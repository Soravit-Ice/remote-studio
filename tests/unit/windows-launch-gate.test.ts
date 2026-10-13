import { it, expect } from "vitest";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { nativeRuntimeDirectory } from "../../packages/shared/src/native-runtime";
const run = promisify(execFile);

it.skipIf(process.platform !== "win32")(
  "identifies a held launcher and rejects a closed gate before any project code runs",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rs-win-gate-"));
    const workspace = join(root, "workspace"),
      data = join(root, "data");
    await mkdir(workspace);
    await mkdir(data);
    const helper = join(nativeRuntimeDirectory(), "studio-sandbox.exe");
    const child = spawn(
      helper,
      [
        "--id",
        randomUUID(),
        "--workspace",
        workspace,
        "--private",
        data,
        "--",
        process.execPath,
        "-e",
        "require('fs').writeFileSync('ran.txt','unexpected')",
      ],
      {
        cwd: workspace,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
    let error = "";
    child.stderr?.on("data", (chunk) => {
      error += chunk.toString();
    });
    const stopped = new Promise<number | null>((res, rej) => {
      child.once("close", res);
      child.once("error", rej);
    });
    try {
      const identity = await run(
        helper,
        ["--process-identity", String(child.pid)],
        { timeout: 5000 },
      );
      expect(identity.stdout.trim()).toMatch(/^[1-9]\d+$/);
      await new Promise((res) => setTimeout(res, 200));
      expect(child.exitCode).toBeNull();
      await expect(readFile(join(workspace, "ran.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      child.stdio[3]?.destroy();
      expect(await stopped).not.toBe(0);
      expect(error).toContain("Native launch authorization pipe closed");
      expect(
        (
          await run(helper, ["--process-identity", String(child.pid)])
        ).stdout.trim(),
      ).toBe("");
      await expect(readFile(join(workspace, "ran.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      child.stdio[3]?.destroy();
      if (child.exitCode === null) child.kill();
      await stopped.catch(() => {});
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    }
  },
);
