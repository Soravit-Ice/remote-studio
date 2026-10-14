import { expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { startHttpBridge } from "../../services/mcp-bridge/src/http";
import { adminToken, rpc } from "../../packages/shared/src/rpc";
import { waitFor } from "../helpers";

it("serves authenticated MCP SDK v2 over JSON HTTP with folder scope and immediate grant revocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-gemini-http-")),
    data = join(root, "data");
  await mkdir(join(root, "allowed"));
  await mkdir(join(root, "hidden"));
  const agent = spawn(
    process.execPath,
    [resolve("dist/services/agent.mjs"), "--test-license", "--data", data],
    { stdio: "ignore" },
  );
  const admin = await adminToken(data);
  let adapter: Awaited<ReturnType<typeof startHttpBridge>> | undefined;
  let client: Client | undefined;
  try {
    await waitFor(
      () => rpc(data, admin, "snapshot").catch(() => null),
      (v) => !!v,
    );
    const folders = await rpc<any>(data, admin, "workspace.add", {
      paths: [join(root, "allowed"), join(root, "hidden")],
    });
    const { clientId } = await rpc<any>(data, admin, "connection.create", {
      name: "Gemini HTTP test",
      workspaceIds: [folders[0].id],
      write: false,
    });
    const credentials = JSON.parse(
      await readFile(join(data, "clients", clientId + ".json"), "utf8"),
    );
    const events: Record<string, any>[] = [];
    adapter = await startHttpBridge(credentials, 0, (event) =>
      events.push(event),
    );
    const origin = "https://studio.example.com";
    adapter.setOrigin(origin);
    const base = adapter.localOrigin;
    const request = (path: string, init?: RequestInit) =>
      fetch(base + path, init);
    const unauthorized = await request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain(
      origin + "/.well-known/oauth-protected-resource/mcp",
    );
    expect(
      (
        await request("/mcp", {
          headers: { Origin: "https://attacker.example.com" },
        })
      ).status,
    ).toBe(403);
    const badHost = await new Promise<number>((resolve, reject) => {
      const call = httpRequest(
        base + "/mcp",
        { headers: { Host: "attacker.example.com" } },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      call.on("error", reject);
      call.end();
    });
    expect(badHost).toBe(421);
    expect((await request("/studio/snapshot")).status).toBe(404);
    const registration = await (
      await request("/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Gemini HTTP acceptance",
          redirect_uris: ["https://gemini.google.com/callback"],
          token_endpoint_auth_method: "none",
        }),
      })
    ).json();
    const verifier = "v".repeat(64);
    const params = new URLSearchParams({
      client_id: registration.client_id,
      redirect_uri: "https://gemini.google.com/callback",
      response_type: "code",
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      resource: origin + "/mcp",
      state: "test-state",
    });
    const html = await (await request("/oauth/authorize?" + params)).text();
    const decision = html.match(/url=([^"<]+)/)![1];
    const pending = events.find((e) => e.type === "pending" && e.pending.length)
      ?.pending[0];
    expect(pending).toBeDefined();
    expect((await request(decision)).status).toBe(200);
    adapter.approve(pending.id, true);
    const callback = await request(decision, { redirect: "manual" });
    expect(callback.status).toBe(302);
    const code = new URL(callback.headers.get("location")!).searchParams.get(
      "code",
    )!;
    const tokens = await (
      await request("/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: registration.client_id,
          redirect_uri: "https://gemini.google.com/callback",
          code_verifier: verifier,
          resource: origin + "/mcp",
        }),
      })
    ).json();
    expect(tokens.access_token).toBeDefined();
    client = new Client({ name: "gemini-http-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
        requestInit: {
          headers: { Authorization: "Bearer " + tokens.access_token },
        },
      }),
    );
    expect(client.getServerVersion()?.name).toBe("remote_studio");
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain("workspace_list");
    expect(tools).not.toContain("file_write");
    const foldersResult = await client.callTool({
      name: "workspace_list",
      arguments: {},
    });
    expect(
      (foldersResult.structuredContent as any).data.map((w: any) => w.id),
    ).toEqual([folders[0].id]);
    const blocked = await client.callTool({
      name: "file_read",
      arguments: { workspaceId: folders[1].id, path: "secret.txt" },
    });
    expect(blocked.isError).toBe(true);
    const legacy = await request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer " + tokens.access_token,
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy-json-client", version: "1" },
        },
      }),
    });
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("content-type")).toContain("application/json");
    expect((await legacy.json()).result.serverInfo.name).toBe("remote_studio");
    expect(events.some((e) => e.type === "tool")).toBe(true);
    await rpc(data, admin, "connection.revoke", clientId);
    await expect(client.listTools()).rejects.toThrow();
  } finally {
    await client?.close();
    await adapter?.close();
    agent.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (agent.exitCode !== null) resolve();
      else {
        agent.once("exit", () => resolve());
        setTimeout(() => {
          agent.kill("SIGKILL");
          resolve();
        }, 2000).unref();
      }
    });
    await rm(root, { recursive: true, force: true });
  }
});
