import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { adminToken, rpc } from "../../packages/shared/src/rpc";

test("development UI displays actual verified plans, imports inert skills and stores encrypted environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-development-ui-")),
    data = join(root, "data"),
    folder = join(root, "development-workspace"),
    skillFolder = join(root, "ui-skill");
  await mkdir(folder);
  await mkdir(skillFolder);
  await writeFile(join(folder, "checked.ts"), "export const ready = true;\n");
  await writeFile(
    join(skillFolder, "SKILL.md"),
    "---\nname: ui-skill\ndescription: Instructions inspected in the real native interface.\n---\nReview the current project before editing.\n",
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STUDIO_TEST_LICENSE: "1",
    STUDIO_DATA_DIR: data,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: process.env.STUDIO_ELECTRON_EXE ? [] : ["."],
    executablePath: process.env.STUDIO_ELECTRON_EXE,
    env: env as Record<string, string>,
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page
      .getByRole("button", { name: "Set up later", exact: true })
      .click();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, folder);
    await page.getByRole("button", { name: "Workspaces", exact: true }).click();
    await page.getByRole("button", { name: "Add folder", exact: true }).click();
    await page
      .getByRole("button", { name: "Permissions for development-workspace" })
      .click();
    await page
      .getByRole("combobox", { name: "Folder access mode" })
      .selectOption("full");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    const token = await adminToken(data),
      state = await rpc<any>(data, token, "snapshot"),
      ws = state.workspaces[0];
    const call = (name: string, args: any) =>
      rpc<any>(data, token, "tool.call", {
        name,
        arguments: { workspaceId: ws.id, ...args },
      });
    const plan = await call("plan_create", {
      title: "Verify actual source",
      designBrief:
        "Keep the existing native interface readable and responsive.",
      tasks: [
        {
          key: "source",
          title: "Read current source",
          criteria: [
            { kind: "file_contains", path: "checked.ts", text: "ready = true" },
          ],
        },
      ],
    });
    await call("task_verify", {
      planId: plan.plan.id,
      taskId: plan.tasks[0].id,
    });
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await page
      .getByRole("button")
      .filter({ hasText: "Verify actual source" })
      .click();
    await expect(page.getByText("1 of 1 tasks verified")).toBeVisible();
    await expect(
      page.getByText("Read actual file and checked content/hash.", {
        exact: false,
      }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/development-plans.png" });
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, skillFolder);
    await page
      .getByRole("button", { name: "Import folder", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "ui-skill", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Inspect resources", exact: true })
      .click();
    await page.getByRole("button", { name: /SKILL\.md/ }).click();
    await expect(
      page.getByText("Review the current project before editing.", {
        exact: false,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("button", { name: "Enable", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Disable", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/development-skills.png" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByText("Project environment", { exact: true }).click();
    const panel = page.locator("details.development-panel");
    await panel
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption(ws.id);
    await panel
      .getByRole("textbox", { name: "Variable name", exact: true })
      .fill("LOCAL_TEST_VALUE");
    await panel
      .getByLabel("Value", { exact: true })
      .fill("ephemeral-ui-secret-64381");
    await panel
      .getByRole("button", { name: "Save encrypted value", exact: true })
      .click();
    await expect(
      panel.getByRole("button", {
        name: "LOCAL_TEST_VALUE · Configured",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await readFile(join(data, "workspace-environment.enc"))).includes(
        Buffer.from("ephemeral-ui-secret-64381"),
      ),
    ).toBe(false);
    await page.screenshot({ path: "test-results/development-environment.png" });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("opt-in background helper preserves an authorized job after Quit and releases ownership when disabled", async () => {
  test.skip(
    !!process.env.STUDIO_ELECTRON_EXE,
    "OS login registration is certified separately on clean machines.",
  );
  const root = await mkdtemp(join(tmpdir(), "rs-background-ui-")),
    data = join(root, "data"),
    folder = join(root, "workspace");
  await mkdir(folder);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STUDIO_TEST_LICENSE: "1",
    STUDIO_DATA_DIR: data,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const launch = async () => {
    app = await electron.launch({
      args: ["."],
      env: env as Record<string, string>,
    });
    return app.firstWindow();
  };
  let token = "",
    jobId = "";
  try {
    let page = await launch();
    await page
      .getByRole("button", { name: "Set up later", exact: true })
      .click();
    token = await adminToken(data);
    const [ws] = await rpc<any>(data, token, "workspace.add", {
      paths: [folder],
    });
    await rpc(data, token, "workspace.update", {
      id: ws.id,
      accessMode: "full",
    });
    await page.evaluate(() =>
      window.studio.setSettings({ backgroundService: true }),
    );
    const job = await rpc<any>(data, token, "tool.call", {
      name: "command_execute",
      arguments: {
        workspaceId: ws.id,
        executable: process.execPath,
        args: [
          "-e",
          "setInterval(()=>require('fs').appendFileSync('ticks.txt','x'),100)",
        ],
        persistent: true,
      },
    });
    jobId = job.id;
    await expect
      .poll(() => readFile(join(folder, "ticks.txt"), "utf8").catch(() => ""))
      .not.toBe("");
    await app!.close();
    app = undefined;
    const first = (await readFile(join(folder, "ticks.txt"), "utf8")).length;
    await expect
      .poll(
        async () => (await readFile(join(folder, "ticks.txt"), "utf8")).length,
      )
      .toBeGreaterThan(first);
    expect((await rpc<any>(data, token, "job.get", jobId)).status).toBe(
      "running",
    );
    page = await launch();
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.evaluate(() =>
      window.studio.setSettings({ backgroundService: false }),
    );
    await page.evaluate(
      (id) => window.studio.resolveJob({ id, decision: "cancel" }),
      jobId,
    );
    expect((await rpc<any>(data, token, "job.get", jobId)).status).toBe(
      "cancelled",
    );
    await app!.close();
    app = undefined;
    await expect
      .poll(() =>
        rpc(data, token, "snapshot")
          .then(() => true)
          .catch(() => false),
      )
      .toBe(false);
  } finally {
    if (token) {
      await rpc(data, token, "job.resolve", {
        id: jobId,
        decision: "cancel",
      }).catch(() => {});
    }
    await app?.close();
    // Signal only the temporary test helper, via its private authenticated pipe.
    if (token) {
      const { createConnection } = await import("node:net");
      await new Promise<void>((resolve) => {
        const s = createConnection(join(data, "background.sock"));
        s.on("connect", () =>
          s.end(
            JSON.stringify({ token, method: "shutdown", input: {} }) + "\n",
          ),
        );
        s.on("error", () => resolve());
        s.on("close", () => resolve());
        s.resume();
      });
    }
    await rm(root, { recursive: true, force: true });
  }
});
