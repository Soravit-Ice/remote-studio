import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { GeminiOAuth } from "../../packages/gemini/src/oauth";
import {
  geminiSettingsSchema,
  publicOriginSchema,
} from "../../packages/contracts/src/index";

const origin = "https://studio.example.com",
  callback = "https://gemini.google.com/oauth/callback";
const verifier = "a".repeat(64),
  challenge = createHash("sha256").update(verifier).digest("base64url");
const req = (path: string, body?: unknown) =>
  new Request(
    origin + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
async function registration(auth: GeminiOAuth, method = "none") {
  const response = await auth.handle(
    req("/oauth/register", {
      client_name: "Gemini",
      redirect_uris: [callback],
      token_endpoint_auth_method: method,
    }),
  );
  expect(response?.status).toBe(201);
  return response!.json();
}
async function authorize(
  auth: GeminiOAuth,
  client: any,
  overrides: Record<string, string> = {},
) {
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: callback,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: challenge,
    state: "state with spaces & =",
    resource: origin + "/mcp",
    ...overrides,
  });
  const response = await auth.handle(req("/oauth/authorize?" + params));
  const html = await response!.text();
  return { response: response!, decision: html.match(/url=([^"<]+)/)?.[1] };
}
async function code(auth: GeminiOAuth, client: any) {
  const { decision } = await authorize(auth, client);
  expect(decision).toBeDefined();
  const [pending] = auth.pending();
  auth.approve(pending.id, true);
  const redirect = await auth.handle(req(decision!));
  expect(redirect?.status).toBe(302);
  const location = new URL(redirect!.headers.get("location")!);
  expect(location.searchParams.get("state")).toBe("state with spaces & =");
  return location.searchParams.get("code")!;
}
async function exchange(
  auth: GeminiOAuth,
  client: any,
  values: Record<string, string>,
  basic = false,
) {
  const params = new URLSearchParams({
    client_id: client.client_id,
    ...values,
  });
  if (client.client_secret && !basic)
    params.set("client_secret", client.client_secret);
  return (await auth.handle(
    new Request(origin + "/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(basic
          ? {
              Authorization:
                "Basic " +
                Buffer.from(
                  client.client_id + ":" + client.client_secret,
                ).toString("base64"),
            }
          : {}),
      },
      body: params,
    }),
  ))!;
}
const grantBody = (code: string, codeVerifier = verifier) => ({
  grant_type: "authorization_code",
  code,
  redirect_uri: callback,
  code_verifier: codeVerifier,
});
function fixture() {
  const auth = new GeminiOAuth();
  auth.setOrigin(origin);
  return auth;
}

describe("Gemini OAuth consent and credential boundaries", () => {
  it("publishes discovery and requires local approval before issuing a code", async () => {
    const auth = fixture();
    expect(
      await (await auth.handle(
        req("/.well-known/oauth-protected-resource/mcp"),
      ))!.json(),
    ).toMatchObject({
      resource: origin + "/mcp",
      authorization_servers: [origin],
    });
    expect(
      await (await auth.handle(
        req("/.well-known/oauth-authorization-server"),
      ))!.json(),
    ).toMatchObject({
      issuer: origin,
      code_challenge_methods_supported: ["S256"],
    });
    const client = await registration(auth),
      { decision } = await authorize(auth, client);
    expect((await auth.handle(req(decision!)))?.status).toBe(200);
    expect(auth.pending()).toHaveLength(1);
    expect(JSON.stringify(auth.pending())).not.toContain("ticket");
    expect(
      (
        await auth.handle(
          req("/oauth/decision?id=" + auth.pending()[0].id + "&ticket=wrong"),
        )
      )?.status,
    ).toBe(400);
    expect(await auth.handle(req("/approve"))).toBeNull();
    expect(auth.authorized(null)).toBe(false);
    auth.approve(auth.pending()[0].id, false);
    const denied = await auth.handle(req(decision!));
    expect(
      new URL(denied!.headers.get("location")!).searchParams.get("error"),
    ).toBe("access_denied");
    expect(() => auth.approve("missing", true)).toThrow();
  });
  it("rejects callback substitution, PKCE downgrade, audience and scope escalation", async () => {
    const auth = fixture(),
      client = await registration(auth);
    const invalidRequests: Record<string, string>[] = [
      { redirect_uri: "https://attacker.example.com/callback" },
      { code_challenge_method: "plain" },
      { code_challenge: "bad" },
      { resource: "https://other.example.com/mcp" },
      { scope: "admin" },
    ];
    for (const overrides of invalidRequests) {
      expect((await authorize(auth, client, overrides)).response.status).toBe(
        400,
      );
    }
    expect(auth.pending()).toHaveLength(0);
    expect(
      (
        await auth.handle(
          req("/oauth/register", {
            redirect_uris: ["http://attacker.example.com/callback"],
          }),
        )
      )?.status,
    ).toBe(400);
  });
  it("uses one-time PKCE codes and rejects incorrect verifiers and replay", async () => {
    const auth = fixture(),
      client = await registration(auth);
    const bad = await code(auth, client);
    expect(
      (await exchange(auth, client, grantBody(bad, "b".repeat(64)))).status,
    ).toBe(400);
    expect((await exchange(auth, client, grantBody(bad))).status).toBe(400);
    const good = await code(auth, client);
    const tokens = await (await exchange(auth, client, grantBody(good))).json();
    expect(auth.authorized("Bearer " + tokens.access_token)).toBe(true);
    expect(auth.authorized("Bearer " + tokens.refresh_token)).toBe(false);
    expect((await exchange(auth, client, grantBody(good))).status).toBe(400);
    expect(() => auth.setOrigin("https://replacement.example.com")).toThrow();
    expect(fixture().authorized("Bearer " + tokens.access_token)).toBe(false);
  });
  it("authenticates confidential clients using only their registered method", async () => {
    for (const method of ["client_secret_basic", "client_secret_post"]) {
      const auth = fixture(),
        client = await registration(auth, method),
        value = await code(auth, client);
      const correctBasic = method === "client_secret_basic";
      expect(
        (await exchange(auth, client, grantBody(value), !correctBasic)).status,
      ).toBe(401);
      expect(
        (
          await exchange(
            auth,
            { ...client, client_secret: "wrong" },
            grantBody(value),
            correctBasic,
          )
        ).status,
      ).toBe(401);
      expect(
        (await exchange(auth, client, grantBody(value), correctBasic)).status,
      ).toBe(200);
    }
  });
  it("rotates refresh tokens, binds them to clients, and revokes the family on replay", async () => {
    const auth = fixture(),
      client = await registration(auth),
      other = await registration(auth);
    const first = await (
      await exchange(auth, client, grantBody(await code(auth, client)))
    ).json();
    const refreshBody = {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
    };
    expect((await exchange(auth, other, refreshBody)).status).toBe(400);
    expect(
      (
        await exchange(auth, client, {
          ...refreshBody,
          resource: "https://other.example.com/mcp",
        })
      ).status,
    ).toBe(400);
    const second = await (await exchange(auth, client, refreshBody)).json();
    expect(auth.authorized("Bearer " + second.access_token)).toBe(true);
    expect((await exchange(auth, client, refreshBody)).status).toBe(400);
    expect(auth.authorized("Bearer " + first.access_token)).toBe(false);
    expect(auth.authorized("Bearer " + second.access_token)).toBe(false);
  });
  it("expires pending approval, codes, and bearer tokens", async () => {
    const auth = fixture(),
      client = await registration(auth);
    const now = Date.now();
    const value = await code(auth, client);
    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(now + 3 * 60_000);
      expect((await exchange(auth, client, grantBody(value))).status).toBe(400);
      clock.mockReturnValue(now);
      const tokens = await (
        await exchange(auth, client, grantBody(await code(auth, client)))
      ).json();
      clock.mockReturnValue(now + 61 * 60_000);
      expect(auth.authorized("Bearer " + tokens.access_token)).toBe(false);
      expect(auth.pending()).toHaveLength(0);
    } finally {
      clock.mockRestore();
    }
  });
  it("bounds registration abuse and validates public HTTPS setup", async () => {
    const auth = fixture();
    for (let i = 0; i < 20; i++) await registration(auth);
    expect(
      (await auth.handle(req("/oauth/register", { redirect_uris: [callback] })))
        ?.status,
    ).toBe(429);
    for (const origin of [
      "http://studio.example.com",
      "https://127.0.0.1",
      "https://studio.example.com/mcp",
      "https://user:pass@studio.example.com",
      "https://studio.example.com?token=secret",
    ])
      expect(publicOriginSchema.safeParse(origin).success).toBe(false);
    expect(
      geminiSettingsSchema.safeParse({
        mode: "named",
        workspaceIds: [],
        write: false,
        autoStart: false,
      }).success,
    ).toBe(false);
  });
  it("persists only hashed credentials and restores sessions for the same origin", async () => {
    const auth = fixture(),
      client = await registration(auth, "client_secret_post");
    const tokens = await (
      await exchange(auth, client, grantBody(await code(auth, client)))
    ).json();
    const state = auth.state();
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain(tokens.access_token);
    expect(serialized).not.toContain(tokens.refresh_token);
    expect(serialized).not.toContain(client.client_secret);
    expect(serialized).not.toContain("ticket");
    const restored = fixture();
    restored.restore(state);
    expect(restored.authorized("Bearer " + tokens.access_token)).toBe(true);
    expect(
      (
        await exchange(restored, client, {
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        })
      ).status,
    ).toBe(200);
    const other = new GeminiOAuth();
    other.setOrigin("https://other.example.com");
    expect(() => other.restore(state)).toThrow("another public origin");
    expect(() =>
      restored.restore({
        ...state,
        access: [["raw-bearer-token", state.access[0][1]]],
      }),
    ).toThrow();
  });
  it("awaits secure storage before returning new OAuth credentials", async () => {
    const persist = vi.fn(async () => {
      throw new Error("Locked vault");
    });
    const auth = new GeminiOAuth(() => {}, persist);
    auth.setOrigin(origin);
    const response = await auth.handle(
      req("/oauth/register", { redirect_uris: [callback] }),
    );
    expect(response?.status).toBe(400);
    expect(await response!.text()).not.toContain("client_secret");
    expect(persist).toHaveBeenCalledOnce();
  });
});
