import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {
  publicOriginSchema,
  id,
  type GeminiAuthorization,
} from "../../contracts/src/index";

const secret = () => randomBytes(32).toString("base64url");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const matches = (value: string, expected: string) =>
  timingSafeEqual(Buffer.from(digest(value)), Buffer.from(expected));
const scope = "remote_studio";
const minute = 60_000;
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
const invalid = (error = "invalid_request", status = 400) =>
  json({ error }, status);
const redirectSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
  }, "OAuth callbacks must use HTTPS without credentials or fragments.");
const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120).default("MCP client"),
  redirect_uris: z.array(redirectSchema).min(1).max(10),
  token_endpoint_auth_method: z
    .enum(["none", "client_secret_post", "client_secret_basic"])
    .default("client_secret_basic"),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.literal("code")).default(["code"]),
});
type Client = z.infer<typeof registrationSchema> & {
  client_id: string;
  secretHash?: string;
  expires: number;
};
type Pending = GeminiAuthorization & {
  ticketHash: string;
  clientId: string;
  state: string | null;
  challenge: string;
  resource: string;
  decision: "waiting" | "allow" | "deny";
  code?: string;
};
type Grant = {
  clientId: string;
  resource: string;
  expires: number;
  family: string;
};
type Code = Grant & { redirectUri: string; challenge: string };
type Refresh = Grant & { used: boolean };

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const grantSchema = z.object({
  clientId: id,
  resource: z.string().url().max(2048),
  expires: z.number().int().positive(),
  family: id,
});
export const geminiOAuthStateSchema = z
  .object({
    version: z.literal(1),
    origin: publicOriginSchema,
    clients: z
      .array(
        z.tuple([
          id,
          registrationSchema.extend({
            client_id: id,
            secretHash: hashSchema.optional(),
            expires: z.number().int().positive(),
          }),
        ]),
      )
      .max(128),
    access: z.array(z.tuple([hashSchema, grantSchema])).max(256),
    refresh: z
      .array(z.tuple([hashSchema, grantSchema.extend({ used: z.boolean() })]))
      .max(512),
  })
  .strict();
export type GeminiOAuthState = z.infer<typeof geminiOAuthStateSchema>;

// This authorization server holds no UI credential. Only the private parent IPC
// can approve a request; public registration and browser pages cannot grant access.
// Stable-origin sessions can be persisted by the parent using OS encryption.
// Raw bearer tokens, pending browser tickets and authorization codes are never serialized.
export class GeminiOAuth {
  private origin = "";
  private clients = new Map<string, Client>();
  private requests = new Map<string, Pending>();
  private codes = new Map<string, Code>();
  private access = new Map<string, Grant>();
  private refresh = new Map<string, Refresh>();
  private registrations: number[] = [];
  constructor(
    private readonly changed: () => void = () => {},
    private readonly persist: (
      state: GeminiOAuthState,
    ) => Promise<void> = async () => {},
  ) {}
  state(): GeminiOAuthState {
    this.prune();
    return geminiOAuthStateSchema.parse({
      version: 1,
      origin: this.origin,
      clients: [...this.clients],
      access: [...this.access],
      refresh: [...this.refresh],
    });
  }
  restore(raw: unknown) {
    const state = geminiOAuthStateSchema.parse(raw);
    if (
      state.origin !== this.origin ||
      state.access.some(([, g]) => g.resource !== this.resource) ||
      state.refresh.some(([, g]) => g.resource !== this.resource)
    )
      throw new Error("OAuth state belongs to another public origin.");
    this.clients = new Map(state.clients);
    this.access = new Map(state.access);
    this.refresh = new Map(state.refresh);
    this.prune();
  }
  setOrigin(value: string) {
    const next = publicOriginSchema.parse(value);
    if (this.origin && this.origin !== next)
      throw new Error("Restart the adapter to change its public origin.");
    this.origin = next;
  }
  get resource() {
    return this.origin + "/mcp";
  }
  private prune() {
    const now = Date.now();
    for (const map of [this.clients, this.codes, this.access, this.refresh])
      for (const [key, value] of map) if (value.expires <= now) map.delete(key);
    for (const [key, value] of this.requests)
      if (Date.parse(value.expiresAt) <= now) this.requests.delete(key);
  }
  pending(): GeminiAuthorization[] {
    this.prune();
    return [...this.requests.values()]
      .filter((item) => item.decision === "waiting")
      .map(({ id, clientName, redirectUri, pairingCode, expiresAt }) => ({
        id,
        clientName,
        redirectUri,
        pairingCode,
        expiresAt,
      }));
  }
  approve(id: string, allow: boolean) {
    this.prune();
    const request = this.requests.get(id);
    if (!request || request.decision !== "waiting")
      throw new Error(
        "This authorization request expired or was already handled.",
      );
    request.decision = allow ? "allow" : "deny";
    if (allow) {
      request.code = secret();
      this.codes.set(digest(request.code), {
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        challenge: request.challenge,
        resource: request.resource,
        family: randomUUID(),
        expires: Date.now() + 2 * minute,
      });
    }
    this.changed();
  }
  authorized(header: string | null) {
    this.prune();
    const token = header?.match(/^Bearer ([A-Za-z0-9_-]+)$/i)?.[1];
    const grant = token ? this.access.get(digest(token)) : undefined;
    return !!grant && grant.resource === this.resource;
  }
  private page(request: Pending, ticket: string): Response {
    if (request.decision !== "waiting") {
      const callback = new URL(request.redirectUri);
      if (request.state !== null)
        callback.searchParams.set("state", request.state);
      if (request.decision === "allow")
        callback.searchParams.set("code", request.code!);
      else callback.searchParams.set("error", "access_denied");
      return new Response(null, {
        status: 302,
        headers: {
          Location: callback.href,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    const next = `/oauth/decision?id=${request.id}&ticket=${encodeURIComponent(ticket)}`;
    return new Response(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="2;url=${next}"><title>Connect Remote Studio</title><body><h1>Connect Remote Studio</h1><p>Open Remote Studio → Connections → Gemini Web.</p><p>Match this code and approve the connection:</p><h2>${request.pairingCode}</h2><p>Return here after approval. This page will continue automatically.</p><p>เปิด Remote Studio แล้วอนุญาตคำขอที่มีรหัสตรงกัน</p></body></html>`,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Frame-Options": "DENY",
          "Content-Security-Policy":
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        },
      },
    );
  }
  private authenticate(
    request: Request,
    params: URLSearchParams,
  ): Client | null {
    let id = params.get("client_id"),
      provided = params.get("client_secret") ?? "";
    const basic = request.headers.get("authorization");
    if (basic) {
      if (!basic.startsWith("Basic ")) return null;
      const decoded = Buffer.from(basic.slice(6), "base64").toString("utf8");
      const at = decoded.indexOf(":");
      if (at < 0) return null;
      const basicId = decodeURIComponent(decoded.slice(0, at));
      if (id && id !== basicId) return null;
      id = basicId;
      provided = decodeURIComponent(decoded.slice(at + 1));
    }
    const client = id ? this.clients.get(id) : undefined;
    if (!client) return null;
    if (client.token_endpoint_auth_method === "none")
      return basic || provided ? null : client;
    if (
      (client.token_endpoint_auth_method === "client_secret_basic") !==
      !!basic
    )
      return null;
    return client.secretHash && matches(provided, client.secretHash)
      ? client
      : null;
  }
  private revokeFamily(family: string) {
    for (const map of [this.access, this.refresh])
      for (const [key, grant] of map)
        if (grant.family === family) map.delete(key);
  }
  private async tokens(grant: Grant, client: Client) {
    if (this.access.size >= 256 || this.refresh.size >= 512)
      return invalid("temporarily_unavailable", 503);
    const accessToken = secret(),
      refreshToken = secret();
    this.access.set(digest(accessToken), {
      ...grant,
      expires: Date.now() + 60 * minute,
    });
    const canRefresh = client.grant_types.includes("refresh_token");
    if (canRefresh)
      this.refresh.set(digest(refreshToken), {
        ...grant,
        expires: Date.now() + 7 * 24 * 60 * minute,
        used: false,
      });
    await this.persist(this.state());
    return json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope,
      ...(canRefresh ? { refresh_token: refreshToken } : {}),
    });
  }
  async handle(request: Request): Promise<Response | null> {
    this.prune();
    const url = new URL(request.url),
      path = url.pathname;
    if (!path.startsWith("/oauth/") && !path.startsWith("/.well-known/"))
      return null;
    if (!this.origin) return invalid("temporarily_unavailable", 503);
    try {
      if (
        request.method === "GET" &&
        [
          "/.well-known/oauth-protected-resource",
          "/.well-known/oauth-protected-resource/mcp",
        ].includes(path)
      )
        return json({
          resource: this.resource,
          resource_name: "Remote Studio",
          authorization_servers: [this.origin],
          scopes_supported: [scope],
          bearer_methods_supported: ["header"],
        });
      if (
        request.method === "GET" &&
        path === "/.well-known/oauth-authorization-server"
      )
        return json({
          issuer: this.origin,
          authorization_endpoint: this.origin + "/oauth/authorize",
          token_endpoint: this.origin + "/oauth/token",
          registration_endpoint: this.origin + "/oauth/register",
          revocation_endpoint: this.origin + "/oauth/revoke",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: [
            "none",
            "client_secret_post",
            "client_secret_basic",
          ],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: [scope, "offline_access"],
        });
      if (request.method === "POST" && path === "/oauth/register") {
        this.registrations = this.registrations.filter(
          (time) => time > Date.now() - minute,
        );
        if (this.registrations.length >= 20 || this.clients.size >= 128)
          return invalid("temporarily_unavailable", 429);
        this.registrations.push(Date.now());
        if (
          !request.headers.get("content-type")?.startsWith("application/json")
        )
          return invalid();
        const metadata = registrationSchema.parse(await request.json());
        if (!metadata.grant_types.includes("authorization_code"))
          return invalid();
        const clientId = randomUUID(),
          clientSecret = secret();
        this.clients.set(clientId, {
          ...metadata,
          client_id: clientId,
          expires: Date.now() + 7 * 24 * 60 * minute,
          ...(metadata.token_endpoint_auth_method !== "none"
            ? { secretHash: digest(clientSecret) }
            : {}),
        });
        await this.persist(this.state());
        return json(
          {
            ...metadata,
            client_id: clientId,
            client_id_issued_at: Math.floor(Date.now() / 1000),
            ...(metadata.token_endpoint_auth_method !== "none"
              ? {
                  client_secret: clientSecret,
                  client_secret_expires_at:
                    Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
                }
              : {}),
          },
          201,
        );
      }
      if (request.method === "GET" && path === "/oauth/authorize") {
        const params = url.searchParams,
          client = this.clients.get(params.get("client_id") ?? "");
        const redirectUri = params.get("redirect_uri") ?? "",
          challenge = params.get("code_challenge") ?? "";
        // Do not redirect any malformed request, even if a callback is supplied.
        if (
          !client ||
          !client.redirect_uris.includes(redirectUri) ||
          params.get("response_type") !== "code" ||
          params.get("code_challenge_method") !== "S256" ||
          !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
          (params.get("resource") &&
            params.get("resource") !== this.resource) ||
          (params.get("scope") ?? scope)
            .split(" ")
            .some((s) => ![scope, "offline_access"].includes(s)) ||
          this.requests.size >= 32
        )
          return invalid();
        const ticket = secret();
        const pending: Pending = {
          id: randomUUID(),
          clientName: client.client_name,
          redirectUri,
          clientId: client.client_id,
          state: params.get("state"),
          challenge,
          resource: this.resource,
          pairingCode: String(randomInt(100000, 1000000)),
          ticketHash: digest(ticket),
          expiresAt: new Date(Date.now() + 10 * minute).toISOString(),
          decision: "waiting",
        };
        this.requests.set(pending.id, pending);
        this.changed();
        return this.page(pending, ticket);
      }
      if (request.method === "GET" && path === "/oauth/decision") {
        const pending = this.requests.get(url.searchParams.get("id") ?? "");
        const ticket = url.searchParams.get("ticket") ?? "";
        if (!pending || !matches(ticket, pending.ticketHash)) return invalid();
        return this.page(pending, ticket);
      }
      if (
        request.method === "POST" &&
        ["/oauth/token", "/oauth/revoke"].includes(path)
      ) {
        if (
          !request.headers
            .get("content-type")
            ?.startsWith("application/x-www-form-urlencoded")
        )
          return invalid();
        const params = new URLSearchParams(await request.text()),
          client = this.authenticate(request, params);
        if (!client) return invalid("invalid_client", 401);
        if (path === "/oauth/revoke") {
          const key = digest(params.get("token") ?? ""),
            grant = this.access.get(key) ?? this.refresh.get(key);
          if (grant?.clientId === client.client_id)
            this.revokeFamily(grant.family);
          await this.persist(this.state());
          return new Response(null, {
            status: 200,
            headers: { "Cache-Control": "no-store" },
          });
        }
        if (params.get("resource") && params.get("resource") !== this.resource)
          return invalid("invalid_target");
        if (params.get("grant_type") === "authorization_code") {
          const key = digest(params.get("code") ?? ""),
            code = this.codes.get(key);
          this.codes.delete(key); // Authorization codes are one use, including failed exchanges.
          const verifier = params.get("code_verifier") ?? "";
          if (
            !code ||
            code.clientId !== client.client_id ||
            code.redirectUri !== params.get("redirect_uri") ||
            !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
            createHash("sha256").update(verifier).digest("base64url") !==
              code.challenge
          )
            return invalid("invalid_grant");
          return await this.tokens(code, client);
        }
        if (params.get("grant_type") === "refresh_token") {
          const grant = this.refresh.get(
            digest(params.get("refresh_token") ?? ""),
          );
          if (
            !grant ||
            grant.clientId !== client.client_id ||
            !client.grant_types.includes("refresh_token")
          )
            return invalid("invalid_grant");
          if (grant.used) {
            this.revokeFamily(grant.family);
            await this.persist(this.state());
            return invalid("invalid_grant");
          }
          grant.used = true;
          return await this.tokens(grant, client);
        }
        return invalid("unsupported_grant_type");
      }
      return invalid("invalid_request", 404);
    } catch {
      return invalid();
    }
  }
}
