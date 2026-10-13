import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  readFile,
  copyFile,
  chmod,
  rm,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  TunnelController,
  bridgeCommand,
  healthBase,
  redact,
  tunnelEnvironment,
  type TunnelDependencies,
} from "../../packages/tunnel/src/index";
import { findTunnelConflict } from "../../packages/tunnel/src/conflicts";

describe("secure tunnel management", () => {
  let root: string, executable: string, controller: TunnelController;
  let available = true,
    bridgeFails = false;
  let grants: Map<
    string,
    { revoked: boolean; workspaceIds: string[]; write: boolean }
  >;
  let dependencies: TunnelDependencies;
  const key = "sk-fixture-runtime-secret-123456789";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rs tunnel-' quote-"));
    executable = join(root, "tunnel-client");
    await copyFile("tests/fixtures/tunnel-client.mjs", executable);
    await chmod(executable, 0o700);
    grants = new Map();
    available = true;
    bridgeFails = false;
    const encryptionKey = randomBytes(32);
    dependencies = {
      directory: root,
      vault: {
        available: () => available,
        encrypt: (value) => {
          const iv = randomBytes(12),
            cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
          const ciphertext = Buffer.concat([
            cipher.update(value, "utf8"),
            cipher.final(),
          ]);
          return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
        },
        decrypt: (value) => {
          const cipher = createDecipheriv(
            "aes-256-gcm",
            encryptionKey,
            value.subarray(0, 12),
          );
          cipher.setAuthTag(value.subarray(12, 28));
          return Buffer.concat([
            cipher.update(value.subarray(28)),
            cipher.final(),
          ]).toString("utf8");
        },
      },
      createGrant: async (settings) => {
        expect(settings).not.toHaveProperty("apiKey");
        const id = randomUUID();
        grants.set(id, { ...settings, revoked: false });
        return id;
      },
      revokeGrant: async (id) => {
        grants.get(id)!.revoked = true;
      },
      checkGrant: async (id) => {
        if (!grants.has(id) || grants.get(id)!.revoked)
          throw new Error("Connection has been revoked.");
      },
      testBridge: async () => {
        if (bridgeFails) throw new Error("Real bridge diagnostic failed.");
        return { toolCount: 21 };
      },
      bridge: (id) => ({
        command: process.execPath,
        args: [
          join(root, 'bridge "$().mjs'),
          "--credential",
          join(root, id + ".json"),
        ],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      }),
      changed: () => {},
      checkConflict: async () => null,
    };
    controller = new TunnelController(dependencies);
    await controller.initialize([executable]);
  });
  afterEach(async () => {
    await controller.stop();
    await rm(root, { recursive: true, force: true });
  });
  const settings = () => ({
    tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
    apiKey: key,
    workspaceIds: [randomUUID()],
    write: false,
    autoStart: false,
  });
  it("refuses an already running tunnel ID without replacing grants or stopping the other runtime", async () => {
    const saved = await controller.save(settings());
    const original = await readFile(join(root, "chatgpt", "config.json"));
    dependencies.checkConflict = async () => ({
      pid: 12345,
      profile: "localbridge",
    });
    await expect(controller.start()).rejects.toThrow("profile localbridge");
    expect(controller.snapshot()).toMatchObject({
      phase: "error",
      ready: false,
    });
    expect(await readFile(join(root, "chatgpt", "config.json"))).toEqual(
      original,
    );
    expect(grants.get(saved.clientId!)!.revoked).toBe(false);
    expect(
      (await readdir(join(root, "chatgpt"))).some((n) => n.startsWith("run-")),
    ).toBe(false);
  });
  it("detects direct/profile routing collisions while excluding its own process and explicit overrides", async () => {
    const tunnelId = settings().tunnelId;
    const other = "tunnel_ffffffffffffffffffffffffffffffff";
    const profile = async () =>
      `control_plane:\n  tunnel_id: '${tunnelId}' # public routing\n  api_key: env:PRIVATE_KEY\n`;
    expect(
      await findTunnelConflict(
        tunnelId,
        [
          {
            pid: 1,
            command: `/opt/bin/tunnel-client run --control-plane.tunnel-id=${tunnelId}`,
          },
          {
            pid: 2,
            command: '/opt/bin/tunnel-client run --profile "localbridge"',
          },
        ],
        profile,
        1,
      ),
    ).toEqual({ pid: 2, profile: "localbridge" });
    expect(
      await findTunnelConflict(
        tunnelId,
        [
          {
            pid: 2,
            command: `/opt/bin/tunnel-client run --profile localbridge --control-plane.tunnel-id ${other}`,
          },
          {
            pid: 3,
            command: "/opt/bin/tunnel-client doctor --profile localbridge",
          },
        ],
        profile,
      ),
    ).toBeNull();
    expect(
      await findTunnelConflict(
        tunnelId,
        [
          {
            pid: 4,
            command: `"C:\\Program Files\\tunnel-client.exe" run --control-plane.tunnel-id "${tunnelId}"`,
          },
        ],
        profile,
      ),
    ).toEqual({ pid: 4 });
  });
  it("encrypts credentials, persists explicit scope, and restores without returning the key", async () => {
    const input = settings();
    const saved = await controller.save(input);
    expect(saved.workspaceIds).toEqual(input.workspaceIds);
    expect(saved.phase).toBe("stopped");
    expect(JSON.stringify(saved)).not.toContain(key);
    const configText = await readFile(
      join(root, "chatgpt", "config.json"),
      "utf8",
    );
    expect(configText).not.toContain(key);
    const config = JSON.parse(configText);
    expect(
      (await readFile(join(root, "chatgpt", config.keyFile))).includes(
        Buffer.from(key),
      ),
    ).toBe(false);
    const restored = new TunnelController(dependencies);
    await restored.initialize([]);
    expect(restored.snapshot()).toMatchObject({
      configured: true,
      hasKey: true,
      phase: "stopped",
      workspaceIds: input.workspaceIds,
    });
    const rotated = await restored.save({
      ...input,
      apiKey: undefined,
      write: true,
    });
    expect(grants.get(saved.clientId!)!.revoked).toBe(true);
    expect(grants.get(rotated.clientId!)!.write).toBe(true);
    expect(
      (await readdir(join(root, "chatgpt"))).filter((name) =>
        name.endsWith(".bin"),
      ),
    ).toHaveLength(1);
    await restored.forget();
    expect(grants.get(rotated.clientId!)!.revoked).toBe(true);
    expect(await readdir(join(root, "chatgpt"))).toEqual([]);
  });
  it("runs only one owned process group, redacts split logs, and stops its child", async () => {
    await controller.save(settings());
    const [first, second] = await Promise.all([
      controller.start(),
      controller.start(),
    ]);
    expect(first.phase).toBe("ready");
    expect(second.ready).toBe(true);
    expect(first.lastPollAt).toBeNull(); // Local readiness never proves OpenAI access.
    expect(first.bridge?.toolCount).toBe(21);
    await expect.poll(() => controller.snapshot().logs).toContain("[REDACTED]");
    expect(controller.snapshot().logs).not.toContain(key);
    const runs = (await readdir(join(root, "chatgpt"))).filter((name) =>
      name.startsWith("run-"),
    );
    expect(runs).toHaveLength(1);
    const processes = JSON.parse(
      await readFile(
        join(root, "chatgpt", runs[0], "fixture-processes.json"),
        "utf8",
      ),
    );
    expect(processes.args).not.toContain(key);
    await controller.stop();
    expect(controller.snapshot()).toMatchObject({
      phase: "stopped",
      live: false,
      ready: false,
    });
    await expect
      .poll(() => {
        try {
          process.kill(processes.worker, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
  });
  it("refuses plaintext fallback and fails closed before spawning when bridge or grant fails", async () => {
    available = false;
    await expect(controller.save(settings())).rejects.toThrow(
      "encrypted credential storage",
    );
    expect(await readdir(join(root, "chatgpt"))).toEqual([]);
    available = true;
    await controller.save(settings());
    bridgeFails = true;
    await expect(controller.start()).rejects.toThrow(
      "bridge diagnostic failed",
    );
    expect(controller.snapshot().phase).toBe("error");
    expect(
      (await readdir(join(root, "chatgpt"))).some((n) => n.startsWith("run-")),
    ).toBe(false);
    bridgeFails = false;
    grants.get(controller.snapshot().clientId!)!.revoked = true;
    await expect(controller.start()).rejects.toThrow("revoked");
    expect(controller.snapshot().bridge).toBeNull();
  });
  it("removes inherited transport/secret overrides and validates owned loopback URLs", () => {
    process.env.MCP_SERVER_URL = "https://attacker.invalid";
    process.env.CONTROL_PLANE_BASE_URL = "https://attacker.invalid";
    process.env.OPENAI_API_KEY = "other-secret";
    process.env.LOG_HTTP_RAW_UNSAFE = "true";
    try {
      const env = tunnelEnvironment(key);
      expect(env.CONTROL_PLANE_API_KEY).toBe(key);
      for (const name of [
        "MCP_SERVER_URL",
        "CONTROL_PLANE_BASE_URL",
        "OPENAI_API_KEY",
        "LOG_HTTP_RAW_UNSAFE",
      ])
        expect(env[name]).toBeUndefined();
      expect(healthBase("http://127.0.0.1:1234/").port).toBe("1234");
      for (const url of [
        "https://127.0.0.1:1234/",
        "http://example.com:1234/",
        "http://user@127.0.0.1:1234/",
        "http://127.0.0.1:1234/?redirect=x",
        "http://127.0.0.1:1234/mcp",
      ])
        expect(() => healthBase(url)).toThrow();
      expect(redact("Authorization: Bearer " + key)).not.toContain(key);
      const command = bridgeCommand(dependencies.bridge(randomUUID()));
      expect(command).toContain('\\"');
      expect(command).toContain("$()"); // literal argv, never expanded by a shell
    } finally {
      delete process.env.MCP_SERVER_URL;
      delete process.env.CONTROL_PLANE_BASE_URL;
      delete process.env.OPENAI_API_KEY;
      delete process.env.LOG_HTTP_RAW_UNSAFE;
    }
  });
});
