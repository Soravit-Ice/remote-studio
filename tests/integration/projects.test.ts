import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fixture, ui } from "../helpers";
const run = promisify(execFile);
const npmRun = (args: string[], cwd: string) =>
  process.platform === "win32"
    ? run(
        process.execPath,
        [
          join(
            dirname(process.execPath),
            "node_modules",
            "npm",
            "bin",
            "npm-cli.js",
          ),
          ...args,
        ],
        { cwd, timeout: 120000 },
      )
    : run("npm", args, { cwd, timeout: 120000 });
it("creates a real Vite React project, installs dependencies, and builds actual artifacts", async () => {
  const f = await fixture();
  try {
    const w = f.folders[0];
    await f.engine.request("workspace.update", { id: w.id, write: true }, ui);
    const created = await f.engine.request(
      "tool.call",
      {
        name: "project_create",
        arguments: { workspaceId: w.id, path: "my-app", name: "my-app" },
      },
      ui,
    );
    await f.engine.request(
      "change.resolve",
      { id: created.changeId, decision: "approve" },
      ui,
    );
    expect(created.files).toContain("src/main.tsx");
    const cwd = join(w.path, "my-app");
    await npmRun(
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      cwd,
    );
    await npmRun(["run", "build"], cwd).catch((error) => {
      throw new Error(String(error.stdout) + String(error.stderr));
    });
    expect((await stat(join(cwd, "dist", "index.html"))).size).toBeGreaterThan(
      0,
    );
    expect(await readFile(join(cwd, "dist", "index.html"), "utf8")).toContain(
      "/assets/",
    );
    await expect(
      f.engine.request(
        "tool.call",
        {
          name: "project_create",
          arguments: { workspaceId: w.id, path: "my-app", name: "my-app" },
        },
        ui,
      ),
    ).rejects.toThrow();
  } finally {
    await f.cleanup();
  }
}, 180000);
