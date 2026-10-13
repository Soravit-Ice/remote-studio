import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("desktop launches, authorizes three real folders, reviews files, and persists settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-ui-"));
  const folders = [0, 1, 2].map((i) => join(root, "folder-" + i));
  for (const path of folders) await mkdir(path);
  await writeFile(join(folders[0], "hello.txt"), "Original text");
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
  const rendererErrors: string[] = [];
  page.on("pageerror", (e) => rendererErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") rendererErrors.push(m.text());
  });
  try {
    await page
      .getByRole("button", { name: "Set up later", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your computer, connected." }),
    ).toBeVisible();
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: paths,
      });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, folders);
    await page.getByRole("button", { name: "Workspaces", exact: true }).click();
    await page.getByRole("button", { name: "Add folder", exact: true }).click();
    await expect(page.getByText("3 authorized folders")).toBeVisible();
    await page
      .getByRole("button", { name: "Permissions for folder-0" })
      .click();
    await page.getByRole("switch", { name: "Allow file writes" }).click();
    await page
      .getByRole("switch", { name: "Allow execution requests" })
      .click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByRole("button", { name: "Files in folder-0" }).click();
    await page
      .getByRole("textbox", { name: "Relative file path" })
      .fill("hello.txt");
    await page.getByRole("button", { name: "Read file", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "File content" }),
    ).toHaveValue("Original text");
    await page
      .getByRole("textbox", { name: "File content" })
      .fill("Reviewed replacement");
    await page.getByRole("button", { name: "Request change" }).click();
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await page
      .getByRole("button")
      .filter({ hasText: "Review file change" })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Approve change", exact: true })
      .click();
    await expect
      .poll(() => readFile(join(folders[0], "hello.txt"), "utf8"))
      .toBe("Reviewed replacement");
    await page
      .getByRole("button")
      .filter({ hasText: "File change" })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Undo change", exact: true })
      .click();
    await expect
      .poll(() => readFile(join(folders[0], "hello.txt"), "utf8"))
      .toBe("Original text");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "dark", exact: true }).click();
    await expect(page.locator("html")).toHaveClass("dark");
    await page.getByRole("button", { name: "light", exact: true }).click();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your workspace is ready." }),
    ).toBeVisible();
    const dismiss = page.getByRole("button", { name: "Dismiss message" });
    if (await dismiss.isVisible()) await dismiss.click();
    await page.screenshot({ path: "test-results/home.png" });
    expect(
      await page.evaluate(() => ({
        node: typeof (window as any).require,
        process: typeof (window as any).process,
        generic: typeof (window.studio as any).invoke,
      })),
    ).toEqual({
      node: "undefined",
      process: "undefined",
      generic: "undefined",
    });
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Set up", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Create connection", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Test bridge", exact: true })
      .click();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await expect(
      page.getByText("Handshake verified", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/connections.png" });
    // An approved process continues when the native main window is closed to tray.
    const trayJob = await page.evaluate(
      async ({ executable }) => {
        const snapshot = await window.studio.snapshot();
        const w = snapshot.workspaces.find((w) => w.execute)!;
        const job = await window.studio.runCommand({
          workspaceId: w.id,
          executable,
          args: [
            "-e",
            "setTimeout(()=>require('node:fs').writeFileSync('tray-result.txt','completed in background'),600)",
          ],
          cwd: ".",
          timeoutMs: 5000,
        });
        await window.studio.resolveJob({ id: job.id, decision: "approve" });
        return job.id;
      },
      { executable: process.execPath },
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    ).toBe(false);
    await expect
      .poll(() =>
        readFile(join(folders[0], "tray-result.txt"), "utf8").catch(() => null),
      )
      .toBe("completed in background");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].show(),
    );
    await expect
      .poll(
        async () =>
          (await page.evaluate((id) => window.studio.getJob(id), trayJob))
            .status,
      )
      .toBe("completed");
    // A second window loading the same app origin cannot use the privileged bridge.
    const spoofed = await app.evaluate(async ({ BrowserWindow, app }) => {
      const other = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          preload: app.getAppPath() + "/out/preload/index.cjs",
        },
      });
      await other.loadURL("studio://app/index.html");
      try {
        return await other.webContents.executeJavaScript(
          "window.studio.snapshot().then(()=> 'unexpected success', error=>error.message)",
        );
      } finally {
        other.destroy();
      }
    });
    expect(spoofed).toContain("Untrusted IPC sender");
  } catch (error) {
    await page.screenshot({ path: "test-results/failure.png" }).catch(() => {});
    console.log("Renderer errors:", rendererErrors);
    console.log(
      "Page content:",
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
    throw error;
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
