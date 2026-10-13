import { it, expect } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";
import { fixture, ui, waitFor } from "../helpers";
import { unzipSkill } from "../../packages/skills/src/index";
import { readLocalBytes } from "../../packages/skills/src/local-read";
import { realpath, rename, symlink } from "node:fs/promises";
it("rejects a local import whose ancestor is redirected before reading bytes", async () => {
  const f = await fixture();
  try {
    const root = await realpath(f.root),
      selected = join(root, "selected"),
      foreign = join(root, "foreign");
    await mkdir(selected);
    await mkdir(foreign);
    await writeFile(join(selected, "asset.txt"), "selected bytes");
    await writeFile(join(foreign, "asset.txt"), "private foreign bytes");
    let redirected = false;
    await expect(
      readLocalBytes(join(selected, "asset.txt"), 1024, async () => {
        if (!redirected) {
          redirected = true;
          await rename(selected, selected + "-moved");
          await symlink(foreign, selected);
        }
      }),
    ).rejects.toThrow("ancestor path changed");
  } finally {
    await f.cleanup();
  }
});
it("validates/imports an inert skill and requires local hash authorization before native execution", async () => {
  const f = await fixture(),
    ws = f.folders[0],
    folder = join(f.root, "hello-skill");
  try {
    await mkdir(join(folder, "scripts"), { recursive: true });
    await writeFile(
      join(folder, "SKILL.md"),
      "---\nname: hello-skill\ndescription: Write a local test file.\nallowed-tools: unrestricted\n---\nRun scripts/hello.mjs after authorization.",
    );
    await writeFile(
      join(folder, "scripts/hello.mjs"),
      "import {writeFileSync} from 'node:fs';writeFileSync('actual.txt','actual approved execution');console.log('skill done');",
    );
    await f.engine.request(
      "workspace.update",
      { id: ws.id, write: true, execute: true, accessMode: "full" },
      ui,
    );
    const [skill] = await f.engine.request(
      "skills.import",
      { kind: "directory", path: folder, workspaceId: ws.id },
      ui,
    );
    expect(skill.enabled).toBe(false);
    expect(skill.authorizedHash).toBeNull();
    await expect(readFile(join(ws.path, "actual.txt"))).rejects.toThrow();
    const call = (name: string, args: any) =>
      f.engine.request(
        "tool.call",
        { name, arguments: { workspaceId: ws.id, ...args } },
        ui,
      );
    await f.engine.request(
      "skills.configure",
      { skillId: skill.id, enabled: true },
      ui,
    );
    expect((await call("skill_read", { skillId: skill.id })).content).toContain(
      "hello-skill",
    );
    await expect(
      call("skill_resource", { skillId: skill.id, resource: "../admin.token" }),
    ).rejects.toThrow("Unsafe");
    await expect(
      call("skill_run", { skillId: skill.id, script: "scripts/hello.mjs" }),
    ).rejects.toThrow("authorization");
    await f.engine.request(
      "skills.configure",
      { skillId: skill.id, authorize: true },
      ui,
    );
    const execution = await call("skill_run", {
        skillId: skill.id,
        script: "scripts/hello.mjs",
      }),
      job = await waitFor(
        () => f.engine.store.job(execution.job.id),
        (j) => j?.status === "completed",
      );
    expect(job?.exitCode).toBe(0);
    expect(await readFile(join(ws.path, "actual.txt"), "utf8")).toBe(
      "actual approved execution",
    );
    await writeFile(
      join(ws.path, "remote-studio-skills", skill.hash, "scripts/hello.mjs"),
      "console.log('tampered');",
    );
    const changed = await call("skill_run", {
        skillId: skill.id,
        script: "scripts/hello.mjs",
      }),
      failed = await waitFor(
        () => f.engine.store.job(changed.job.id),
        (j) => j?.status === "failed",
      );
    expect(failed?.logs).toContain("content changed");
  } finally {
    await f.cleanup();
  }
});
it("rejects ZIP traversal and oversized decompression before installing content", () => {
  expect(() =>
    unzipSkill(zipSync({ "../escape/SKILL.md": Buffer.from("bad") })),
  ).toThrow("Unsafe");
  expect(() =>
    unzipSkill(
      zipSync({
        "safe-skill/assets/bomb.bin": new Uint8Array(3 * 1024 * 1024),
      }),
    ),
  ).toThrow("large");
});
it("does not accept a branch or arbitrary download URL as a pinned GitHub skill", async () => {
  const f = await fixture();
  try {
    await expect(
      f.engine.request(
        "skills.import",
        { kind: "github", url: "http://127.0.0.1/private", commit: "main" },
        ui,
      ),
    ).rejects.toThrow("commit SHA");
  } finally {
    await f.cleanup();
  }
});
it("updates skills atomically and invalidates script authorization only when content changes", async () => {
  const f = await fixture(),
    folder = join(f.root, "versioned-skill"),
    ws = f.folders[0];
  try {
    await mkdir(folder);
    const original =
      "---\nname: versioned-skill\ndescription: Versioned local instructions.\n---\nOriginal.";
    await writeFile(join(folder, "SKILL.md"), original);
    const [first] = await f.engine.request(
      "skills.import",
      { kind: "directory", path: folder, workspaceId: ws.id },
      ui,
    );
    await f.engine.request(
      "skills.configure",
      { skillId: first.id, enabled: true, authorize: true },
      ui,
    );
    const [same] = await f.engine.request(
      "skills.import",
      { kind: "directory", path: folder, replaceSkillId: first.id },
      ui,
    );
    expect(same.hash).toBe(first.hash);
    expect(same.enabled).toBe(true);
    expect(same.authorizedHash).toBe(first.hash);
    await writeFile(
      join(folder, "SKILL.md"),
      original + "\nChanged instructions.",
    );
    const [changed] = await f.engine.request(
      "skills.import",
      { kind: "directory", path: folder, replaceSkillId: same.id },
      ui,
    );
    expect(changed.hash).not.toBe(same.hash);
    expect(changed.enabled).toBe(false);
    expect(changed.authorizedHash).toBeNull();
    expect(changed.workspaceId).toBe(ws.id);
    expect(f.engine.skills.list(ws.id, ui)).toHaveLength(1);
    await writeFile(join(folder, "SKILL.md"), "malformed update");
    await expect(
      f.engine.request(
        "skills.import",
        { kind: "directory", path: folder, replaceSkillId: changed.id },
        ui,
      ),
    ).rejects.toThrow("frontmatter");
    expect(f.engine.skills.list(ws.id, ui).map((s) => s.id)).toEqual([
      changed.id,
    ]);
  } finally {
    await f.cleanup();
  }
});
