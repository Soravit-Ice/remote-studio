import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Store } from "../../packages/database/src/index";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("real SDK initializes encrypted storage and unactivated source/package blocks writes while retaining setup", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-license-ui-"));
  // Simulate a credential retained from 0.2.2 before activation was required for reads.
  const data = join(root, "data"),
    clientId = randomUUID(),
    token = randomBytes(32).toString("hex");
  const store = new Store(data);
  store.put("client", clientId, {
    id: clientId,
    name: "legacy",
    workspaceIds: [],
    write: false,
    revoked: false,
    lastSeen: null,
    tokenHash: createHash("sha256").update(token).digest("hex"),
  });
  store.close();
  await mkdir(join(data, "clients"), { recursive: true });
  const credential = join(data, "clients", clientId + ".json");
  await writeFile(
    credential,
    JSON.stringify({ id: clientId, token, directory: data }),
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STUDIO_DATA_DIR: join(root, "data"),
    STUDIO_TEST_LICENSE: "1",
  };
  // A packaged binary must ignore this fixture flag. Source must be checked without it.
  if (!process.env.STUDIO_ELECTRON_EXE) delete env.STUDIO_TEST_LICENSE;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.STUDIO_ELECTRON_EXE,
    args: process.env.STUDIO_ELECTRON_EXE ? [] : ["."],
    env: env as Record<string, string>,
    cwd: process.env.STUDIO_ELECTRON_EXE ? root : undefined,
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Set up later", exact: true })
      .click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByText("Activation required", { exact: true }),
    ).toBeVisible();
    const snapshot = await page.evaluate(() => window.studio.snapshot());
    const packageVersion = await app.evaluate(({ app }) => app.getVersion());
    expect(snapshot.version).toBe(packageVersion);
    const status = await page.evaluate(() => window.studio.licenseStatus());
    expect(status).toMatchObject({
      configured: true,
      valid: false,
      signedIn: false,
      activated: false,
    });
    await expect(
      page.getByRole("img", { name: "Remote Studio", exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/license-settings.png" });
    const denied = await page.evaluate(async () => {
      try {
        await window.studio.createConnection({
          name: "unactivated",
          workspaceIds: [],
          write: false,
        });
        return "unexpected success";
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(denied).toMatch(/Activate your Remote Studio purchase/);
    const client = new Client({ name: "unactivated-regression", version: "1" });
    const runtime = await app.evaluate(() => process.execPath);
    const transport = new StdioClientTransport({
      command: runtime,
      args: [
        join(snapshot.agent.runtimeDirectory!, "bridge.mjs"),
        "--credential",
        credential,
      ],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      stderr: "pipe",
    });
    try {
      await expect(client.connect(transport)).rejects.toThrow();
    } finally {
      await client.close();
    }
    expect(
      (await page.evaluate(() => window.studio.snapshot())).clients,
    ).toHaveLength(1);

    const folder = join(root, "project");
    await mkdir(folder);
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, folder);
    const ws = await page.evaluate(
      async () => (await window.studio.addFolders())[0],
    );
    await page.evaluate(
      async (id) => window.studio.updateWorkspace({ id, accessMode: "full" }),
      ws.id,
    );
    const result = await page.evaluate(async (workspaceId) => {
      try {
        await window.studio.proposeFile({
          workspaceId,
          path: "must-not-write.txt",
          content: "denied",
          expectedHash: null,
        });
        return "unexpected success";
      } catch (error) {
        return (error as Error).message;
      }
    }, ws.id);
    expect(result).toMatch(/Activate your Remote Studio purchase/);
    const bytes = await readFile(join(root, "data", "license-sdk.enc"), "utf8");
    expect(bytes).not.toContain('"productCode"');
    expect(bytes).not.toContain("PRIVATE KEY");
    expect(
      (await page.evaluate(() => window.studio.snapshot())).changes,
    ).toHaveLength(0);
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
