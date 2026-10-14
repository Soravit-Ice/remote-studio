import { geminiOAuthStateSchema } from "./oauth";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  geminiSettingsSchema,
  id,
  type GeminiSettings,
  type GeminiStatus,
} from "../../contracts/src/index";
import {
  tunnelEnvironment,
  type TunnelDependencies,
} from "../../tunnel/src/index";
import type { BridgeEntry } from "../../connections/src/index";

export type GeminiDependencies = Omit<
  TunnelDependencies,
  "bridge" | "checkConflict"
> & {
  httpBridge(id: string): BridgeEntry;
};
const savedSchema = geminiSettingsSchema.safeExtend({
  tunnelToken: z.never().optional(),
  clientId: id,
  keyFile: z
    .string()
    .regex(/^[0-9a-f-]{36}\.bin$/)
    .nullable(),
  runtimePath: z.string().nullable(),
});
type Saved = z.infer<typeof savedSchema>;
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function atomic(path: string, value: string | Buffer) {
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, value, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
async function stopChild(child: ChildProcess | null) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const kill = (force: boolean) => {
    if (process.platform === "win32") {
      const task = spawn(
        "taskkill",
        ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])],
        { stdio: "ignore", windowsHide: true },
      );
      task.on("error", () => child.kill(force ? "SIGKILL" : "SIGTERM"));
    } else {
      try {
        process.kill(-child.pid!, force ? "SIGKILL" : "SIGTERM");
      } catch {
        /* Already exited. */
      }
    }
  };
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  kill(false);
  await Promise.race([closed, pause(1500)]);
  if (child.exitCode === null && child.signalCode === null) kill(true);
  await Promise.race([closed, pause(1000)]);
}
export async function inspectCloudflared(path: string) {
  if (
    !isAbsolute(path) ||
    !["cloudflared", "cloudflared.exe"].includes(basename(path))
  )
    throw new Error("Choose the official cloudflared executable.");
  await access(
    path,
    process.platform === "win32" ? constants.F_OK : constants.X_OK,
  );
  const output = await new Promise<string>((resolve, reject) =>
    execFile(
      path,
      ["--version"],
      {
        timeout: 5000,
        maxBuffer: 32768,
        env: tunnelEnvironment(),
        windowsHide: true,
      },
      (error, stdout, stderr) =>
        error
          ? reject(
              new Error("Could not run cloudflared. Check its installation."),
            )
          : resolve(stdout + stderr),
    ),
  );
  const version = output.match(/cloudflared version (\d+\.\d+\.\d+)/)?.[1];
  if (!version)
    throw new Error(
      "The selected executable did not identify itself as cloudflared.",
    );
  return { path, version };
}

export class GeminiController {
  private saved: Saved | null = null;
  private runtime: GeminiStatus["runtime"] = null;
  private gateway: ChildProcess | null = null;
  private cloudflare: ChildProcess | null = null;
  private runDirectory: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private storageQueue: Promise<unknown> = Promise.resolve();
  private monitor: ReturnType<typeof setInterval> | null = null;
  private checking = false;
  private phase: GeminiStatus["phase"] = "unconfigured";
  private bridge: GeminiStatus["bridge"] = null;
  private origin = "";
  private registered = false;
  private publicVerifiedAt: string | null = null;
  private lastToolAt: string | null = null;
  private pending: GeminiStatus["pending"] = [];
  private error: string | null = null;
  constructor(private readonly deps: GeminiDependencies) {}
  private get folder() {
    return join(this.deps.directory, "gemini");
  }
  private emit() {
    this.deps.changed();
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  snapshot(): GeminiStatus {
    return {
      configured: !!this.saved,
      secureStorage: this.deps.vault.available(),
      hasToken: !!this.saved?.keyFile,
      mode: this.saved?.mode ?? "quick",
      publicOrigin: this.saved?.publicOrigin ?? "",
      localPort: this.saved?.localPort ?? 8766,
      workspaceIds: [...(this.saved?.workspaceIds ?? [])],
      workspaceGrants: this.saved?.workspaceGrants,
      autoStart: this.saved?.autoStart ?? false,
      clientId: this.saved?.clientId ?? null,
      runtime: this.runtime ? { ...this.runtime } : null,
      phase: this.phase,
      mcpUrl: this.origin && this.gateway ? this.origin + "/mcp" : null,
      bridge: this.bridge,
      publicVerifiedAt: this.publicVerifiedAt,
      lastToolAt: this.lastToolAt,
      pending: this.pending
        .filter((p) => Date.parse(p.expiresAt) > Date.now())
        .map((p) => ({ ...p })),
      error: this.error,
    };
  }
  async initialize(candidates: string[]) {
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(this.folder, 0o700);
    try {
      this.saved = savedSchema.parse(
        JSON.parse(await readFile(join(this.folder, "config.json"), "utf8")),
      );
      this.phase = "stopped";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.phase = "error";
        this.error =
          "Saved Gemini settings are invalid. Enter the settings again.";
      }
    }
    for (const path of this.saved?.runtimePath
      ? [this.saved.runtimePath]
      : candidates) {
      try {
        this.runtime = await inspectCloudflared(path);
        break;
      } catch {
        /* Native picker remains available. */
      }
    }
  }
  async autoStart() {
    if (this.saved?.autoStart) await this.start().catch(() => {});
  }
  save(input: GeminiSettings) {
    return this.serial(async () => {
      const settings = geminiSettingsSchema.parse(input),
        old = this.saved;
      let token = "";
      if (settings.mode === "named") {
        if (!this.deps.vault.available())
          throw new Error(
            "Unlock OS encrypted storage before saving a Cloudflare token.",
          );
        if (settings.tunnelToken) token = settings.tunnelToken;
        else if (old?.keyFile)
          token = this.deps.vault.decrypt(
            await readFile(join(this.folder, old.keyFile)),
          );
        else throw new Error("Enter the named tunnel token from Cloudflare.");
      }
      const keyFile = settings.mode === "named" ? randomUUID() + ".bin" : null;
      let clientId: string | null = null;
      try {
        await this.stopInternal();
        clientId = await this.deps.createGrant({
          workspaceIds: settings.workspaceIds,
          write: settings.write,
          execute: settings.execute,
          accessMode: settings.accessMode,
          workspaceGrants: settings.workspaceGrants,
        });
        if (keyFile)
          await atomic(
            join(this.folder, keyFile),
            this.deps.vault.encrypt(token),
          );
        const { tunnelToken: _token, ...plain } = settings;
        const next: Saved = {
          ...plain,
          clientId,
          keyFile,
          runtimePath: this.runtime?.path ?? null,
        };
        await atomic(
          join(this.folder, "config.json"),
          JSON.stringify(next, null, 2) + "\n",
        );
        this.saved = next;
        this.phase = "stopped";
        this.error = null;
        this.bridge = null;
      } catch (error) {
        if (clientId) await this.deps.revokeGrant(clientId).catch(() => {});
        if (keyFile) await rm(join(this.folder, keyFile), { force: true });
        throw error;
      } finally {
        token = "";
      }
      if (old) {
        await this.deps.revokeGrant(old.clientId);
        await rm(this.oauthFile(old.clientId), { force: true });
        if (old.keyFile)
          await rm(join(this.folder, old.keyFile), { force: true });
      }
      this.emit();
      return this.snapshot();
    });
  }
  selectRuntime(path: string) {
    return this.serial(async () => {
      const runtime = await inspectCloudflared(path);
      await this.stopInternal();
      if (this.saved) {
        const next = { ...this.saved, runtimePath: path };
        await atomic(
          join(this.folder, "config.json"),
          JSON.stringify(next, null, 2),
        );
        this.saved = next;
      }
      this.runtime = runtime;
      this.emit();
      return this.snapshot();
    });
  }
  private watch(child: ChildProcess, kind: "gateway" | "cloudflare") {
    child.on("error", () =>
      this.failed(
        child,
        `Could not start the ${kind} process. Check its installation.`,
      ),
    );
    child.once("close", () =>
      this.failed(child, `The ${kind} process exited. Start Gemini again.`),
    );
  }
  private failed(child: ChildProcess, message: string) {
    if (child !== this.gateway && child !== this.cloudflare) return;
    void this.serial(async () => {
      await this.stopInternal();
      this.phase = "error";
      this.error = message;
      this.emit();
    });
  }
  private oauthFile(clientId: string) {
    return join(this.folder, `oauth-${clientId}.bin`);
  }
  private persistState(child: ChildProcess, raw: any) {
    const clientId = this.saved?.clientId;
    const next = this.storageQueue.then(async () => {
      if (
        !clientId ||
        this.saved?.mode !== "named" ||
        this.gateway !== child ||
        !this.deps.vault.available()
      )
        throw new Error();
      const state = geminiOAuthStateSchema.parse(raw.state);
      if (
        state.origin !== this.origin ||
        state.origin !== this.saved.publicOrigin
      )
        throw new Error();
      await this.deps.checkGrant(clientId);
      await atomic(
        this.oauthFile(clientId),
        this.deps.vault.encrypt(JSON.stringify(state)),
      );
    });
    this.storageQueue = next.catch(() => {});
    void next.then(
      () => {
        if (child.connected)
          child.send({
            type: "stateSaved",
            requestId: raw.requestId,
            ok: true,
          });
      },
      () => {
        if (child.connected)
          child.send({
            type: "stateSaved",
            requestId: raw.requestId,
            ok: false,
          });
        this.failed(
          child,
          "Could not save Gemini authorization securely. Unlock OS encrypted storage and reconnect.",
        );
      },
    );
  }
  private setOrigin(value: string, state?: unknown) {
    this.origin = value;
    this.gateway?.send({
      type: "origin",
      value,
      persistent: this.saved?.mode === "named",
      ...(state ? { state } : {}),
    });
    if (this.registered) this.phase = "ready";
    this.emit();
  }
  start() {
    return this.serial(async () => {
      if (this.gateway) return this.snapshot();
      try {
        if (!this.saved || !this.runtime)
          throw new Error(
            "Save Gemini settings and install cloudflared first.",
          );
        await this.deps.checkGrant(this.saved.clientId);
        let restoredState: unknown;
        if (this.saved.mode === "named") {
          if (!this.deps.vault.available())
            throw new Error(
              "Unlock OS encrypted storage and re-enter the Cloudflare token.",
            );
          try {
            restoredState = geminiOAuthStateSchema.parse(
              JSON.parse(
                this.deps.vault.decrypt(
                  await readFile(this.oauthFile(this.saved.clientId)),
                ),
              ),
            );
            if (
              (restoredState as { origin: string }).origin !==
              this.saved.publicOrigin
            )
              throw new Error();
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
              throw new Error(
                "Saved Gemini authorization could not be unlocked. Unlock OS encrypted storage and retry, or save the connection again.",
              );
          }
        }
        this.runtime = await inspectCloudflared(this.runtime.path);
        this.phase = "starting";
        this.error = null;
        this.emit();
        const result = await this.deps.testBridge(this.saved.clientId);
        this.bridge = {
          verifiedAt: new Date().toISOString(),
          toolCount: result.toolCount,
        };
        this.runDirectory = join(this.folder, "run-" + randomUUID());
        await mkdir(this.runDirectory, { mode: 0o700 });
        const bridge = this.deps.httpBridge(this.saved.clientId);
        const child = spawn(
          bridge.command,
          [
            ...bridge.args,
            "--port",
            String(this.saved.mode === "named" ? this.saved.localPort : 0),
          ],
          {
            cwd: this.runDirectory,
            env: tunnelEnvironment(),
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            detached: process.platform !== "win32",
            shell: false,
            windowsHide: true,
          },
        );
        this.gateway = child;
        this.watch(child, "gateway");
        child.on("message", (raw: any) => {
          if (this.gateway !== child) return;
          if (raw?.type === "state") {
            this.persistState(child, raw);
            return;
          }
          if (raw?.type === "pending" && Array.isArray(raw.pending))
            this.pending = raw.pending;
          else if (raw?.type === "tool" && typeof raw.at === "string")
            this.lastToolAt = raw.at;
          else if (raw?.type === "error")
            this.error =
              "The MCP adapter rejected an expired or invalid authorization request.";
          this.emit();
        });
        const localOrigin = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error(
                  "The local MCP adapter did not start. Check the port and restart.",
                ),
              ),
            7000,
          );
          const ready = (raw: any) => {
            if (raw?.type !== "ready") return;
            const parsed = new URL(raw.localOrigin);
            if (
              parsed.protocol !== "http:" ||
              parsed.hostname !== "127.0.0.1" ||
              !parsed.port
            )
              return;
            clearTimeout(timer);
            child.off("message", ready);
            resolve(parsed.origin);
          };
          child.on("message", ready);
          child.once("close", () => {
            clearTimeout(timer);
            reject(
              new Error(
                "The MCP adapter exited before startup. Check the local port.",
              ),
            );
          });
        });
        if (this.saved.mode === "named")
          this.setOrigin(this.saved.publicOrigin, restoredState);
        const config = join(this.runDirectory, "config.yaml");
        await writeFile(config, "{}\n", { mode: 0o600 });
        const providerEnv = tunnelEnvironment();
        const args = [
          "tunnel",
          "--config",
          config,
          "--no-autoupdate",
          "--metrics",
          "127.0.0.1:0",
          "--loglevel",
          "info",
          "--output",
          "json",
        ];
        if (this.saved.mode === "quick") args.push("--url", localOrigin);
        else {
          if (!this.saved.keyFile || !this.deps.vault.available())
            throw new Error(
              "Unlock OS encrypted storage and re-enter the Cloudflare token.",
            );
          providerEnv.TUNNEL_TOKEN = this.deps.vault.decrypt(
            await readFile(join(this.folder, this.saved.keyFile)),
          );
          args.push("run");
        }
        const cloudflare = spawn(this.runtime.path, args, {
          cwd: this.runDirectory,
          env: providerEnv,
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
          shell: false,
          windowsHide: true,
        });
        delete providerEnv.TUNNEL_TOKEN;
        this.cloudflare = cloudflare;
        this.watch(cloudflare, "cloudflare");
        for (const stream of [cloudflare.stdout!, cloudflare.stderr!]) {
          let buffer = "";
          stream.setEncoding("utf8").on("data", (chunk: string) => {
            if (this.cloudflare !== cloudflare) return;
            buffer = (buffer + chunk).slice(-16384);
            let at: number;
            while ((at = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, at);
              buffer = buffer.slice(at + 1);
              // Provider logs are never persisted or sent to the renderer.
              const quick = line.match(
                /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/,
              )?.[0];
              if (quick && this.saved?.mode === "quick" && !this.origin)
                this.setOrigin(quick);
              if (line.includes("Registered tunnel connection")) {
                this.registered = true;
                if (this.origin) this.phase = "ready";
                this.emit();
              }
            }
          });
        }
        await new Promise<void>((resolve, reject) => {
          cloudflare.once("spawn", resolve);
          cloudflare.once("error", () =>
            reject(new Error("Cloudflare Tunnel could not start.")),
          );
        });
        if (this.phase === "starting") this.phase = "running";
        const connectionDeadline = Date.now() + 45_000;
        this.monitor = setInterval(() => {
          if (!this.registered && Date.now() > connectionDeadline) {
            this.failed(
              child,
              "Cloudflare did not establish a tunnel. Check the network and the named tunnel token, then restart.",
            );
            return;
          }
          if (this.checking || !this.saved) return;
          this.checking = true;
          void this.deps
            .checkGrant(this.saved.clientId)
            .catch(() =>
              this.failed(
                child,
                "Gemini folder grants were revoked. Save the connection again.",
              ),
            )
            .finally(() => {
              this.checking = false;
            });
        }, 4000);
        this.monitor.unref();
        this.emit();
        return this.snapshot();
      } catch (error) {
        await this.stopInternal();
        this.phase = "error";
        this.error = (error as Error).message;
        this.emit();
        throw error;
      }
    });
  }
  private async stopInternal() {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    const gateway = this.gateway,
      cloudflare = this.cloudflare;
    this.gateway = this.cloudflare = null;
    await stopChild(gateway);
    await this.storageQueue;
    await stopChild(cloudflare);
    if (this.runDirectory)
      await rm(this.runDirectory, { recursive: true, force: true });
    this.runDirectory = null;
    this.origin = "";
    this.registered = false;
    this.pending = [];
    this.publicVerifiedAt = this.lastToolAt = null;
    this.phase = this.saved ? "stopped" : "unconfigured";
    this.error = null;
  }
  stop() {
    return this.serial(async () => {
      await this.stopInternal();
      this.emit();
      return this.snapshot();
    });
  }
  approve(input: { id: string; allow: boolean }) {
    return this.serial(async () => {
      if (
        !this.gateway ||
        !this.pending.some(
          (p) => p.id === input.id && Date.parse(p.expiresAt) > Date.now(),
        )
      )
        throw new Error(
          "The authorization request expired. Connect again in Gemini.",
        );
      const requestId = randomUUID(),
        child = this.gateway;
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          child.off("message", received);
          if (error) reject(error);
          else resolve();
        };
        const received = (raw: any) => {
          if (raw?.type === "approved" && raw.requestId === requestId) finish();
          else if (raw?.type === "error")
            finish(
              new Error("The authorization request expired. Connect again."),
            );
        };
        const timer = setTimeout(
          () => finish(new Error("The MCP adapter did not confirm approval.")),
          5000,
        );
        child.on("message", received);
        child.send({ type: "approve", ...input, requestId });
      });
      this.emit();
      return this.snapshot();
    });
  }
  test() {
    return this.serial(async () => {
      if (!this.saved) throw new Error("Save a Gemini connection first.");
      try {
        await this.deps.checkGrant(this.saved.clientId);
      } catch (error) {
        await this.stopInternal();
        this.phase = "error";
        this.error = "Gemini grants were revoked. Save the connection again.";
        this.emit();
        throw error;
      }
      const result = await this.deps.testBridge(this.saved.clientId);
      this.bridge = {
        verifiedAt: new Date().toISOString(),
        toolCount: result.toolCount,
      };
      this.publicVerifiedAt = null;
      if (this.origin && this.gateway) {
        try {
          const response = await fetch(
            this.origin + "/.well-known/oauth-protected-resource/mcp",
            { redirect: "error", signal: AbortSignal.timeout(5000) },
          );
          if (
            !response.ok ||
            Number(response.headers.get("content-length") ?? 0) > 16384
          )
            throw new Error();
          const reader = response.body?.getReader();
          if (!reader) throw new Error();
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > 16384) throw new Error();
              chunks.push(value);
            }
          } finally {
            await reader.cancel();
          }
          const text = Buffer.concat(chunks).toString("utf8");
          const metadata = JSON.parse(text);
          if (
            metadata.resource !== this.origin + "/mcp" ||
            metadata.authorization_servers?.[0] !== this.origin
          )
            throw new Error();
          this.publicVerifiedAt = new Date().toISOString();
          this.error = null;
        } catch {
          this.error =
            "Public HTTPS check failed. Check the Cloudflare hostname and its route to the local port, then retry.";
        }
      }
      this.emit();
      return this.snapshot();
    });
  }
  forget() {
    return this.serial(async () => {
      await this.stopInternal();
      if (this.saved) {
        await this.deps.revokeGrant(this.saved.clientId);
        await rm(this.oauthFile(this.saved.clientId), { force: true });
        await rm(join(this.folder, "config.json"), { force: true });
        if (this.saved.keyFile)
          await rm(join(this.folder, this.saved.keyFile), { force: true });
      }
      this.saved = null;
      this.bridge = null;
      this.phase = "unconfigured";
      this.emit();
      return this.snapshot();
    });
  }
}
