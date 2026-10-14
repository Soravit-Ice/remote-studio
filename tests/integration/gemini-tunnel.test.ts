import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  copyFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  GeminiController,
  type GeminiDependencies,
} from "../../packages/gemini/src/index";
import { waitFor } from "../helpers";
import type { GeminiSettings } from "../../packages/contracts/src/index";

describe.skipIf(process.platform === "win32")(
  "Gemini tunnel process lifecycle (local fixture)",
  () => {
    let root: string, controller: GeminiController, deps: GeminiDependencies;
    let locked: boolean, bridgeFails: boolean;
    const grants = new Map<string, { revoked: boolean }>();
    const settings: GeminiSettings = {
      mode: "quick",
      publicOrigin: "",
      localPort: 8766,
      workspaceIds: [],
      write: false,
      autoStart: false,
    };
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "rs-gemini-tunnel-"));
      locked = bridgeFails = false;
      grants.clear();
      const runtime = join(root, "cloudflared");
      await copyFile("tests/fixtures/cloudflared.mjs", runtime);
      await chmod(runtime, 0o700);
      const key = randomBytes(32);
      deps = {
        directory: root,
        vault: {
          available: () => !locked,
          encrypt(value) {
            const iv = randomBytes(12),
              cipher = createCipheriv("aes-256-gcm", key, iv);
            const bytes = Buffer.concat([
              cipher.update(value, "utf8"),
              cipher.final(),
            ]);
            return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
          },
          decrypt(value) {
            const cipher = createDecipheriv(
              "aes-256-gcm",
              key,
              value.subarray(0, 12),
            );
            cipher.setAuthTag(value.subarray(12, 28));
            return Buffer.concat([
              cipher.update(value.subarray(28)),
              cipher.final(),
            ]).toString("utf8");
          },
        },
        async createGrant(value) {
          expect(value).not.toHaveProperty("tunnelToken");
          const id = randomUUID();
          grants.set(id, { revoked: false });
          await mkdir(join(root, "clients"), { recursive: true });
          await writeFile(
            join(root, "clients", id + ".json"),
            JSON.stringify({
              directory: root,
              token: randomBytes(32).toString("hex"),
            }),
            { mode: 0o600 },
          );
          return id;
        },
        async revokeGrant(id) {
          grants.get(id)!.revoked = true;
        },
        async checkGrant(id) {
          if (!grants.has(id) || grants.get(id)!.revoked)
            throw new Error("Revoked.");
        },
        async testBridge() {
          if (bridgeFails) throw new Error("Bridge diagnostic failed.");
          return { toolCount: 1 };
        },
        httpBridge(id) {
          return {
            command: process.execPath,
            args: [
              resolve("dist/services/http-bridge.mjs"),
              "--credential",
              join(root, "clients", id + ".json"),
            ],
            env: {},
          };
        },
        changed() {},
      };
      controller = new GeminiController(deps);
      await controller.initialize([runtime]);
    });
    afterEach(async () => {
      await controller.stop();
      await rm(root, { recursive: true, force: true });
    });
    it("supervises a quick tunnel, preserves scope on restore, and stops on revocation", async () => {
      await controller.save({ ...settings, autoStart: true });
      await controller.start();
      const ready = await waitFor(
        () => controller.snapshot(),
        (status) => status.phase === "ready",
      );
      expect(ready.mcpUrl).toBe(
        "https://remote-studio-fixture.trycloudflare.com/mcp",
      );
      expect(ready.publicVerifiedAt).toBeNull();
      expect(ready.lastToolAt).toBeNull();
      const folder = join(
        root,
        "gemini",
        (await readdir(join(root, "gemini"))).find((name) =>
          name.startsWith("run-"),
        )!,
      );
      const fixture = JSON.parse(
        await readFile(join(folder, "fixture.json"), "utf8"),
      );
      expect(fixture.hasToken).toBe(false);
      expect(fixture.hasOverride).toBe(false);
      expect((await fetch(fixture.localOrigin + "/mcp")).status).toBe(401);
      await controller.stop();
      await expect(fetch(fixture.localOrigin + "/mcp")).rejects.toThrow();
      expect(controller.snapshot().mcpUrl).toBeNull();
      controller = new GeminiController(deps);
      await controller.initialize([]);
      await controller.autoStart();
      await waitFor(
        () => controller.snapshot(),
        (status) => status.phase === "ready",
      );
      grants.get(ready.clientId!)!.revoked = true;
      await waitFor(
        () => controller.snapshot(),
        (status) => status.phase === "error",
      );
      expect(controller.snapshot().mcpUrl).toBeNull();
      await controller.forget();
      expect(controller.snapshot().configured).toBe(false);
    });
    it("encrypts named tunnel tokens and keeps them out of argv, config, and snapshots", async () => {
      const token =
        "named-tunnel-test-token-" + randomBytes(32).toString("hex");
      await controller.save({
        ...settings,
        mode: "named",
        publicOrigin: "https://studio.example.com",
        tunnelToken: token,
        localPort: 49765,
      });
      const configText = await readFile(
          join(root, "gemini/config.json"),
          "utf8",
        ),
        config = JSON.parse(configText);
      expect(configText).not.toContain(token);
      expect(
        (await readFile(join(root, "gemini", config.keyFile))).includes(
          Buffer.from(token),
        ),
      ).toBe(false);
      expect(JSON.stringify(controller.snapshot())).not.toContain(token);
      locked = true;
      await expect(controller.start()).rejects.toThrow(
        "Unlock OS encrypted storage",
      );
      expect(controller.snapshot().mcpUrl).toBeNull();
      locked = false;
      await controller.start();
      await waitFor(
        () => controller.snapshot(),
        (status) => status.phase === "ready",
      );
      const folder = join(
        root,
        "gemini",
        (await readdir(join(root, "gemini"))).find((name) =>
          name.startsWith("run-"),
        )!,
      );
      const fixtureText = await readFile(join(folder, "fixture.json"), "utf8"),
        fixture = JSON.parse(fixtureText);
      expect(fixture.hasToken).toBe(true);
      expect(fixtureText).not.toContain(token);
      expect(await readdir(folder)).not.toContain("token");
      const base = "http://127.0.0.1:49765";
      const client = await (
        await fetch(base + "/oauth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            redirect_uris: ["https://gemini.google.com/callback"],
            token_endpoint_auth_method: "none",
          }),
        })
      ).json();
      const verifier = "p".repeat(64);
      const params = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://gemini.google.com/callback",
        response_type: "code",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      });
      const html = await (
        await fetch(base + "/oauth/authorize?" + params)
      ).text();
      const decision = html.match(/url=([^"<]+)/)![1];
      await waitFor(
        () => controller.snapshot(),
        (status) => status.pending.length > 0,
      );
      await controller.approve({
        id: controller.snapshot().pending[0].id,
        allow: true,
      });
      const redirect = await fetch(base + decision, { redirect: "manual" });
      const code = new URL(redirect.headers.get("location")!).searchParams.get(
        "code",
      )!;
      const oauthToken = await (
        await fetch(base + "/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            code_verifier: verifier,
            client_id: client.client_id,
            redirect_uri: "https://gemini.google.com/callback",
          }),
        })
      ).json();
      expect(oauthToken.refresh_token).toBeDefined();
      const oauthFile = join(
        root,
        "gemini",
        "oauth-" + config.clientId + ".bin",
      );
      expect(
        (await readFile(oauthFile)).includes(
          Buffer.from(oauthToken.access_token),
        ),
      ).toBe(false);
      await controller.stop();
      controller = new GeminiController(deps);
      await controller.initialize([]);
      await controller.start();
      await waitFor(
        () => controller.snapshot(),
        (status) => status.phase === "ready",
      );
      const refreshed = await fetch(base + "/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: client.client_id,
          refresh_token: oauthToken.refresh_token,
        }),
      });
      expect(refreshed.status).toBe(200);
      expect((await refreshed.json()).access_token).toBeDefined();

      const before = controller.snapshot().clientId!;
      await controller.save({
        ...settings,
        mode: "named",
        publicOrigin: "https://studio.example.com",
      });
      expect(grants.get(before)?.revoked).toBe(true);
      await expect(readFile(oauthFile)).rejects.toThrow();
      expect(controller.snapshot().hasToken).toBe(true);
      await controller.forget();
      await expect(
        readFile(join(root, "gemini", config.keyFile)),
      ).rejects.toThrow();
    });
    it("does not launch Cloudflare if the bridge check fails", async () => {
      await controller.save(settings);
      bridgeFails = true;
      await expect(controller.start()).rejects.toThrow(
        "Bridge diagnostic failed",
      );
      expect(controller.snapshot().phase).toBe("error");
      expect(
        (await readdir(join(root, "gemini"))).some((name) =>
          name.startsWith("run-"),
        ),
      ).toBe(false);
    });
  },
);
