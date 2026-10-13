import { randomUUID } from "node:crypto";
import { Security, type Actor } from "../../security/src/index";
import { Jobs } from "../../jobs/src/index";
import { DeveloperTools } from "../../projects/src/developer";
import { projectMap } from "../../projects/src/map";
import {
  planCreateSchema,
  type Criterion,
  type Plan,
  type Task,
  type TaskAttempt,
  type Verification,
  type PlanEvent,
  type PlanDetail,
  type Artifact,
} from "../../contracts/src/index";
import {
  executionContext,
  type ExecutionContext,
} from "../../shared/src/execution-context";
export class Planning {
  constructor(
    readonly security: Security,
    readonly jobs: Jobs,
    readonly developer: DeveloperTools,
    readonly changed: () => void,
    readonly browserCheck: (input: any, actor: Actor) => Promise<any>,
    readonly stopSessions: (
      planId: string,
      taskId: string | undefined,
      actor: Actor,
    ) => Promise<void>,
    readonly artifactBytes: (id: string, actor: Actor) => Promise<Buffer>,
  ) {}
  private get(id: string, workspaceId: string, actor: Actor): Plan {
    const plan = this.security.store.developmentRecord<Plan>("plans", id);
    if (
      !plan ||
      plan.workspaceId !== workspaceId ||
      (!actor.ui && plan.clientId !== actor.id)
    )
      throw new Error("Plan not found for this client and workspace.");
    this.security.workspace(workspaceId, actor);
    return plan;
  }
  private event(plan: Plan, action: string, detail: string) {
    const event: PlanEvent = {
      id: randomUUID(),
      planId: plan.id,
      workspaceId: plan.workspaceId,
      clientId: plan.clientId,
      at: new Date().toISOString(),
      action,
      detail: detail.slice(0, 2000),
    };
    this.security.store.saveDevelopment("plan_events", event);
    this.changed();
  }
  private tasks(plan: Plan) {
    return this.security.store
      .developmentForPlan<Task>(
        "tasks",
        plan.id,
        plan.workspaceId,
        plan.clientId,
      )
      .reverse();
  }
  private graph(tasks: { key: string; dependsOn: string[] }[]) {
    const keys = new Set(tasks.map((t) => t.key));
    if (keys.size !== tasks.length) throw new Error("Duplicate task keys.");
    const visiting = new Set<string>(),
      seen = new Set<string>();
    const visit = (key: string) => {
      if (visiting.has(key)) throw new Error("Task dependency cycle.");
      if (seen.has(key)) return;
      const t = tasks.find((t) => t.key === key);
      if (!t) throw new Error("Unknown task dependency: " + key);
      visiting.add(key);
      for (const d of t.dependsOn) visit(d);
      visiting.delete(key);
      seen.add(key);
    };
    for (const key of keys) visit(key);
  }
  create(raw: unknown, actor: Actor) {
    const input = planCreateSchema.parse(raw);
    this.security.workspace(input.workspaceId, actor, "write");
    this.graph(input.tasks);
    const at = new Date().toISOString(),
      plan: Plan = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        clientId: actor.id,
        title: input.title,
        mode: input.mode,
        status: "active",
        revision: 1,
        createdAt: at,
        updatedAt: at,
        designBrief: input.designBrief,
      };
    this.security.store.transaction(() => {
      this.security.store.saveDevelopment("plans", plan);
      for (const definition of input.tasks)
        this.security.store.saveDevelopment("tasks", {
          ...definition,
          id: randomUUID(),
          planId: plan.id,
          workspaceId: plan.workspaceId,
          clientId: plan.clientId,
          status: "pending",
          error: null,
          assessment: "",
        } as Task);
    });
    this.event(plan, "created", plan.title);
    return this.detail(plan, actor);
  }
  private detail(plan: Plan, actor: Actor): PlanDetail {
    this.get(plan.id, plan.workspaceId, actor);
    const tasks = this.tasks(plan),
      forPlan = <T extends { planId?: string }>(
        table: "task_attempts" | "verifications" | "artifacts" | "plan_events",
      ) =>
        this.security.store.developmentForPlan<T>(
          table,
          plan.id,
          plan.workspaceId,
          plan.clientId,
        );
    return {
      plan,
      tasks,
      attempts: forPlan<TaskAttempt>("task_attempts"),
      verifications: forPlan<Verification>("verifications"),
      artifacts: forPlan<Artifact>("artifacts"),
      events: forPlan<PlanEvent>("plan_events"),
      nextTasks: tasks
        .filter(
          (t) =>
            ["pending", "failed", "interrupted", "blocked"].includes(
              t.status,
            ) &&
            t.dependsOn.every(
              (k) => tasks.find((x) => x.key === k)?.status === "completed",
            ),
        )
        .map((t) => t.id),
      progress: {
        completed: tasks.filter((t) => t.status === "completed").length,
        total: tasks.length,
      },
    };
  }
  async read(
    input: { planId: string; workspaceId: string },
    actor: Actor,
    refresh = true,
  ) {
    const plan = this.get(input.planId, input.workspaceId, actor);
    if (refresh) await this.refresh(plan, actor);
    return this.detail(this.get(plan.id, plan.workspaceId, actor), actor);
  }
  async update(
    input: {
      planId: string;
      workspaceId: string;
      revision: number;
      title?: string;
      designBrief?: string;
      status?: "active" | "paused" | "cancelled";
      tasks?: any[];
    },
    actor: Actor,
  ) {
    const plan = this.get(input.planId, input.workspaceId, actor);
    this.security.workspace(plan.workspaceId, actor, "write");
    if (plan.revision !== input.revision)
      throw new Error("Plan revision conflict. Read the current plan first.");
    if (input.tasks) {
      const definitions = input.tasks;
      this.graph(definitions);
      const existing = this.tasks(plan);
      if (existing.some((t) => !["pending", "blocked"].includes(t.status)))
        throw new Error(
          "Replanning tasks requires pending/blocked tasks; create a new plan for already executed work.",
        );
      this.security.store.transaction(() => {
        for (const t of existing)
          this.security.store.db
            .prepare("DELETE FROM tasks WHERE id=?")
            .run(t.id);
        for (const t of definitions)
          this.security.store.saveDevelopment("tasks", {
            ...t,
            id: randomUUID(),
            planId: plan.id,
            workspaceId: plan.workspaceId,
            clientId: plan.clientId,
            status: "pending",
            error: null,
            assessment: "",
          });
      });
    }
    if (input.title !== undefined) plan.title = input.title;
    if (input.designBrief !== undefined) plan.designBrief = input.designBrief;
    if (input.status) plan.status = input.status;
    if (input.status === "cancelled") {
      const detail = this.detail(plan, actor),
        ids = new Set([
          ...detail.attempts.flatMap((a) => a.jobIds),
          ...detail.verifications.flatMap((v) => (v.jobId ? [v.jobId] : [])),
        ]);
      for (const id of ids) {
        const job = this.jobs.get(id, actor);
        if (
          job.planId === plan.id &&
          ["running", "queued", "awaiting_approval"].includes(job.status)
        )
          await this.jobs.resolve(id, "cancel", actor);
      }
      await this.stopSessions(plan.id, undefined, actor);
      for (const task of detail.tasks)
        this.security.store.saveDevelopment("tasks", {
          ...task,
          status: task.status === "completed" ? "completed" : "cancelled",
        });
    }
    plan.revision++;
    plan.updatedAt = new Date().toISOString();
    this.security.store.saveDevelopment("plans", plan);
    this.event(plan, "updated", input.status ?? "metadata");
    return this.detail(plan, actor);
  }
  async resume(input: { planId: string; workspaceId: string }, actor: Actor) {
    const plan = this.get(input.planId, input.workspaceId, actor);
    this.security.workspace(plan.workspaceId, actor, "write");
    if (plan.status === "cancelled")
      throw new Error("Cancelled plans cannot resume.");
    await this.refresh(plan, actor);
    plan.status = "active";
    plan.revision++;
    plan.updatedAt = new Date().toISOString();
    this.security.store.saveDevelopment("plans", plan);
    for (const t of this.tasks(plan))
      if (t.status === "interrupted")
        this.security.store.saveDevelopment("tasks", {
          ...t,
          status: "pending",
          error: null,
        });
    this.event(
      plan,
      "resumed",
      "Context restored. Commands and file changes were not replayed.",
    );
    void this.jobs.pump();
    return this.detail(plan, actor);
  }
  private task(
    input: { planId: string; workspaceId: string; taskId: string },
    actor: Actor,
  ) {
    const plan = this.get(input.planId, input.workspaceId, actor),
      task = this.tasks(plan).find((t) => t.id === input.taskId);
    if (!task) throw new Error("Task not found in this plan.");
    return { plan, task };
  }
  async updateTask(
    input: {
      planId: string;
      workspaceId: string;
      taskId: string;
      status?: "pending" | "running" | "blocked" | "cancelled";
      error?: string;
      assessment?: string;
      criteria?: Criterion[];
      revision?: number;
    },
    actor: Actor,
  ) {
    let { plan, task } = this.task(input, actor);
    this.security.workspace(plan.workspaceId, actor, "write");
    if (input.status === "running") {
      await this.refresh(plan, actor);
      ({ plan, task } = this.task(input, actor));
    }
    if (plan.status !== "active") throw new Error("Plan is not active.");
    if (input.criteria) {
      if (input.revision !== plan.revision)
        throw new Error(
          "Plan revision conflict before updating acceptance criteria.",
        );
      if (
        this.security.store
          .jobsWithStatus(["running", "queued", "awaiting_approval"])
          .some((j) => j.taskId === task.id && !j.command.persistent)
      )
        throw new Error(
          "Stop or finish task validation jobs before updating criteria.",
        );
      task.criteria = input.criteria;
      task.status = "pending";
      task.error = null;
      for (const v of this.security.store
        .developmentForPlan<Verification>(
          "verifications",
          plan.id,
          plan.workspaceId,
          plan.clientId,
        )
        .filter((v) => v.taskId === task.id))
        this.security.store.saveDevelopment("verifications", {
          ...v,
          status: "stale",
        });
      plan.revision++;
      plan.updatedAt = new Date().toISOString();
      this.security.store.saveDevelopment("plans", plan);
    }
    if (input.status === "running") this.dependencies(plan, task);
    if (input.status === "cancelled") {
      for (const job of this.security.store.jobsWithStatus([
        "running",
        "queued",
        "awaiting_approval",
      ]))
        if (job.planId === plan.id && job.taskId === task.id)
          await this.jobs.resolve(job.id, "cancel", actor);
      await this.stopSessions(plan.id, task.id, actor);
    }
    if (input.status) task.status = input.status;
    if (input.error !== undefined) task.error = input.error;
    if (input.assessment !== undefined) task.assessment = input.assessment;
    this.security.store.saveDevelopment("tasks", task);
    this.event(plan, "task_updated", task.key);
    return this.detail(plan, actor);
  }
  private dependencies(plan: Plan, task: Task) {
    if (
      task.dependsOn.some(
        (k) =>
          this.tasks(plan).find((t) => t.key === k)?.status !== "completed",
      )
    )
      throw new Error("Task dependencies have not passed verification.");
  }
  async before(
    tool: string,
    input: any,
    actor: Actor,
    permission: "read" | "write" | "execute" = "write",
  ): Promise<ExecutionContext | undefined> {
    if (!input.planId && !input.taskId) return;
    if (!input.planId || !input.taskId || !input.workspaceId)
      throw new Error(
        "Linked execution requires workspaceId, planId and taskId.",
      );
    let { plan, task } = this.task(input, actor);
    await this.refresh(plan, actor);
    ({ plan, task } = this.task(input, actor));
    if (
      plan.status !== "active" ||
      ["completed", "cancelled", "verifying"].includes(task.status)
    )
      throw new Error("Task cannot execute in its current state.");
    this.dependencies(plan, task);
    if (
      this.security.store
        .developmentForPlan<TaskAttempt>(
          "task_attempts",
          plan.id,
          plan.workspaceId,
          plan.clientId,
        )
        .some((a) => a.taskId === task.id && a.status === "running")
    )
      throw new Error("Task already has an active operation.");
    if (
      permission !== "read" &&
      !tool.startsWith("job_") &&
      this.security.store
        .jobsWithStatus(["running", "queued", "awaiting_approval"])
        .some((j) => j.taskId === task.id && !j.command.persistent)
    )
      throw new Error(
        "Wait for the task's existing command before starting another operation.",
      );
    const attempt: TaskAttempt = {
      id: randomUUID(),
      planId: plan.id,
      taskId: task.id,
      workspaceId: plan.workspaceId,
      clientId: plan.clientId,
      tool,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      jobIds: [],
      changeIds: [],
      artifactIds: [],
      error: null,
    };
    this.security.store.saveDevelopment("task_attempts", attempt);
    this.security.store.saveDevelopment("tasks", {
      ...task,
      status: "running",
      error: null,
    });
    this.changed();
    return { planId: plan.id, taskId: task.id, attemptId: attempt.id };
  }
  after(context: ExecutionContext | undefined, result: any, error?: Error) {
    if (!context) return;
    const a = this.security.store.developmentRecord<TaskAttempt>(
      "task_attempts",
      context.attemptId,
    )!;
    const jobs =
      result?.jobs ??
      (result?.command ? [result] : result?.job ? [result.job] : []);
    a.jobIds = jobs.map((j: any) => j.id);
    if (result?.expectedHash !== undefined && result?.id)
      a.changeIds = [result.id];
    if (result?.changeId) a.changeIds.push(result.changeId);
    if (result?.artifact?.id) a.artifactIds = [result.artifact.id];
    if (result?.diff?.id) a.artifactIds.push(result.diff.id);
    a.status = error ? "failed" : "completed";
    a.error = error?.message ?? null;
    a.finishedAt = new Date().toISOString();
    this.security.store.saveDevelopment("task_attempts", a);
    const t = this.security.store.developmentRecord<Task>(
      "tasks",
      context.taskId,
    )!;
    t.status = error
      ? "failed"
      : result?.status === "pending" ||
          result?.status === "awaiting_approval" ||
          jobs.some((j: any) => j.status === "awaiting_approval")
        ? "awaiting_approval"
        : "running";
    t.error = error?.message ?? null;
    this.security.store.saveDevelopment("tasks", t);
    this.changed();
  }
  private async refresh(plan: Plan, actor: Actor) {
    const tasks = this.tasks(plan),
      vs = this.security.store.developmentForPlan<Verification>(
        "verifications",
        plan.id,
        plan.workspaceId,
        plan.clientId,
      );
    const revisions = new Map<string, string>();
    for (const v of vs) {
      if (v.status !== "passed") continue;
      let stale = false;
      try {
        if (v.fileHash) {
          const f = await this.security.read(
            plan.workspaceId,
            v.criterion.path,
            actor,
          );
          stale = f.hash !== v.fileHash;
        } else if (v.sourceRevision) {
          const path = v.criterion.path;
          if (!revisions.has(path)) {
            const map = await projectMap(
              this.security,
              { workspaceId: plan.workspaceId, path },
              actor,
            );
            revisions.set(path, map.complete ? map.revision : "incomplete");
          }
          stale = revisions.get(path) !== v.sourceRevision;
        }
      } catch {
        stale = true;
      }
      if (stale) {
        v.status = "stale";
        this.security.store.saveDevelopment("verifications", v);
        const t = tasks.find((t) => t.id === v.taskId);
        if (t?.status === "completed") {
          t.status = "pending";
          t.error = "Verification is stale after source changed.";
          this.security.store.saveDevelopment("tasks", t);
        }
        if (plan.status === "completed") {
          plan.status = "active";
          this.security.store.saveDevelopment("plans", plan);
        }
      }
    }
  }
  async verify(
    input: { planId: string; workspaceId: string; taskId: string },
    actor: Actor,
  ) {
    const { plan, task } = this.task(input, actor);
    this.security.workspace(plan.workspaceId, actor, "execute");
    if (plan.status !== "active") throw new Error("Plan is not active.");
    await this.refresh(plan, actor);
    this.dependencies(plan, task);
    const attempts = this.detail(plan, actor).attempts.filter(
      (a) => a.taskId === task.id,
    );
    for (const a of attempts)
      for (const id of a.jobIds) {
        const j = this.jobs.get(id, actor);
        if (
          ["running", "queued", "awaiting_approval"].includes(j.status) &&
          !j.command.persistent
        )
          throw new Error("Wait for task jobs before verification.");
      }
    if (task.status === "cancelled")
      throw new Error("Cancelled tasks cannot be verified.");
    task.status = "verifying";
    this.security.store.saveDevelopment("tasks", task);
    const existing = this.detail(plan, actor).verifications.filter(
      (v) => v.taskId === task.id,
    );
    const results: Verification[] = [];
    for (const criterion of task.criteria) {
      const same = (v: Verification) =>
        JSON.stringify(v.criterion) === JSON.stringify(criterion);
      let v = existing.find((v) => same(v) && v.status === "running");
      if (v?.jobId) {
        const j = this.jobs.get(v.jobId, actor);
        if (["queued", "running", "awaiting_approval"].includes(j.status)) {
          results.push(v);
          continue;
        }
        const map = await projectMap(
          this.security,
          { workspaceId: plan.workspaceId, path: criterion.path },
          actor,
        );
        v.status =
          j.status === "completed" &&
          j.exitCode === 0 &&
          map.complete &&
          map.revision === v.sourceRevision
            ? "passed"
            : "failed";
        v.detail = j.error ?? `Process ${j.status}, exit ${j.exitCode}`;
      } else {
        v = {
          id: randomUUID(),
          planId: plan.id,
          taskId: task.id,
          workspaceId: plan.workspaceId,
          clientId: plan.clientId,
          criterion,
          status: "failed",
          at: new Date().toISOString(),
          sourceRevision: null,
          fileHash: null,
          jobId: null,
          artifactId: null,
          detail: "",
        };
        try {
          if (
            criterion.kind === "file_exists" ||
            criterion.kind === "file_contains"
          ) {
            const f = await this.security.read(
              plan.workspaceId,
              criterion.path,
              actor,
            );
            v.fileHash = f.hash;
            v.status = (
              criterion.kind === "file_exists"
                ? !criterion.hash || criterion.hash === f.hash
                : f.content.includes(criterion.text)
            )
              ? "passed"
              : "failed";
            v.detail = "Read actual file and checked content/hash.";
          } else {
            const map = await projectMap(
              this.security,
              { workspaceId: plan.workspaceId, path: criterion.path },
              actor,
            );
            if (!map.complete)
              throw new Error(
                "Source scan is incomplete; verification cannot pass.",
              );
            v.sourceRevision = map.revision;
            if (criterion.kind === "script") {
              const attempt: TaskAttempt = {
                id: randomUUID(),
                planId: plan.id,
                taskId: task.id,
                workspaceId: plan.workspaceId,
                clientId: plan.clientId,
                tool: "task_verify",
                status: "running",
                startedAt: new Date().toISOString(),
                finishedAt: null,
                jobIds: [],
                changeIds: [],
                artifactIds: [],
                error: null,
              };
              this.security.store.saveDevelopment("task_attempts", attempt);
              try {
                const job = await executionContext.run(
                  { planId: plan.id, taskId: task.id, attemptId: attempt.id },
                  () =>
                    this.developer.script(
                      {
                        workspaceId: plan.workspaceId,
                        path: criterion.path,
                        script: criterion.script,
                        args: [],
                      },
                      actor,
                    ),
                );
                attempt.jobIds = [job.id];
                attempt.status = "completed";
                v.jobId = job.id;
                v.status = "running";
                v.detail = "Waiting for the actual validation process.";
              } catch (error) {
                attempt.status = "failed";
                attempt.error = (error as Error).message;
                throw error;
              } finally {
                attempt.finishedAt = new Date().toISOString();
                this.security.store.saveDevelopment("task_attempts", attempt);
              }
            } else if (criterion.kind === "screenshot") {
              const artifact = criterion.artifactId
                ? this.security.store.developmentRecord<Artifact>(
                    "artifacts",
                    criterion.artifactId,
                  )
                : this.detail(plan, actor).artifacts.find(
                    (a) =>
                      a.taskId === task.id &&
                      a.role === "screenshot" &&
                      a.sourcePath === criterion.path &&
                      a.sourceRevision === map.revision,
                  );
              if (
                !artifact ||
                artifact.workspaceId !== plan.workspaceId ||
                artifact.clientId !== plan.clientId ||
                artifact.sourcePath !== criterion.path ||
                artifact.sourceRevision !== map.revision ||
                artifact.role !== "screenshot"
              )
                throw new Error("A current owned screenshot is required.");
              await this.artifactBytes(artifact.id, actor);
              v.artifactId = artifact.id;
              v.status = "passed";
              v.detail = "Actual screenshot for the current source revision.";
            } else {
              const check = await this.browserCheck(
                {
                  workspaceId: plan.workspaceId,
                  sessionId: criterion.sessionId,
                  path: criterion.path,
                  planId: plan.id,
                  taskId: task.id,
                },
                actor,
              );
              const after = await projectMap(
                this.security,
                { workspaceId: plan.workspaceId, path: criterion.path },
                actor,
              );
              v.status =
                check.passed &&
                after.complete &&
                after.revision === map.revision
                  ? "passed"
                  : "failed";
              v.artifactId = check.artifact?.id ?? null;
              v.detail = JSON.stringify(check).slice(0, 4000);
            }
          }
        } catch (error) {
          v.detail = (error as Error).message;
        }
      }
      this.security.store.saveDevelopment("verifications", v);
      results.push(v);
    }
    const approval = results.some(
      (v) =>
        v.jobId && this.jobs.get(v.jobId, actor).status === "awaiting_approval",
    );
    task.status = approval
      ? "awaiting_approval"
      : results.some((v) => v.status === "running")
        ? "verifying"
        : results.every((v) => v.status === "passed")
          ? "completed"
          : "failed";
    task.error =
      task.status === "failed"
        ? results
            .filter((v) => v.status === "failed")
            .map((v) => v.detail)
            .join("; ")
        : null;
    this.security.store.saveDevelopment("tasks", task);
    if (this.tasks(plan).every((t) => t.status === "completed")) {
      plan.status = "completed";
      this.security.store.saveDevelopment("plans", plan);
    }
    this.event(plan, "verified", `${task.key}: ${task.status}`);
    return this.detail(plan, actor);
  }
}
