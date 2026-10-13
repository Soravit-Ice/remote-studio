import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const run = promisify(execFile);
const require = createRequire(import.meta.url);
const report: {
  component: string;
  available: boolean;
  version?: string;
  error?: string;
}[] = [];
for (const [component, binary, args] of [
  ["Node", "node", ["--version"]],
  ["pnpm", "pnpm", ["--version"]],
  ["Git", "git", ["--version"]],
  ["FFmpeg (optional)", "ffmpeg", ["-version"]],
  ["FFprobe (optional)", "ffprobe", ["-version"]],
] as [string, string, string[]][]) {
  try {
    const { stdout } = await run(binary, args, { timeout: 5000 });
    report.push({ component, available: true, version: stdout.split("\n")[0] });
  } catch (error) {
    report.push({
      component,
      available: false,
      error: (error as Error).message,
    });
  }
}
try {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("SELECT 1");
  db.close();
  report.push({ component: "SQLite", available: true });
} catch (error) {
  report.push({ component: "SQLite", available: false, error: String(error) });
}
report.push(
  { component: "Electron runtime", available: existsSync(require("electron")) },
  {
    component: "Bundled agent",
    available: existsSync("dist/services/agent.mjs"),
  },
);
console.table(report);
if (report.some((r) => !r.available && !r.component.includes("optional")))
  process.exitCode = 1;
