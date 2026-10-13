import { Maintenance } from "../../../packages/maintenance/src/index";
import {
  Licensing,
  type LicenseAuthority,
} from "../../../packages/licensing/src/index";
import { runtimeRevision } from "../../../packages/shared/src/native-runtime";
import { realpath, lstat, mkdir, writeFile, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { Store } from "../../../packages/database/src/index";
import {
  Security,
  hash,
  sameSecret,
  type Actor,
} from "../../../packages/security/src/index";
import { Files, proposeSchema } from "../../../packages/filesystem/src/index";
import { Jobs } from "../../../packages/jobs/src/index";
import {
  createProject,
  inspectProject,
} from "../../../packages/projects/src/index";
import {
  settingsSchema,
  settingsPatchSchema,
  id,
  type Workspace,
  type Change,
  type Snapshot,
  type Audit,
  accessModeSchema,
  workspaceGrantSchema,
} from "../../../packages/contracts/src/index";
import { catalog } from "./tools";
import { repositoryDirectory } from "../../../packages/git/src/index";
import {
  sandboxStatus,
  sandboxProbe,
  serviceDirectory,
} from "../../../packages/terminal/src/sandbox";
import { DeveloperTools } from "../../../packages/projects/src/developer";
import { Browsers } from "../../../packages/browser/src/index";
import { workspaceRoot } from "../../../packages/shared/src/workspace-root";
import { Artifacts } from "../../../packages/artifacts/src/index";
import { Planning } from "../../../packages/planning/src/index";
import {
  executionContext,
  toolContext,
  WorkspaceLocks,
  type ExecutionContext,
} from "../../../packages/shared/src/execution-context";
import {
  projectContext,
  codeQuery,
} from "../../../packages/projects/src/intelligence";
import { Desktops } from "../../../packages/desktop/src/index";
import { Skills } from "../../../packages/skills/src/index";
import { Environment } from "../../../packages/environment/src/index";
import { Design } from "../../../packages/design/src/index";
const runFile = promisify(execFile);
const uiActor: Actor = {
  id: "local-ui",
  ui: true,
  workspaceIds: null,
  write: true,
};
export class Engine {
  readonly store: Store;
  readonly security: Security;
  readonly files: Files;
  readonly jobs: Jobs;
  readonly developer: DeveloperTools;
  readonly browsers: Browsers;
  readonly artifacts: Artifacts;
  readonly planning: Planning;
  readonly desktops: Desktops;
  readonly skills: Skills;
  readonly environment: Environment;
  readonly design: Design;
  readonly locks = new WorkspaceLocks();
  readonly serverId: string;
  readonly startedAt = new Date().toISOString();
  constructor(
    readonly directory: string,
    readonly secret: string,
    readonly changed: () => void,
    readonly licensing: LicenseAuthority = new Licensing(directory, changed),
  ) {
    this.store = new Store(directory);
    this.serverId =
      this.store.get<string>("identity", "server") ?? randomUUID();
    this.store.put("identity", "server", this.serverId);
    this.security = new Security(this.store, () => this.licensing.ensure());
    this.files = new Files(this.security, changed);
    this.environment = new Environment(this.security);
    this.design = new Design(this.security, this.files);
    this.jobs = new Jobs(this.security, changed, (workspaceId, actor) =>
      this.environment.forJob(workspaceId, actor),
    );
    this.developer = new DeveloperTools(this.security, this.jobs);
    this.artifacts = new Artifacts(this.security);
    this.desktops = new Desktops(this.security, this.artifacts, this.jobs);
    this.skills = new Skills(this.security, this.files, this.jobs, changed);
    this.browsers = new Browsers(
      this.security,
      this.files,
      this.jobs,
      this.developer,
      this.artifacts,
    );
    this.planning = new Planning(
      this.security,
      this.jobs,
      this.developer,
      changed,
      (input, actor) => this.browsers.check(input, actor),
      async (planId, taskId, actor) => {
        await this.browsers.stopPlan(planId, taskId, actor);
        await this.desktops.stopPlan(planId, taskId, actor);
      },
      (id, actor) => this.artifacts.bytes(id, actor),
    );
  }
  actor(token: string, role: string): Actor {
    if (role === "ui" && sameSecret(token, this.secret)) return uiActor;
    const client = this.store
      .clients()
      .find((c) => !c.revoked && sameSecret(c.tokenHash, hash(token)));
    if (!client || role !== "client")
      throw new Error("Unauthorized agent request.");
    return {
      id: client.id,
      ui: false,
      workspaceIds: client.workspaceIds,
      write: client.write,
    };
  }
  available(actor: Actor) {
    const modules = this.store.modules();
    const folders = this.store
      .workspaces()
      .filter(
        (w) =>
          w.enabled &&
          (!actor.workspaceIds || actor.workspaceIds.includes(w.id)),
      )
      .map((w) => this.security.effective(w.id, actor));
    return catalog.filter(
      (t) =>
        modules[t.module] &&
        (t.permission !== "execute" || modules.Terminal) &&
        (t.permission !== "write" || modules.Files) &&
        (actor.ui ||
          !["Browser", "Desktop"].includes(t.module) ||
          folders.some(
            (w) =>
              w.accessMode === "full" &&
              w.write &&
              w.execute &&
              sandboxStatus().available,
          )) &&
        (actor.ui ||
          t.permission === "read" ||
          folders.some(
            (w) => w[t.permission === "write" ? "write" : "execute"],
          )),
    );
  }
  snapshot(): Snapshot {
    return {
      version: "0.1.0",
      agent: {
        status: "running",
        pid: process.pid,
        startedAt: this.startedAt,
        memoryBytes: process.memoryUsage().rss,
        serverId: this.serverId,
        runtimeDirectory: serviceDirectory(),
        buildFingerprint: runtimeRevision(serviceDirectory()),
      },
      settings: this.store.settings(),
      workspaces: this.store.workspaces(),
      jobs: [
        ...new Map(
          [
            ...this.store.jobsWithStatus(["running"]),
            ...this.store.jobSummaries(),
          ].map((j) => [j.id, j]),
        ).values(),
      ],
      plans: this.store.development("plans", undefined, undefined, 100),
      artifacts: this.store.development("artifacts", undefined, undefined, 100),
      skills: this.store.all("skill"),
      changes: this.store.changeSummaries(),
      audit: this.store.recordPage<Audit>("audit"),
      tools: catalog.map(({ name, module, permission, description }) => ({
        name,
        module,
        permission,
        description,
        enabled: !!this.store.modules()[module],
      })),
      modules: this.store.modules(),
      clients: this.store.clients().map(({ tokenHash: _tokenHash, ...c }) => c),
      sandbox: sandboxStatus(),
    };
  }
  async request(method: string, raw: unknown, actor: Actor): Promise<any> {
    if (method === "server.identity") {
      if (
        !actor.ui &&
        !this.store.clients().some((c) => c.id === actor.id && !c.revoked)
      )
        throw new Error("Client access revoked.");
      return {
        serverId: this.serverId,
        catalogFingerprint: hash(
          JSON.stringify(
            this.available(actor).map((t) => ({
              name: t.name,
              input: z.toJSONSchema(t.input),
              output: z.toJSONSchema(t.output),
            })),
          ),
        ),
      };
    }
    if (method === "skill.resources") {
      if (!this.store.modules().Skills)
        throw new Error("Skills module is disabled.");
      const resources: any[] = [];
      for (const ws of this.store.workspaces().filter((w) => w.enabled)) {
        try {
          this.security.workspace(ws.id, actor);
        } catch {
          continue;
        }
        for (const skill of this.skills
          .list(ws.id, actor)
          .filter((s) => s.enabled))
          for (const file of skill.files) {
            if (resources.length >= 500) return { resources };
            resources.push({
              uri: `remote-studio://workspaces/${ws.id}/skills/${skill.id}/${encodeURIComponent(file.path)}`,
              name: `${skill.name}: ${file.path}`,
              description: skill.description,
              mimeType: /\.(?:md|txt|[cm]?[jt]s|py|sh|json|yaml|toml)$/.test(
                file.path,
              )
                ? "text/plain"
                : "application/octet-stream",
            });
          }
      }
      return { resources };
    }
    if (method === "artifact.content") {
      const input = z.object({ workspaceId: id, artifactId: id }).parse(raw),
        a = this.artifacts.get(input.artifactId, actor);
      if (a.workspaceId !== input.workspaceId)
        throw new Error("Artifact belongs to another workspace.");
      return this.artifacts.read(a.id, actor);
    }
    if (method === "tool.list")
      return this.available(actor).map(
        ({ name, module, permission, description, input, output }) => ({
          name,
          module,
          permission,
          description,
          inputSchema: z.toJSONSchema(input),
          outputSchema: z.toJSONSchema(z.object({ data: output })),
        }),
      );
    if (method === "tool.call") {
      const call = z
        .object({ name: z.string(), arguments: z.unknown() })
        .parse(raw);
      const tool = this.available(actor).find((t) => t.name === call.name);
      if (!tool) throw new Error("Tool is disabled or unavailable.");
      const input = tool.input.parse(call.arguments) as any;
      let context: ExecutionContext | undefined;
      try {
        if (input.workspaceId) {
          this.security.workspace(input.workspaceId, actor);
          if (
            input.jobId &&
            this.jobs.get(input.jobId, actor).workspaceId !== input.workspaceId
          )
            throw new Error("Job belongs to another workspace.");
          if (input.sessionId) {
            if (tool.module === "Desktop")
              this.desktops.assertScope(
                input.sessionId,
                input.workspaceId,
                actor,
              );
            else
              this.browsers.assertScope(
                input.sessionId,
                input.workspaceId,
                actor,
              );
          }
          if (
            input.changeId &&
            this.store.get<Change>("change", input.changeId)?.workspaceId !==
              input.workspaceId
          )
            throw new Error("Change belongs to another workspace.");
        }
        const execute = async () => {
          const protectedWork =
            tool.permission !== "read" &&
            ![
              "job_cancel",
              "preview_stop",
              "browser_close",
              "desktop_stop",
            ].includes(tool.name);
          if (protectedWork) await this.licensing.ensure();
          if (!tool.name.startsWith("plan_") && !tool.name.startsWith("task_"))
            context = await this.planning.before(
              tool.name,
              input,
              actor,
              tool.permission,
            );
          const run = () =>
            toolContext.run({ module: tool.module, tool: tool.name }, () =>
              this.execute(tool.name, input, actor),
            );
          const data = context
            ? await executionContext.run(context, () =>
                !protectedWork ? run() : this.licensing.run(run),
              )
            : !protectedWork
              ? await run()
              : await this.licensing.run(run);
          const result = tool.output.parse(data);
          this.planning.after(context, result);
          return result;
        };
        const result =
          (tool.permission === "write" || tool.name === "task_verify") &&
          input.workspaceId
            ? await this.locks.run(input.workspaceId, execute)
            : await execute();
        this.store.audit(
          tool.name,
          actor.id,
          input.workspaceId ?? null,
          input.path ?? input.jobId ?? "",
          true,
        );
        return result;
      } catch (error) {
        this.planning.after(context, undefined, error as Error);
        this.store.audit(
          tool.name,
          actor.id,
          input.workspaceId ?? null,
          (error as Error).message,
          false,
        );
        throw error;
      }
    }
    if (method === "client.seen") {
      if (actor.ui) throw new Error("Client identity required.");
      const client = this.store.clients().find((c) => c.id === actor.id)!;
      const use = z
        .object({
          tool: z.string().max(100).optional(),
          clientName: z.string().max(200).optional(),
        })
        .parse(raw);
      const at = new Date().toISOString();
      if (use.clientName === "remote-studio-diagnostics")
        client.lastDiagnosticAt = at;
      else {
        client.lastSeen = at;
        client.lastTool = {
          name: use.tool ?? "unknown",
          at,
          clientName: use.clientName ?? "unreported",
          serverId: this.serverId,
        };
      }
      this.store.put("client", client.id, client);
      this.changed();
      return { ok: true };
    }
    if (!actor.ui)
      throw new Error(
        "This operation is available only in the trusted local UI.",
      );
    switch (method) {
      case "license.initialize": {
        if (!(this.licensing instanceof Licensing))
          throw new Error(
            "License administration is unavailable in this test adapter.",
          );
        const input = z
          .object({ key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/) })
          .strict()
          .parse(raw);
        return this.licensing.initialize(input.key);
      }
      case "license.status":
        return this.licensing.status();
      case "license.login":
      case "license.complete":
      case "license.activate":
      case "license.logout":
      case "license.deactivate": {
        if (!(this.licensing instanceof Licensing))
          throw new Error(
            "License administration is unavailable in this test adapter.",
          );
        if (method === "license.login") return this.licensing.login();
        if (method === "license.complete")
          return this.licensing.complete(z.string().max(4096).parse(raw));
        if (method === "license.activate")
          return this.licensing.activate(
            z.string().trim().min(1).max(200).optional().parse(raw),
          );
        for (const ws of this.store.workspaces()) {
          await this.jobs.revokeWorkspace(ws.id);
          await this.browsers.revoke(ws.id);
          await this.desktops.revoke(ws.id);
        }
        return method === "license.logout"
          ? this.licensing.logout()
          : this.licensing.deactivate();
      }
      case "maintenance.support":
        return new Maintenance(this.store).supportBundle();
      case "maintenance.cleanup": {
        const result = await new Maintenance(this.store).cleanupArtifacts();
        this.changed();
        return result;
      }
      case "jobs.page":
        return this.store.jobPage(
          z
            .object({
              limit: z.number().int().min(1).max(100),
              offset: z.number().int().min(0).max(1000000),
            })
            .parse(raw),
        );
      case "jobs.stopAll": {
        const jobs = this.store.jobsWithStatus([
          "running",
          "queued",
          "awaiting_approval",
        ]);
        for (const job of jobs)
          await this.jobs.resolve(job.id, "cancel", actor);
        await this.browsers.close();
        await this.desktops.stopAll();
        this.store.db.exec(
          "UPDATE tasks SET data=json_set(data,'$.status','interrupted','$.error','Stopped locally. Resume explicitly to continue.') WHERE json_extract(data,'$.status') IN ('running','verifying','awaiting_approval')",
        );
        this.changed();
        return { jobs: jobs.length };
      }
      case "environment.restore":
        return this.environment.restore(raw, actor);
      case "skills.inspect":
        return this.skills.inspect(
          z
            .object({ skillId: id, resource: z.string().min(1).max(4096) })
            .parse(raw),
          actor,
        );
      case "skills.import":
        return this.skills.import(
          z
            .object({
              kind: z.enum(["directory", "zip", "github"]),
              path: z.string().optional(),
              url: z.string().optional(),
              commit: z.string().optional(),
              workspaceId: id.optional(),
              replaceSkillId: id.optional(),
            })
            .parse(raw),
          actor,
        );
      case "skills.configure":
        return this.skills.configure(
          z
            .object({
              skillId: id,
              enabled: z.boolean().optional(),
              authorize: z.boolean().optional(),
              uninstall: z.boolean().optional(),
            })
            .parse(raw),
          actor,
        );
      case "plan.get": {
        const input = z
          .object({
            workspaceId: id,
            planId: id,
            refresh: z.boolean().default(false),
          })
          .parse(raw);
        return this.planning.read(input, actor, input.refresh);
      }
      case "plan.control": {
        const input = z
          .object({
            workspaceId: id,
            planId: id,
            revision: z.number().int(),
            action: z.enum(["resume", "pause", "cancel"]),
          })
          .parse(raw);
        return input.action === "resume"
          ? this.planning.resume(input, actor)
          : this.planning.update(
              {
                ...input,
                status: input.action === "pause" ? "paused" : "cancelled",
              },
              actor,
            );
      }
      case "artifact.get": {
        const input = z.object({ workspaceId: id, artifactId: id }).parse(raw),
          a = this.artifacts.get(input.artifactId, actor);
        if (a.workspaceId !== input.workspaceId)
          throw new Error("Artifact belongs to another workspace.");
        return this.artifacts.read(a.id, actor);
      }
      case "snapshot": {
        const snapshot = this.snapshot();
        snapshot.license = await this.licensing.status(false);
        snapshot.workspaces = await Promise.all(
          snapshot.workspaces.map((workspace) =>
            this.locks.run(workspace.id, async () => {
              const ws = this.store.get<Workspace>("workspace", workspace.id);
              if (!ws) return workspace;
              try {
                const root = await workspaceRoot(ws);
                if (ws.rootIdentity !== root.identity) {
                  ws.rootIdentity = root.identity;
                  this.store.put("workspace", ws.id, ws);
                }
                return ws;
              } catch (error) {
                return { ...ws, rootError: (error as Error).message };
              }
            }),
          ),
        );
        return snapshot;
      }
      case "change.get": {
        const change = this.store.get<Change>("change", id.parse(raw));
        if (!change) throw new Error("Change not found.");
        return change;
      }
      case "job.get":
        return this.jobs.get(id.parse(raw), actor);
      case "workspace.add": {
        const { paths } = z
          .object({ paths: z.array(z.string()).min(1) })
          .parse(raw);
        const added: Workspace[] = [];
        for (const requested of paths) {
          const path = await realpath(requested);
          if (!(await lstat(path)).isDirectory())
            throw new Error("Choose a folder.");
          let ws = this.store.workspaces().find((w) => w.path === path);
          if (!ws) {
            ws = {
              id: randomUUID(),
              name: basename(path),
              path,
              rootIdentity: (await workspaceRoot({ path })).identity,
              group: "",
              enabled: true,
              write: false,
              execute: false,
              createdAt: new Date().toISOString(),
            };
            this.store.put("workspace", ws.id, ws);
            this.store.audit("workspace.add", actor.id, ws.id, path);
          }
          added.push(ws);
        }
        this.changed();
        return added;
      }
      case "workspace.update": {
        const input = z
          .object({
            id,
            name: z.string().min(1).max(80).optional(),
            group: z.string().max(80).optional(),
            enabled: z.boolean().optional(),
            write: z.boolean().optional(),
            execute: z.boolean().optional(),
            accessMode: accessModeSchema.optional(),
          })
          .strict()
          .parse(raw);
        return this.locks.run(input.id, async () => {
          const ws = this.store.get<Workspace>("workspace", input.id);
          if (!ws) throw new Error("Workspace not found.");
          const next = { ...ws, ...input };
          if (
            input.accessMode === "full" ||
            input.write === true ||
            input.execute === true
          )
            next.rootIdentity = (await workspaceRoot(ws)).identity;
          if (input.accessMode === "readOnly") {
            next.write = false;
            next.execute = false;
          }
          if (input.accessMode === "reviewed") {
            next.write = input.write ?? true;
            next.execute = input.execute ?? true;
          }
          if (input.accessMode === "full") {
            next.write = true;
            next.execute = true;
            await sandboxProbe(next, this.directory);
          }
          this.store.put("workspace", ws.id, next);
          if (
            input.accessMode !== undefined &&
            input.accessMode !== ws.accessMode
          ) {
            await this.jobs.revokeWorkspace(ws.id);
            await this.browsers.revoke(ws.id);
            await this.desktops.revoke(ws.id);
          }
          if (
            input.enabled === false ||
            input.execute === false ||
            input.write === false
          )
            await this.jobs.revokeWorkspace(ws.id);
          if (
            input.enabled === false ||
            input.execute === false ||
            input.write === false
          ) {
            await this.browsers.revoke(ws.id);
            await this.desktops.revoke(ws.id);
          }
          if (input.enabled === false || input.write === false)
            for (const change of this.store.changes())
              if (change.workspaceId === ws.id && change.status === "pending")
                this.store.put("change", change.id, {
                  ...change,
                  status: "rejected",
                });
          this.store.audit(
            "workspace.permissions",
            actor.id,
            ws.id,
            JSON.stringify(input),
          );
          this.changed();
          return { ok: true };
        });
      }
      case "workspace.inspectRoot": {
        const input = z.object({ id, path: z.string() }).strict().parse(raw);
        const ws = this.store.get<Workspace>("workspace", input.id);
        if (!ws) throw new Error("Workspace not found.");
        if (input.path !== ws.path)
          throw new Error(
            "Select the original workspace folder. Add a different folder as a new workspace.",
          );
        return workspaceRoot({ path: input.path });
      }
      case "workspace.reauthorize": {
        const input = z
          .object({ id, path: z.string(), identity: z.string() })
          .strict()
          .parse(raw);
        return this.locks.run(input.id, async () => {
          const ws = this.store.get<Workspace>("workspace", input.id);
          if (!ws) throw new Error("Workspace not found.");
          if (input.path !== ws.path)
            throw new Error(
              "Select the original workspace folder. Add a different folder as a new workspace.",
            );
          const root = await workspaceRoot({
            path: input.path,
            rootIdentity: input.identity,
          });
          await this.jobs.revokeWorkspace(ws.id);
          await this.browsers.revoke(ws.id);
          await this.desktops.revoke(ws.id);
          const next = { ...ws, rootIdentity: root.identity };
          if (next.accessMode === "full")
            await sandboxProbe(next, this.directory);
          // A local selection cannot authorize work proposed against an older root.
          for (const change of this.store.changes())
            if (change.workspaceId === ws.id && change.status === "pending")
              this.store.put("change", change.id, {
                ...change,
                status: "rejected",
              });
          await workspaceRoot(next);
          this.store.put("workspace", ws.id, next);
          this.store.audit(
            "workspace.reauthorize",
            actor.id,
            ws.id,
            JSON.stringify({
              previousIdentity: ws.rootIdentity,
              identity: root.identity,
            }),
          );
          this.changed();
          return next;
        });
      }
      case "workspace.remove": {
        const key = id.parse(raw);
        await this.jobs.revokeWorkspace(key);
        await this.browsers.revoke(key);
        await this.desktops.revoke(key);
        this.store.delete("workspace", key);
        for (const change of this.store.changes())
          if (change.workspaceId === key && change.status === "pending")
            this.store.put("change", change.id, {
              ...change,
              status: "rejected",
            });
        this.store.audit("workspace.remove", actor.id, key, "Access removed");
        this.changed();
        return { ok: true };
      }
      case "settings.set": {
        const settings = settingsPatchSchema.parse(raw);
        this.store.put(
          "settings",
          "main",
          settingsSchema.parse({ ...this.store.settings(), ...settings }),
        );
        this.changed();
        void this.jobs.pump();
        return { ok: true };
      }
      case "module.set": {
        const input = z
          .object({
            name: z.enum([
              "Files",
              "Terminal",
              "Projects",
              "Git",
              "Jobs",
              "System",
              "Browser",
              "Planning",
              "Skills",
              "Desktop",
            ]),
            enabled: z.boolean(),
          })
          .parse(raw);
        this.store.put("modules", "main", {
          ...this.store.modules(),
          [input.name]: input.enabled,
        });
        if (input.name === "Terminal" && !input.enabled)
          for (const ws of this.store.workspaces())
            await this.jobs.revokeWorkspace(ws.id);
        if (input.name === "Files" && !input.enabled)
          for (const job of this.store.jobsWithStatus([
            "running",
            "queued",
            "awaiting_approval",
          ]))
            if (job.authorization === "full")
              await this.jobs.resolve(job.id, "cancel", actor);
        if (
          (input.name === "Browser" ||
            input.name === "Terminal" ||
            input.name === "Files") &&
          !input.enabled
        )
          await this.browsers.close();
        if (
          (input.name === "Desktop" ||
            input.name === "Terminal" ||
            input.name === "Files") &&
          !input.enabled
        )
          await this.desktops.stopAll();
        if (!input.enabled)
          for (const job of this.store.jobsWithStatus([
            "running",
            "queued",
            "awaiting_approval",
          ]))
            if (job.originModule === input.name)
              await this.jobs.resolve(job.id, "cancel", actor);
        this.changed();
        return { ok: true };
      }
      case "change.resolve": {
        const input = z
          .object({ id, decision: z.enum(["approve", "reject", "undo"]) })
          .parse(raw);
        return input.decision === "reject"
          ? this.files.resolve(input.id, input.decision, actor)
          : this.licensing.run(() =>
              this.files.resolve(input.id, input.decision, actor),
            );
      }
      case "job.resolve": {
        const input = z
          .object({
            id,
            decision: z.enum(["approve", "reject", "cancel", "retry"]),
          })
          .parse(raw);
        const old = this.jobs.get(input.id, actor);
        if (input.decision === "approve" || input.decision === "retry")
          await this.licensing.ensure();
        if (input.decision === "retry" && old.planId && old.taskId) {
          return this.locks.run(old.workspaceId, async () => {
            const context = await this.planning.before(
              "job_retry",
              {
                workspaceId: old.workspaceId,
                planId: old.planId,
                taskId: old.taskId,
              },
              this.jobs.actor(old),
              "execute",
            );
            try {
              const result = await executionContext.run(context!, () =>
                this.jobs.resolve(input.id, input.decision, actor),
              );
              this.planning.after(context, result);
              return result;
            } catch (error) {
              this.planning.after(context, null, error as Error);
              throw error;
            }
          });
        }
        return this.jobs.resolve(input.id, input.decision, actor);
      }
      case "command.request":
        if (!this.store.modules().Terminal)
          throw new Error("Terminal module is disabled.");
        return this.licensing.run(() => this.jobs.create(raw, actor));
      case "file.read": {
        const input = z
          .object({ workspaceId: id, path: z.string() })
          .parse(raw);
        return this.security.read(input.workspaceId, input.path, actor);
      }
      case "file.propose":
        return this.licensing.run(() =>
          this.files.propose(proposeSchema.parse(raw), actor),
        );
      case "connection.update": {
        const input = z
          .object({
            id,
            workspaceIds: z.array(id),
            write: z.boolean(),
            execute: z.boolean(),
            accessMode: accessModeSchema,
            workspaceGrants: z.array(workspaceGrantSchema),
          })
          .strict()
          .parse(raw);
        return this.locks.run("client:" + input.id, async () => {
          const client = this.store
            .clients()
            .find((c) => c.id === input.id && !c.revoked);
          if (!client) throw new Error("Connection not found.");
          if (
            input.workspaceGrants.length !== input.workspaceIds.length ||
            new Set(input.workspaceIds).size !== input.workspaceIds.length ||
            new Set(input.workspaceGrants.map((g) => g.workspaceId)).size !==
              input.workspaceIds.length ||
            input.workspaceGrants.some(
              (g) => !input.workspaceIds.includes(g.workspaceId),
            )
          )
            throw new Error("Grant scopes must match selected folders.");
          for (const scoped of input.workspaceGrants) {
            const ws = this.security.workspace(scoped.workspaceId, actor);
            if (scoped.accessMode === "full")
              await sandboxProbe(ws, this.directory);
          }
          for (const scoped of input.workspaceGrants)
            this.security.workspace(scoped.workspaceId, actor);
          this.store.put("client", client.id, { ...client, ...input });
          await this.jobs.revokeClient(client.id);
          await this.browsers.revokeClient(client.id);
          await this.desktops.revokeClient(client.id);
          this.store.audit(
            "connection.permissions",
            actor.id,
            null,
            client.name,
          );
          this.changed();
          return { ok: true };
        });
      }
      case "connection.create": {
        const input = z
          .object({
            name: z.string().min(1).max(80),
            workspaceIds: z.array(id).nullable(),
            write: z.boolean(),
            execute: z.boolean().optional(),
            accessMode: accessModeSchema.optional(),
            workspaceGrants: z.array(workspaceGrantSchema).optional(),
          })
          .parse(raw);
        for (const ws of input.workspaceIds ?? [])
          this.security.workspace(ws, actor);
        if (
          input.workspaceGrants &&
          (input.workspaceIds === null ||
            input.workspaceGrants.length !== input.workspaceIds.length ||
            input.workspaceGrants.some(
              (g) => !input.workspaceIds!.includes(g.workspaceId),
            ) ||
            new Set(input.workspaceGrants.map((g) => g.workspaceId)).size !==
              input.workspaceGrants.length)
        )
          throw new Error(
            "Grant scopes must match explicitly selected folders.",
          );
        if (input.accessMode === "full" && !input.workspaceGrants) {
          if (!input.workspaceIds?.length)
            throw new Error(
              "Full Access requires explicitly selected folders.",
            );
          for (const ws of input.workspaceIds)
            await sandboxProbe(
              this.security.workspace(ws, actor),
              this.directory,
            );
        }
        for (const scoped of input.workspaceGrants ?? [])
          if (scoped.accessMode === "full")
            await sandboxProbe(
              this.security.workspace(scoped.workspaceId, actor),
              this.directory,
            );
        const clientId = randomUUID(),
          token = randomBytes(32).toString("hex");
        const client = {
          id: clientId,
          name: input.name,
          workspaceIds: input.workspaceIds,
          write: input.write,
          execute: input.execute,
          accessMode: input.accessMode,
          workspaceGrants: input.workspaceGrants,
          lastSeen: null,
          revoked: false,
          tokenHash: hash(token),
        };
        this.store.put("client", clientId, client);
        await mkdir(join(this.directory, "clients"), {
          recursive: true,
          mode: 0o700,
        });
        await writeFile(
          join(this.directory, "clients", clientId + ".json"),
          JSON.stringify({ id: clientId, token, directory: this.directory }),
          { flag: "wx", mode: 0o600 },
        );
        this.store.audit("connection.create", actor.id, null, input.name);
        this.changed();
        return { clientId };
      }
      case "connection.revoke": {
        const clientId = id.parse(raw);
        return this.locks.run("client:" + clientId, async () => {
          const client = this.store.clients().find((c) => c.id === clientId);
          if (!client) throw new Error("Connection not found.");
          this.store.put("client", clientId, { ...client, revoked: true });
          await this.jobs.revokeClient(clientId);
          await this.browsers.revokeClient(clientId);
          await this.desktops.revokeClient(clientId);
          this.store.audit("connection.revoke", actor.id, null, client.name);
          this.changed();
          return { ok: true };
        });
      }
      case "connection.secret": {
        const clientId = id.parse(raw);
        if (!this.store.clients().some((c) => c.id === clientId && !c.revoked))
          throw new Error("Connection has been revoked.");
        return JSON.parse(
          await readFile(
            join(this.directory, "clients", clientId + ".json"),
            "utf8",
          ),
        );
      }
      default:
        throw new Error("Unknown agent operation.");
    }
  }
  async execute(name: string, input: any, actor: Actor): Promise<any> {
    const visible = () =>
      this.store
        .workspaces()
        .filter(
          (w) =>
            w.enabled &&
            (!actor.workspaceIds || actor.workspaceIds.includes(w.id)),
        )
        .map((w) => this.security.effective(w.id, actor));
    switch (name) {
      case "design_preset":
        this.security.workspace(input.workspaceId, actor);
        return this.design.preset(input.preset);
      case "design_registry_inspect":
        this.security.workspace(input.workspaceId, actor);
        return this.design.inspect(input.item);
      case "design_registry_add":
        return this.design.add(input, actor);
      case "asset_inspect":
        return this.design.assets(input, actor);
      case "git_checkpoint":
        return this.developer.checkpoint(input, actor);
      case "project_environment":
        return this.environment.status(input.workspaceId, actor);
      case "skill_list":
        return this.skills.list(input.workspaceId, actor);
      case "skill_read":
        return this.skills.read(input, actor);
      case "skill_resource":
        return this.skills.resource(input, actor);
      case "skill_run":
        return this.skills.run(input, actor);
      case "desktop_launch":
        return this.desktops.launch(input, actor);
      case "desktop_status":
        return this.desktops.operation({ ...input, action: "status" }, actor);
      case "desktop_snapshot":
        return this.desktops.operation({ ...input, action: "snapshot" }, actor);
      case "desktop_action":
        return this.desktops.operation(input, actor);
      case "desktop_screenshot":
        return this.desktops.screenshot(input, actor);
      case "desktop_stop":
        return this.desktops.stop(input.sessionId, actor);
      case "plan_create":
        return this.planning.create(input, actor);
      case "plan_get":
        return this.planning.read(input, actor);
      case "plan_update":
        return this.planning.update(input, actor);
      case "plan_resume":
        return this.planning.resume(input, actor);
      case "task_update":
        return this.planning.updateTask(input, actor);
      case "task_verify":
        return this.planning.verify(input, actor);
      case "artifact_read": {
        const a = this.artifacts.get(input.artifactId, actor);
        if (a.workspaceId !== input.workspaceId)
          throw new Error("Artifact belongs to another workspace.");
        return this.artifacts.read(a.id, actor);
      }
      case "browser_check":
        return this.browsers.check(input, actor);
      case "browser_compare":
        return this.artifacts.compare(input, actor);
      case "project_context":
        return projectContext(this.security, input, actor);
      case "code_query":
        return codeQuery(this.security, input, actor);
      case "workspace_list":
      case "permission_status":
        return visible();
      case "workspace_info":
        return this.security.effective(input.workspaceId, actor);
      case "file_list":
        return this.files.list(input, actor);
      case "file_read":
        return this.security.read(input.workspaceId, input.path, actor);
      case "file_search":
        return this.files.search(input, actor);
      case "file_write":
        return this.files.propose(input, actor);
      case "directory_create":
        return this.files.mutate(
          input.workspaceId,
          [{ operation: "mkdir", path: input.path }],
          actor,
        );
      case "file_write_binary":
        return this.files.mutate(
          input.workspaceId,
          [
            {
              ...input,
              operation: "write",
              content: input.base64,
              encoding: "base64",
            },
          ],
          actor,
        );
      case "file_delete":
        return this.files.mutate(
          input.workspaceId,
          [{ ...input, operation: "delete" }],
          actor,
        );
      case "file_copy":
      case "file_move":
        return this.files.mutate(
          input.workspaceId,
          [{ ...input, operation: name === "file_copy" ? "copy" : "move" }],
          actor,
        );
      case "file_batch":
        return this.files.mutate(
          input.workspaceId,
          input.files.map((f: any) => ({ ...f, operation: "write" })),
          actor,
        );
      case "file_patch_many": {
        const operations = [];
        for (const p of input.patches) {
          const original = await this.security.read(
            input.workspaceId,
            p.path,
            actor,
          );
          if (
            original.hash !== p.expectedHash ||
            original.content.split(p.find).length !== 2
          )
            throw new Error("Patch hash conflict or ambiguous match.");
          operations.push({
            operation: "write" as const,
            path: p.path,
            content: original.content.replace(p.find, () => p.replace),
            expectedHash: p.expectedHash,
          });
        }
        return this.files.mutate(input.workspaceId, operations, actor);
      }
      case "file_patch": {
        const before = await this.security.read(
          input.workspaceId,
          input.path,
          actor,
        );
        if (before.hash !== input.expectedHash)
          throw new Error("File hash conflict.");
        if (before.content.split(input.find).length !== 2)
          throw new Error("Patch must match exactly once.");
        return this.files.propose(
          {
            ...input,
            content: before.content.replace(input.find, () => input.replace),
          },
          actor,
        );
      }
      case "file_diff": {
        const change = this.store.get<Change>("change", input.changeId);
        if (!change || change.clientId !== actor.id)
          throw new Error("Change not found for this client.");
        this.security.workspace(change.workspaceId, actor);
        return change;
      }
      case "file_restore":
        return this.files.restore(input.changeId, actor);
      case "command_execute":
        return this.jobs.create(input, actor);
      case "job_list":
        return this.store.jobPage({
          ...input,
          clientId: actor.id,
          workspaceIds: this.store
            .workspaces()
            .filter((w) => {
              if (input.workspaceId && w.id !== input.workspaceId) return false;
              try {
                this.security.workspace(w.id, actor);
                return true;
              } catch {
                return false;
              }
            })
            .map((w) => w.id),
        });
      case "job_status":
        return this.jobs.get(input.jobId, actor);
      case "job_logs": {
        return this.jobs.logs(input.jobId, actor, input.cursor);
      }
      case "job_input":
        return this.jobs.input(input.jobId, actor, input.input, input.eof);
      case "job_wait":
        return this.jobs.wait(input.jobId, actor, input.timeoutMs);
      case "shell_execute":
        return this.developer.shell(input, actor);
      case "project_install":
        return this.developer.install(input, actor);
      case "project_validate":
        return this.developer.validate(input, actor);
      case "project_run_script":
        return this.developer.script(input, actor);
      case "toolchain_info":
        return this.developer.doctor(input, actor);
      case "preview_start":
        return this.developer.preview(input, actor);
      case "preview_status":
        return this.developer.previewStatus(input, actor);
      case "preview_stop":
        await this.developer.previewStatus(input, actor);
        return this.jobs.resolve(input.jobId, "cancel", actor);
      case "git_init":
      case "git_stage":
      case "git_commit":
      case "git_branch":
        return this.developer.git(name, input, actor);
      case "browser_prepare":
        return this.browsers.prepare(input, actor);
      case "browser_open":
        return this.browsers.open(input, actor);
      case "browser_snapshot":
        return this.browsers.snapshot(input.sessionId, actor);
      case "browser_action":
        return this.browsers.action(input, actor);
      case "browser_screenshot":
        return this.browsers.screenshot(input, actor);
      case "browser_close":
        return this.browsers.stop(input.sessionId, actor);
      case "job_cancel":
        return this.jobs.resolve(input.jobId, "cancel", actor);
      case "project_create": {
        const result = await createProject(
          this.security,
          input,
          actor,
          this.files,
        );
        this.changed();
        return result;
      }
      case "project_inspect":
        return inspectProject(this.security, input, actor);
      case "git_status":
      case "git_diff":
      case "git_log": {
        const cwd = await repositoryDirectory(
          this.security,
          input.workspaceId,
          input.path,
          actor,
        );
        const args =
          name === "git_status"
            ? ["status", "--short", "--branch"]
            : name === "git_diff"
              ? ["diff", "--no-ext-diff", "--no-textconv"]
              : ["log", "-20", "--oneline", "--no-show-signature"];
        const { stdout } = await runFile(
          "git",
          [
            "--no-pager",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=",
            "-c",
            "core.attributesFile=",
            ...args,
          ],
          {
            cwd,
            env: {
              PATH: process.env.PATH,
              SystemRoot: process.env.SystemRoot,
              GIT_OPTIONAL_LOCKS: "0",
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL:
                process.platform === "win32" ? "NUL" : "/dev/null",
            },
            timeout: 10000,
            maxBuffer: 256 * 1024,
          },
        );
        return { output: stdout };
      }
      case "system_info":
        return {
          platform: process.platform,
          arch: process.arch,
          node: process.versions.node,
          agentVersion: "0.1.0",
          memoryBytes: process.memoryUsage().rss,
          serverId: this.serverId,
          catalogFingerprint: hash(
            JSON.stringify(
              this.available(actor).map((t) => ({
                name: t.name,
                input: z.toJSONSchema(t.input),
                output: z.toJSONSchema(t.output),
              })),
            ),
          ),
        };
      default:
        throw new Error("Tool implementation missing.");
    }
  }
  async close() {
    await this.desktops.close();
    await this.browsers.close();
    await this.jobs.shutdown();
    await this.licensing.dispose();
    this.store.close();
  }
}
