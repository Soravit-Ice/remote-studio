import { posix, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { Security, type Actor } from "../../security/src/index";
import { Files } from "../../filesystem/src/index";
import { Jobs } from "../../jobs/src/index";
import { Artifacts } from "../../artifacts/src/index";
import { createProject } from "../../projects/src/index";
import {
  resolveExecutable,
  serviceDirectory,
} from "../../terminal/src/sandbox";
import { videoTemplate, videoGuide } from "./template";
import { videoRevision } from "./revision";
import { WorkspaceLocks } from "../../shared/src/execution-context";
import { readVideoBytes } from "./binary";
import {
  hyperframesVersion,
  videoSettings,
  videoReportSchema,
  type VideoRun,
  type VideoOperation,
  type VideoReport,
  type VideoSettings,
} from "./contracts";

type Scope = { workspaceId: string; path: string };
export class Videos {
  private readonly controls = new WorkspaceLocks();
  constructor(
    readonly security: Security,
    readonly files: Files,
    readonly jobs: Jobs,
    readonly artifacts: Artifacts,
  ) {}
  guide() {
    return {
      framework: "HyperFrames",
      supportedVersion: hyperframesVersion,
      guide: videoGuide,
    };
  }
  async create(
    input: Scope & VideoSettings & { name: string; brief: string },
    actor: Actor,
  ) {
    const files = videoTemplate(input.name, input.brief, input);
    return createProject(
      this.security,
      {
        ...input,
        template: "custom",
        files: Object.entries(files).map(([path, content]) => ({
          path,
          content,
        })),
      },
      actor,
      this.files,
    );
  }
  async revision(input: Scope, actor: Actor) {
    const root = await this.security.path(input.workspaceId, input.path, actor);
    const revision = await videoRevision(root, (path) =>
      this.security.path(
        input.workspaceId,
        posix.join(input.path, path),
        actor,
      ),
    );
    this.security.workspace(input.workspaceId, actor);
    return revision;
  }
  async inspect(input: Scope, actor: Actor) {
    const pkg = JSON.parse(
      (
        await this.security.read(
          input.workspaceId,
          posix.join(input.path, "package.json"),
          actor,
        )
      ).content,
    );
    const html = await this.security.read(
      input.workspaceId,
      posix.join(input.path, "index.html"),
      actor,
    );
    // Supported roots are declarative, static attributes. Runtime-generated
    // compositions are deliberately left to the CLI rather than inferred.
    const roots = [
      ...html.content.matchAll(
        /<div\b([^>]*\bdata-composition-id\s*=\s*["'][^"']+["'][^>]*)>/gi,
      ),
    ];
    if (roots.length !== 1)
      throw new Error(
        "Use one standalone root div with static quoted data-composition-id in index.html; put nested scenes in sub-compositions.",
      );
    const attrs = roots[0][1];
    const attribute = (name: string) =>
      new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(attrs)?.[2];
    const settings = videoSettings.parse({
      width: Number(attribute("data-width")),
      height: Number(attribute("data-height")),
      duration: Number(attribute("data-duration")),
      fps: Number(attribute("data-fps") ?? 30),
    });
    if (
      pkg.dependencies?.hyperframes !== hyperframesVersion &&
      pkg.devDependencies?.hyperframes !== hyperframesVersion
    )
      throw new Error(
        `This adapter requires pinned hyperframes@${hyperframesVersion}. Update package.json explicitly and run project_install.`,
      );
    return {
      framework: "HyperFrames",
      supportedVersion: hyperframesVersion,
      compositionId: attribute("data-composition-id"),
      settings,
      revision: await this.revision(input, actor),
      sourceHash: html.hash,
      next: "Install with project_install if needed; author scenes with file tools; video_validate mode=check before video_render.",
    };
  }
  private owned(input: { workspaceId: string; jobId: string }, actor: Actor) {
    const job = this.jobs.get(input.jobId, actor);
    const run = this.security.store.get<VideoRun>("videoRun", input.jobId);
    if (
      !run ||
      run.workspaceId !== input.workspaceId ||
      job.workspaceId !== input.workspaceId ||
      (!actor.ui && run.clientId !== actor.id)
    )
      throw new Error("Video job not found for this workspace and client.");
    this.security.workspace(run.workspaceId, actor);
    return { job, run };
  }
  private async report(run: VideoRun, actor: Actor): Promise<VideoReport> {
    return videoReportSchema.parse(
      JSON.parse(
        (
          await this.security.read(
            run.workspaceId,
            posix.join(run.path, run.directory, "report.json"),
            actor,
          )
        ).content,
      ),
    );
  }
  async start(
    input: Scope & {
      quality?: string;
      format?: "mp4" | "webm" | "mov";
      workers?: number;
      times?: number[];
    },
    operation: VideoOperation,
    actor: Actor,
  ) {
    const inspected = await this.inspect(input, actor);
    let ffprobe: string | undefined;
    if (operation === "render") {
      const checks = this.security.store
        .all<VideoRun>("videoRun")
        .filter(
          (r) =>
            r.workspaceId === input.workspaceId &&
            r.path === input.path &&
            r.clientId === actor.id &&
            r.operation === "check" &&
            r.revision === inspected.revision &&
            this.security.store.job(r.jobId)?.status === "completed",
        );
      let passed = false;
      for (const check of checks) {
        const report = await this.report(check, actor).catch(() => null);
        if (
          report?.ok &&
          report.operation === "check" &&
          report.result?.ok === true &&
          report.result.browserSkipped !== true
        ) {
          passed = true;
          break;
        }
      }
      if (!passed)
        throw new Error(
          "Run video_validate mode=check and wait for a successful full browser check on the current source before rendering.",
        );
      ffprobe = await resolveExecutable("ffprobe").catch(() => undefined);
      if (!ffprobe)
        throw new Error(
          "FFprobe is required to verify output. Install FFmpeg/FFprobe locally, then retry.",
        );
    }
    if (input.times?.some((t) => t >= inspected.settings.duration))
      throw new Error(
        "Snapshot timestamps must be before the composition duration.",
      );
    if (input.times && new Set(input.times).size !== input.times.length)
      throw new Error("Snapshot timestamps must be unique.");
    const directory = "renders/rs-" + randomUUID();
    const output =
      operation === "render"
        ? directory + "/video." + (input.format ?? "mp4")
        : undefined;
    await this.security.path(
      input.workspaceId,
      posix.join(input.path, directory),
      actor,
      "write",
      true,
    );
    let port: number | undefined;
    if (operation === "preview") {
      const previous = this.security.store
        .all<VideoRun>("videoRun")
        .find(
          (r) =>
            r.workspaceId === input.workspaceId &&
            r.path === input.path &&
            r.clientId === actor.id &&
            r.operation === "preview" &&
            ["running", "queued", "awaiting_approval"].includes(
              this.security.store.job(r.jobId)?.status ?? "",
            ),
        );
      if (previous)
        return this.status(
          { workspaceId: input.workspaceId, jobId: previous.jobId },
          actor,
        );
      port = await new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const port = (server.address() as { port: number }).port;
          server.close((error) => (error ? reject(error) : resolve(port)));
        });
      });
    }
    const job = await this.jobs.create(
      {
        workspaceId: input.workspaceId,
        cwd: input.path,
        executable: process.execPath,
        args: [
          join(serviceDirectory(), "video-worker.mjs"),
          JSON.stringify({
            operation,
            directory,
            output,
            revision: inspected.revision,
            settings: inspected.settings,
            times: input.times,
            quality: input.quality ?? "looks",
            format: input.format ?? "mp4",
            workers: input.workers,
            ffprobe,
            port,
          }),
        ],
        persistent: operation === "preview",
        timeoutMs: operation === "render" ? 3600000 : 600000,
      },
      actor,
      { HYPERFRAMES_SKIP_SKILLS: "1", HYPERFRAMES_NO_TELEMETRY: "1" },
    );
    const run: VideoRun = {
      jobId: job.id,
      workspaceId: input.workspaceId,
      clientId: actor.id,
      path: input.path,
      operation,
      revision: inspected.revision,
      directory,
      output,
      url: port
        ? `http://127.0.0.1:${port}/#project/${encodeURIComponent(input.path.split("/").at(-1) === "." ? this.security.workspace(input.workspaceId, actor).path.split(/[\\/]/).at(-1)! : input.path.split("/").at(-1)!)}`
        : undefined,
    };
    this.security.store.put("videoRun", job.id, run);
    return {
      job,
      operation,
      outputPath: output ? posix.join(input.path, output) : undefined,
      url: run.url,
      next: "Wait using job_wait, then call video_status for actual results.",
    };
  }
  async status(input: { workspaceId: string; jobId: string }, actor: Actor) {
    return this.controls.run(input.jobId, () =>
      this.inspectStatus(input, actor),
    );
  }
  private async inspectStatus(
    input: { workspaceId: string; jobId: string },
    actor: Actor,
  ) {
    const { job, run } = this.owned(input, actor);
    let report: VideoReport | undefined,
      verified = false,
      error: string | undefined;
    let ready = false;
    const artifacts = [];
    if (run.url && job.status === "running") {
      try {
        const response = await fetch(run.url.split("#")[0], {
          signal: AbortSignal.timeout(1500),
          redirect: "error",
        });
        ready = response.status === 200;
        await response.body?.cancel();
      } catch {
        /* starting or unavailable */
      }
    }
    if (["completed", "failed"].includes(job.status)) {
      try {
        report = await this.report(run, actor);
        if (report.operation !== run.operation)
          throw new Error("Video report operation mismatch.");
        verified =
          job.status === "completed" &&
          job.exitCode === 0 &&
          report.ok === true;
        if (verified && run.output) {
          if (report.output?.path !== run.output)
            throw new Error("Video report output path mismatch.");
          const actual = await readVideoBytes(
            this.security,
            run.workspaceId,
            posix.join(run.path, run.output),
            actor,
            run.verifiedOutput ? { offset: 0, length: 1 } : undefined,
          );
          if (
            (run.verifiedOutput
              ? actual.identity !== run.verifiedOutput.identity ||
                report.output.hash !== run.verifiedOutput.hash
              : actual.hash !== report.output.hash) ||
            actual.bytes !== report.output.bytes
          )
            throw new Error("Rendered output changed after verification.");
          if (!run.verifiedOutput) {
            run.verifiedOutput = {
              identity: actual.identity,
              hash: actual.hash!,
            };
            this.security.store.put("videoRun", job.id, run);
          }
        }
        if (verified && run.operation === "snapshot") {
          if (!report.frames?.length)
            throw new Error("Snapshot report contains no frames.");
          if (run.artifacts && run.artifacts.length !== report.frames.length)
            throw new Error("Snapshot artifact count differs from its report.");
          if (!run.artifacts) {
            const ids = [];
            for (const frame of report.frames ?? []) {
              if (
                !frame.startsWith(run.directory + "/frames/") ||
                frame.includes("..") ||
                !frame.endsWith(".png")
              )
                throw new Error("Invalid snapshot report path.");
              const bytes = await readVideoBytes(
                this.security,
                run.workspaceId,
                posix.join(run.path, frame),
                actor,
                { offset: 0, length: 4 * 1024 * 1024 },
                4 * 1024 * 1024,
              );
              const artifact = await this.artifacts.create(
                {
                  workspaceId: run.workspaceId,
                  name: frame.split("/").at(-1)!,
                  mimeType: "image/png",
                  bytes: bytes.buffer!,
                  sourceRevision: run.revision,
                  sourcePath: run.path,
                  role: "screenshot",
                },
                actor,
              );
              ids.push(artifact.id);
            }
            run.artifacts = ids;
            this.security.store.put("videoRun", job.id, run);
          }
          for (const id of run.artifacts)
            artifacts.push(this.artifacts.get(id, actor));
        }
      } catch (e) {
        verified = false;
        error = (e as Error).message;
      }
    }
    const sourceCurrent = await this.revision(
      { workspaceId: run.workspaceId, path: run.path },
      actor,
    )
      .then((r) => r === run.revision)
      .catch(() => false);
    this.security.workspace(run.workspaceId, actor);
    return {
      job,
      operation: run.operation,
      verified,
      sourceCurrent,
      report,
      error,
      artifacts,
      url: run.url,
      ready,
      outputPath: run.output ? posix.join(run.path, run.output) : undefined,
      localPath: run.output
        ? join(
            this.security.workspace(run.workspaceId, actor).path,
            run.path,
            run.output,
          )
        : undefined,
    };
  }
  async outputRead(
    input: {
      workspaceId: string;
      jobId: string;
      offset: number;
      length: number;
    },
    actor: Actor,
  ) {
    const { job, run } = this.owned(input, actor);
    if (run.operation !== "render" || job.status !== "completed" || !run.output)
      throw new Error("Only completed owned render outputs can be read.");
    const report = await this.report(run, actor);
    if (!report.ok || report.output?.path !== run.output)
      throw new Error("Output was not verified.");
    if (!run.verifiedOutput) {
      const status = await this.status(input, actor);
      if (!status.verified)
        throw new Error(status.error ?? "Output verification failed.");
      run.verifiedOutput = this.owned(input, actor).run.verifiedOutput;
    }
    const read = await readVideoBytes(
      this.security,
      run.workspaceId,
      posix.join(run.path, run.output),
      actor,
      input,
    );
    if (
      read.bytes !== report.output.bytes ||
      read.identity !== run.verifiedOutput?.identity ||
      report.output.hash !== run.verifiedOutput.hash
    )
      throw new Error("Rendered output changed after verification.");
    return {
      name: "video." + run.output.split(".").at(-1),
      mimeType: report.output.mimeType,
      bytes: read.bytes,
      expectedHash: report.output.hash,
      encoding: "base64",
      content: read.buffer!.toString("base64"),
      offset: input.offset,
      nextOffset: read.nextOffset,
      eof: read.nextOffset === read.bytes,
    };
  }
}
