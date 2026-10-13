import { type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  executionContext,
  toolContext,
  WorkspaceLocks,
} from "../../shared/src/execution-context";
import { StreamingRedactor } from "../../environment/src/index";
import { Security, type Actor } from "../../security/src/index";
import {
  commandSchema,
  type Command,
  type Job,
} from "../../contracts/src/index";
import { sandboxStatus, spawnSandbox } from "../../terminal/src/sandbox";
import { stopOwnedProcesses } from "../../terminal/src/recovery";
const redact = (s: string) =>
  s
    .replace(
      /((?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(/\x1b\[[0-9;]*m/g, "");
export class Jobs {
  private active = new Map<string, ChildProcess>();
  private stopping = new Set<string>();
  private timers = new Map<string, NodeJS.Timeout>();
  private shuttingDown = false;
  private launching = new Map<string, Promise<void>>();
  private controls = new WorkspaceLocks();
  private redactors = new Map<
    string,
    { stdout: StreamingRedactor; stderr: StreamingRedactor }
  >();
  constructor(
    readonly security: Security,
    readonly changed: () => void,
    readonly environmentFor: (
      workspaceId: string,
      actor: Actor,
    ) => Record<string, string> = () => ({}),
  ) {}
  async create(
    raw: unknown,
    actor: Actor,
    environment?: Record<string, string>,
    dependencies?: string[],
  ): Promise<Job> {
    const command = commandSchema.parse(raw);
    for (const dependency of dependencies ?? []) {
      const job = this.get(dependency, actor);
      if (job.workspaceId !== command.workspaceId)
        throw new Error("Job dependency belongs to another workspace.");
    }
    if (!this.security.store.modules().Terminal)
      throw new Error("Terminal module is disabled.");
    await this.security.path(
      command.workspaceId,
      command.cwd,
      actor,
      "execute",
    );
    const full = this.security.isFull(command.workspaceId, actor);
    if (full) {
      this.security.workspace(command.workspaceId, actor, "write");
    }
    if (!sandboxStatus().available) throw new Error(sandboxStatus().reason);
    if (command.idempotencyKey) {
      const previous = this.security.store.idempotentJob(
        actor.id,
        command.idempotencyKey,
      );
      if (previous) {
        if (JSON.stringify(previous.command) !== JSON.stringify(command))
          throw new Error("Idempotency key was used for a different command.");
        return previous;
      }
    }
    const job: Job = {
      id: randomUUID(),
      workspaceId: command.workspaceId,
      clientId: actor.id,
      label: [command.executable, ...command.args].join(" "),
      command,
      status: full ? "queued" : "awaiting_approval",
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      logs: "",
      error: null,
      pid: null,
      sandboxed: true,
      authorization: full ? "full" : "reviewed",
      logOffset: 0,
      ...executionContext.getStore(),
      dependsOn: dependencies,
      originModule: toolContext.getStore()?.module ?? "Terminal",
    };
    this.security.store.saveJob(job);
    if (environment)
      this.security.store.put("jobEnvironment", job.id, environment);
    this.security.store.audit(
      full ? "command.authorized_workspace" : "command.approval_requested",
      actor.id,
      job.workspaceId,
      redact(job.label),
    );
    this.changed();
    if (full) void this.pump();
    return job;
  }
  get(id: string, actor: Actor) {
    const job = this.security.store.job(id);
    if (!job) throw new Error("Job not found.");
    if (!actor.ui && job.clientId !== actor.id)
      throw new Error("Job belongs to another client.");
    if (!actor.ui) this.security.workspace(job.workspaceId, actor);
    return job;
  }
  async resolve(
    id: string,
    decision: "approve" | "reject" | "cancel" | "retry",
    actor: Actor,
  ) {
    return this.controls.run(id, () =>
      this.resolveDecision(id, decision, actor),
    );
  }
  private async resolveDecision(
    id: string,
    decision: "approve" | "reject" | "cancel" | "retry",
    actor: Actor,
  ) {
    const job = this.get(id, actor);
    if (["approve", "reject", "retry"].includes(decision) && !actor.ui)
      throw new Error(
        "Only the local interface can approve or retry commands.",
      );
    if (decision === "approve") {
      if (job.status !== "awaiting_approval")
        throw new Error("Job is not awaiting approval.");
      await this.security.path(
        job.workspaceId,
        job.command.cwd,
        this.actor(job),
        "execute",
      );
      job.status = "queued";
      this.security.store.saveJob(job);
    }
    if (decision === "reject") {
      if (job.status !== "awaiting_approval")
        throw new Error("Job is not awaiting approval.");
      job.status = "cancelled";
      job.finishedAt = new Date().toISOString();
      this.security.store.saveJob(job);
    }
    if (decision === "cancel") {
      if (!["queued", "running", "awaiting_approval"].includes(job.status))
        return job;
      this.stopping.add(id);
      await this.kill(id);
      job.status = "cancelled";
      job.finishedAt = new Date().toISOString();
      job.pid = null;
      this.security.store.saveJob(job);
    }
    if (decision === "retry") {
      if (!["failed", "interrupted", "cancelled"].includes(job.status))
        throw new Error("Only unsuccessful jobs can be retried.");
      const command: Command = { ...job.command, idempotencyKey: undefined };
      return toolContext.run(
        { module: job.originModule ?? "Terminal", tool: "job.retry" },
        () => this.create(command, this.actor(job)),
      );
    }
    this.security.store.audit(
      "job." + decision,
      actor.id,
      job.workspaceId,
      job.id,
    );
    this.changed();
    void this.pump();
    return job;
  }
  actor(job: Job): Actor {
    return {
      id: job.clientId,
      ui: job.clientId === "local-ui",
      workspaceIds: null,
      write: true,
    };
  }
  async pump() {
    if (this.shuttingDown) return;
    if (this.active.size >= this.security.store.settings().concurrency) return;
    for (const candidate of this.security.store.jobsWithStatus(["queued"])) {
      if (this.active.size >= this.security.store.settings().concurrency) break;
      if (
        candidate.planId &&
        this.security.store.developmentRecord<any>("plans", candidate.planId)
          ?.status !== "active"
      )
        continue;
      if (
        candidate.dependsOn?.some((id) =>
          ["failed", "cancelled", "interrupted"].includes(
            this.security.store.job(id)?.status ?? "",
          ),
        )
      ) {
        this.security.store.saveJob({
          ...candidate,
          status: "failed",
          error: "A prerequisite job did not complete successfully.",
          finishedAt: new Date().toISOString(),
        });
        this.changed();
        continue;
      }
      if (
        candidate.dependsOn?.some(
          (id) => this.security.store.job(id)?.status !== "completed",
        )
      )
        continue;
      if (
        this.security.store
          .jobsWithStatus(["running"])
          .some(
            (j) =>
              j.status === "running" &&
              j.workspaceId === candidate.workspaceId &&
              !j.command.persistent &&
              !candidate.command.persistent,
          )
      )
        continue;
      const job = {
        ...candidate,
        status: "running" as const,
        startedAt: new Date().toISOString(),
      };
      if (!this.security.store.claim(job)) continue;
      // Reserve the slot before awaiting filesystem validation.
      this.active.set(job.id, null as unknown as ChildProcess);
      let launched!: () => void;
      this.launching.set(
        job.id,
        new Promise<void>((resolve) => {
          launched = resolve;
        }),
      );
      try {
        if (!this.security.store.modules().Terminal)
          throw new Error("Terminal module is disabled.");
        if (
          job.originModule &&
          !this.security.store.modules()[job.originModule]
        )
          throw new Error("The job's originating module is disabled.");
        const cwd = await this.security.path(
          job.workspaceId,
          job.command.cwd,
          this.actor(job),
          "execute",
        );
        if (this.stopping.has(job.id))
          throw new Error("Cancelled before process start.");
        if (
          job.authorization === "full" &&
          !this.security.isFull(job.workspaceId, this.actor(job))
        )
          throw new Error("Full Access was revoked before execution.");
        const extra =
          this.security.store.get<Record<string, string>>(
            "jobEnvironment",
            job.id,
          ) ?? {};
        const environment = this.environmentFor(
          job.workspaceId,
          this.actor(job),
        );
        this.redactors.set(job.id, {
          stdout: new StreamingRedactor(Object.values(environment)),
          stderr: new StreamingRedactor(Object.values(environment)),
        });
        const child = await spawnSandbox(
          this.security.workspace(job.workspaceId, this.actor(job), "execute"),
          this.security.store.directory,
          job.command.executable,
          job.command.args,
          cwd,
          { ...environment, ...extra },
        );
        this.active.set(job.id, child);
        job.pid = child.pid ?? null;
        this.security.store.saveJob(job);
        this.changed();
        const append = (stream: "stdout" | "stderr", chunk: string) => {
          if (this.shuttingDown) return;
          const current = this.security.store.job(job.id)!;
          const safe =
            this.redactors.get(job.id)?.[stream].push(chunk) ?? redact(chunk);
          if (!safe) return;
          const all = current.logs + safe;
          current.logOffset =
            (current.logOffset ?? 0) + Math.max(0, all.length - 128 * 1024);
          current.logs = all.slice(-128 * 1024);
          this.security.store.saveJob(current);
          this.changed();
        };
        child.stdout
          ?.setEncoding("utf8")
          .on("data", (chunk) => append("stdout", chunk));
        child.stderr
          ?.setEncoding("utf8")
          .on("data", (chunk) => append("stderr", chunk));
        if (!job.command.persistent)
          this.timers.set(
            job.id,
            setTimeout(() => {
              const current = this.security.store.job(job.id)!;
              current.error = "Command exceeded its approved timeout.";
              this.security.store.saveJob(current);
              void this.kill(job.id);
            }, job.command.timeoutMs),
          );
        child.once("error", (error) =>
          this.finish(job.id, null, error.message),
        );
        child.once("close", (code) => this.finish(job.id, code));
        if (this.stopping.has(job.id) || this.shuttingDown)
          await stopOwnedProcesses(child);
      } catch (error) {
        this.finish(job.id, null, (error as Error).message);
      } finally {
        launched();
        this.launching.delete(job.id);
      }
    }
  }
  logs(id: string, actor: Actor, cursor = 0) {
    const job = this.get(id, actor),
      offset = job.logOffset ?? 0;
    const end = offset + job.logs.length;
    if (cursor > end) throw new Error("Log cursor is past the current output.");
    return {
      logs: job.logs.slice(Math.max(0, cursor - offset)),
      status: job.status,
      cursor: end,
      truncated: cursor < offset,
    };
  }
  async input(id: string, actor: Actor, input: string, eof = false) {
    this.security.workspace(this.get(id, actor).workspaceId, actor, "execute");
    let job = this.get(id, actor),
      child = this.active.get(id);
    const started = Date.now();
    while (job.status === "running" && !child && Date.now() - started < 5000) {
      await new Promise((res) => setTimeout(res, 25));
      job = this.get(id, actor);
      child = this.active.get(id);
    }
    if (job.status !== "running" || !child?.stdin || child.stdin.destroyed)
      throw new Error("Job has no writable stdin.");
    await new Promise<void>((res, rej) =>
      child.stdin!.write(input, (err) => (err ? rej(err) : res())),
    );
    if (eof) child.stdin.end();
    this.security.store.audit("job.input", actor.id, job.workspaceId, id);
    return { accepted: true };
  }
  async wait(id: string, actor: Actor, timeoutMs: number) {
    const start = Date.now();
    let job = this.get(id, actor);
    while (
      ["running", "queued"].includes(job.status) &&
      Date.now() - start < timeoutMs
    ) {
      await new Promise((res) => setTimeout(res, 100));
      job = this.get(id, actor);
    }
    return job;
  }
  private finish(id: string, exitCode: number | null, error?: string) {
    if (!this.active.has(id)) return;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.active.delete(id);
    const job = this.security.store.job(id)!;
    const redactors = this.redactors.get(id);
    const tail = redactors
      ? redactors.stdout.flush() + redactors.stderr.flush()
      : "";
    if (tail) {
      const all = job.logs + tail;
      job.logOffset =
        (job.logOffset ?? 0) + Math.max(0, all.length - 128 * 1024);
      job.logs = all.slice(-128 * 1024);
    }
    this.redactors.delete(id);
    if (this.shuttingDown) job.status = "interrupted";
    else if (this.stopping.delete(id) || job.status === "cancelled")
      job.status = "cancelled";
    else
      job.status =
        exitCode === 0 && !error && !job.error ? "completed" : "failed";
    job.finishedAt = new Date().toISOString();
    job.pid = null;
    job.exitCode = exitCode;
    job.error = error ?? job.error;
    this.security.store.saveJob(job);
    this.security.store.audit(
      "job." + job.status,
      job.clientId,
      job.workspaceId,
      id,
      job.status === "completed",
    );
    this.changed();
    void this.pump();
  }
  async kill(id: string) {
    await this.launching.get(id);
    const processHandle = this.active.get(id);
    if (!processHandle?.pid) return;
    await stopOwnedProcesses(processHandle);
  }
  async revokeWorkspace(id: string) {
    for (const job of this.security.store.jobsWithStatus([
      "running",
      "queued",
      "awaiting_approval",
    ]))
      if (
        job.workspaceId === id &&
        ["running", "queued", "awaiting_approval"].includes(job.status)
      )
        await this.resolve(job.id, "cancel", {
          id: "local-ui",
          ui: true,
          workspaceIds: null,
          write: true,
        });
  }
  async revokeClient(id: string) {
    for (const job of this.security.store.jobsWithStatus([
      "running",
      "queued",
      "awaiting_approval",
    ]))
      if (
        job.clientId === id &&
        ["running", "queued", "awaiting_approval"].includes(job.status)
      )
        await this.resolve(job.id, "cancel", {
          id: "local-ui",
          ui: true,
          workspaceIds: null,
          write: true,
        });
  }
  async shutdown() {
    this.shuttingDown = true;
    for (const id of this.active.keys()) {
      this.stopping.add(id);
      clearTimeout(this.timers.get(id));
      const job = this.security.store.job(id)!;
      job.status = "interrupted";
      job.pid = null;
      job.finishedAt = new Date().toISOString();
      job.error = "Agent stopped. Manual retry requires approval.";
      this.security.store.saveJob(job);
      await this.kill(id);
    }
    this.active.clear();
  }
}
