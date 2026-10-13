import { createServer } from "node:net";
import { dirname, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { serviceDirectory } from "../../terminal/src/sandbox";
import { resolveExecutable } from "../../terminal/src/sandbox";
import { Security, type Actor } from "../../security/src/index";
import { Jobs } from "../../jobs/src/index";
import { inspectProject } from "./index";
import { repositoryDirectory } from "../../git/src/index";
type Scope = { workspaceId: string; path: string };
export class DeveloperTools {
  async checkpoint(
    input: Scope & { paths: string[]; message: string },
    actor: Actor,
  ) {
    const cwd = await repositoryDirectory(
        this.security,
        input.workspaceId,
        input.path,
        actor,
      ),
      ws = this.security.workspace(input.workspaceId, actor, "execute"),
      paths: string[] = [];
    for (const path of input.paths) {
      const file = await this.security.path(
        input.workspaceId,
        path,
        actor,
        "read",
      );
      if (!(await lstat(file)).isFile())
        throw new Error("Checkpoint paths must be explicit regular files.");
      paths.push(relative(cwd, file).split(sep).join("/"));
    }
    return this.jobs.create(
      {
        workspaceId: ws.id,
        cwd: relative(ws.path, cwd).split(sep).join("/") || ".",
        executable: process.execPath,
        args: [
          join(serviceDirectory(), "git-checkpoint-worker.mjs"),
          JSON.stringify({ id: randomUUID(), paths, message: input.message }),
        ],
      },
      actor,
    );
  }
  constructor(
    readonly security: Security,
    readonly jobs: Jobs,
  ) {}
  async doctor(input: Scope, actor: Actor) {
    this.security.workspace(input.workspaceId, actor);
    const tools = await Promise.all(
      ["node", "npm", "pnpm", "python3", "python", "git"].map(async (name) => ({
        name,
        path: await resolveExecutable(name).catch(() => null),
      })),
    );
    return {
      tools,
      platform: process.platform,
      bundledNode: process.versions.node,
    };
  }
  shell(
    input: {
      workspaceId: string;
      cwd: string;
      command: string;
      shell: string;
      timeoutMs: number;
      persistent: boolean;
      idempotencyKey?: string;
    },
    actor: Actor,
  ) {
    const name =
      input.shell === "default"
        ? process.platform === "win32"
          ? "powershell"
          : "zsh"
        : input.shell;
    const executable =
      name === "powershell"
        ? "powershell.exe"
        : name === "cmd"
          ? "cmd.exe"
          : "/bin/" + name;
    const args =
      name === "powershell"
        ? [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            input.command,
          ]
        : name === "cmd"
          ? ["/d", "/s", "/c", input.command]
          : name === "zsh"
            ? ["-f", "-c", input.command]
            : ["-c", input.command];
    return this.jobs.create({ ...input, executable, args }, actor);
  }
  async packageCommand(
    input: Scope,
    actor: Actor,
    args: string[],
    persistent = false,
    timeoutMs = 180000,
    environment?: Record<string, string>,
    dependencies?: string[],
  ) {
    const project = await inspectProject(this.security, input, actor);
    const manager = await resolveExecutable(project.packageManager);
    let executable = manager,
      argv = args;
    if (/\.(?:[cm]?js)$/.test(manager)) {
      executable = process.execPath;
      argv = [manager, ...args];
    }
    if (process.platform === "win32" && manager.endsWith(".cmd")) {
      const cli = join(
        dirname(manager),
        "node_modules",
        project.packageManager,
        "bin",
        project.packageManager === "npm"
          ? "npm-cli.js"
          : project.packageManager === "pnpm"
            ? "pnpm.cjs"
            : "yarn.js",
      );
      executable = process.execPath;
      argv = [cli, ...args];
    }
    return this.jobs.create(
      {
        workspaceId: input.workspaceId,
        cwd: input.path,
        executable,
        args: argv,
        persistent,
        timeoutMs,
      },
      actor,
      environment,
      dependencies,
    );
  }
  async install(input: Scope, actor: Actor) {
    const project = await inspectProject(this.security, input, actor);
    const entries = await this.security.path(
      input.workspaceId,
      input.path,
      actor,
    );
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(entries);
    const args =
      project.packageManager === "npm"
        ? [
            names.includes("package-lock.json") ? "ci" : "install",
            "--no-audit",
            "--no-fund",
          ]
        : project.packageManager === "pnpm"
          ? [
              "install",
              ...(names.includes("pnpm-lock.yaml")
                ? ["--frozen-lockfile"]
                : []),
            ]
          : [
              "install",
              ...(names.includes("yarn.lock") ? ["--frozen-lockfile"] : []),
            ];
    return this.packageCommand(input, actor, args);
  }
  async script(
    input: Scope & { script: string; args: string[]; persistent?: boolean },
    actor: Actor,
    environment?: Record<string, string>,
    dependencies?: string[],
  ) {
    const project = await inspectProject(this.security, input, actor);
    if (!Object.hasOwn(project.scripts, input.script))
      throw new Error("Package script does not exist: " + input.script);
    return this.packageCommand(
      input,
      actor,
      [
        "run",
        input.script,
        ...(input.args.length ? ["--", ...input.args] : []),
      ],
      input.persistent ?? false,
      180000,
      environment,
      dependencies,
    );
  }
  async validate(input: Scope & { checks: string[] }, actor: Actor) {
    const project = await inspectProject(this.security, input, actor);
    const missing = input.checks.filter(
      (s) => !Object.hasOwn(project.scripts, s),
    );
    if (missing.length)
      throw new Error("Validation scripts missing: " + missing.join(", "));
    const jobs = [];
    for (const script of input.checks) {
      const job = await this.script(
        { ...input, script, args: [] },
        actor,
        undefined,
        jobs.length ? [jobs[jobs.length - 1].id] : undefined,
      );
      jobs.push(job);
    }
    return { jobs };
  }
  async git(
    name: string,
    input: Scope & {
      paths?: string[];
      message?: string;
      branch?: string;
      action?: string;
    },
    actor: Actor,
  ) {
    const cwd =
      name === "git_init"
        ? await this.security.path(
            input.workspaceId,
            input.path,
            actor,
            "execute",
          )
        : await repositoryDirectory(
            this.security,
            input.workspaceId,
            input.path,
            actor,
          );
    let args: string[];
    if (name === "git_init") args = ["init"];
    else if (name === "git_stage") {
      const files = [];
      for (const p of input.paths!)
        files.push(
          relative(
            cwd,
            await this.security.path(
              input.workspaceId,
              p,
              actor,
              "write",
              true,
            ),
          ),
        );
      args = ["add", "--", ...files];
    } else if (name === "git_commit") args = ["commit", "-m", input.message!];
    else
      args =
        input.action === "switch"
          ? ["switch", "--", input.branch!]
          : ["branch", "--", input.branch!];
    const root = this.security.workspace(input.workspaceId, actor).path;
    return this.jobs.create(
      {
        workspaceId: input.workspaceId,
        cwd: relative(root, cwd).split(sep).join("/") || ".",
        executable: "git",
        args: ["-c", "core.hooksPath=", "-c", "core.fsmonitor=false", ...args],
      },
      actor,
    );
  }
  async preview(
    input: Scope & { script: string; port?: number },
    actor: Actor,
  ) {
    const previous = this.security.store
      .all<{
        jobId: string;
        workspaceId: string;
        clientId: string;
        path: string;
        url: string;
      }>("preview")
      .find(
        (p) =>
          p.workspaceId === input.workspaceId &&
          p.clientId === actor.id &&
          p.path === input.path &&
          ["awaiting_approval", "queued", "running"].includes(
            this.security.store.job(p.jobId)?.status ?? "",
          ),
      );
    if (previous) return this.previewStatus(previous, actor);
    const project = await inspectProject(this.security, input, actor);
    let port = input.port;
    if (!port)
      port = await new Promise<number>((res, rej) => {
        const s = createServer();
        s.once("error", rej);
        s.listen(0, "127.0.0.1", () => {
          const p = (s.address() as { port: number }).port;
          s.close((err) => (err ? rej(err) : res(p)));
        });
      });
    const nextDev =
      project.framework === "Next.js" &&
      /next\s+dev(?:\s|$)/.test(project.scripts[input.script] ?? "");
    if (nextDev && /--turbo(?:pack)?\b/.test(project.scripts[input.script]))
      throw new Error(
        "Native Next preview requires Webpack polling. Remove the explicit --turbo/--turbopack flag or choose another package script.",
      );
    const args =
      project.framework === "Next.js"
        ? [
            "--hostname",
            "127.0.0.1",
            "--port",
            String(port),
            ...(nextDev && !project.scripts[input.script].includes("--webpack")
              ? ["--webpack"]
              : []),
          ]
        : [
            "--host",
            "127.0.0.1",
            "--port",
            String(port),
            ...(project.framework === "React" ? ["--strictPort"] : []),
          ];
    if (project.framework === "Electron")
      throw new Error("Use desktop_launch for a built Electron app.");
    const job = await this.script({ ...input, args, persistent: true }, actor, {
      BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
      PORT: String(port),
      WATCHPACK_POLLING: "true",
      CHOKIDAR_USEPOLLING: "1",
    });
    const preview = {
      jobId: job.id,
      workspaceId: input.workspaceId,
      clientId: actor.id,
      path: input.path,
      url: `http://127.0.0.1:${port}`,
    };
    this.security.store.put("preview", job.id, preview);
    const started = Date.now();
    let status;
    do {
      status = await this.previewStatus(preview, actor);
      if (status.ready || !["running", "queued"].includes(status.job.status))
        break;
      await new Promise((r) => setTimeout(r, 200));
    } while (Date.now() - started < 8000);
    return status;
  }
  async previewStatus(input: { jobId: string }, actor: Actor) {
    const job = this.jobs.get(input.jobId, actor),
      preview = this.security.store.get<{
        url: string;
        clientId: string;
        workspaceId: string;
      }>("preview", job.id);
    if (!preview || preview.clientId !== job.clientId)
      throw new Error("Managed preview not found.");
    let ready = false;
    if (job.status === "running")
      try {
        ready =
          (
            await fetch(preview.url, {
              redirect: "manual",
              signal: AbortSignal.timeout(1500),
            })
          ).status < 400;
      } catch {
        /* Not ready yet. */
      }
    return { job, url: preview.url, ready };
  }
}
