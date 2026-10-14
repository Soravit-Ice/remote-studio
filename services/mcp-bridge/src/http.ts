import { createServer } from "node:http";
import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import {
  GeminiOAuth,
  type GeminiOAuthState,
} from "../../../packages/gemini/src/oauth";
import { rpc } from "../../../packages/shared/src/rpc";
import { createBridge } from "./server";

export async function startHttpBridge(
  credentials: { directory: string; token: string },
  port: number,
  changed: (event: Record<string, unknown>) => void,
  persist?: (state: GeminiOAuthState) => Promise<void>,
) {
  let origin = "",
    localOrigin = "",
    active = 0;
  const oauth = new GeminiOAuth(
    () => changed({ type: "pending", pending: oauth.pending() }),
    persist,
  );
  const factory = () =>
    createBridge(credentials.directory, credentials.token, "remote_studio");
  const modern = createMcpHandler(factory, {
    legacy: "reject",
    responseMode: "json",
    maxSubscriptions: 0,
    maxRequestBodySize: 1024 * 1024,
  });
  const http = createServer({ maxHeaderSize: 16384 }, (req, res) => {
    void (async () => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (!origin) {
        res.writeHead(503).end();
        return;
      }
      if (
        req.headers.host !== new URL(origin).host &&
        req.headers.host !== new URL(localOrigin).host
      ) {
        res.writeHead(421).end();
        return;
      }
      if (
        req.headers.origin &&
        ![origin, localOrigin, "https://gemini.google.com"].includes(
          req.headers.origin,
        )
      ) {
        res.writeHead(403).end();
        return;
      }
      if (req.headers.origin) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Vary", "Origin");
        res.setHeader(
          "Access-Control-Expose-Headers",
          "WWW-Authenticate, MCP-Protocol-Version",
        );
      }
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Accept",
        );
        res.writeHead(204).end();
        return;
      }
      if ((req.url?.length ?? 0) > 8192) {
        res.writeHead(414).end();
        return;
      }
      if (active >= 32) {
        res.writeHead(429).end();
        return;
      }
      active++;
      try {
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1024 * 1024) {
            res.writeHead(413).end();
            return;
          }
          chunks.push(chunk);
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers))
          if (value)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        const request = new Request(new URL(req.url ?? "/", origin), {
          method: req.method,
          headers,
          ...(["GET", "HEAD"].includes(req.method ?? "GET")
            ? {}
            : { body: Buffer.concat(chunks) }),
        });
        let response = await oauth.handle(request);
        if (!response && new URL(request.url).pathname === "/mcp") {
          if (!oauth.authorized(request.headers.get("authorization"))) {
            response = Response.json(
              { error: "invalid_token" },
              {
                status: 401,
                headers: {
                  "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="remote_studio"`,
                },
              },
            );
          } else {
            // Resolve this scoped credential on every request, including tool discovery.
            await rpc(
              credentials.directory,
              credentials.token,
              "tool.list",
              {},
              "client",
            );
            if (request.method !== "POST")
              response = new Response(null, {
                status: 405,
                headers: { Allow: "POST" },
              });
            else if (
              !headers.get("content-type")?.startsWith("application/json")
            )
              response = new Response(null, { status: 415 });
            else {
              const parsedBody = JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
              );
              if (await isLegacyRequest(request, parsedBody)) {
                const server = await factory();
                const transport = new WebStandardStreamableHTTPServerTransport({
                  sessionIdGenerator: undefined,
                  enableJsonResponse: true,
                });
                try {
                  await server.connect(transport);
                  const result = await transport.handleRequest(request, {
                    parsedBody,
                  });
                  response = new Response(await result.arrayBuffer(), {
                    status: result.status,
                    headers: result.headers,
                  });
                } finally {
                  await server.close();
                }
              } else response = await modern.fetch(request, { parsedBody });
              if (parsedBody.method === "tools/call" && response.ok)
                changed({ type: "tool", at: new Date().toISOString() });
            }
          }
        }
        response ??= new Response(null, { status: 404 });
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res
          .writeHead(response.status)
          .end(Buffer.from(await response.arrayBuffer()));
      } finally {
        active--;
      }
    })().catch(() => {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    });
  });
  http.requestTimeout = 30_000;
  http.headersTimeout = 10_000;
  http.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, "127.0.0.1", resolve);
  });
  const address = http.address();
  if (!address || typeof address === "string")
    throw new Error("Could not bind the MCP adapter.");
  localOrigin = `http://127.0.0.1:${address.port}`;
  return {
    localOrigin,
    setOrigin(value: string, state?: unknown) {
      oauth.setOrigin(value);
      if (state) oauth.restore(state);
      origin = new URL(oauth.resource).origin;
    },
    approve(id: string, allow: boolean) {
      oauth.approve(id, allow);
    },
    pending: () => oauth.pending(),
    async close() {
      http.closeAllConnections();
      await modern.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
