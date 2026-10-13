import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Full Access UI applies files and runs a native command without another approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-ui-full-"));
  const folder = join(root, "full-workspace");
  await mkdir(folder);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STUDIO_TEST_LICENSE: "1",
    STUDIO_DATA_DIR: join(root, "data"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: process.env.STUDIO_ELECTRON_EXE ? [] : ["."],
    executablePath: process.env.STUDIO_ELECTRON_EXE,
    env: env as Record<string, string>,
  });
  const page = await app.firstWindow();
  try {
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
      .getByRole("button", { name: "Permissions for full-workspace" })
      .click();
    await page
      .getByRole("combobox", { name: "Folder access mode" })
      .selectOption("full");
    await expect
      .poll(async () => {
        const state = await page.evaluate(() => window.studio.snapshot());
        return state.workspaces[0]?.accessMode;
      })
      .toBe("full");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    const executable = process.env.STUDIO_ELECTRON_EXE ?? process.execPath;
    const result = await page.evaluate(
      async ({ executable }) => {
        const state = await window.studio.snapshot();
        const ws = state.workspaces[0];
        const change = await window.studio.proposeFile({
          workspaceId: ws.id,
          path: "created.txt",
          content: "Applied immediately",
          expectedHash: null,
        });
        const job = await window.studio.runCommand({
          workspaceId: ws.id,
          executable,
          args: ["-e", "console.log('native-ui-verified')"],
          cwd: ".",
          timeoutMs: 10000,
        });
        return { change, job };
      },
      { executable },
    );
    expect(result.change.status).toBe("applied");
    expect(result.job.status).not.toBe("awaiting_approval");
    await expect
      .poll(
        async () =>
          (await page.evaluate((id) => window.studio.getJob(id), result.job.id))
            .status,
      )
      .toBe("completed");
    const job = await page.evaluate(
      (id) => window.studio.getJob(id),
      result.job.id,
    );
    expect(job.exitCode).toBe(0);
    expect(job.logs).toContain("native-ui-verified");
    expect(await readFile(join(folder, "created.txt"), "utf8")).toBe(
      "Applied immediately",
    );
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.screenshot({ path: "test-results/full-access.png" });
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
