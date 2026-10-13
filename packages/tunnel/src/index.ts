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
import { join, isAbsolute, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  id,
  tunnelSettingsSchema,
  type TunnelSettings,
  type TunnelStatus,
} from "../../contracts/src/index";
import type { BridgeEntry } from "../../connections/src/index";
import { detectTunnelConflict, conflictMessage } from "./conflicts";

const savedSchema = tunnelSettingsSchema.omit({ apiKey: true }).extend({
  clientId: id,
  keyFile: z.string().regex(/^[0-9a-f-]{36}\.bin$/),
  runtimePath: z.string().nullable(),
});
type Saved = z.infer<typeof savedSchema>;
export interface TunnelDependencies {
  directory: string;
  vault: {
    available(): boolean;
    encrypt(key: string): Buffer;
    decrypt(bytes: Buffer): string;
  };
  createGrant(
    settings: Pick<
      TunnelSettings,
      "workspaceIds" | "write" | "execute" | "accessMode" | "workspaceGrants"
    >,
  ): Promise<string>;
  revokeGrant(id: string): Promise<void>;
  checkGrant(id: string): Promise<void>;
  testBridge(id: string): Promise<{ toolCount: number }>;
  bridge(id: string): BridgeEntry;
  checkConflict?: typeof detectTunnelConflict;
  changed(): void;
}

// Only OS essentials are inherited. User MCP/control-plane overrides cannot
// replace our bridge, redirect the key, enable raw logging, or expose the UI.
export function tunnelEnvironment(key?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "WINDIR",
    "PATH",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
  ])
    if (process.env[name]) env[name] = process.env[name];
  if (key) env.CONTROL_PLANE_API_KEY = key;
  env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}
export function redact(value: string, secrets: string[] = []): string {
  for (const secret of secrets.filter(Boolean))
    value = value.split(secret).join("[REDACTED]");
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(Bearer\s+)[^\s"',}]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|authorization|token)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
      "$1[REDACTED]",
    );
}
// tunnel-client parses this into argv with its own quote parser, then uses
// exec.Command directly. No shell, expansion, or user-supplied command is used.
export function bridgeCommand(entry: BridgeEntry): string {
  return [entry.command, ...entry.args]
    .map((arg) => '"' + arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"')
    .join(" ");
}
export function healthBase(value: string): URL {
  const url = new URL(value.trim());
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Runtime reported an invalid loopback health address.");
  return url;
}
export async function inspectRuntime(
  path: string,
): Promise<{ path: string; version: string }> {
  if (
    !isAbsolute(path) ||
    !["tunnel-client", "tunnel-client.exe"].includes(basename(path))
  )
    throw new Error("Choose the official tunnel-client executable.");
  await access(
    path,
    process.platform === "win32" ? constants.F_OK : constants.X_OK,
  );
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      path,
      ["--version"],
      {
        timeout: 5000,
        maxBuffer: 32768,
        env: tunnelEnvironment(),
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(
              "Could not run tunnel-client. Install the official runtime and check OS permissions.",
            ),
          );
        else resolve(stdout + stderr);
      },
    );
  });
  const version = output.match(/\b(\d+\.\d+\.\d+(?:\+[a-zA-Z0-9]+)?)/)?.[1];
  if (!version)
    throw new Error("The selected runtime did not report a version.");
  return { path, version };
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function killTree(child: ChildProcess, force: boolean) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const proc = spawn(
      "taskkill",
      ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])],
      { stdio: "ignore", windowsHide: true, shell: false },
    );
    proc.on("error", () => child.kill());
  } else {
    try {
      process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
    } catch {
      /* This owned process group has already exited. */
    }
  }
}
async function atomic(path: string, contents: string | Buffer) {
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, contents, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

export class TunnelController {
  private saved: Saved | null = null;
  private runtime: TunnelStatus["runtime"] = null;
  private child: ChildProcess | null = null;
  private closed: Promise<void> | null = null;
  private runDirectory: string | null = null;
  private monitor: ReturnType<typeof setInterval> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private probing = false;
  private phase: TunnelStatus["phase"] = "unconfigured";
  private bridge: TunnelStatus["bridge"] = null;
  private live = false;
  private ready = false;
  private lastPollAt: string | null = null;
  private checkedAt: string | null = null;
  private error: string | null = null;
  private logs = "";
  constructor(private readonly deps: TunnelDependencies) {}
  private get folder() {
    return join(this.deps.directory, "chatgpt");
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  private emit() {
    this.deps.changed();
  }
  private log(message: string) {
    this.logs = (this.logs + message + "\n").slice(-24000);
    this.emit();
  }
  snapshot(): TunnelStatus {
    return {
      configured: !!this.saved,
      tunnelId: this.saved?.tunnelId ?? "",
      hasKey: !!this.saved?.keyFile,
      secureStorage: this.deps.vault.available(),
      workspaceIds: [...(this.saved?.workspaceIds ?? [])],
      write: this.saved?.write ?? false,
      execute: this.saved?.execute ?? this.saved?.write ?? false,
      accessMode:
        this.saved?.accessMode ?? (this.saved?.write ? "reviewed" : "readOnly"),
      workspaceGrants: this.saved?.workspaceGrants,
      autoStart: this.saved?.autoStart ?? false,
      clientId: this.saved?.clientId ?? null,
      runtime: this.runtime ? { ...this.runtime } : null,
      phase: this.phase,
      bridge: this.bridge,
      live: this.live,
      ready: this.ready,
      lastPollAt: this.lastPollAt,
      checkedAt: this.checkedAt,
      error: this.error,
      logs: this.logs,
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
          "Saved ChatGPT configuration is invalid. Enter the settings again.";
      }
    }
    // A saved selection wins; do not silently replace a missing custom runtime.
    for (const path of this.saved?.runtimePath
      ? [this.saved.runtimePath]
      : candidates) {
      try {
        this.runtime = await inspectRuntime(path);
        break;
      } catch {
        /* UI offers the native executable picker. */
      }
    }
  }
  async autoStart() {
    if (this.saved?.autoStart) {
      try {
        await this.start();
      } catch {
        /* start records an actionable error for the UI. */
      }
    }
  }
  save(input: TunnelSettings) {
    return this.serial(async () => {
      const settings = tunnelSettingsSchema.parse(input);
      if (!this.deps.vault.available())
        throw new Error(
          "OS encrypted credential storage is unavailable. Unlock your keychain and try again.",
        );
      if (!settings.apiKey && !this.saved)
        throw new Error("Enter your runtime CONTROL_PLANE_API_KEY.");
      const old = this.saved;
      // Decrypt before replacing anything, so a locked/missing key fails closed.
      let key: string;
      try {
        key = settings.apiKey ?? (await this.readKey());
      } catch {
        throw new Error(
          "Saved key could not be unlocked. Enter your runtime API key again.",
        );
      }
      let clientId: string | null = null;
      const keyFile = randomUUID() + ".bin";
      try {
        await this.stopInternal();
        clientId = await this.deps.createGrant({
          workspaceIds: settings.workspaceIds,
          write: settings.write,
          execute: settings.execute,
          accessMode: settings.accessMode,
          workspaceGrants: settings.workspaceGrants,
        });
        await atomic(join(this.folder, keyFile), this.deps.vault.encrypt(key));
        const next: Saved = {
          tunnelId: settings.tunnelId,
          workspaceIds: settings.workspaceIds,
          write: settings.write,
          execute: settings.execute,
          accessMode: settings.accessMode,
          workspaceGrants: settings.workspaceGrants,
          autoStart: settings.autoStart,
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
        this.bridge = null;
        this.error = null;
        this.logs = "";
      } catch (error) {
        if (clientId) await this.deps.revokeGrant(clientId).catch(() => {});
        await rm(join(this.folder, keyFile), { force: true });
        throw new Error(redact((error as Error).message, [key]));
      } finally {
        key = "";
      }
      if (old) {
        await this.deps.revokeGrant(old.clientId);
        await rm(join(this.folder, old.keyFile), { force: true });
      }
      this.emit();
      return this.snapshot();
    });
  }
  selectRuntime(path: string) {
    return this.serial(async () => {
      const runtime = await inspectRuntime(path);
      await this.stopInternal();
      if (this.saved) {
        const next = { ...this.saved, runtimePath: path };
        await atomic(
          join(this.folder, "config.json"),
          JSON.stringify(next, null, 2) + "\n",
        );
        this.saved = next;
      }
      this.runtime = runtime;
      this.error = null;
      this.emit();
      return this.snapshot();
    });
  }
  private async readKey() {
    if (!this.saved || !this.deps.vault.available())
      throw new Error(
        "Unlock OS encrypted storage and enter the API key in settings.",
      );
    return tunnelSettingsSchema.shape.apiKey
      .unwrap()
      .parse(
        this.deps.vault.decrypt(
          await readFile(join(this.folder, this.saved.keyFile)),
        ),
      );
  }
  start() {
    return this.serial(async () => {
      if (this.child) return this.snapshot();
      let key = "";
      try {
        if (!this.saved)
          throw new Error(
            "Save the tunnel ID, runtime key, and folder grants first.",
          );
        if (!this.runtime)
          throw new Error(
            "Install the official tunnel-client runtime, then choose its executable.",
          );
        await this.deps.checkGrant(this.saved.clientId);
        const conflict = await (
          this.deps.checkConflict ?? detectTunnelConflict
        )(this.saved.tunnelId);
        if (conflict) throw new Error(conflictMessage(conflict));
        key = await this.readKey();
        this.phase = "starting";
        this.error = null;
        this.logs = "";
        this.live = this.ready = false;
        this.lastPollAt = this.checkedAt = null;
        this.bridge = null;
        this.emit();
        const result = await this.deps.testBridge(this.saved.clientId);
        this.bridge = {
          verifiedAt: new Date().toISOString(),
          toolCount: result.toolCount,
        };
        this.runtime = await inspectRuntime(this.runtime.path);
        this.runDirectory = join(this.folder, "run-" + randomUUID());
        await mkdir(this.runDirectory, { mode: 0o700 });
        const args = [
          "run",
          "--control-plane.base-url",
          "https://api.openai.com",
          "--control-plane.tunnel-id",
          this.saved.tunnelId,
          "--control-plane.api-key",
          "env:CONTROL_PLANE_API_KEY",
          "--mcp.command",
          "channel=main,command=" +
            bridgeCommand(this.deps.bridge(this.saved.clientId)),
          "--health.listen-addr",
          "127.0.0.1:0",
          "--health.url-file",
          join(this.runDirectory, "health.url"),
          "--log.format",
          "json",
          "--log.level",
          "info",
          "--log.file",
          "",
          "--log.http-raw-unsafe=false",
        ];
        const child = spawn(this.runtime.path, args, {
          env: tunnelEnvironment(key),
          cwd: this.runDirectory,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
        });
        this.child = child;
        let secret = key;
        const buffers = { stdout: "", stderr: "" };
        const dropping = { stdout: false, stderr: false };
        const record = (stream: "stdout" | "stderr", chunk: string) => {
          if (dropping[stream]) {
            const newline = chunk.indexOf("\n");
            if (newline < 0) return;
            chunk = chunk.slice(newline + 1);
            dropping[stream] = false;
          }
          buffers[stream] += chunk;
          let at: number;
          while ((at = buffers[stream].indexOf("\n")) >= 0) {
            const line = buffers[stream].slice(0, at);
            buffers[stream] = buffers[stream].slice(at + 1);
            this.log(
              line.length > 8192
                ? "[Oversized runtime log line omitted]"
                : redact(line, [secret]),
            );
          }
          if (buffers[stream].length > 16384) {
            buffers[stream] = "";
            dropping[stream] = true;
            this.log("[Oversized runtime output omitted]");
          }
        };
        child
          .stdout!.setEncoding("utf8")
          .on("data", (value: string) => record("stdout", value));
        child
          .stderr!.setEncoding("utf8")
          .on("data", (value: string) => record("stderr", value));
        this.closed = new Promise<void>((resolve) =>
          child.once("close", (code, signal) => {
            killTree(child, true); // Clean up this owned group if the runtime crashes.
            record("stdout", "\n");
            record("stderr", "\n");
            secret = "";
            if (this.child === child) {
              this.child = null;
              this.live = this.ready = false;
              this.phase = "error";
              this.error = `Tunnel runtime exited (${signal ?? code ?? "unknown"}). Review diagnostics and restart.`;
              if (this.monitor) clearInterval(this.monitor);
              this.monitor = null;
              this.emit();
            }
            resolve();
          }),
        );
        await new Promise<void>((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", () =>
            reject(
              new Error(
                "Tunnel runtime could not start. Check its installation and OS permissions.",
              ),
            ),
          );
        });
        this.phase = "running";
        this.monitor = setInterval(
          () => void this.probe().catch(() => {}),
          2000,
        );
        this.monitor.unref();
        // A short bounded wait; ongoing health is observed by the monitor.
        for (let i = 0; i < 12 && this.child && !this.live; i++) {
          await pause(150);
          await this.probe();
        }
        this.emit();
        return this.snapshot();
      } catch (error) {
        await this.stopInternal();
        this.phase = "error";
        this.error = redact((error as Error).message, [key]);
        this.emit();
        throw new Error(this.error);
      } finally {
        key = "";
      }
    });
  }
  stop() {
    return this.serial(async () => {
      await this.stopInternal();
      this.emit();
      return this.snapshot();
    });
  }
  private async stopInternal() {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    const child = this.child,
      closed = this.closed;
    this.child = null;
    if (child) {
      killTree(child, false);
      await Promise.race([closed, pause(2000)]);
      killTree(child, true);
      await Promise.race([closed, pause(1000)]);
    }
    this.closed = null;
    if (this.runDirectory)
      await rm(this.runDirectory, { recursive: true, force: true });
    this.runDirectory = null;
    this.live = this.ready = false;
    this.lastPollAt = this.checkedAt = null;
    this.phase = this.saved ? "stopped" : "unconfigured";
    this.error = null;
  }
  test() {
    return this.serial(async () => {
      if (!this.saved) throw new Error("Save a ChatGPT connection first.");
      try {
        await this.deps.checkGrant(this.saved.clientId);
        const result = await this.deps.testBridge(this.saved.clientId);
        this.bridge = {
          verifiedAt: new Date().toISOString(),
          toolCount: result.toolCount,
        };
        await this.probe();
        this.emit();
        return this.snapshot();
      } catch (error) {
        this.bridge = null;
        await this.stopInternal();
        this.phase = "error";
        this.error = redact((error as Error).message);
        this.emit();
        throw new Error(this.error);
      }
    });
  }
  forget() {
    return this.serial(async () => {
      await this.stopInternal();
      if (this.saved) {
        await this.deps.revokeGrant(this.saved.clientId);
        await rm(join(this.folder, "config.json"), { force: true });
        await rm(join(this.folder, this.saved.keyFile), { force: true });
      }
      this.saved = null;
      this.bridge = null;
      this.logs = "";
      this.phase = "unconfigured";
      this.emit();
      return this.snapshot();
    });
  }
  private async probe() {
    const child = this.child,
      runDirectory = this.runDirectory;
    if (!child || !runDirectory || this.probing) return;
    this.probing = true;
    try {
      const base = healthBase(
        await readFile(join(runDirectory, "health.url"), "utf8"),
      );
      const get = (path: string) =>
        fetch(new URL(path, base), {
          signal: AbortSignal.timeout(1500),
          redirect: "error",
        });
      const [live, ready, metrics] = await Promise.all([
        get("/healthz"),
        get("/readyz"),
        get("/metrics"),
      ]);
      // Bound the metrics body; it is local but still untrusted runtime output.
      const reader = metrics.body?.getReader();
      let text = "",
        bytes = 0;
      if (reader && metrics.ok) {
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.length;
            if (bytes > 256000) break;
            text += new TextDecoder().decode(chunk.value);
          }
        } finally {
          await reader.cancel();
        }
      }
      await live.body?.cancel();
      await ready.body?.cancel();
      if (this.child !== child) return;
      this.live = live.ok;
      this.ready = ready.ok;
      const timestamp = Number(
        text.match(
          /^commands_poll_last_successful_timestamp_seconds(?:\{[^\n]*\})?\s+([0-9.]+)/m,
        )?.[1] ?? 0,
      );
      this.lastPollAt =
        timestamp > 0 && timestamp <= Date.now() / 1000 + 5
          ? new Date(timestamp * 1000).toISOString()
          : null;
      this.checkedAt = new Date().toISOString();
      this.phase = this.ready ? "ready" : "running";
      this.error = null;
    } catch (error) {
      if (this.child !== child) return;
      this.live = this.ready = false;
      this.lastPollAt = null;
      this.phase = "running";
      this.error =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "Waiting for runtime health endpoint…"
          : "Local health check failed. Review runtime diagnostics.";
    } finally {
      this.probing = false;
      this.emit();
    }
  }
}
