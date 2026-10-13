import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { reportSpawnedProcesses } from "../../shared/src/spawn-reporter";
reportSpawnedProcesses();
import type { ElectronApplication, Page } from "playwright-core";
import {
  pageAction,
  pageSnapshot,
  pageCheck,
  pageLocator,
  trackPage,
  type Diagnostic,
} from "../../browser/src/page";
const { _electron } = (await import(
  pathToFileURL(
    join(dirname(process.argv[1]), "vendor/playwright-core/index.mjs"),
  ).href
)) as typeof import("playwright-core");
let application: ElectronApplication | undefined;
const diagnostics: Diagnostic[] = [];
async function windowPage(input: any): Promise<Page> {
  if (!application) throw new Error("Desktop app is not open.");
  const page = application.windows()[input.window ?? 0];
  if (!page) throw new Error("Desktop window not found.");
  return page;
}
async function execute(input: any) {
  if (input.action === "launch") {
    await mkdir(input.userData, { recursive: true, mode: 0o700 });
    const env = {
      ...process.env,
      STUDIO_APP_USER_DATA: input.userData,
    } as Record<string, string>;
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({
      executablePath: input.executable,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        `--user-data-dir=${input.userData}`,
        ...(input.entry ? [input.entry] : []),
      ],
      cwd: input.cwd,
      env,
      timeout: 20000,
    });
    application.on("window", (p) => trackPage(p, diagnostics));
    const first = await application.firstWindow({ timeout: 15000 });
    await first.waitForLoadState("domcontentloaded");
    trackPage(first, diagnostics);
    return status();
  }
  if (input.action === "status") return status();
  if (input.action === "stop") {
    await application?.close();
    return { closed: true };
  }
  const page = await windowPage(input);
  if (input.action === "snapshot")
    return {
      ...(await pageSnapshot(page, diagnostics)),
      windows: await windows(),
    };
  if (input.action === "check") return pageCheck(page, diagnostics);
  if (input.action === "screenshot")
    return {
      base64: (
        await (input.selector || input.locator
          ? pageLocator(page, input).screenshot({ type: "png", timeout: 10000 })
          : page.screenshot({
              type: "png",
              animations: "disabled",
              timeout: 10000,
            }))
      ).toString("base64"),
      capture: {
        capturedAt: new Date().toISOString(),
        viewport: page.viewportSize() ?? undefined,
        selector: input.selector,
        window: input.window ?? 0,
      },
    };
  await pageAction(page, input);
  return {
    ...(await pageSnapshot(page, diagnostics)),
    windows: await windows(),
  };
}
async function windows() {
  return Promise.all(
    (application?.windows() ?? []).map(async (p, i) => ({
      index: i,
      title: await p.title().catch(() => ""),
      url: p.url(),
    })),
  );
}
async function status() {
  const process = application?.process();
  return {
    phase: process?.exitCode === null ? "running" : "exited",
    pid: process?.pid ?? null,
    exitCode: process?.exitCode ?? null,
    windows: await windows(),
    diagnostics: [...diagnostics],
  };
}
try {
  for await (const line of createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })) {
    const input = JSON.parse(line);
    try {
      process.stdout.write(
        JSON.stringify({ id: input.id, data: await execute(input) }) + "\n",
      );
    } catch (error) {
      process.stdout.write(
        JSON.stringify({ id: input.id, error: (error as Error).message }) +
          "\n",
      );
    }
    if (input.action === "stop") break;
  }
} finally {
  await application?.close().catch(() => {});
}
