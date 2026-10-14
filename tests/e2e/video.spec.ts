import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Video module exposes nine real tools and native enable/disable controls", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-video-ui-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STUDIO_TEST_LICENSE: "1",
    STUDIO_DATA_DIR: join(root, "data"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ["."],
    env: env as Record<string, string>,
  });
  const page = await app.firstWindow(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page
      .getByRole("button", { name: "Set up later", exact: true })
      .click();
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("textbox", { name: "Search tools" }).fill("Video");
    await expect(page.getByText("9 tools", { exact: true })).toBeVisible();
    const toggle = page.getByRole("switch", { name: "Enable Video module" });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.screenshot({ path: "test-results/video-tools.png" });
    await page.getByRole("button", { name: /All tools/ }).click();
    await page.getByRole("textbox", { name: "Search tools" }).fill("video_");
    await expect(page.locator(".tools-list > button")).toHaveCount(9);
    await page.getByRole("button", { name: /^video_render / }).click();
    await expect(
      page.getByRole("heading", { name: "video_render", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});
