import { testLicense } from "../license-fixture";
import { beforeEach, afterEach, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, ui, waitFor, secret } from "../helpers";
import { Engine } from "../../services/local-agent/src/engine";
let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
  await f.engine.request(
    "workspace.update",
    { id: f.folders[0].id, execute: true },
    ui,
  );
});
afterEach(async () => {
  await f.cleanup();
});
const command = (script: string) => ({
  workspaceId: f.folders[0].id,
  executable: process.execPath,
  args: ["-e", script],
  cwd: ".",
  timeoutMs: 5000,
});
it("serializes competing approval decisions instead of reporting a rejected command as approved", async () => {
  const job = await f.engine.jobs.create(
    command("console.log('one authorized execution')"),
    ui,
  );
  const outcomes = await Promise.allSettled([
    f.engine.jobs.resolve(job.id, "approve", ui),
    f.engine.jobs.resolve(job.id, "reject", ui),
  ]);
  expect(outcomes.map((result) => result.status)).toEqual([
    "fulfilled",
    "rejected",
  ]);
  const result = await waitFor(
    () => f.engine.store.job(job.id),
    (value) => value?.status === "completed",
  );
  expect(result?.logs.match(/one authorized execution/g)).toHaveLength(1);
});
it("disabling Files stops Full Access execution while preserving independently reviewed commands", async () => {
  const ws = f.folders[0];
  await f.engine.request(
    "workspace.update",
    { id: ws.id, accessMode: "full" },
    ui,
  );
  const job = await f.engine.jobs.create(
    {
      ...command(
        "setInterval(()=>require('fs').appendFileSync('ticks.txt','x'),50)",
      ),
      persistent: true,
    },
    ui,
  );
  await waitFor(
    () => readFile(join(ws.path, "ticks.txt"), "utf8").catch(() => ""),
    (value) => value.length > 0,
  );
  const other = f.folders[1];
  await f.engine.request(
    "workspace.update",
    { id: other.id, execute: true },
    ui,
  );
  const reviewed = await f.engine.jobs.create(
    { ...command("process.exit(0)"), workspaceId: other.id },
    ui,
  );
  await f.engine.request("module.set", { name: "Files", enabled: false }, ui);
  expect(f.engine.store.job(job.id)?.status).toBe("cancelled");
  expect(f.engine.store.job(reviewed.id)?.status).toBe("awaiting_approval");
  const stopped = await readFile(join(ws.path, "ticks.txt"), "utf8");
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(await readFile(join(ws.path, "ticks.txt"), "utf8")).toBe(stopped);
});
it("requires approval, records actual output and exit code, and persists jobs after restart", async () => {
  const job = await f.engine.jobs.create(
    command("console.log('real stdout');console.error('real stderr')"),
    ui,
  );
  expect(job.status).toBe("awaiting_approval");
  expect(job.pid).toBeNull();
  await f.engine.jobs.resolve(job.id, "approve", ui);
  const result = await waitFor(
    () => f.engine.store.job(job.id)!,
    (j) => j.status === "completed",
  );
  expect(result.exitCode).toBe(0);
  expect(result.logs).toContain("real stdout");
  expect(result.logs).toContain("real stderr");
  await f.engine.close();
  f.engine = new Engine(join(f.root, "data"), secret, () => {}, testLicense);
  expect(f.engine.store.job(job.id)?.status).toBe("completed");
});
it("does not report success for failed commands or missing dependencies", async () => {
  const job = await f.engine.jobs.create(
    command("console.error('failure');process.exit(7)"),
    ui,
  );
  await f.engine.jobs.resolve(job.id, "approve", ui);
  const result = await waitFor(
    () => f.engine.store.job(job.id)!,
    (j) => j.status === "failed",
  );
  expect(result.exitCode).toBe(7);
  const missing = await f.engine.jobs.create(
    { ...command(""), executable: "remote-studio-not-installed-binary" },
    ui,
  );
  await f.engine.jobs.resolve(missing.id, "approve", ui);
  expect(
    (
      await waitFor(
        () => f.engine.store.job(missing.id)!,
        (j) => j.status === "failed",
      )
    ).error,
  ).toContain("ENOENT");
});
it("cancels processes and terminates their actual child process groups", async () => {
  const marker = join(f.folders[0].path, "child-marker");
  const script =
    "const {spawn}=require('node:child_process');spawn(process.execPath,['-e'," +
    JSON.stringify(
      "setInterval(()=>require('node:fs').appendFileSync(" +
        JSON.stringify(marker) +
        ",'x'),50)",
    ) +
    "],{stdio:'inherit'});setInterval(()=>{},1000);";
  const job = await f.engine.jobs.create(command(script), ui);
  await f.engine.jobs.resolve(job.id, "approve", ui);
  await waitFor(
    async () => {
      try {
        return (await readFile(marker)).length;
      } catch {
        return 0;
      }
    },
    (n) => n > 1,
  );
  await f.engine.jobs.resolve(job.id, "cancel", ui);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const size = (await readFile(marker)).length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect((await readFile(marker)).length).toBe(size);
  expect(f.engine.store.job(job.id)?.status).toBe("cancelled");
});
it("enforces timeout and bounds/redacts process output", async () => {
  const job = await f.engine.jobs.create(
    {
      ...command(
        "console.log('api_key=do-not-show');console.log('x'.repeat(200000));setInterval(()=>{},1000)",
      ),
      timeoutMs: 300,
    },
    ui,
  );
  await f.engine.jobs.resolve(job.id, "approve", ui);
  const result = await waitFor(
    () => f.engine.store.job(job.id)!,
    (j) => j.status === "failed",
  );
  expect(result.error).toContain("timeout");
  expect(result.logs.length).toBeLessThanOrEqual(128 * 1024);
  expect(result.logs).not.toContain("do-not-show");
});
it("requires separate execution grants and cancels jobs on workspace revocation", async () => {
  await expect(
    f.engine.jobs.create({ ...command(""), workspaceId: f.folders[1].id }, ui),
  ).rejects.toThrow("separate");
  const job = await f.engine.jobs.create(
    command("setInterval(()=>{},1000)"),
    ui,
  );
  await f.engine.jobs.resolve(job.id, "approve", ui);
  await waitFor(
    () => f.engine.store.job(job.id)!,
    (j) => j.pid !== null,
  );
  await f.engine.request(
    "workspace.update",
    { id: f.folders[0].id, enabled: false },
    ui,
  );
  expect(f.engine.store.job(job.id)?.status).toBe("cancelled");
});
it("reuses idempotency keys and rejects reuse for different commands", async () => {
  const request = {
    ...command("console.log('once')"),
    idempotencyKey: "unique",
  };
  const first = await f.engine.jobs.create(request, ui);
  expect((await f.engine.jobs.create(request, ui)).id).toBe(first.id);
  await expect(
    f.engine.jobs.create({ ...request, args: ["-e", "different"] }, ui),
  ).rejects.toThrow("different");
});
it("marks a crashed worker as interrupted without replay", async () => {
  const job = await f.engine.jobs.create(command("console.log(1)"), ui);
  f.engine.store.saveJob({ ...job, status: "running", pid: 999999 });
  await f.engine.close();
  f.engine = new Engine(join(f.root, "data"), secret, () => {}, testLicense);
  expect(f.engine.store.job(job.id)?.status).toBe("interrupted");
  expect(f.engine.store.job(job.id)?.error).toContain("not be repeated");
});
it("does not inherit unrelated API credentials", async () => {
  process.env.STUDIO_TEST_SECRET = "private";
  const job = await f.engine.jobs.create(
    command("console.log(process.env.STUDIO_TEST_SECRET || 'missing')"),
    ui,
  );
  await f.engine.jobs.resolve(job.id, "approve", ui);
  const result = await waitFor(
    () => f.engine.store.job(job.id)!,
    (j) => j.status === "completed",
  );
  expect(result.logs).toContain("missing");
  delete process.env.STUDIO_TEST_SECRET;
  await writeFile(join(f.folders[0].path, "test-finished"), "real");
});
it("reaps a rapidly detached descendant after its parent exits without touching another native scope", async () => {
  const other = await f.engine.jobs.create(
    {
      ...command(
        "setInterval(()=>require('fs').appendFileSync('other-scope.txt','x'),50)",
      ),
      persistent: true,
    },
    ui,
  );
  await f.engine.jobs.resolve(other.id, "approve", ui);
  await waitFor(
    () =>
      readFile(join(f.folders[0].path, "other-scope.txt"), "utf8").catch(
        () => "",
      ),
    (s) => s.length > 0,
  );
  const detached = await f.engine.jobs.create(
    command(
      "const child=require('child_process').spawn(process.execPath,['-e',`setInterval(()=>require('fs').appendFileSync('detached.txt','x'),20)`],{detached:true,stdio:'ignore'});child.unref();setTimeout(()=>process.exit(0),100)",
    ),
    ui,
  );
  await f.engine.jobs.resolve(detached.id, "approve", ui);
  const done = await waitFor(
    () => f.engine.store.job(detached.id),
    (j) => j?.status === "completed",
  );
  expect(done?.exitCode).toBe(0);
  const marker = join(f.folders[0].path, "detached.txt"),
    size = (await readFile(marker).catch(() => Buffer.alloc(0))).length,
    foreign = (await readFile(join(f.folders[0].path, "other-scope.txt")))
      .length;
  await new Promise((r) => setTimeout(r, 300));
  expect((await readFile(marker).catch(() => Buffer.alloc(0))).length).toBe(
    size,
  );
  expect(
    (await readFile(join(f.folders[0].path, "other-scope.txt"))).length,
  ).toBeGreaterThan(foreign);
  await f.engine.jobs.resolve(other.id, "cancel", ui);
});
