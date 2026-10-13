import { testLicense } from "../license-fixture";
import { afterEach, beforeEach, expect, it } from "vitest";
import { writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { fixture, ui, waitFor } from "../helpers";
import { Engine } from "../../services/local-agent/src/engine";
import { projectMap } from "../../packages/projects/src/map";
import { mkdir } from "node:fs/promises";
let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
  await f.engine.request(
    "workspace.update",
    { id: f.folders[0].id, write: true, execute: true },
    ui,
  );
});
afterEach(async () => {
  await f.cleanup();
});
const call = (name: string, args: any) =>
  f.engine.request(
    "tool.call",
    { name, arguments: { workspaceId: f.folders[0].id, ...args } },
    ui,
  );
it("resolves inherited monorepo TS aliases without loading project plugins", async () => {
  const ws = f.folders[0];
  await mkdir(join(ws.path, "packages/web/src"), { recursive: true });
  await writeFile(
    join(ws.path, "tsconfig.base.json"),
    '{"compilerOptions":{"strict":true,"target":"ES2023"}}',
  );
  await writeFile(
    join(ws.path, "packages/web/tsconfig.json"),
    '{"extends":"../../tsconfig.base.json","compilerOptions":{"paths":{"@/*":["./src/*"]},"plugins":[{"name":"./plugin.mjs"}]}}',
  );
  await writeFile(
    join(ws.path, "packages/web/src/shared.ts"),
    'export const greeting = "hello";',
  );
  await writeFile(
    join(ws.path, "packages/web/src/main.ts"),
    'import { greeting } from "@/shared";\nconsole.log(greeting);',
  );
  await writeFile(
    join(ws.path, "packages/web/plugin.mjs"),
    "import {writeFileSync} from 'node:fs';writeFileSync('executed-plugin.txt','bad');",
  );
  const result = await call("code_query", {
    action: "definitions",
    file: "packages/web/src/main.ts",
    line: 2,
    column: 13,
  });
  expect(
    result.results.some(
      (row: any) => row.path === "packages/web/src/shared.ts",
    ),
  ).toBe(true);
  expect(result.limitations.join(" ")).toContain("plugins are ignored");
  await expect(
    readFile(join(ws.path, "executed-plugin.txt")),
  ).rejects.toThrow();
});
it("persists a dependency graph, rejects fabricated completion, and invalidates changed file evidence", async () => {
  await writeFile(
    join(f.folders[0].path, "answer.ts"),
    "export const answer = 42;",
  );
  const p = await call("plan_create", {
    title: "Feature",
    mode: "full",
    tasks: [
      {
        key: "code",
        title: "Implementation",
        criteria: [{ kind: "file_contains", path: "answer.ts", text: "42" }],
      },
      {
        key: "review",
        title: "Review",
        dependsOn: ["code"],
        criteria: [{ kind: "file_exists", path: "answer.ts" }],
      },
    ],
  });
  await expect(
    call("task_update", {
      planId: p.plan.id,
      taskId: p.tasks[1].id,
      status: "running",
    }),
  ).rejects.toThrow("dependencies");
  await expect(
    call("task_update", {
      planId: p.plan.id,
      taskId: p.tasks[0].id,
      status: "completed",
    }),
  ).rejects.toThrow();
  let result = await call("task_verify", {
    planId: p.plan.id,
    taskId: p.tasks[0].id,
  });
  expect(result.tasks[0].status).toBe("completed");
  result = await call("task_verify", {
    planId: p.plan.id,
    taskId: p.tasks[1].id,
  });
  expect(result.plan.status).toBe("completed");
  await writeFile(
    join(f.folders[0].path, "answer.ts"),
    "export const answer = 7;",
  );
  result = await call("plan_get", { planId: p.plan.id });
  expect(result.plan.status).toBe("active");
  expect(result.verifications.some((v: any) => v.status === "stale")).toBe(
    true,
  );
  expect(result.progress.completed).toBe(0);
  const dir = f.engine.directory;
  await f.engine.close();
  f.engine = new Engine(dir, "a".repeat(64), () => {}, testLicense);
  expect((await call("plan_get", { planId: p.plan.id })).tasks).toHaveLength(2);
});
it("rejects cyclic plans, revision conflicts, and cross-client/workspace reads", async () => {
  await expect(
    call("plan_create", {
      title: "Bad",
      tasks: [
        {
          key: "a",
          title: "A",
          dependsOn: ["b"],
          criteria: [{ kind: "file_exists", path: "a" }],
        },
        {
          key: "b",
          title: "B",
          dependsOn: ["a"],
          criteria: [{ kind: "file_exists", path: "b" }],
        },
      ],
    }),
  ).rejects.toThrow("cycle");
  const p = await call("plan_create", {
    title: "Good",
    tasks: [
      { key: "a", title: "A", criteria: [{ kind: "file_exists", path: "a" }] },
    ],
  });
  await expect(
    call("plan_update", { planId: p.plan.id, revision: 99, title: "Other" }),
  ).rejects.toThrow("revision");
  await expect(
    f.engine.request(
      "tool.call",
      {
        name: "plan_get",
        arguments: { workspaceId: f.folders[1].id, planId: p.plan.id },
      },
      ui,
    ),
  ).rejects.toThrow("not found");
  const { clientId } = await f.engine.request(
      "connection.create",
      { name: "Other", workspaceIds: [f.folders[0].id], write: true },
      ui,
    ),
    credential = await f.engine.request("connection.secret", clientId, ui),
    actor = f.engine.actor(credential.token, "client");
  await expect(
    f.engine.request(
      "tool.call",
      {
        name: "plan_get",
        arguments: { workspaceId: f.folders[0].id, planId: p.plan.id },
      },
      actor,
    ),
  ).rejects.toThrow("not found");
});
it("records actual native command verification and does not count a pending approval as success", async () => {
  await writeFile(
    join(f.folders[0].path, "package.json"),
    JSON.stringify({
      name: "check",
      scripts: { test: 'node -e "process.exit(0)"' },
    }),
  );
  const p = await call("plan_create", {
    title: "Validate",
    tasks: [
      {
        key: "test",
        title: "Test",
        criteria: [{ kind: "script", script: "test", path: "." }],
      },
    ],
  });
  let result = await call("task_verify", {
    planId: p.plan.id,
    taskId: p.tasks[0].id,
  });
  const v = result.verifications[0];
  expect(result.tasks[0].status).toBe("awaiting_approval");
  expect(f.engine.store.job(v.jobId)?.status).toBe("awaiting_approval");
  await f.engine.request(
    "job.resolve",
    { id: v.jobId, decision: "approve" },
    ui,
  );
  await waitFor(
    () => f.engine.store.job(v.jobId),
    (j) => j?.status === "completed",
  );
  result = await call("task_verify", {
    planId: p.plan.id,
    taskId: p.tasks[0].id,
  });
  expect(result.tasks[0].status).toBe("completed");
  expect(result.verifications.find((x: any) => x.id === v.id).status).toBe(
    "passed",
  );
});
it("links file changes to attempts and resumes interrupted tasks without replay", async () => {
  const p = await call("plan_create", {
    title: "Create",
    tasks: [
      {
        key: "create",
        title: "File",
        criteria: [{ kind: "file_exists", path: "a.txt" }],
      },
    ],
  });
  const result = await call("file_write", {
    planId: p.plan.id,
    taskId: p.tasks[0].id,
    path: "a.txt",
    content: "actual",
    expectedHash: null,
  });
  expect(result.status).toBe("pending");
  const detail = await call("plan_get", { planId: p.plan.id });
  expect(detail.attempts[0].changeIds).toEqual([result.id]);
  const task = detail.tasks[0];
  f.engine.store.saveDevelopment("tasks", { ...task, status: "running" });
  const dir = f.engine.directory;
  await f.engine.close();
  f.engine = new Engine(dir, "a".repeat(64), () => {}, testLicense);
  expect((await call("plan_get", { planId: p.plan.id })).tasks[0].status).toBe(
    "interrupted",
  );
  expect(
    (await call("plan_resume", { planId: p.plan.id })).tasks[0].status,
  ).toBe("pending");
  await expect(readFile(join(f.folders[0].path, "a.txt"))).rejects.toThrow();
});
it("stores immutable actual PNG evidence, bounds previews, compares images and rejects foreign artifacts", async () => {
  const a = new PNG({ width: 20, height: 20 });
  a.data.fill(255);
  const b = new PNG({ width: 20, height: 20 });
  b.data.fill(255);
  b.data[0] = 0;
  const create = (bytes: Buffer) =>
    f.engine.artifacts.create(
      {
        workspaceId: f.folders[0].id,
        name: "real.png",
        mimeType: "image/png",
        bytes,
        sourceRevision: "r",
        role: "screenshot",
      },
      ui,
    );
  const before = await create(PNG.sync.write(a)),
    after = await create(PNG.sync.write(b));
  const read = await call("artifact_read", { artifactId: before.id });
  expect(Buffer.from(read.image.data, "base64").subarray(1, 4).toString()).toBe(
    "PNG",
  );
  const comparison = await call("browser_compare", {
    beforeId: before.id,
    afterId: after.id,
  });
  expect(comparison.changedPixels).toBeGreaterThan(0);
  expect(comparison.diff.hash).toMatch(/^[a-f0-9]{64}$/);
  await expect(
    f.engine.request(
      "tool.call",
      {
        name: "artifact_read",
        arguments: { workspaceId: f.folders[1].id, artifactId: before.id },
      },
      ui,
    ),
  ).rejects.toThrow("another workspace");
});
it("maps monorepos and resolves actual JS/TS symbols and references in the worker", async () => {
  await writeFile(
    join(f.folders[0].path, "package.json"),
    JSON.stringify({
      name: "source",
      packageManager: "npm@11.0.0",
      scripts: { test: "node --test" },
    }),
  );
  await writeFile(
    join(f.folders[0].path, "source.ts"),
    'export function greet(name: string) { return name; }\nconst message = greet("world");\n',
  );
  const context = await call("project_context", {});
  expect(context.packages[0].name).toBe("source");
  expect(context.validation).toEqual(["test"]);
  const symbols = await call("code_query", {
    action: "symbols",
    query: "greet",
  });
  expect(symbols.results.some((s: any) => s.name === "greet")).toBe(true);
  const refs = await call("code_query", {
    action: "references",
    file: "source.ts",
    line: 2,
    column: 18,
  });
  expect(refs.results.length).toBeGreaterThanOrEqual(2);
});
it("backs up an existing pre-migration database before introducing versioned tables", async () => {
  const version = f.engine.store.db.prepare("PRAGMA user_version").get() as any;
  expect(version.user_version).toBe(2);
  f.engine.store.db.exec("PRAGMA user_version=0");
  const dir = f.engine.directory;
  await f.engine.close();
  f.engine = new Engine(dir, "a".repeat(64), () => {}, testLicense);
  expect((await readdir(dir)).some((n) => n.startsWith("studio.pre-v1-"))).toBe(
    true,
  );
  expect(f.engine.store.workspaces()).toHaveLength(3);
});
it("reuses unchanged source hashes and detects edits with preserved modification time", async () => {
  const path = join(f.folders[0].path, "cached.ts");
  await writeFile(path, "export const value = 1;");
  const { stat, utimes } = await import("node:fs/promises");
  const original = await stat(path);
  const first = await projectMap(
    f.engine.security,
    { workspaceId: f.folders[0].id, path: "." },
    ui,
  );
  const cached = await projectMap(
    f.engine.security,
    { workspaceId: f.folders[0].id, path: "." },
    ui,
  );
  expect(cached.revision).toBe(first.revision);
  await writeFile(path, "export const value = 2;");
  await utimes(path, original.atime, original.mtime);
  const changed = await projectMap(
    f.engine.security,
    { workspaceId: f.folders[0].id, path: "." },
    ui,
  );
  expect(changed.revision).not.toBe(first.revision);
});
it("manual retry creates a new linked attempt and current criteria can replace stale session evidence", async () => {
  await f.engine.request(
    "workspace.update",
    { id: f.folders[0].id, accessMode: "full" },
    ui,
  );
  const p = await call("plan_create", {
    title: "Retry",
    tasks: [
      {
        key: "run",
        title: "Actual operation",
        criteria: [{ kind: "file_exists", path: "ready.txt" }],
      },
    ],
  });
  const failed = await call("command_execute", {
    planId: p.plan.id,
    taskId: p.tasks[0].id,
    executable: process.execPath,
    args: ["-e", "process.exit(1)"],
  });
  await waitFor(
    () => f.engine.store.job(failed.id),
    (j) => j?.status === "failed",
  );
  const retried = await f.engine.request(
    "job.resolve",
    { id: failed.id, decision: "retry" },
    ui,
  );
  expect(retried.id).not.toBe(failed.id);
  expect(retried.planId).toBe(p.plan.id);
  expect(retried.taskId).toBe(p.tasks[0].id);
  expect(retried.attemptId).not.toBe(failed.attemptId);
  await waitFor(
    () => f.engine.store.job(retried.id),
    (j) => j?.status === "failed",
  );
  const detail = await call("plan_get", { planId: p.plan.id });
  expect(detail.attempts.some((a: any) => a.jobIds.includes(retried.id))).toBe(
    true,
  );
  await writeFile(join(f.folders[0].path, "new.txt"), "checked");
  await expect(
    call("task_update", {
      planId: p.plan.id,
      taskId: p.tasks[0].id,
      revision: 99,
      criteria: [{ kind: "file_exists", path: "new.txt" }],
    }),
  ).rejects.toThrow("revision");
  const updated = await call("task_update", {
    planId: p.plan.id,
    taskId: p.tasks[0].id,
    revision: detail.plan.revision,
    criteria: [{ kind: "file_contains", path: "new.txt", text: "checked" }],
  });
  expect(updated.plan.revision).toBe(detail.plan.revision + 1);
  expect(
    (await call("task_verify", { planId: p.plan.id, taskId: p.tasks[0].id }))
      .tasks[0].status,
  ).toBe("completed");
});
