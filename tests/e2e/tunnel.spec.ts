import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  copyFile,
  chmod,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("ChatGPT settings encrypt the key, supervise the runtime, and restore on launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-chatgpt-ui-"));
  const folder = join(root, "authorized"),
    data = join(root, "data"),
    runtime = join(root, "tunnel-client");
  await mkdir(folder);
  await copyFile("tests/fixtures/tunnel-client.mjs", runtime);
  await chmod(runtime, 0o700);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STUDIO_TEST_LICENSE: "1",
    STUDIO_DATA_DIR: data,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () =>
    electron.launch({
      args: process.env.STUDIO_ELECTRON_EXE ? [] : ["."],
      executablePath: process.env.STUDIO_ELECTRON_EXE,
      env: env as Record<string, string>,
    });
  let app = await launch();
  let page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const key = "sk-ui-fixture-secret-never-a-real-key";
  try {
    await page
      .getByRole("button", { name: "Set up later", exact: true })
      .click();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, folder);
    await page.getByRole("button", { name: "Workspaces", exact: true }).click();
    await page.getByRole("button", { name: "Add folder", exact: true }).click();
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Set up ChatGPT Web", exact: true })
      .click();
    await app.evaluate(({ dialog }, runtime) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [runtime],
      });
    }, runtime);
    await page
      .getByRole("button", { name: "Choose executable", exact: true })
      .click();
    await expect(page.getByText(runtime, { exact: false })).toBeVisible();
    await page
      .getByLabel("Tunnel ID", { exact: false })
      .fill("tunnel_0123456789abcdef0123456789abcdef");
    await page.getByLabel("Runtime API key", { exact: false }).fill(key);
    await page
      .getByRole("checkbox", { name: "authorized", exact: false })
      .check();
    await page
      .getByRole("switch", { name: "Start tunnel when app opens", exact: true })
      .click();
    await page.screenshot({ path: "test-results/chatgpt-settings.png" });
    await page
      .getByRole("button", { name: "Save & start", exact: true })
      .click();
    await expect(
      page.getByText("Runtime ready", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/^\d+ tools · handshake verified locally$/),
    ).toBeVisible();
    await expect(
      page.getByText("ยังไม่พบหลักฐานการตอบกลับจาก OpenAI", { exact: false }),
    ).toBeVisible();
    const configText = await readFile(
      join(data, "chatgpt", "config.json"),
      "utf8",
    );
    expect(configText).not.toContain(key);
    const config = JSON.parse(configText);
    expect(
      (await readFile(join(data, "chatgpt", config.keyFile))).includes(
        Buffer.from(key),
      ),
    ).toBe(false);
    const status = await page.evaluate(() => window.studio.tunnelStatus());
    expect(status.workspaceIds).toHaveLength(1);
    expect(status.autoStart).toBe(true);
    expect(JSON.stringify(status)).not.toContain(key);
    expect(status.lastPollAt).toBeNull(); // The fixture cannot prove an OpenAI connection.
    await page.getByRole("button", { name: "Run checks", exact: true }).click();
    await page
      .locator(".tunnel-panel")
      .screenshot({ path: "test-results/chatgpt-runtime.png" });
    await page
      .getByRole("button", { name: "Stop tunnel", exact: true })
      .click();
    await expect(
      page.locator(".tunnel-panel").getByText("Stopped", { exact: true }),
    ).toBeVisible();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.studio.tunnelStatus())).phase,
      )
      .toBe("ready");
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit ChatGPT settings", exact: true })
      .click();
    await expect(
      page.getByLabel("Runtime API key", { exact: false }),
    ).toHaveValue("");
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Set up ChatGPT Web", exact: true }),
    ).toBeVisible();
    const snapshot = await page.evaluate(() => window.studio.snapshot());
    expect(
      snapshot.clients.find((c) => c.id === config.clientId)?.revoked,
    ).toBe(true);
    await expect(
      readFile(join(data, "chatgpt", "config.json")),
    ).rejects.toThrow();
    expect(errors).toEqual([]);
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
