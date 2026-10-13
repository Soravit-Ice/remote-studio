import { expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  readdir,
  writeFile,
  readFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { adminToken, rpc } from "../../packages/shared/src/rpc";
import { waitFor } from "../helpers";
it("restart terminates a birth-verified orphan process tree and never replays old work", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-recovery-")),
    directory = join(root, "data");
  await mkdir(join(root, "workspace"));
  let agent: ChildProcess | undefined;
  const token = await adminToken(directory),
    admin = (method: string, input?: unknown) =>
      rpc<any>(directory, token, method, input);
  const launch = async () => {
    agent = spawn(
      process.execPath,
      [
        resolve("dist/services/agent.mjs"),
        "--test-license",
        "--data",
        directory,
      ],
      { env: { ...process.env, STUDIO_DATA_DIR: directory }, stdio: "ignore" },
    );
    await waitFor(
      () => admin("snapshot").catch(() => null),
      (s) => !!s,
      10000,
    );
  };
  const stop = async (signal: NodeJS.Signals) => {
    if (!agent || agent.exitCode !== null || agent.signalCode !== null) return;
    const stopped = new Promise<void>((res) =>
      agent!.once("exit", () => res()),
    );
    agent.kill(signal);
    await stopped;
  };
  try {
    await launch();
    const [w] = await admin("workspace.add", {
      paths: [join(root, "workspace")],
    });
    await admin("workspace.update", { id: w.id, accessMode: "full" });
    const job = await admin("tool.call", {
      name: "command_execute",
      arguments: {
        workspaceId: w.id,
        executable: process.execPath,
        persistent: true,
        args: [
          "-e",
          "const fs=require('fs');fs.writeFileSync('starts.txt','one');setInterval(()=>fs.appendFileSync('ticks.txt','tick\\n'),100)",
        ],
      },
    });
    await waitFor(
      () => admin("job.get", job.id),
      (j) => j.pid && j.logs !== undefined,
    );
    await waitFor(
      () => readdir(join(directory, "owned-processes")),
      (files) => files.length > 0,
    );
    await waitFor(
      () => readFile(join(w.path, "ticks.txt"), "utf8").catch(() => ""),
      (s) => s.length > 0,
    );
    await stop("SIGKILL");
    // A stale arbitrary PID must never be killed on recovery.
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await writeFile(
      join(directory, "owned-processes", id + ".json"),
      JSON.stringify({
        id,
        pid: process.pid,
        identity: "different process birth",
        workspace: w.path,
        reads: [],
      }),
    );
    await launch();
    expect((await admin("job.get", job.id)).status).toBe("interrupted");
    const ticks = await readFile(join(w.path, "ticks.txt"), "utf8");
    await new Promise((res) => setTimeout(res, 400));
    expect(await readFile(join(w.path, "ticks.txt"), "utf8")).toBe(ticks);
    expect(await readFile(join(w.path, "starts.txt"), "utf8")).toBe("one");
    expect(await readdir(join(directory, "owned-processes"))).toHaveLength(0);
  } finally {
    await stop("SIGTERM");
    await rm(root, { recursive: true, force: true });
  }
});
