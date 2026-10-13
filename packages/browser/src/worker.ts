import type { Browser, Page } from "playwright-core";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { reportSpawnedProcesses } from "../../shared/src/spawn-reporter";
reportSpawnedProcesses();
const { chromium } = (await import(
  pathToFileURL(
    join(dirname(process.argv[1]), "vendor/playwright-core/index.mjs"),
  ).href
)) as typeof import("playwright-core");
import { createInterface } from "node:readline";
import {
  pageAction,
  pageSnapshot,
  pageCheck,
  pageLocator,
  trackPage,
  type Diagnostic,
} from "./page";
let browser: Browser | undefined, page: Page | undefined;
let origin: string | undefined;
const diagnostics: Diagnostic[] = [];
async function snapshot() {
  if (!page) throw new Error("Browser is not open.");
  return pageSnapshot(page, diagnostics);
}
async function execute(input: any) {
  if (input.action === "open") {
    const url = new URL(input.url);
    origin = url.origin;
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port)
      throw new Error("Only managed loopback previews are permitted.");
    // This worker and every descendant already inherit our native scope.
    // macOS prohibits a second Seatbelt initialization inside that scope.
    // There is no retry or launch outside the enforced native sandbox.
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: false,
      timeout: 15000,
      args: [
        "--disable-gpu",
        "--disable-background-networking",
        "--password-store=basic",
        "--use-mock-keychain",
      ],
    });
    const context = await browser.newContext({
      viewport: { width: input.width, height: input.height },
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      let target: URL;
      try {
        target = new URL(request.url());
      } catch {
        return route.abort();
      }
      const local =
        target.hostname === "localhost" ||
        target.hostname.endsWith(".localhost") ||
        /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(
          target.hostname,
        ) ||
        target.hostname.includes(":") ||
        !target.hostname.includes(".");
      if (
        !["http:", "https:"].includes(target.protocol) ||
        ((request.isNavigationRequest() || local) &&
          target.origin !== url.origin)
      )
        return route.abort();
      return route.continue();
    });
    page = await context.newPage();
    trackPage(page, diagnostics);
    await page.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });
    return { url: page.url(), title: await page.title() };
  }
  if (!page) throw new Error("Browser is not open.");
  if (input.action === "snapshot") return snapshot();
  if (input.action === "check") return pageCheck(page, diagnostics);
  if (input.action === "screenshot")
    return {
      base64: (
        await (input.selector || input.locator
          ? pageLocator(page, input).screenshot({ type: "png", timeout: 10000 })
          : page.screenshot({
              type: "png",
              fullPage: input.fullPage,
              clip: input.clip,
              animations: "disabled",
              scale: "css",
              timeout: 10000,
            }))
      ).toString("base64"),
      capture: {
        capturedAt: new Date().toISOString(),
        viewport: page.viewportSize() ?? undefined,
        fullPage: input.fullPage,
        clip: input.clip,
        selector:
          input.selector ??
          (input.locator ? JSON.stringify(input.locator) : undefined),
        sourceUrl: new URL(page.url()).origin + new URL(page.url()).pathname,
      },
    };
  if (input.action === "close") {
    await browser?.close();
    return { closed: true };
  }
  await pageAction(page, input, origin);
  return snapshot();
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
    } catch (e) {
      process.stdout.write(
        JSON.stringify({ id: input.id, error: (e as Error).message }) + "\n",
      );
    }
    if (input.action === "close") break;
  }
} finally {
  await browser?.close().catch(() => {});
}
