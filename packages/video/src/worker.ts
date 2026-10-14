import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  hyperframesVersion,
  type VideoOperation,
  type VideoReport,
  type VideoSettings,
} from "./contracts";
import { videoRevision } from "./revision";

const input = JSON.parse(process.argv[2]) as {
  operation: VideoOperation;
  directory: string;
  output?: string;
  revision: string;
  settings: VideoSettings;
  times?: number[];
  quality?: string;
  format?: "mp4" | "webm" | "mov";
  workers?: number;
  ffprobe?: string;
  port?: number;
};
const report: VideoReport = { ok: false, operation: input.operation };
const runFile = promisify(execFile);
async function cli(args: string[], json = false) {
  const pkg = JSON.parse(
    await readFile("node_modules/hyperframes/package.json", "utf8"),
  );
  if (pkg.version !== hyperframesVersion)
    throw new Error(
      `Install the supported pinned hyperframes@${hyperframesVersion} with project_install.`,
    );
  const child = spawn(
    process.execPath,
    [
      join(process.cwd(), "node_modules/hyperframes/bin/hyperframes.mjs"),
      ...args,
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
  let stdout = "",
    overflow = false;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (b: string) => {
    process.stdout.write(b);
    if (json) {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(b) > 1024 * 1024)
        overflow = true;
      else stdout += b;
    }
  });
  child.stderr.on("data", (b: Buffer) => process.stderr.write(b));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (json && !overflow) {
    try {
      report.result = JSON.parse(stdout.trim());
    } catch {
      /* report the actual CLI error below */
    }
  }
  if (code !== 0)
    throw new Error(
      `HyperFrames ${input.operation} exited with code ${code}; see job logs.`,
    );
  if (!json) return undefined;
  if (overflow)
    throw new Error("HyperFrames JSON exceeds 1 MiB; inspect the job logs.");
  const result = JSON.parse(stdout.trim()) as Record<string, unknown>;
  if (
    result.ok === false ||
    (input.operation === "check" &&
      (result.ok !== true || result.browserSkipped === true))
  )
    throw new Error("HyperFrames did not pass its complete browser check.");
  return result;
}
try {
  if ((await videoRevision(process.cwd())) !== input.revision)
    throw new Error(
      "Video source changed while the job was queued. Check the current source again.",
    );
  await mkdir(input.directory, { recursive: true });
  if (["check", "snapshot", "render"].includes(input.operation))
    await cli(["browser", "ensure"]);
  if (["lint", "check", "timeline"].includes(input.operation))
    report.result = await cli([input.operation, "--json"], true);
  else if (input.operation === "snapshot") {
    const frames = join(input.directory, "frames");
    await cli([
      "snapshot",
      "--at",
      input.times!.join(","),
      "--no-end",
      "--output",
      frames,
    ]);
    report.frames = (await readdir(frames))
      .filter((f) => f.endsWith(".png"))
      .sort()
      .map((f) => join(frames, f).replaceAll("\\", "/"));
    if (report.frames.length !== input.times!.length)
      throw new Error("Snapshot did not produce the requested frame count.");
  } else if (input.operation === "preview") {
    await cli([
      "preview",
      "--foreground",
      "--no-open",
      "--force-new",
      "--port",
      String(input.port),
    ]);
  } else {
    await cli([
      "render",
      "--output",
      input.output!,
      "--format",
      input.format!,
      "--quality",
      input.quality!,
      "--fps",
      String(input.settings.fps),
      ...(input.workers ? ["--workers", String(input.workers)] : []),
    ]);
    const metadata = await runFile(
      input.ffprobe!,
      [
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        input.output!,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    const probe = JSON.parse(metadata.stdout),
      stream = probe.streams?.find((s: any) => s.codec_type === "video");
    const duration = Number(probe.format?.duration),
      [n, d] = String(stream?.avg_frame_rate).split("/").map(Number),
      fps = n / d;
    if (
      !stream ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isFinite(fps) ||
      fps <= 0
    )
      throw new Error("Encoded file has no valid video stream.");
    if (
      stream.width !== input.settings.width ||
      stream.height !== input.settings.height ||
      Math.abs(duration - input.settings.duration) > 2 / input.settings.fps ||
      Math.abs(fps - input.settings.fps) > 0.01
    )
      throw new Error(
        "Encoded dimensions, duration or frame rate differ from the composition.",
      );
    const bytes = (await stat(input.output!)).size;
    if (bytes <= 0 || bytes > 1024 ** 3)
      throw new Error("Encoded output is empty or exceeds 1 GiB.");
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(input.output!))
      digest.update(chunk);
    report.output = {
      path: input.output!,
      bytes,
      hash: digest.digest("hex"),
      width: stream.width,
      height: stream.height,
      duration,
      fps,
      codec: String(stream.codec_name),
      mimeType:
        input.format === "webm"
          ? "video/webm"
          : input.format === "mov"
            ? "video/quicktime"
            : "video/mp4",
    };
  }
  if ((await videoRevision(process.cwd())) !== input.revision)
    throw new Error(
      "Video source changed during the job. Check and run again.",
    );
  report.ok = true;
} catch (error) {
  report.error = (error as Error).message;
  console.error(report.error);
  process.exitCode = 1;
} finally {
  await mkdir(input.directory, { recursive: true });
  await writeFile(
    join(input.directory, "report.json"),
    JSON.stringify(report),
    { flag: "wx", mode: 0o600 },
  );
}
