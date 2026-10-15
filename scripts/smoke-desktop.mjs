import { _electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = await mkdtemp(join(tmpdir(), "rs-startup-smoke-"));
const executableIndex = process.argv.indexOf("--executable");
const executablePath =
  executableIndex < 0 ? undefined : resolve(process.argv[executableIndex + 1]);
const env = { ...process.env, STUDIO_TEST_LICENSE: "1", STUDIO_DATA_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
let studio;
let agentPid;

try {
  studio = await _electron.launch({
    executablePath,
    args: executablePath ? [] : [resolve(".")],
    env,
    timeout: 20000,
  });
  const page = await studio.firstWindow({ timeout: 20000 });
  await expect(
    page.getByRole("button", { name: "Set up later", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Set up later", exact: true }).click();
  const homeTitle = executablePath
    ? "Activate to connect your assistant."
    : "Your computer, connected.";
  await expect(page.getByRole("heading", { name: homeTitle })).toBeVisible();
  const snapshot = await page.evaluate(() => window.studio.snapshot());
  agentPid = snapshot.agent.pid;
  if (
    !snapshot.agent.buildFingerprint ||
    snapshot.agent.buildFingerprint.length !== 64
  )
    throw new Error("The GUI did not reach the current built agent.");

  if (process.argv.includes("--recovery")) {
    await studio.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer(),
    );
    await expect
      .poll(
        () =>
          studio.evaluate(async ({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            if (
              !window ||
              window.webContents.isCrashed() ||
              window.webContents.isLoading()
            )
              return "loading";
            return window.webContents
              .executeJavaScript("document.body.innerText")
              .catch(() => "loading");
          }),
        { timeout: 15000 },
      )
      .toContain(homeTitle)
      .catch(async (error) => {
        console.error(
          await readFile(join(root, "desktop.log"), "utf8").catch(
            () => "No desktop events recorded.",
          ),
        );
        console.error(
          await studio.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().map((window) => ({
              url: window.webContents.getURL(),
              loading: window.webContents.isLoading(),
              rendererPid: window.webContents.getOSProcessId(),
            })),
          ),
        );
        console.error(
          await studio.evaluate(async ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]
              .webContents.executeJavaScript("document.body.innerText")
              .catch((error) => error.message),
          ),
        );
        throw error;
      });
    // This PID belongs to this disposable agent, not the user's normal app.
    process.kill(agentPid, "SIGKILL");
    const recovered = await studio.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
        "window.studio.snapshot()",
      ),
    );
    if (
      recovered.agent.pid === agentPid ||
      recovered.agent.buildFingerprint !== snapshot.agent.buildFingerprint
    )
      throw new Error("Agent recovery did not reconnect the same build.");
    agentPid = recovered.agent.pid;
  }

  await mkdir(resolve("test-results"), { recursive: true });
  const screenshot = await studio.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
      .toPNG()
      .toString("base64"),
  );
  await writeFile(
    resolve("test-results/remote-studio-startup.png"),
    Buffer.from(screenshot, "base64"),
  );
  console.log(
    "Remote Studio startup" +
      (process.argv.includes("--recovery")
        ? ", renderer recovery and agent recovery"
        : "") +
      " passed.",
  );
} finally {
  if (studio) await studio.close();
  if (agentPid) {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        process.kill(agentPid, 0);
      } catch {
        agentPid = undefined;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (agentPid) process.kill(agentPid, "SIGTERM");
  }
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}
