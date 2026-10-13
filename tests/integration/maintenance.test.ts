import { it, expect } from "vitest";
import { writeFile, readFile, mkdir, rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { fixture, ui, waitFor } from "../helpers";
import type { Verification } from "../../packages/contracts/src/index";
it("stops only owned jobs and exports diagnostics without source, command arguments or environment values", async () => {
  const f = await fixture(),
    ws = f.folders[0];
  try {
    await f.engine.request(
      "workspace.update",
      { id: ws.id, accessMode: "full" },
      ui,
    );
    const secret = "no-support-secret-728381";
    f.engine.environment.restore(
      [
        {
          workspaceId: ws.id,
          name: "PRIVATE_VALUE",
          value: secret,
          clientIds: [],
        },
      ],
      ui,
    );
    const job = await f.engine.jobs.create(
      {
        workspaceId: ws.id,
        executable: process.execPath,
        args: [
          "-e",
          "setInterval(()=>console.log(process.env.PRIVATE_VALUE),100)",
        ],
        persistent: true,
      },
      ui,
    );
    await waitFor(
      () => f.engine.store.job(job.id),
      (j) => !!j?.pid,
    );
    expect(await f.engine.request("jobs.stopAll", {}, ui)).toEqual({ jobs: 1 });
    expect(f.engine.store.job(job.id)?.status).toBe("cancelled");
    const bundle = JSON.stringify(
      await f.engine.request("maintenance.support", {}, ui),
    );
    expect(bundle).not.toContain(secret);
    expect(bundle).not.toContain(ws.path);
    expect(bundle).not.toContain("setInterval");
    expect(bundle).not.toContain("tokenHash");
    const page = await f.engine.request(
      "jobs.page",
      { limit: 1, offset: 0 },
      ui,
    );
    expect(page).toHaveLength(1);
    expect(page[0].logs).toBe("");
    expect(
      await f.engine.request("jobs.page", { limit: 1, offset: 1 }, ui),
    ).toEqual([]);
  } finally {
    await f.cleanup();
  }
});
it("cleans expired unreferenced images while preserving verification evidence and default unlimited retention", async () => {
  const f = await fixture(),
    ws = f.folders[0];
  try {
    await f.engine.request("workspace.update", { id: ws.id, write: true }, ui);
    const png = new PNG({ width: 10, height: 10 });
    png.data.fill(255);
    const make = () =>
      f.engine.artifacts.create(
        {
          workspaceId: ws.id,
          name: "real.png",
          mimeType: "image/png",
          bytes: PNG.sync.write(png),
          sourceRevision: "old",
          role: "screenshot",
        },
        ui,
      );
    const a = await make(),
      b = await make();
    for (const artifact of [a, b])
      f.engine.store.saveDevelopment("artifacts", {
        ...artifact,
        createdAt: "2000-01-01T00:00:00.000Z",
      });
    f.engine.store.saveDevelopment("verifications", {
      id: "proof",
      planId: "plan",
      taskId: "task",
      workspaceId: ws.id,
      clientId: ui.id,
      criterion: { kind: "screenshot", path: "." },
      status: "passed",
      at: "2000-01-01T00:00:00.000Z",
      sourceRevision: "old",
      artifactId: a.id,
      fileHash: null,
      jobId: null,
      detail: "Actual capture",
    } as Verification);
    expect(await f.engine.request("maintenance.cleanup", {}, ui)).toEqual({
      removed: 0,
      bytes: 0,
    });
    await f.engine.request("settings.set", { artifactRetentionDays: 1 }, ui);
    expect(await f.engine.request("maintenance.cleanup", {}, ui)).toEqual({
      removed: 1,
      bytes: b.bytes,
    });
    expect(await f.engine.artifacts.bytes(a.id, ui)).toEqual(
      PNG.sync.write(png),
    );
    await expect(f.engine.artifacts.bytes(b.id, ui)).rejects.toThrow(
      "not found",
    );
  } finally {
    await f.cleanup();
  }
});
it("rejects an ancestor swapped after approval before consuming outside file bytes", async () => {
  const f = await fixture(),
    ws = f.folders[0];
  try {
    await mkdir(join(ws.path, "swap"));
    await writeFile(join(ws.path, "swap/allowed.txt"), "allowed");
    await writeFile(
      join(f.folders[1].path, "allowed.txt"),
      "outside-not-authorized",
    );
    const original = f.engine.security.path.bind(f.engine.security);
    let swapped = false;
    f.engine.security.path = async (...args: Parameters<typeof original>) => {
      const path = await original(...args);
      if (!swapped && args[1] === "swap/allowed.txt") {
        swapped = true;
        await rename(join(ws.path, "swap"), join(ws.path, "original"));
        await symlink(f.folders[1].path, join(ws.path, "swap"), "dir");
      }
      return path;
    };
    await expect(
      f.engine.security.read(ws.id, "swap/allowed.txt", ui),
    ).rejects.toThrow();
    expect(await readFile(join(f.folders[1].path, "allowed.txt"), "utf8")).toBe(
      "outside-not-authorized",
    );
  } finally {
    await f.cleanup();
  }
});
