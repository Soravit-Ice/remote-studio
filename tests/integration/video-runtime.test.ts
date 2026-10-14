import { expect, it } from "vitest";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fixture, ui, waitFor } from "../helpers";

// Explicit opt-in: downloads the pinned optional CLI/browser into a temporary
// authorized folder. No fixture substitutes for HyperFrames or the encoder.
it.skipIf(process.env.STUDIO_TEST_VIDEO !== "1")(
  "checks, snapshots, previews and renders real HyperFrames in the native sandbox",
  async () => {
    const f = await fixture(),
      w = f.folders[0];
    const call = (name: string, args = {}) =>
      f.engine.request(
        "tool.call",
        { name, arguments: { workspaceId: w.id, path: "motion", ...args } },
        ui,
      );
    const done = async (job: { id: string }) => {
      const result = await waitFor(
        () => f.engine.jobs.get(job.id, ui),
        (j) => !["queued", "running"].includes(j.status),
        600000,
      );
      if (result.status !== "completed")
        throw new Error(result.error + "\n" + result.logs);
      return result;
    };
    try {
      await f.engine.request(
        "workspace.update",
        { id: w.id, accessMode: "full" },
        ui,
      );
      await call("video_project_create", {
        name: "ทดสอบ Motion",
        brief: "Actual render acceptance",
        width: 640,
        height: 360,
        duration: 2,
      });
      await done(await call("project_install"));
      const check = await call("video_validate", { mode: "check" });
      await done(check.job);
      expect(await call("video_status", { jobId: check.job.id })).toMatchObject(
        { verified: true, sourceCurrent: true, report: { ok: true } },
      );
      const frames = await call("video_snapshot", { times: [0.8, 1.6] });
      await done(frames.job);
      const [captured, repeated] = await Promise.all([
        call("video_status", { jobId: frames.job.id }),
        call("video_status", { jobId: frames.job.id }),
      ]);
      expect(captured.verified).toBe(true);
      expect(captured.artifacts).toHaveLength(2);
      expect(repeated.artifacts.map((a: any) => a.id)).toEqual(
        captured.artifacts.map((a: any) => a.id),
      );
      expect(
        (await call("artifact_read", { artifactId: captured.artifacts[0].id }))
          .image.mimeType,
      ).toBe("image/png");
      const preview = await call("video_preview");
      const ready = await waitFor(
        () => call("video_status", { jobId: preview.job.id }),
        (s) => s.ready,
        60000,
      );
      expect(ready.url).toContain("#project/motion");
      await call("job_cancel", { jobId: preview.job.id });
      // Studio may add project metadata on first launch. Recheck its saved source.
      if (
        !(await call("video_status", { jobId: check.job.id })).sourceCurrent
      ) {
        const refreshed = await call("video_validate", { mode: "check" });
        await done(refreshed.job);
      }
      const rendered = await call("video_render", {
        quality: "draft",
        workers: 1,
      });
      await done(rendered.job);
      const result = await call("video_status", { jobId: rendered.job.id });
      expect(result.verified).toBe(true);
      expect(result.report.output).toMatchObject({
        width: 640,
        height: 360,
        fps: 30,
        mimeType: "video/mp4",
      });
      const bytes = await readFile(result.localPath);
      await mkdir("test-results", { recursive: true });
      await cp(result.localPath, "test-results/video-smoke.mp4");
      await writeFile(
        "test-results/video-smoke.png",
        await f.engine.artifacts.bytes(captured.artifacts[0].id, ui),
      );
      const parts: Buffer[] = [];
      let offset = 0;
      while (true) {
        const chunk = await call("video_output_read", {
          jobId: rendered.job.id,
          offset,
          length: 4096,
        });
        parts.push(Buffer.from(chunk.content, "base64"));
        offset = chunk.nextOffset;
        if (chunk.eof) break;
      }
      expect(Buffer.concat(parts)).toEqual(bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        result.report.output.hash,
      );
      // A same-sized replacement must never retain verified=true.
      bytes[bytes.length - 1] ^= 1;
      await writeFile(result.localPath, bytes);
      expect(
        await call("video_status", { jobId: rendered.job.id }),
      ).toMatchObject({ verified: false });
      await expect(
        call("video_output_read", { jobId: rendered.job.id }),
      ).rejects.toThrow("changed");
      for (const format of ["webm", "mov"] as const) {
        const exported = await call("video_render", {
          format,
          quality: "draft",
          workers: 1,
        });
        await done(exported.job);
        const verified = await call("video_status", { jobId: exported.job.id });
        expect(verified.verified).toBe(true);
        expect(verified.report.output.mimeType).toBe(
          format === "webm" ? "video/webm" : "video/quicktime",
        );
        await cp(verified.localPath, "test-results/video-smoke." + format);
      }
      await writeFile(join(w.path, "motion/BRIEF.md"), "Changed source");
      await expect(call("video_render")).rejects.toThrow("current source");
    } finally {
      await f.cleanup();
    }
  },
  900000,
);
