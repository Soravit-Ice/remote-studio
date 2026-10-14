import { app, BrowserWindow, shell } from "electron";
import { createServer, createConnection } from "node:net";
import { chmod, mkdir, writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import { GeminiController } from "../../../../packages/gemini/src/index";
import type { GeminiStatus } from "../../../../packages/contracts/src/index";
import {
  tunnelSettingsSchema,
  geminiSettingsSchema,
  id,
} from "../../../../packages/contracts/src/index";
import { sameSecret } from "../../../../packages/security/src/index";
import {
  TunnelController,
  tunnelEnvironment,
} from "../../../../packages/tunnel/src/index";
const run = promisify(execFile),
  fingerprint = (data: string) =>
    createHash("sha256").update(data).digest("hex").slice(0, 12);
const endpoint = (data: string) =>
  process.platform === "win32"
    ? "\\\\.\\pipe\\remote-studio-background-" + fingerprint(data)
    : join(data, "background.sock");
export function backgroundCall(
  data: string,
  token: string,
  method: string,
  input: unknown = {},
) {
  return new Promise<any>((resolve, reject) => {
    const socket = createConnection(endpoint(data));
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Background helper did not respond."));
    }, 45000);
    socket.once("connect", () =>
      socket.write(JSON.stringify({ token, method, input }) + "\n"),
    );
    socket.on("data", (bytes) => {
      buffer += bytes.toString();
      if (buffer.length > 1024 * 1024) {
        socket.destroy();
        reject(new Error("Background response exceeded its budget."));
        return;
      }
      if (!buffer.includes("\n")) return;
      try {
        const result = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
        if (result.ok) resolve(result.data);
        else reject(new Error(result.error));
      } catch (e) {
        reject(e);
      }
      socket.end();
    });
    socket.once("error", reject);
    socket.once("close", () => {
      clearTimeout(timer);
      if (!buffer.includes("\n"))
        reject(new Error("Background helper disconnected."));
    });
  });
}
export class TunnelProxy {
  constructor(
    readonly data: string,
    readonly token: string,
  ) {}
  snapshot() {
    return backgroundCall(this.data, this.token, "snapshot");
  }
  initialize(_paths: string[]) {
    return this.snapshot();
  }
  autoStart() {
    return backgroundCall(this.data, this.token, "autoStart");
  }
  save(input: any) {
    return backgroundCall(this.data, this.token, "save", input);
  }
  start() {
    return backgroundCall(this.data, this.token, "start");
  }
  stop() {
    return backgroundCall(this.data, this.token, "stop");
  }
  test() {
    return backgroundCall(this.data, this.token, "test");
  }
  forget() {
    return backgroundCall(this.data, this.token, "forget");
  }
  selectRuntime(path: string) {
    return backgroundCall(this.data, this.token, "selectRuntime", path);
  }
}
export class GeminiProxy {
  constructor(
    readonly data: string,
    readonly token: string,
  ) {}
  snapshot(): Promise<GeminiStatus> {
    return backgroundCall(this.data, this.token, "gemini:snapshot");
  }
  autoStart() {
    return backgroundCall(this.data, this.token, "gemini:autoStart");
  }
  save(input: unknown) {
    return backgroundCall(this.data, this.token, "gemini:save", input);
  }
  start() {
    return backgroundCall(this.data, this.token, "gemini:start");
  }
  stop() {
    return backgroundCall(this.data, this.token, "gemini:stop");
  }
  test() {
    return backgroundCall(this.data, this.token, "gemini:test");
  }
  forget() {
    return backgroundCall(this.data, this.token, "gemini:forget");
  }
  selectRuntime(path: string) {
    return backgroundCall(this.data, this.token, "gemini:selectRuntime", path);
  }
  approve(input: { id: string; allow: boolean }) {
    return backgroundCall(this.data, this.token, "gemini:approve", input);
  }
}
export async function serveBackground(
  data: string,
  token: string,
  controller: TunnelController,
  gemini: GeminiController,
) {
  const lockWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  lockWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  lockWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  if (process.platform === "darwin") app.dock?.hide();
  await controller.initialize(
    process.platform === "darwin"
      ? ["/opt/homebrew/bin/tunnel-client", "/usr/local/bin/tunnel-client"]
      : [],
  );
  await controller.autoStart();
  await gemini.initialize(
    process.platform === "darwin"
      ? ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"]
      : [],
  );
  await gemini.autoStart();
  if (process.platform !== "win32")
    await unlink(endpoint(data)).catch(() => {});
  const server = createServer((socket) => {
    let buffer = "";
    socket.setTimeout(60000, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("data", async (bytes) => {
      buffer += bytes.toString();
      if (buffer.length > 1024 * 1024) {
        socket.destroy();
        return;
      }
      if (!buffer.includes("\n")) return;
      socket.pause();
      try {
        const request = z
          .object({
            token: z.string().max(256),
            method: z.enum([
              "ping",
              "gemini:snapshot",
              "gemini:autoStart",
              "gemini:save",
              "gemini:start",
              "gemini:stop",
              "gemini:test",
              "gemini:forget",
              "gemini:selectRuntime",
              "gemini:approve",
              "snapshot",
              "save",
              "start",
              "stop",
              "test",
              "forget",
              "selectRuntime",
              "shutdown",
              "autoStart",
            ]),
            input: z.unknown(),
          })
          .parse(JSON.parse(buffer.slice(0, buffer.indexOf("\n"))));
        if (!sameSecret(request.token, token))
          throw new Error("Unauthorized background request.");
        let result;
        switch (request.method) {
          case "gemini:snapshot":
            result = gemini.snapshot();
            break;
          case "gemini:autoStart":
            await gemini.autoStart();
            result = gemini.snapshot();
            break;
          case "gemini:save":
            result = await gemini.save(
              geminiSettingsSchema.parse(request.input),
            );
            break;
          case "gemini:start":
            result = await gemini.start();
            break;
          case "gemini:stop":
            result = await gemini.stop();
            break;
          case "gemini:test":
            result = await gemini.test();
            break;
          case "gemini:forget":
            result = await gemini.forget();
            break;
          case "gemini:selectRuntime":
            result = await gemini.selectRuntime(
              z.string().parse(request.input),
            );
            break;
          case "gemini:approve":
            result = await gemini.approve(
              z
                .object({ id, allow: z.boolean() })
                .strict()
                .parse(request.input),
            );
            break;
          case "ping":
            result = { pid: process.pid };
            break;
          case "snapshot":
            result = controller.snapshot();
            break;
          case "save":
            result = await controller.save(
              tunnelSettingsSchema.parse(request.input),
            );
            break;
          case "start":
            result = await controller.start();
            break;
          case "autoStart":
            await controller.autoStart();
            result = controller.snapshot();
            break;
          case "stop":
            result = await controller.stop();
            break;
          case "test":
            result = await controller.test();
            break;
          case "forget":
            result = await controller.forget();
            break;
          case "selectRuntime":
            result = await controller.selectRuntime(
              z.string().parse(request.input),
            );
            break;
          case "shutdown":
            await controller.stop();
            await gemini.stop();
            result = { stopped: true };
            setTimeout(() => app.quit(), 200);
            break;
        }
        socket.end(JSON.stringify({ ok: true, data: result }) + "\n");
      } catch (error) {
        socket.end(
          JSON.stringify({ ok: false, error: (error as Error).message }) + "\n",
        );
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint(data), resolve);
  });
  if (process.platform !== "win32") await chmod(endpoint(data), 0o600);
  const stop = async () => {
    await controller.stop();
    await gemini.stop();
    server.close();
    if (process.platform !== "win32")
      await unlink(endpoint(data)).catch(() => {});
    app.quit();
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}
function xml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function windowsArg(s: string) {
  return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1") + '"';
}
export class BackgroundService {
  readonly label: string;
  constructor(
    readonly data: string,
    readonly runtime: string,
    readonly appPath: string,
    readonly packaged: boolean,
    readonly servicesRoot: string,
  ) {
    this.label = "com.t2etech.remotestudio.background." + fingerprint(data);
  }
  private args() {
    return [
      ...(this.packaged ? [] : [this.appPath]),
      "--studio-background",
      "--studio-data",
      this.data,
      "--studio-services",
      this.servicesRoot,
    ];
  }
  private startupPath() {
    return process.platform === "darwin"
      ? join(homedir(), "Library/LaunchAgents", this.label + ".plist")
      : join(
          app.getPath("appData"),
          "Microsoft/Windows/Start Menu/Programs/Startup",
          this.label + ".lnk",
        );
  }
  async register() {
    if (!this.packaged) return;
    if (process.platform === "darwin") {
      const path = this.startupPath();
      await mkdir(join(homedir(), "Library/LaunchAgents"), { recursive: true });
      const args = [this.runtime, ...this.args()]
        .map((a) => "<string>" + xml(a) + "</string>")
        .join("");
      await writeFile(
        path,
        `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${this.label}</string><key>ProgramArguments</key><array>${args}</array><key>EnvironmentVariables</key><dict><key>STUDIO_DATA_DIR</key><string>${xml(this.data)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>`,
        { mode: 0o600 },
      );
      try {
        await run("/bin/launchctl", [
          "bootstrap",
          `gui/${process.getuid!()}`,
          path,
        ]);
      } catch (error) {
        await unlink(path).catch(() => {});
        throw new Error(
          "Could not register the per-user LaunchAgent: " +
            (error as Error).message,
        );
      }
    } else if (process.platform === "win32") {
      const path = this.startupPath();
      await mkdir(
        join(
          app.getPath("appData"),
          "Microsoft/Windows/Start Menu/Programs/Startup",
        ),
        { recursive: true },
      );
      if (
        !shell.writeShortcutLink(path, "create", {
          target: this.runtime,
          args: this.args().map(windowsArg).join(" "),
          description: "Remote Studio background agent",
        })
      )
        throw new Error("Could not create the per-user Startup shortcut.");
    } else throw new Error("Background startup supports macOS and Windows.");
  }
  async unregister() {
    if (!this.packaged) return;
    const path = this.startupPath();
    if (process.platform === "darwin")
      await run("/bin/launchctl", [
        "bootout",
        `gui/${process.getuid!()}/${this.label}`,
      ]).catch(() => {});
    await unlink(path).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  async ensure(token: string) {
    try {
      await backgroundCall(this.data, token, "ping");
      return;
    } catch {
      /* Start the owned helper. */
    }
    const env = tunnelEnvironment();
    delete env.ELECTRON_RUN_AS_NODE;
    env.STUDIO_DATA_DIR = this.data;
    const child = spawn(this.runtime, this.args(), {
      detached: true,
      stdio: "ignore",
      env,
      cwd: this.packaged ? dirname(this.runtime) : this.appPath,
    });
    let startError: Error | undefined;
    child.once("error", (error) => {
      startError = error;
    });
    child.unref();
    for (let i = 0; i < 100; i++) {
      if (startError)
        throw new Error(
          "Background helper could not start: " + startError.message,
        );
      try {
        await backgroundCall(this.data, token, "ping");
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    throw new Error(
      "Background helper did not become ready. Existing jobs were preserved.",
    );
  }
}
