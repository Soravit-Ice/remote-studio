import { expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { adminToken, rpc } from "../../packages/shared/src/rpc";
import {
  bridgeCommand,
  healthBase,
  tunnelEnvironment,
} from "../../packages/tunnel/src/index";
import { waitFor } from "../helpers";

const runtime =
  process.env.STUDIO_TEST_TUNNEL_RUNTIME ??
  ["/opt/homebrew/bin/tunnel-client", "/usr/local/bin/tunnel-client"].find(
    existsSync,
  );
it.skipIf(!runtime || process.platform === "win32")(
  "official installed tunnel-client forwards real MCP discovery and workspace tool results through a loopback control-plane fixture",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rs official tunnel-' space-"));
    const directory = join(root, "data"),
      workspace = join(root, "workspace");
    await mkdir(workspace);
    const agent = spawn(
      process.execPath,
      [
        resolve("dist/services/agent.mjs"),
        "--test-license",
        "--data",
        directory,
      ],
      { stdio: "ignore", env: tunnelEnvironment() },
    );
    let child: ChildProcess | undefined;
    const posted: any[] = [];
    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "loopback-tunnel-test", version: "1.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "workspace_list", arguments: {} },
      },
    ];
    let delivered = 0;
    const requests: unknown[] = [];
    const server = createServer(async (request, response) => {
      let text = "";
      for await (const chunk of request) text += chunk;
      const body = text ? JSON.parse(text) : {};
      if (requests.length < 10) requests.push({ url: request.url, body });
      response.setHeader("Content-Type", "application/json");
      if (body.request_id) {
        posted.push(body);
        response.end("{}");
        return;
      }
      if (!request.url?.split("?")[0].endsWith("/poll")) {
        response.end("{}");
        return;
      }
      const commands: unknown[] = [];
      if (delivered < messages.length && posted.length >= delivered) {
        commands.push({
          request_id: "test-command-" + delivered,
          shard_token: "test-shard",
          command_type: "jsonrpc",
          channel: "main",
          created_at: new Date().toISOString(),
          headers: {},
          jsonrpc: messages[delivered],
        });
        delivered++;
      }
      // A real long poll would wait. This bounded local fixture prevents spinning.
      setTimeout(() => response.end(JSON.stringify({ commands })), 40);
    });
    let logs = "";
    try {
      const token = await adminToken(directory);
      await waitFor(
        async () => {
          try {
            return await rpc(directory, token, "snapshot");
          } catch {
            return null;
          }
        },
        Boolean,
        10000,
      );
      const [w] = await rpc(directory, token, "workspace.add", {
        paths: [workspace],
      });
      const { clientId } = await rpc(directory, token, "connection.create", {
        name: "Official tunnel loopback test",
        workspaceIds: [w.id],
        write: false,
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address() as { port: number };
      // Only this test redirects the official CLI to a local mock. Production
      // controller fixes the destination to api.openai.com and cannot accept URLs.
      child = spawn(
        runtime!,
        [
          "run",
          "--control-plane.base-url",
          `http://127.0.0.1:${address.port}`,
          "--control-plane.tunnel-id",
          "tunnel_0123456789abcdef0123456789abcdef",
          "--control-plane.api-key",
          "env:CONTROL_PLANE_API_KEY",
          "--mcp.command",
          "channel=main,command=" +
            bridgeCommand({
              command: process.execPath,
              args: [
                resolve("dist/services/bridge.mjs"),
                "--credential",
                join(directory, "clients", clientId + ".json"),
              ],
              env: { ELECTRON_RUN_AS_NODE: "1" },
            }),
          "--health.listen-addr",
          "127.0.0.1:0",
          "--health.url-file",
          join(root, "health.url"),
          "--log.format",
          "json",
          "--log.level",
          "info",
          "--log.file",
          "",
          "--log.http-raw-unsafe=false",
        ],
        {
          env: tunnelEnvironment("sk-loopback-fixture-not-a-real-key"),
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        },
      );
      child.stdout!.on("data", (b) => {
        logs = (logs + b.toString()).slice(-12000);
      });
      child.stderr!.on("data", (b) => {
        logs = (logs + b.toString()).slice(-12000);
      });
      await waitFor(
        async () => posted,
        (values) => values.some((v) => v.resp_json?.id === 3),
        12000,
      ).catch(() => {
        throw new Error(
          "Official runtime forwarding failed: " +
            JSON.stringify(requests) +
            logs,
        );
      });
      expect(
        posted.find((v) => v.resp_json?.id === 1)?.resp_json.result.serverInfo
          .name,
      ).toBe("remote-studio");
      expect(
        posted.find((v) => v.resp_json?.id === 2)?.resp_json.result.tools
          .length,
      ).toBeGreaterThanOrEqual(17);
      const result = posted.find((v) => v.resp_json?.id === 3);
      expect(result.resp_code).toBe(200);
      expect(result.resp_json.result.isError).not.toBe(true);
      expect(JSON.stringify(result.resp_json.result)).toContain(w.id);
      expect(JSON.stringify(result.resp_json.result)).not.toContain(
        "sk-loopback",
      );
      const health = healthBase(
        await readFile(join(root, "health.url"), "utf8"),
      );
      const metrics = await (await fetch(new URL("/metrics", health))).text();
      expect(
        Number(
          metrics.match(
            /^commands_poll_last_successful_timestamp_seconds(?:\{[^\n]*\})?\s+([0-9.]+)/m,
          )?.[1] ?? 0,
        ),
      ).toBeGreaterThan(0);
    } finally {
      if (child?.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* exited */
        }
      }
      agent.kill("SIGTERM");
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
);
