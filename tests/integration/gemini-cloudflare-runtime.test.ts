import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { GeminiController } from "../../packages/gemini/src/index";
import { adminToken, rpc } from "../../packages/shared/src/rpc";
import { waitFor } from "../helpers";

// Explicit opt-in: real outbound Cloudflare traffic, isolated empty folder,
// no production credentials, and no claim about a real Gemini account.
it.skipIf(!process.env.STUDIO_TEST_CLOUDFLARED_RUNTIME)(
  "official cloudflared exposes only OAuth-protected MCP over public HTTPS",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rs-cloudflare-live-")),
      data = join(root, "data");
    await mkdir(join(root, "empty-workspace"));
    const agent = spawn(
      process.execPath,
      [resolve("dist/services/agent.mjs"), "--test-license", "--data", data],
      { stdio: "ignore" },
    );
    const admin = await adminToken(data);
    const bridge = (id: string, name = "bridge") => ({
      command: process.execPath,
      args: [
        resolve(`dist/services/${name}.mjs`),
        "--credential",
        join(data, "clients", id + ".json"),
      ],
      env: {},
    });
    const controller = new GeminiController({
      directory: data,
      vault: {
        available: () => false,
        encrypt: () => {
          throw new Error("No secrets used by quick tunnels.");
        },
        decrypt: () => {
          throw new Error("No secrets used by quick tunnels.");
        },
      },
      async createGrant(settings) {
        return (
          await rpc<any>(data, admin, "connection.create", {
            name: "Cloudflare live acceptance",
            ...settings,
          })
        ).clientId;
      },
      async revokeGrant(id) {
        await rpc(data, admin, "connection.revoke", id);
      },
      async checkGrant(id) {
        await rpc(data, admin, "connection.secret", id);
      },
      async testBridge(id) {
        const client = new Client({
          name: "cloudflare-local-check",
          version: "1",
        });
        try {
          await client.connect(new StdioClientTransport(bridge(id)));
          return { toolCount: (await client.listTools()).tools.length };
        } finally {
          await client.close();
        }
      },
      httpBridge: (id) => bridge(id, "http-bridge"),
      changed() {},
    });
    try {
      await waitFor(
        () => rpc(data, admin, "snapshot").catch(() => null),
        (v) => !!v,
      );
      const [folder] = await rpc<any>(data, admin, "workspace.add", {
        paths: [join(root, "empty-workspace")],
      });
      await controller.initialize([
        process.env.STUDIO_TEST_CLOUDFLARED_RUNTIME!,
      ]);
      await controller.save({
        mode: "quick",
        publicOrigin: "",
        localPort: 8766,
        workspaceIds: [folder.id],
        write: false,
        autoStart: false,
      });
      await controller.start();
      const ready = await waitFor(
        () => controller.snapshot(),
        (s) => s.phase === "ready",
        40_000,
      );
      expect(ready.mcpUrl).toMatch(
        /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/mcp$/,
      );
      const checked = await waitFor(
        () => controller.test(),
        (s) => !!s.publicVerifiedAt,
        20_000,
      ).catch(async (error) => {
        try {
          const response = await fetch(
            new URL(ready.mcpUrl!).origin +
              "/.well-known/oauth-protected-resource/mcp",
            { signal: AbortSignal.timeout(5000) },
          );
          throw new Error(
            `${(error as Error).message} · HTTP ${response.status} · ${(await response.text()).slice(0, 600)}`,
          );
        } catch (diagnostic) {
          throw new Error(
            `Public metadata failed: ${(diagnostic as Error).message} · ${JSON.stringify((diagnostic as { cause?: unknown }).cause ?? {})}`,
          );
        }
      });
      expect(checked.publicVerifiedAt).not.toBeNull();
      const request = await fetch(ready.mcpUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
        signal: AbortSignal.timeout(10_000),
      });
      expect(request.status).toBe(401);
      expect(request.headers.get("www-authenticate")).toContain(
        "oauth-protected-resource/mcp",
      );
      const origin = new URL(ready.mcpUrl!).origin;
      expect(
        (
          await fetch(origin + "/studio/snapshot", {
            signal: AbortSignal.timeout(10_000),
          })
        ).status,
      ).toBe(404);
      expect(controller.snapshot().lastToolAt).toBeNull();
    } finally {
      await controller.forget();
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
  },
  90_000,
);
