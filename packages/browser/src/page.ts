import type { Page } from "playwright-core";
import axe from "axe-core";
export interface Diagnostic {
  kind: "console" | "pageerror" | "requestfailed" | "http";
  message: string;
  at: string;
  severity: "error" | "warning" | "info";
}
const trackedPages = new WeakSet<Page>();
export function trackPage(page: Page, diagnostics: Diagnostic[]) {
  if (trackedPages.has(page)) return;
  trackedPages.add(page);
  const add = (
    kind: Diagnostic["kind"],
    message: string,
    severity: Diagnostic["severity"] = "error",
  ) => {
    diagnostics.push({
      kind,
      message: message.slice(0, 2000),
      at: new Date().toISOString(),
      severity,
    });
    if (diagnostics.length > 100) diagnostics.shift();
  };
  page.on("console", (m) =>
    add(
      "console",
      m.text(),
      m.type() === "error"
        ? "error"
        : m.type() === "warning"
          ? "warning"
          : "info",
    ),
  );
  page.on("pageerror", (e) => add("pageerror", e.message));
  page.on("requestfailed", (r) =>
    add("requestfailed", `${r.url()}: ${r.failure()?.errorText}`),
  );
  page.on("response", (r) => {
    if (r.status() >= 400) add("http", `${r.status()}: ${r.url()}`);
  });
}
export async function pageSnapshot(page: Page, diagnostics: Diagnostic[]) {
  return {
    url: page.url(),
    title: await page.title(),
    content: (await page.locator("body").ariaSnapshot({ timeout: 5000 })).slice(
      0,
      24000,
    ),
    logs: diagnostics.map((d) => `${d.kind}: ${d.message}`),
    diagnostics: [...diagnostics],
    viewport: page.viewportSize(),
  };
}
export function pageLocator(page: Page, input: any) {
  const l = input.locator;
  if (!l) return page.locator(input.selector ?? "body");
  if (l.by === "role")
    return page.getByRole(l.value, { name: l.name, exact: l.exact });
  if (l.by === "text") return page.getByText(l.value, { exact: l.exact });
  if (l.by === "testId") return page.getByTestId(l.value);
  return page.locator(l.value);
}
export async function pageAction(
  page: Page,
  input: any,
  allowedOrigin?: string,
) {
  const locator = pageLocator(page, input);
  switch (input.action) {
    case "click":
      await locator.click({ timeout: 5000 });
      break;
    case "fill":
      await locator.fill(input.value ?? "", { timeout: 5000 });
      break;
    case "press":
      await locator.press(input.value ?? "Enter", { timeout: 5000 });
      break;
    case "hover":
      await locator.hover({ timeout: 5000 });
      break;
    case "wait":
      await locator.waitFor({ state: "visible", timeout: 5000 });
      break;
    case "scroll":
      await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
      break;
    case "reload":
      await page.reload({ waitUntil: "domcontentloaded", timeout: 10000 });
      break;
    case "viewport":
      if (!input.width || !input.height)
        throw new Error("Viewport requires width and height.");
      await page.setViewportSize({ width: input.width, height: input.height });
      break;
    case "navigate": {
      if (!allowedOrigin)
        throw new Error("Native desktop navigation is not exposed.");
      const url = new URL(input.value ?? "/", allowedOrigin);
      if (url.origin !== allowedOrigin)
        throw new Error("Navigation must stay within the managed preview.");
      await page.goto(url.href, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });
      break;
    }
    default:
      throw new Error("Unknown page action.");
  }
}
export async function pageCheck(page: Page, diagnostics: Diagnostic[]) {
  await page.evaluate(axe.source);
  const accessibility = await page.evaluate(async () => {
    const result = await (window as any).axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
      },
    });
    return {
      violations: result.violations.map((v: any) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        helpUrl: v.helpUrl,
        nodes: v.nodes
          .slice(0, 20)
          .map((n: any) => ({ target: n.target, summary: n.failureSummary })),
      })),
      incomplete: result.incomplete.map((v: any) => ({
        id: v.id,
        impact: v.impact,
      })),
    };
  });
  const layout = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const overflow = [...document.querySelectorAll("body *")]
      .filter((e) => {
        const s = getComputedStyle(e),
          b = e.getBoundingClientRect();
        return (
          s.display !== "none" &&
          s.visibility !== "hidden" &&
          b.width > 0 &&
          (b.right > width + 1 || b.left < -1)
        );
      })
      .slice(0, 50)
      .map((e) => ({
        tag: e.tagName,
        id: e.id,
        bounds: {
          left: e.getBoundingClientRect().left,
          right: e.getBoundingClientRect().right,
        },
      }));
    const brokenImages = [...document.images]
      .filter((i) => i.complete && i.naturalWidth === 0)
      .map((i) => ({ src: i.getAttribute("src"), alt: i.alt }))
      .slice(0, 50);
    return {
      horizontalOverflow: document.documentElement.scrollWidth > width + 1,
      overflow,
      brokenImages,
    };
  });
  const keyboard: any[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    keyboard.push(
      await page.evaluate(() => {
        const e = document.activeElement;
        return e
          ? {
              tag: e.tagName,
              id: e.id,
              label:
                e.getAttribute("aria-label") ?? e.textContent?.slice(0, 80),
            }
          : null;
      }),
    );
  }
  return {
    passed:
      !layout.horizontalOverflow &&
      !layout.brokenImages.length &&
      !accessibility.violations.length &&
      !diagnostics.some((d) => d.severity === "error"),
    accessibility,
    layout,
    keyboard,
    diagnostics: [...diagnostics],
  };
}
