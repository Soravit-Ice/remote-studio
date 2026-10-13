import { beforeEach, afterEach, it, expect } from "vitest";
import { writeFile, readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fixture, ui, waitFor } from "../helpers";
import {
  StreamingRedactor,
  validateEnvironmentName,
} from "../../packages/environment/src/index";
const exec = promisify(execFile);
let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
  await f.engine.request(
    "workspace.update",
    { id: f.folders[0].id, accessMode: "full" },
    ui,
  );
});
afterEach(async () => {
  await f.cleanup();
});
it("injects only locally bound variables, redacts chunk boundaries, and never persists their values", async () => {
  const ws = f.folders[0],
    value = "private-testing-value-398284";
  const connection = await f.engine.request(
    "connection.create",
    {
      name: "Environment test",
      workspaceIds: [ws.id],
      write: true,
      execute: true,
      accessMode: "full",
    },
    ui,
  );
  const credential = await f.engine.request(
      "connection.secret",
      connection.clientId,
      ui,
    ),
    actor = f.engine.actor(credential.token, "client");
  expect(() => f.engine.environment.restore([], actor)).toThrow("local UI");
  f.engine.environment.restore(
    [{ workspaceId: ws.id, name: "TEST_VALUE", value, clientIds: [actor.id] }],
    ui,
  );
  expect(
    JSON.stringify(f.engine.environment.status(ws.id, actor)),
  ).not.toContain(value);
  expect(f.engine.environment.forJob(ws.id, actor)).toEqual({
    TEST_VALUE: value,
  });
  expect(() => f.engine.environment.forJob(f.folders[1].id, ui)).toThrow(
    "separate workspace grant",
  );
  const job = await f.engine.jobs.create(
    {
      workspaceId: ws.id,
      executable: process.execPath,
      args: [
        "-e",
        "const s=process.env.TEST_VALUE;process.stdout.write(s.slice(0,8));setTimeout(()=>console.log(s.slice(8)),25)",
      ],
      cwd: ".",
      timeoutMs: 5000,
    },
    actor,
  );
  const done = await waitFor(
    () => f.engine.store.job(job.id),
    (j) => j?.status === "completed",
  );
  expect(done?.logs).toContain("[REDACTED]");
  expect(done?.logs).not.toContain(value);
  expect(JSON.stringify(f.engine.store.all("environment"))).not.toContain(
    value,
  );
  expect(
    (await readFile(join(f.engine.directory, "studio.sqlite"))).includes(
      Buffer.from(value),
    ),
  ).toBe(false);
  for (const name of [
    "PATH",
    "NODE_OPTIONS",
    "STUDIO_DATA_DIR",
    "MAC_CHROMIUM_TMPDIR",
    "CARGO_HOME",
  ])
    expect(() => validateEnvironmentName(name)).toThrow("reserved");
});
it("keeps live output immediate and hides every split of a configured secret", () => {
  const secret = "secret-long-value";
  for (let split = 1; split < secret.length; split++) {
    const r = new StreamingRedactor([secret]);
    expect(
      r.push(secret.slice(0, split)) + r.push(secret.slice(split)) + r.flush(),
    ).toBe("[REDACTED]");
  }
  const r = new StreamingRedactor([secret]);
  expect(r.push("server-ready\n")).toBe("server-ready\n");
  expect(r.push("sec") + r.flush()).toBe("[REDACTED]");
});
it("checkpoints explicit dirty and untracked files without changing HEAD or the real staging area", async () => {
  const ws = f.folders[0];
  const git = async (...args: string[]) =>
    (await exec("git", args, { cwd: ws.path })).stdout.trim();
  await git("init");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.test");
  await writeFile(join(ws.path, "tracked.txt"), "baseline");
  await git("add", "tracked.txt");
  await git("commit", "-m", "baseline");
  const head = await git("rev-parse", "HEAD");
  await writeFile(join(ws.path, "tracked.txt"), "staged user's edit");
  await git("add", "tracked.txt");
  await writeFile(join(ws.path, "tracked.txt"), "unstaged user's edit");
  await writeFile(join(ws.path, "untracked.txt"), "keep this");
  const index = await readFile(join(ws.path, ".git/index"));
  const job = await f.engine.request(
    "tool.call",
    {
      name: "git_checkpoint",
      arguments: {
        workspaceId: ws.id,
        path: ".",
        paths: ["tracked.txt", "untracked.txt"],
        message: "Actual checkpoint",
      },
    },
    ui,
  );
  const done = await waitFor(
    () => f.engine.store.job(job.id),
    (j) => !!j && !["running", "queued"].includes(j.status),
  );
  expect(done?.status, done?.logs).toBe("completed");
  const result = JSON.parse(done!.logs.trim());
  expect(await git("show", result.commit + ":tracked.txt")).toBe(
    "unstaged user's edit",
  );
  expect(await git("show", result.commit + ":untracked.txt")).toBe("keep this");
  expect(await git("rev-parse", "HEAD")).toBe(head);
  expect(await readFile(join(ws.path, ".git/index"))).toEqual(index);
  expect(await git("show", ":tracked.txt")).toBe("staged user's edit");
  expect(await readdir(ws.path)).toContain("untracked.txt");
});
it("keeps old active jobs and idempotency records discoverable beyond the Activity page", async () => {
  const ws = f.folders[0];
  const old = await f.engine.jobs.create(
    {
      workspaceId: ws.id,
      executable: process.execPath,
      args: ["-e", "console.log('old')"],
      idempotencyKey: "old-key",
      cwd: ".",
    },
    ui,
  );
  await waitFor(
    () => f.engine.store.job(old.id),
    (j) => j?.status === "completed",
  );
  f.engine.store.transaction(() => {
    for (let i = 0; i < 520; i++)
      f.engine.store.saveJob({
        ...old,
        id: String(i),
        command: { ...old.command, idempotencyKey: undefined },
      });
  });
  expect((await f.engine.jobs.create(old.command, ui)).id).toBe(old.id);
  f.engine.store.saveJob({ ...old, status: "queued" });
  expect(
    f.engine.store.jobsWithStatus(["queued"]).some((j) => j.id === old.id),
  ).toBe(true);
});
