import { executionContext } from "../../shared/src/execution-context";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Security, type Actor } from "../../security/src/index";
import { Files } from "../../filesystem/src/index";
import { Jobs } from "../../jobs/src/index";
import { DeveloperTools } from "../../projects/src/developer";
import { spawnSandbox, serviceDirectory } from "../../terminal/src/sandbox";
import { Artifacts } from "../../artifacts/src/index";
import { projectMap } from "../../projects/src/map";
import {
  recordOwnedProcess,
  stopOwnedProcesses,
} from "../../terminal/src/recovery";
type Session = {
  planId?: string;
  taskId?: string;
  id: string;
  clientId: string;
  workspaceId: string;
  jobId: string;
  child: ChildProcess;
  stderr: string;
  pending: Map<
    string,
    {
      resolve(value: any): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >;
};
export class Browsers {
  private sessions = new Map<string, Session>();
  constructor(
    readonly security: Security,
    readonly files: Files,
    readonly jobs: Jobs,
    readonly developer: DeveloperTools,
    readonly artifacts: Artifacts,
  ) {}
  private full(workspaceId: string, actor: Actor) {
    if (
      !this.security.store.modules().Browser ||
      !this.security.store.modules().Terminal
    )
      throw new Error("Browser or Terminal module is disabled.");
    const ws = this.security.workspace(workspaceId, actor, "execute");
    this.security.workspace(workspaceId, actor, "write");
    if (!this.security.isFull(workspaceId, actor))
      throw new Error(
        "Browser automation requires Workspace Full Access and a native sandbox.",
      );
    return ws;
  }
  private directory(workspaceId: string, actor: Actor) {
    return join(
      this.full(workspaceId, actor).path,
      ".remote-studio",
      "runtime",
      "browser-runtime",
    );
  }
  prepare(input: { workspaceId: string }, actor: Actor) {
    return this.jobs.create(
      {
        workspaceId: input.workspaceId,
        executable: process.execPath,
        args: [
          join(serviceDirectory(), "vendor/playwright-core/cli.js"),
          "install",
          "chromium",
        ],
        timeoutMs: 600000,
      },
      actor,
      { PLAYWRIGHT_BROWSERS_PATH: this.directory(input.workspaceId, actor) },
    );
  }
  private get(id: string, actor: Actor) {
    const s = this.sessions.get(id);
    if (!s || (!actor.ui && s.clientId !== actor.id))
      throw new Error("Browser session not found for this client.");
    this.full(s.workspaceId, actor);
    return s;
  }
  private request(s: Session, input: Record<string, unknown>) {
    return new Promise<any>((resolve, reject) => {
      const id = randomUUID(),
        timer = setTimeout(() => {
          s.pending.delete(id);
          reject(new Error("Browser operation timed out: " + s.stderr));
        }, 35000);
      s.pending.set(id, { resolve, reject, timer });
      s.child.stdin!.write(JSON.stringify({ ...input, id }) + "\n", (error) => {
        if (error) {
          clearTimeout(timer);
          s.pending.delete(id);
          reject(error);
        }
      });
    });
  }
  assertScope(id: string, workspaceId: string, actor: Actor) {
    if (this.get(id, actor).workspaceId !== workspaceId)
      throw new Error("Browser session belongs to another workspace.");
  }
  async open(
    input: {
      workspaceId: string;
      jobId: string;
      width: number;
      height: number;
    },
    actor: Actor,
  ) {
    const ws = this.full(input.workspaceId, actor),
      preview = await this.developer.previewStatus(input, actor);
    if (preview.job.workspaceId !== ws.id || !preview.ready)
      throw new Error("Managed preview is not ready in this workspace.");
    // The worker and Chromium descendants inherit the same native policy. CDP
    // uses private pipes inside it; no unauthenticated localhost control port.
    const child = await spawnSandbox(
      ws,
      this.security.store.directory,
      process.execPath,
      [join(serviceDirectory(), "browser-worker.mjs")],
      ws.path,
      { PLAYWRIGHT_BROWSERS_PATH: this.directory(ws.id, actor) },
      "browser",
    );
    const s: Session = {
      ...executionContext.getStore(),
      id: randomUUID(),
      workspaceId: ws.id,
      clientId: actor.id,
      jobId: preview.job.id,
      child,
      stderr: "",
      pending: new Map(),
    };
    let buffer = "";
    child.stderr!.on(
      "data",
      (b) => (s.stderr = (s.stderr + b.toString()).slice(-3000)),
    );
    child.stdout!.on("data", (b) => {
      buffer += b.toString();
      if (buffer.length > 8 * 1024 * 1024) {
        this.kill(child);
        return;
      }
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        try {
          const reply = JSON.parse(line),
            waiter = s.pending.get(reply.id);
          if (reply.type === "spawned") {
            void recordOwnedProcess(child, reply.pid).catch(() => {});
            continue;
          }
          if (waiter) {
            clearTimeout(waiter.timer);
            s.pending.delete(reply.id);
            if (reply.error) waiter.reject(new Error(reply.error));
            else waiter.resolve(reply.data);
          }
        } catch {
          this.kill(child);
        }
      }
    });
    const failed = (message: string) => {
      for (const waiter of s.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(message + ": " + s.stderr));
      }
      s.pending.clear();
      this.sessions.delete(s.id);
    };
    child.once("error", (e) => failed(e.message));
    child.once("close", (code, signal) =>
      failed(`Browser worker exited (${signal ?? code})`),
    );
    try {
      const result = await this.request(s, {
        ...input,
        action: "open",
        url: preview.url,
      });
      this.full(ws.id, actor);
      this.sessions.set(s.id, s);
      return { sessionId: s.id, ...result };
    } catch (error) {
      await stopOwnedProcesses(child);
      throw error;
    }
  }
  async snapshot(id: string, actor: Actor) {
    return {
      sessionId: id,
      ...(await this.request(this.get(id, actor), { action: "snapshot" })),
    };
  }
  async action(
    input: {
      sessionId: string;
      action: string;
      selector?: string;
      value?: string;
    },
    actor: Actor,
  ) {
    return {
      sessionId: input.sessionId,
      ...(await this.request(this.get(input.sessionId, actor), input)),
    };
  }
  async screenshot(
    input: {
      sessionId: string;
      path?: string;
      fullPage: boolean;
      selector?: string;
      locator?: any;
      clip?: any;
    },
    actor: Actor,
  ) {
    const s = this.get(input.sessionId, actor),
      sourcePath = this.jobs.get(s.jobId, actor).command.cwd,
      map = await projectMap(
        this.security,
        { workspaceId: s.workspaceId, path: sourcePath },
        actor,
      ),
      result = await this.request(s, {
        ...input,
        action: "screenshot",
        fullPage: input.fullPage,
      }),
      bytes = Buffer.from(result.base64, "base64");
    const change = input.path
      ? await this.files.mutate(
          s.workspaceId,
          [
            {
              operation: "write",
              path: input.path,
              content: result.base64,
              encoding: "base64",
              expectedHash: null,
            },
          ],
          actor,
        )
      : undefined;
    const after = await projectMap(
      this.security,
      { workspaceId: s.workspaceId, path: sourcePath },
      actor,
    );
    if (after.revision !== map.revision)
      throw new Error(
        "Source changed during screenshot capture. Capture again.",
      );
    const artifact = await this.artifacts.create(
      {
        workspaceId: s.workspaceId,
        name: input.path ?? "screenshot.png",
        mimeType: "image/png",
        bytes,
        sourceRevision: map.revision,
        sourcePath,
        role: "screenshot",
        capture: { ...result.capture, kind: "browser", sessionId: s.id },
      },
      actor,
    );
    return {
      path: input.path,
      bytes: bytes.length,
      changeId: change?.id,
      artifact,
    };
  }
  async check(
    input: {
      workspaceId: string;
      sessionId: string;
      path?: string;
      planId?: string;
      taskId?: string;
    },
    actor: Actor,
  ) {
    const s = this.get(input.sessionId, actor);
    if (s.workspaceId !== input.workspaceId)
      throw new Error("Session belongs to another workspace.");
    if (input.path !== undefined) {
      const job = this.jobs.get(s.jobId, actor);
      const expected = await this.security.path(
          s.workspaceId,
          input.path,
          actor,
        ),
        actual = await this.security.path(
          s.workspaceId,
          job.command.cwd,
          actor,
        );
      if (expected !== actual)
        throw new Error(
          "Browser verification source must match the managed preview project.",
        );
    }
    if (input.planId) {
      if (s.planId && (s.planId !== input.planId || s.taskId !== input.taskId))
        throw new Error("Browser session belongs to another task.");
      s.planId = input.planId;
      s.taskId = input.taskId;
    }
    const sourcePath = this.jobs.get(s.jobId, actor).command.cwd;
    const before = await projectMap(
      this.security,
      { workspaceId: s.workspaceId, path: sourcePath },
      actor,
    );
    const result = await this.request(s, { action: "check" });
    const after = await projectMap(
      this.security,
      { workspaceId: s.workspaceId, path: sourcePath },
      actor,
    );
    if (after.revision !== before.revision)
      throw new Error("Source changed during UI verification. Check again.");
    const artifact = await this.artifacts.create(
      {
        workspaceId: s.workspaceId,
        name: "browser-check.json",
        mimeType: "application/json",
        bytes: Buffer.from(JSON.stringify(result, null, 2)),
        sourceRevision: before.revision,
        sourcePath,
        role: "report",
        planId: input.planId,
        taskId: input.taskId,
      },
      actor,
    );
    return { ...result, artifact };
  }
  private kill(child: ChildProcess) {
    void stopOwnedProcesses(child).catch(() => {});
  }
  async stop(id: string, actor: Actor) {
    const s = this.sessions.get(id);
    if (!s || (!actor.ui && s.clientId !== actor.id))
      throw new Error("Browser session not found for this client.");
    this.sessions.delete(id);
    await stopOwnedProcesses(s.child);
    return { closed: true };
  }
  async revoke(workspaceId: string) {
    for (const s of [...this.sessions.values()])
      if (s.workspaceId === workspaceId)
        await this.stop(s.id, {
          id: "local-ui",
          ui: true,
          workspaceIds: null,
          write: true,
        });
  }
  async revokeClient(clientId: string) {
    for (const s of [...this.sessions.values()])
      if (s.clientId === clientId)
        await this.stop(s.id, {
          id: "local-ui",
          ui: true,
          workspaceIds: null,
          write: true,
        });
  }
  async stopPlan(planId: string, taskId: string | undefined, actor: Actor) {
    for (const s of [...this.sessions.values()])
      if (s.planId === planId && (!taskId || s.taskId === taskId))
        await this.stop(s.id, actor);
  }
  async close() {
    for (const s of [...this.sessions.values()])
      await this.stop(s.id, {
        id: "local-ui",
        ui: true,
        workspaceIds: null,
        write: true,
      });
  }
}
