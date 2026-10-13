import { expect, it } from "vitest";
import {
  mkdir,
  readFile,
  writeFile,
  symlink,
  link,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { fixture, ui, waitFor } from "../helpers";
import { hash } from "../../packages/security/src/index";
it("native isolation rejects shell, Python, link escapes and root replacement, and supervises child processes", async () => {
  const f = await fixture(),
    w = f.folders[0],
    outside = join(f.folders[1].path, "private.txt");
  const call = (name: string, args: Record<string, unknown>) =>
    f.engine.request(
      "tool.call",
      { name, arguments: { workspaceId: w.id, ...args } },
      ui,
    );
  const finished = (j: any) =>
    waitFor(
      () => f.engine.jobs.get(j.id, ui),
      (v) => !["queued", "running"].includes(v.status),
    );
  try {
    await f.engine.request(
      "workspace.update",
      { id: w.id, accessMode: "full" },
      ui,
    );
    await writeFile(outside, "outside");
    const shell =
      process.platform === "win32"
        ? `Get-Content -LiteralPath '${outside.replaceAll("'", "''")}'; if (!$?) { exit 4 }`
        : `/bin/cat '${outside.replaceAll("'", "'\\''")}'`;
    const denied = await finished(
      await call("shell_execute", { command: shell }),
    );
    expect(denied.exitCode).not.toBe(0);
    expect(denied.logs).toMatch(/denied|permitted/i);
    const chain = await call("toolchain_info", {}),
      python = chain.tools.find(
        (t: any) =>
          t.name === (process.platform === "win32" ? "python" : "python3"),
      );
    if (python.path) {
      const script = `import os\np=${JSON.stringify(outside)}\nfor mode in ['r','w']:\n try:\n  open(p,mode); os._exit(9)\n except PermissionError:\n  print('python-denied-'+mode)\n`;
      const result = await finished(
        await call("command_execute", {
          executable: python.path,
          args: ["-c", script],
        }),
      );
      expect(result.exitCode).toBe(0);
      expect(result.logs).toContain("python-denied-w");
    }
    await symlink(
      f.folders[1].path,
      join(w.path, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      call("file_write", {
        path: "escape/private.txt",
        content: "bad",
        expectedHash: hash("outside"),
      }),
    ).rejects.toThrow(/Symbolic|reparse/i);
    await link(outside, join(w.path, "hardlink"));
    await expect(
      call("file_write", {
        path: "hardlink",
        content: "bad",
        expectedHash: hash("outside"),
      }),
    ).rejects.toThrow(/Hard-linked/i);
    await expect(
      call("file_delete", { path: ".", recursive: true }),
    ).rejects.toThrow(/root/i);
    const root = await finished(
      await call("command_execute", {
        executable: process.execPath,
        args: [
          "-e",
          `try{require('fs').renameSync(process.cwd(),process.cwd()+'-moved');process.exit(9)}catch(e){console.log('root-denied')}`,
        ],
      }),
    );
    expect(root.exitCode).toBe(0);
    expect(root.logs).toContain("root-denied");
    const failed = await finished(
      await call("command_execute", {
        executable: process.execPath,
        args: ["-e", "console.error('actual failure');process.exit(7)"],
      }),
    );
    expect(failed.status).toBe("failed");
    expect(failed.exitCode).toBe(7);
    expect(failed.logs).toContain("actual failure");
    const timeout = await finished(
      await call("command_execute", {
        executable: process.execPath,
        args: ["-e", "setInterval(()=>{},100)"],
        timeoutMs: 100,
      }),
    );
    expect(timeout.status).toBe("failed");
    expect(timeout.error).toContain("timeout");
    const child = await call("command_execute", {
      executable: process.execPath,
      args: [
        "-e",
        `const c=require('child_process').spawn(process.execPath,['-e',"setTimeout(()=>require('fs').writeFileSync('child-survived','bad'),2000);setInterval(()=>{},100)"],{stdio:'inherit'});console.log('child-started');setInterval(()=>{},100)`,
      ],
      persistent: true,
    });
    await waitFor(
      () => f.engine.jobs.get(child.id, ui),
      (j) => j.logs.includes("child-started"),
    );
    await f.engine.request(
      "workspace.update",
      { id: w.id, execute: false },
      ui,
    );
    expect(f.engine.jobs.get(child.id, ui).status).toBe("cancelled");
    await new Promise((res) => setTimeout(res, 2500));
    await expect(readFile(join(w.path, "child-survived"))).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("outside");
  } finally {
    await f.cleanup();
  }
});
it("checkpoints restore copy/delete and binary bytes, reject conflicting Undo, and detect changed roots", async () => {
  const f = await fixture(),
    w = f.folders[0];
  const call = (name: string, args: Record<string, unknown>) =>
    f.engine.request(
      "tool.call",
      { name, arguments: { workspaceId: w.id, ...args } },
      ui,
    );
  try {
    await f.engine.request(
      "workspace.update",
      { id: w.id, accessMode: "full" },
      ui,
    );
    await call("directory_create", { path: "folder/sub" });
    await call("file_write", {
      path: "folder/sub/one.txt",
      content: "one",
      expectedHash: null,
    });
    const copied = await call("file_copy", {
      path: "folder",
      destination: "copy",
    });
    expect(copied.status).toBe("applied");
    const deleted = await call("file_delete", {
      path: "copy",
      recursive: true,
    });
    await call("file_restore", { changeId: deleted.id });
    expect(await readFile(join(w.path, "copy/sub/one.txt"), "utf8")).toBe(
      "one",
    );
    const edit = await call("file_write_binary", {
      path: "bytes.bin",
      base64: Buffer.from([0, 255]).toString("base64"),
      expectedHash: null,
    });
    await call("file_restore", { changeId: edit.id });
    await expect(readFile(join(w.path, "bytes.bin"))).rejects.toThrow();
    await writeFile(join(w.path, "copy/sub/one.txt"), "newer");
    await expect(f.engine.files.resolve(copied.id, "undo", ui)).rejects.toThrow(
      /conflict/i,
    );
    await call("project_create", {
      path: "empty",
      name: "empty",
      template: "empty",
    });
    expect(await readFile(join(w.path, "folder/sub/one.txt"), "utf8")).toBe(
      "one",
    );
    await mkdir(join(w.path, "runtime-escape"));
    await symlink(
      f.folders[1].path,
      join(w.path, "runtime-escape/.remote-studio"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const [other] = await f.engine.request(
      "workspace.add",
      { paths: [join(w.path, "runtime-escape")] },
      ui,
    );
    await expect(
      f.engine.request(
        "workspace.update",
        { id: other.id, accessMode: "full" },
        ui,
      ),
    ).rejects.toThrow(/Runtime|regular/i);
    await rename(w.path, w.path + "-before");
    await mkdir(w.path);
    await expect(
      call("directory_create", { path: "replaced-root" }),
    ).rejects.toThrow(/root has changed/i);
    await expect(
      f.engine.request(
        "workspace.update",
        { id: w.id, accessMode: "full" },
        ui,
      ),
    ).rejects.toThrow(/root has changed/i);
    await rm(w.path, { recursive: true });
    await symlink(
      f.folders[1].path,
      w.path,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(call("directory_create", { path: "bad" })).rejects.toThrow(
      /root has changed/i,
    );
  } finally {
    await f.cleanup();
  }
});
it("creates a custom project in an empty root and performs scoped Git init, stage, commit and branches", async () => {
  const f = await fixture(),
    w = f.folders[0];
  const call = (name: string, args: Record<string, unknown>) =>
    f.engine.request(
      "tool.call",
      { name, arguments: { workspaceId: w.id, ...args } },
      ui,
    );
  const done = async (job: any) => {
    const j = await waitFor(
      () => f.engine.jobs.get(job.id, ui),
      (v) => !["queued", "running"].includes(v.status),
    );
    if (j.status !== "completed") throw new Error(j.error + "\n" + j.logs);
    return j;
  };
  try {
    await f.engine.request(
      "workspace.update",
      { id: w.id, accessMode: "full" },
      ui,
    );
    const root = await call("project_create", {
      name: "root",
      template: "custom",
      files: [{ path: "src/nested.txt", content: "root project" }],
    });
    expect(root.status).toBe("applied");
    expect(await readFile(join(w.path, "src/nested.txt"), "utf8")).toBe(
      "root project",
    );
    await expect(call("project_create", { name: "root" })).rejects.toThrow(
      /TARGET_NOT_EMPTY/,
    );
    await done(await call("git_init", {}));
    await done(
      await call("command_execute", {
        executable: "git",
        args: ["config", "user.name", "Native Test"],
      }),
    );
    await done(
      await call("command_execute", {
        executable: "git",
        args: ["config", "user.email", "test@example.invalid"],
      }),
    );
    await done(await call("git_stage", { paths: ["src/nested.txt"] }));
    await done(await call("git_commit", { message: "Scoped native commit" }));
    await done(
      await call("git_branch", { action: "create", branch: "native-test" }),
    );
    await done(
      await call("git_branch", { action: "switch", branch: "native-test" }),
    );
    expect((await call("git_status", {})).output).toContain("native-test");
    expect((await call("git_log", {})).output).toContain(
      "Scoped native commit",
    );
    await writeFile(
      join(w.path, ".git/objects/info/alternates"),
      f.folders[1].path,
    );
    await expect(call("git_status", {})).rejects.toThrow(
      /External Git metadata/,
    );
  } finally {
    await f.cleanup();
  }
});
