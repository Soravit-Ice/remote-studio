import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  copyFile,
  chmod,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

test("Gemini setup, local OAuth consent, scoped HTTP tool call, restart and removal", async () => {
  test.skip(
    process.platform === "win32",
    "POSIX cloudflared fixture; Windows certification remains separate.",
  );
  const root = await mkdtemp(join(tmpdir(), "rs-gemini-ui-")),
    data = join(root, "data"),
    folder = join(root, "gemini-authorized"),
    runtime = join(root, "cloudflared");
  await mkdir(folder);
  await copyFile("tests/fixtures/cloudflared.mjs", runtime);
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
  let app = await launch(),
    page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let client: Client | undefined;
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
      .getByRole("button", { name: "Set up Gemini Web", exact: true })
      .click();
    await app.evaluate(({ dialog }, runtime) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [runtime],
      });
    }, runtime);
    await page
      .getByRole("button", { name: "Choose cloudflared", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "gemini-authorized", exact: false })
      .check();
    await page
      .getByRole("switch", { name: "Start Gemini when app opens", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .screenshot({ path: "test-results/gemini-quick-settings.png" });
    await page
      .getByRole("button", { name: "Save & start", exact: true })
      .click();
    const panel = page.getByRole("region", { name: "Gemini Web connection" });
    await expect(
      panel.getByText("Tunnel connected", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Copy Gemini MCP URL" }),
    ).toBeVisible();
    const config = JSON.parse(
      await readFile(join(data, "gemini/config.json"), "utf8"),
    );
    expect(config.autoStart).toBe(true);
    expect(config.workspaceIds).toHaveLength(1);
    expect(config.workspaceGrants[0].accessMode).toBe("readOnly");
    const run = (await readdir(join(data, "gemini"))).find((name) =>
      name.startsWith("run-"),
    )!;
    const fixture = JSON.parse(
      await readFile(join(data, "gemini", run, "fixture.json"), "utf8"),
    );
    const base = fixture.localOrigin;
    const registration = await (
      await fetch(base + "/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Gemini UI fixture",
          redirect_uris: ["https://gemini.google.com/callback"],
          token_endpoint_auth_method: "none",
        }),
      })
    ).json();
    const verifier = "v".repeat(64),
      query = new URLSearchParams({
        client_id: registration.client_id,
        redirect_uri: "https://gemini.google.com/callback",
        response_type: "code",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        state: "ui-fixture",
      });
    const html = await (await fetch(base + "/oauth/authorize?" + query)).text();
    const decision = html.match(/url=([^"<]+)/)![1];
    await expect(
      panel.getByRole("button", { name: "Allow connection", exact: true }),
    ).toBeVisible();
    const pending = (await page.evaluate(() => window.studio.geminiStatus()))
      .pending[0];
    expect(html).toContain(pending.pairingCode);
    await panel.screenshot({ path: "test-results/gemini-consent.png" });
    await panel
      .getByRole("button", { name: "Allow connection", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Allow connection", exact: true }),
    ).toHaveCount(0);
    const redirect = await fetch(base + decision, { redirect: "manual" });
    const code = new URL(redirect.headers.get("location")!).searchParams.get(
      "code",
    )!;
    const tokens = await (
      await fetch(base + "/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: registration.client_id,
          redirect_uri: "https://gemini.google.com/callback",
          code,
          code_verifier: verifier,
        }),
      })
    ).json();
    client = new Client({ name: "Gemini UI fixture", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
        requestInit: {
          headers: { Authorization: "Bearer " + tokens.access_token },
        },
      }),
    );
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "file_write")).toBe(false);
    const result = await client.callTool({
      name: "workspace_list",
      arguments: {},
    });
    expect(
      (result.structuredContent as any).data.map((w: any) => w.id),
    ).toEqual(config.workspaceIds);
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.studio.geminiStatus())).lastToolAt,
      )
      .not.toBeNull();
    await panel.screenshot({ path: "test-results/gemini-connected.png" });
    await client.close();
    client = undefined;
    let backgroundBase: string | undefined;
    if (!process.env.STUDIO_ELECTRON_EXE) {
      await page.evaluate(() =>
        window.studio.setSettings({ backgroundService: true }),
      );
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.studio.geminiStatus())).phase,
        )
        .toBe("ready");
      const currentRun = (await readdir(join(data, "gemini"))).find((name) =>
        name.startsWith("run-"),
      )!;
      backgroundBase = JSON.parse(
        await readFile(
          join(data, "gemini", currentRun, "fixture.json"),
          "utf8",
        ),
      ).localOrigin;
    }
    await app.close();
    await expect(fetch(base + "/mcp")).rejects.toThrow();
    if (backgroundBase)
      expect((await fetch(backgroundBase + "/mcp")).status).toBe(401);
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
          (await page.evaluate(() => window.studio.geminiStatus())).phase,
      )
      .toBe("ready")
      .catch(async (error) => {
        const settings = (await page.evaluate(() => window.studio.snapshot()))
          .settings;
        const status = await page.evaluate(() => window.studio.geminiStatus());
        throw new Error(
          `${(error as Error).message} · ${JSON.stringify({ settings, status })}`,
        );
      });
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit Gemini settings", exact: true })
      .click();
    await page.getByLabel("Cloudflare tunnel type").selectOption("named");
    await page
      .getByLabel("Public HTTPS origin")
      .fill("https://studio.example.com");
    await page
      .getByRole("dialog")
      .screenshot({ path: "test-results/gemini-named-settings.png" });
    await page
      .getByRole("button", { name: "Remove Gemini", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Set up Gemini Web", exact: true }),
    ).toBeVisible();
    const snapshot = await page.evaluate(() => window.studio.snapshot());
    expect(
      snapshot.clients.find((c) => c.id === config.clientId)?.revoked,
    ).toBe(true);
    await expect(readFile(join(data, "gemini/config.json"))).rejects.toThrow();
    if (!process.env.STUDIO_ELECTRON_EXE)
      await page.evaluate(() =>
        window.studio.setSettings({ backgroundService: false }),
      );
    expect(errors).toEqual([]);
  } finally {
    await client?.close();
    if (!process.env.STUDIO_ELECTRON_EXE)
      await page
        .evaluate(() => window.studio.setSettings({ backgroundService: false }))
        .catch(() => {});
    await app.close();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  }
});
