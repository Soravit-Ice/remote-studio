import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("local folder recovery handles cancellation, restores Full Access and persists after relaunch", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-ui-recovery-"));
  const folder = join(root, "recovery-project");
  await mkdir(folder);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STUDIO_TEST_LICENSE: "1",
    STUDIO_DATA_DIR: join(root, "data"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () =>
    electron.launch({
      args: process.env.STUDIO_ELECTRON_EXE ? [] : ["."],
      executablePath: process.env.STUDIO_ELECTRON_EXE,
      cwd: process.env.STUDIO_ELECTRON_EXE ? root : undefined,
      env: env as Record<string, string>,
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Set up later", exact: true })
      .click();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, folder);
    await page.getByRole("button", { name: "Workspaces", exact: true }).click();
    await page.getByRole("button", { name: "Add folder", exact: true }).click();
    await page
      .getByRole("button", { name: "Permissions for recovery-project" })
      .click();
    await page
      .getByRole("combobox", { name: "Folder access mode" })
      .selectOption("full");
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.studio.snapshot()).workspaces[0]?.accessMode,
        ),
      )
      .toBe("full");
    const before = await page.evaluate(async () => {
      const ws = (await window.studio.snapshot()).workspaces[0];
      await window.studio.createConnection({
        name: "Saved client",
        workspaceIds: [ws.id],
        write: true,
        execute: true,
      });
      return (await window.studio.snapshot()).workspaces[0];
    });
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    const db = new DatabaseSync(join(root, "data", "studio.sqlite"));
    db.prepare(
      "UPDATE records SET data=json_set(data,'$.rootIdentity','0:0') WHERE kind='workspace' AND id=?",
    ).run(before.id);
    db.close();
    await page.reload();
    await page.getByRole("button", { name: "Workspaces", exact: true }).click();
    await expect(page.getByText("Folder needs re-authorization")).toBeVisible();
    await page
      .getByRole("button", { name: "Permissions for recovery-project" })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Folder access mode" }),
    ).toBeDisabled();
    await page.locator(".dialog-content").evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      );
    });
    await page.screenshot({
      path: "test-results/workspace-recovery-required.png",
    });
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await page
      .getByRole("button", { name: "Re-authorize folder", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Re-authorize folder", exact: true }),
    ).toBeEnabled();
    expect(
      (await page.evaluate(() => window.studio.snapshot())).workspaces[0]
        .rootIdentity,
    ).toBe("0:0");
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    }, before.path);
    await page
      .getByRole("button", { name: "Re-authorize folder", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Re-authorize folder", exact: true }),
    ).toBeEnabled();
    expect(
      (await page.evaluate(() => window.studio.snapshot())).workspaces[0]
        .rootIdentity,
    ).toBe("0:0");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await page
      .getByRole("button", { name: "Re-authorize folder", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Folder access mode" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("switch", { name: "Allow file writes" }),
    ).toBeChecked();
    await expect(
      page.getByRole("switch", { name: "Allow execution requests" }),
    ).toBeChecked();
    await page.screenshot({
      path: "test-results/workspace-recovery-restored.png",
    });
    const restored = (await page.evaluate(() => window.studio.snapshot()))
      .workspaces[0];
    expect(restored).toMatchObject({
      id: before.id,
      path: before.path,
      accessMode: "full",
      write: true,
      execute: true,
    });
    expect(restored.rootError).toBeUndefined();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Workspaces", exact: true }).click();
    const restarted = await page.evaluate(() => window.studio.snapshot());
    expect(restarted.workspaces[0]).toMatchObject(restored);
    expect(restarted.clients).toHaveLength(1);
    const write = await page.evaluate(async () => {
      const ws = (await window.studio.snapshot()).workspaces[0];
      return window.studio.proposeFile({
        workspaceId: ws.id,
        path: "after-restart.txt",
        content: "usable",
        expectedHash: null,
      });
    });
    expect(write.status).toBe("applied");
  } finally {
    await app.close();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  }
});
