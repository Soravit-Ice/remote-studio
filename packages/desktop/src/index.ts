import { executionContext } from "../../shared/src/execution-context";
import { randomUUID } from "node:crypto";
import { join, relative, sep } from "node:path";
import { realpath, readdir } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import { Security, type Actor } from "../../security/src/index";
import { Artifacts } from "../../artifacts/src/index";
import { Jobs } from "../../jobs/src/index";
import { projectMap } from "../../projects/src/map";
import { inspectProject } from "../../projects/src/index";
import { spawnSandbox, serviceDirectory } from "../../terminal/src/sandbox";
import {
  recordOwnedProcess,
  stopOwnedProcesses,
} from "../../terminal/src/recovery";
type Session = {
  planId?: string;
  taskId?: string;
  id: string;
  workspaceId: string;
  clientId: string;
  path: string;
  child: ChildProcess;
  pending: Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >;
  stderr: string;
};
export class Desktops {
  private sessions = new Map<string, Session>();
  private closing = false;
  constructor(
    readonly security: Security,
    readonly artifacts: Artifacts,
    readonly jobs: Jobs,
  ) {}
  private full(workspaceId: string, actor: Actor) {
    this.security.workspace(workspaceId, actor, "write");
    const ws = this.security.workspace(workspaceId, actor, "execute");
    if (
      !this.security.store.modules().Desktop ||
      !this.security.store.modules().Terminal ||
      !this.security.isFull(workspaceId, actor)
    )
      throw new Error(
        "Desktop testing requires the Desktop module and Workspace Full Access with native isolation.",
      );
    return ws;
  }
  private get(id: string, actor: Actor) {
    const s = this.sessions.get(id);
    if (!s || (!actor.ui && s.clientId !== actor.id))
      throw new Error("Desktop session not found for this client.");
    this.full(s.workspaceId, actor);
    return s;
  }
  assertScope(id: string, workspaceId: string, actor: Actor) {
    if (this.get(id, actor).workspaceId !== workspaceId)
      throw new Error("Desktop session belongs to another workspace.");
  }
  private request(s: Session, input: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = randomUUID(),
        timer = setTimeout(() => {
          s.pending.delete(id);
          reject(new Error("Desktop operation timed out: " + s.stderr));
        }, 45000);
      s.pending.set(id, { resolve, reject, timer });
      s.child.stdin!.write(JSON.stringify({ ...input, id }) + "\n", (e) => {
        if (e) {
          clearTimeout(timer);
          s.pending.delete(id);
          reject(e);
        }
      });
    });
  }
  async launch(
    input: {
      workspaceId: string;
      path: string;
      entry?: string;
      packagedPath?: string;
    },
    actor: Actor,
  ) {
    const ws = this.full(input.workspaceId, actor),
      cwd = await this.security.path(ws.id, input.path, actor, "execute"),
      project = await inspectProject(this.security, input, actor);
    if (project.framework !== "Electron")
      throw new Error(
        "desktop_launch currently supports Electron. Tauri requires its own native test adapter.",
      );
    const pkg = JSON.parse(
      (
        await this.security.read(
          ws.id,
          (input.path === "." ? "" : input.path + "/") + "package.json",
          actor,
        )
      ).content,
    );
    const entry = input.packagedPath
      ? undefined
      : await this.security.path(
          ws.id,
          (input.path === "." ? "" : input.path + "/") +
            (input.entry ?? pkg.main ?? "out/main/index.js"),
          actor,
        );
    const binary =
      process.platform === "darwin"
        ? "Electron.app/Contents/MacOS/Electron"
        : process.platform === "win32"
          ? "electron.exe"
          : "electron";
    let executable: string;
    let bundleId: string | undefined;
    if (input.packagedPath) {
      const packaged = await this.security.path(
        ws.id,
        input.packagedPath,
        actor,
        "execute",
      );
      if (process.platform === "darwin" && packaged.endsWith(".app")) {
        const plist = await this.security.read(
          ws.id,
          input.packagedPath + "/Contents/Info.plist",
          actor,
        );
        bundleId =
          /<key>CFBundleIdentifier<\/key>\s*<string>([A-Za-z0-9.-]+)<\/string>/.exec(
            plist.content,
          )?.[1];
        if (!bundleId)
          throw new Error(
            "Packaged app requires a valid XML CFBundleIdentifier for scoped native IPC.",
          );
        const executables = await readdir(join(packaged, "Contents/MacOS"), {
          withFileTypes: true,
        });
        const files = executables.filter((e) => e.isFile());
        if (files.length !== 1)
          throw new Error(
            "Packaged Electron bundle must contain one main executable.",
          );
        executable = join(packaged, "Contents/MacOS", files[0].name);
      } else if (process.platform === "win32" && packaged.endsWith(".exe"))
        executable = packaged;
      else
        throw new Error(
          "Choose a packaged .app on macOS or .exe on Windows inside this workspace.",
        );
    } else
      try {
        executable = await realpath(
          join(cwd, "node_modules/electron/dist", binary),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const installer = await realpath(
          join(cwd, "node_modules/electron/install.js"),
        );
        await this.security.path(
          ws.id,
          relative(ws.path, installer).split(sep).join("/"),
          actor,
        );
        const job = await this.jobs.create(
          {
            workspaceId: ws.id,
            cwd: input.path,
            executable: process.execPath,
            args: [installer],
            timeoutMs: 600000,
          },
          actor,
        );
        return {
          phase: "preparing",
          job,
          message:
            "Electron downloads its pinned runtime on demand. Wait for this job, then retry desktop_launch.",
        };
      }
    await this.security.path(
      ws.id,
      relative(ws.path, executable).split(sep).join("/"),
      actor,
    );
    const child = await spawnSandbox(
      ws,
      this.security.store.directory,
      process.execPath,
      [join(serviceDirectory(), "desktop-worker.mjs")],
      cwd,
      {},
      "desktop",
      bundleId,
    );
    const s: Session = {
      ...executionContext.getStore(),
      id: randomUUID(),
      workspaceId: ws.id,
      clientId: actor.id,
      path: input.path,
      child,
      pending: new Map(),
      stderr: "",
    };
    let buffer = "";
    child.stderr!.on(
      "data",
      (b) => (s.stderr = (s.stderr + b.toString()).slice(-4000)),
    );
    child.stdout!.on("data", (b) => {
      buffer += b.toString();
      if (buffer.length > 8 * 1024 * 1024) {
        this.kill(child);
        return;
      }
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const r = JSON.parse(line);
          if (r.type === "spawned") {
            void recordOwnedProcess(child, r.pid).catch(() => {});
            continue;
          }
          const p = s.pending.get(r.id);
          if (p) {
            clearTimeout(p.timer);
            s.pending.delete(r.id);
            if (r.error) p.reject(new Error(r.error));
            else p.resolve(r.data);
          }
        } catch {
          this.kill(child);
        }
      }
    });
    const failed = (error: string) => {
      for (const p of s.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(error + ": " + s.stderr));
      }
      s.pending.clear();
      this.sessions.delete(s.id);
      if (!this.closing)
        this.security.store.put("desktopSession", s.id, {
          id: s.id,
          workspaceId: s.workspaceId,
          clientId: s.clientId,
          phase: "interrupted",
          error,
        });
    };
    child.once("error", (e) => failed(e.message));
    child.once("close", (code) => failed(`Worker exited ${code}`));
    try {
      const result = await this.request(s, {
        action: "launch",
        executable,
        entry,
        cwd,
        userData: join(ws.path, ".remote-studio/runtime/desktop", s.id),
      });
      this.full(ws.id, actor);
      this.sessions.set(s.id, s);
      this.security.store.put("desktopSession", s.id, {
        id: s.id,
        workspaceId: s.workspaceId,
        clientId: s.clientId,
        path: s.path,
        phase: result.phase,
      });
      return { sessionId: s.id, ...result };
    } catch (error) {
      await stopOwnedProcesses(child);
      throw error;
    }
  }
  async operation(input: any, actor: Actor) {
    const s = this.get(input.sessionId, actor);
    if (input.workspaceId !== s.workspaceId)
      throw new Error("Desktop session belongs to another workspace.");
    return { sessionId: s.id, ...(await this.request(s, input)) };
  }
  async screenshot(input: any, actor: Actor) {
    const s = this.get(input.sessionId, actor),
      map = await projectMap(
        this.security,
        { workspaceId: s.workspaceId, path: s.path },
        actor,
      ),
      result = await this.request(s, { ...input, action: "screenshot" });
    const after = await projectMap(
      this.security,
      { workspaceId: s.workspaceId, path: s.path },
      actor,
    );
    if (map.revision !== after.revision)
      throw new Error("Source changed during capture.");
    const artifact = await this.artifacts.create(
      {
        workspaceId: s.workspaceId,
        name: "desktop.png",
        mimeType: "image/png",
        bytes: Buffer.from(result.base64, "base64"),
        sourceRevision: map.revision,
        sourcePath: s.path,
        role: "screenshot",
        capture: { ...result.capture, kind: "desktop", sessionId: s.id },
      },
      actor,
    );
    return { sessionId: s.id, artifact };
  }
  private kill(child: ChildProcess) {
    void stopOwnedProcesses(child).catch(() => {});
  }
  async stop(id: string, actor: Actor) {
    const s = this.get(id, actor);
    await this.request(s, { action: "stop" }).catch(() => {});
    this.sessions.delete(id);
    await stopOwnedProcesses(s.child);
    return { closed: true };
  }
  async revoke(workspaceId: string) {
    for (const s of [...this.sessions.values()])
      if (s.workspaceId === workspaceId) {
        this.sessions.delete(s.id);
        await stopOwnedProcesses(s.child);
      }
  }
  async revokeClient(clientId: string) {
    for (const s of [...this.sessions.values()])
      if (s.clientId === clientId) {
        this.sessions.delete(s.id);
        await stopOwnedProcesses(s.child);
      }
  }
  async stopPlan(planId: string, taskId: string | undefined, actor: Actor) {
    for (const s of [...this.sessions.values()])
      if (s.planId === planId && (!taskId || s.taskId === taskId))
        await this.stop(s.id, actor);
  }
  async stopAll() {
    const count = this.sessions.size;
    for (const s of [...this.sessions.values()]) {
      this.sessions.delete(s.id);
      await stopOwnedProcesses(s.child);
    }
    return count;
  }
  async close() {
    this.closing = true;
    for (const s of this.sessions.values()) await stopOwnedProcesses(s.child);
    this.sessions.clear();
  }
}
