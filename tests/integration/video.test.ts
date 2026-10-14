import { expect, it } from "vitest";
import { writeFile, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fixture, ui, waitFor } from "../helpers";
import { readVideoBytes } from "../../packages/video/src/binary";
import { videoRender } from "../../packages/video/src/contracts";
import { spawn } from "node:child_process";
import { toolContext } from "../../packages/shared/src/execution-context";

it("creates reviewed video projects, inspects real settings, and enforces current checks and scopes", async () => {
  const f = await fixture();
  const w = f.folders[0];
  const call = (name: string, args = {}) =>
    f.engine.request(
      "tool.call",
      { name, arguments: { workspaceId: w.id, path: "motion", ...args } },
      ui,
    );
  try {
    await f.engine.request(
      "workspace.update",
      { id: w.id, write: true, execute: true },
      ui,
    );
    const created = await call("video_project_create", {
      name: "สวัสดี <script>",
      brief: "A Thai motion title",
      width: 640,
      height: 360,
      duration: 2,
      fps: 30,
    });
    expect(created.status).toBe("pending");
    await expect(call("video_inspect")).rejects.toThrow();
    await f.engine.request(
      "change.resolve",
      { id: created.changeId, decision: "approve" },
      ui,
    );
    expect(await readFile(join(w.path, "motion/BRIEF.md"), "utf8")).toContain(
      "A Thai motion title",
    );
    expect(await readFile(join(w.path, "motion/index.html"), "utf8")).toContain(
      "&lt;script&gt;",
    );
    const inspected = await call("video_inspect");
    expect(inspected.settings).toEqual({
      width: 640,
      height: 360,
      duration: 2,
      fps: 30,
    });
    await expect(
      call("video_project_create", { name: "overwrite", brief: "x" }),
    ).rejects.toThrow();
    await expect(call("video_snapshot", { times: [2] })).rejects.toThrow(
      "before",
    );
    await expect(call("video_snapshot", { times: [1, 1] })).rejects.toThrow(
      "unique",
    );
    await expect(call("video_render")).rejects.toThrow("current source");
    const pending = await call("video_validate", { mode: "check" });
    expect(pending.job.status).toBe("awaiting_approval");
    expect(pending.job.originModule).toBe("Video");
    await expect(
      call("video_status", {
        workspaceId: f.folders[1].id,
        jobId: pending.job.id,
      }),
    ).rejects.toThrow("another workspace");
    const connection = await f.engine.request(
      "connection.create",
      { name: "Readonly video", workspaceIds: [w.id], write: false },
      ui,
    );
    const token = await f.engine.request(
      "connection.secret",
      connection.clientId,
      ui,
    );
    const actor = f.engine.actor(token.token, "client");
    expect(f.engine.available(actor).map((t) => t.name)).toContain(
      "video_guide",
    );
    expect(f.engine.available(actor).map((t) => t.name)).not.toContain(
      "video_render",
    );
    await expect(
      f.engine.request(
        "tool.call",
        {
          name: "video_status",
          arguments: { workspaceId: w.id, jobId: pending.job.id },
        },
        actor,
      ),
    ).rejects.toThrow("another client");
    await f.engine.request("module.set", { name: "Video", enabled: false }, ui);
    expect(f.engine.jobs.get(pending.job.id, ui).status).toBe("cancelled");
    expect(f.engine.available(ui).some((t) => t.module === "Video")).toBe(
      false,
    );
  } finally {
    await f.cleanup();
  }
});

it("reports real missing-runtime failures and invalidates source/asset changes", async () => {
  const f = await fixture(),
    w = f.folders[0];
  const call = (name: string, args = {}) =>
    f.engine.request(
      "tool.call",
      { name, arguments: { workspaceId: w.id, path: "motion", ...args } },
      ui,
    );
  try {
    await f.engine.request(
      "workspace.update",
      { id: w.id, accessMode: "full" },
      ui,
    );
    await call("video_project_create", {
      name: "Motion",
      brief: "A test",
      width: 640,
      height: 360,
    });
    const before = await call("video_inspect");
    await writeFile(join(w.path, "motion/music.wav"), Buffer.from([1, 2, 3]));
    expect((await call("video_inspect")).revision).not.toBe(before.revision);
    const started = await call("video_validate", { mode: "check" });
    const done = await waitFor(
      () => f.engine.jobs.get(started.job.id, ui),
      (j) => j.status === "failed",
    );
    expect(done.exitCode).not.toBe(0);
    expect(await call("video_status", { jobId: done.id })).toMatchObject({
      verified: false,
      report: { ok: false },
    });
    await expect(call("video_output_read", { jobId: done.id })).rejects.toThrow(
      "completed",
    );
    await symlink(join(f.root, "data"), join(w.path, "motion/escape"));
    await expect(call("video_inspect")).rejects.toThrow(/links/);
    expect(
      videoRender.safeParse({ workspaceId: w.id, path: "motion", workers: 100 })
        .success,
    ).toBe(false);
  } finally {
    await f.cleanup();
  }
});

it("bounds binary reads and rejects links and protected paths", async () => {
  const f = await fixture(),
    w = f.folders[0];
  try {
    await writeFile(join(w.path, "video.mp4"), Buffer.from([0, 1, 2, 3, 4, 5]));
    const part = await readVideoBytes(
      f.engine.security,
      w.id,
      "video.mp4",
      ui,
      { offset: 2, length: 2 },
    );
    expect(part.buffer).toEqual(Buffer.from([2, 3]));
    expect(part.nextOffset).toBe(4);
    const whole = await readVideoBytes(
      f.engine.security,
      w.id,
      "video.mp4",
      ui,
    );
    expect(whole.hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      readVideoBytes(f.engine.security, w.id, "video.mp4", ui, {
        offset: 7,
        length: 1,
      }),
    ).rejects.toThrow("Offset");
    await expect(
      readVideoBytes(f.engine.security, w.id, "video.mp4", ui, undefined, 1),
    ).rejects.toThrow("budget");
    await symlink(join(w.path, "video.mp4"), join(w.path, "linked.mp4"));
    await expect(
      readVideoBytes(f.engine.security, w.id, "linked.mp4", ui),
    ).rejects.toThrow("links");
    await expect(
      readVideoBytes(f.engine.security, w.id, "../data/studio.sqlite", ui),
    ).rejects.toThrow();
  } finally {
    await f.cleanup();
  }
});

it.skipIf(process.platform !== "darwin")(
  "allows a video worker to lower its own priority and denies scheduling unrelated processes",
  async () => {
    const f = await fixture(),
      w = f.folders[0];
    const foreign = spawn(process.execPath, ["-e", "setInterval(()=>{},100)"], {
      stdio: "ignore",
    });
    try {
      await writeFile(
        join(f.folders[1].path, "private.txt"),
        "outside video scope",
      );
      await f.engine.request(
        "workspace.update",
        { id: w.id, accessMode: "full" },
        ui,
      );
      const job = await toolContext.run(
        { module: "Video", tool: "video-policy-test" },
        () =>
          f.engine.jobs.create(
            {
              workspaceId: w.id,
              cwd: ".",
              executable: process.execPath,
              args: [
                "-e",
                `const os=require('node:os');os.setPriority(19);console.log('self allowed');try{os.setPriority(${foreign.pid},19);console.log('FOREIGN ALLOWED')}catch(e){console.log('foreign denied '+e.code)};try{require('fs').readFileSync(${JSON.stringify(join(f.folders[1].path, "private.txt"))});console.log('SIBLING READ')}catch{console.log('sibling denied')}`,
              ],
            },
            ui,
          ),
      );
      const result = await waitFor(
        () => f.engine.jobs.get(job.id, ui),
        (j) => !["queued", "running"].includes(j.status),
      );
      expect(result.status).toBe("completed");
      expect(result.logs).toContain("self allowed");
      expect(result.logs).toContain("foreign denied");
      expect(result.logs).not.toContain("FOREIGN ALLOWED");
      expect(result.logs).toContain("sibling denied");
      expect(result.logs).not.toContain("SIBLING READ");
    } finally {
      foreign.kill();
      await f.cleanup();
    }
  },
);
