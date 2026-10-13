import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  rename,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import type { Writable, Readable } from "node:stream";
import { nativeRuntimeDirectory } from "../../shared/src/native-runtime";
const run = promisify(execFile);
type Owned = { pid: number; identity: string };
export type ProcessInfo = Owned & { parent: number; group: number };
type Manifest = {
  version?: 2;
  pid: number;
  identity: string;
  workspace: string;
  id: string;
  reads: string[];
  helper?: string;
  owned?: Owned[];
  temporaryRoot?: string;
  temporaryIdentity?: string;
  scopeMarkers?: { path: string; identity: string }[];
};
const trackers = new WeakMap<
  ChildProcess,
  { add: (pid: number) => Promise<void>; stop: () => Promise<void> }
>();
async function processes(): Promise<ProcessInfo[]> {
  const helper = join(nativeRuntimeDirectory(), "studio-process-info");
  const { stdout } = await run(helper, [], {
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}
async function identity(pid: number) {
  if (process.platform === "darwin")
    return (await processes()).find((p) => p.pid === pid)?.identity ?? "";
  if (process.platform === "win32") {
    const { stdout } = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
      ],
      { timeout: 5000, windowsHide: true },
    );
    return stdout.trim();
  }
  throw new Error("Native process recovery is not supported on this platform.");
}
// Missing parents are never evidence of ownership. Match the recorded birth
// against the current parent before following an edge, including PID reuse.
export function ownedDescendants(current: ProcessInfo[], seeds: Owned[]) {
  const byPid = new Map(current.map((p) => [p.pid, p]));
  const owned = new Map(
    seeds
      .filter((p) => p.pid > 1 && p.identity)
      .map((p) => [p.pid, p.identity]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of current) {
      if (
        !owned.has(p.pid) &&
        owned.has(p.parent) &&
        byPid.get(p.parent)?.identity === owned.get(p.parent)
      ) {
        owned.set(p.pid, p.identity);
        changed = true;
      }
    }
  }
  return [...owned].map(([pid, identity]) => ({ pid, identity }));
}
async function cleanup(m: Manifest) {
  for (const marker of m.scopeMarkers ?? []) {
    if (
      !/^\/private\/tmp\/rs-scope-[a-f0-9-]{36}(?:-foreign)?$/.test(marker.path)
    )
      throw new Error("Invalid native scope marker.");
    const stat = await lstat(marker.path).catch(() => null);
    if (
      stat?.isFile() &&
      !stat.isSymbolicLink() &&
      `${stat.dev}:${stat.ino}` === marker.identity
    )
      await rm(marker.path);
  }
  if (m.helper)
    await run(
      m.helper,
      [
        "--cleanup",
        "--id",
        m.id,
        "--workspace",
        m.workspace,
        ...m.reads.flatMap((r) => ["--read", r]),
      ],
      { timeout: 30000, windowsHide: true },
    );
  if (m.temporaryRoot) {
    if (!/^\/private\/tmp\/rs-desktop-[a-f0-9-]{36}$/.test(m.temporaryRoot))
      throw new Error("Invalid owned temporary directory.");
    const stat = await lstat(m.temporaryRoot).catch(() => null);
    if (
      stat &&
      !stat.isSymbolicLink() &&
      `${stat.dev}:${stat.ino}` === m.temporaryIdentity
    )
      await rm(m.temporaryRoot, { recursive: true, force: true });
  }
}
async function terminate(m: Manifest) {
  if (process.platform === "win32") {
    if (m.pid > 1 && (await identity(m.pid).catch(() => "")) === m.identity)
      await new Promise<void>((res, rej) => {
        const child = spawn(
          "taskkill.exe",
          ["/PID", String(m.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        child.once("error", rej);
        child.once("close", (c) =>
          c === 0 ? res() : rej(new Error("Owned process cleanup failed.")),
        );
      });
    return;
  }
  // Only v2 records certify saved detached children. Older records may stop
  // their birth-verified root and its current descendants.
  let current = await processes();
  const owned = new Map(
    ownedDescendants(current, [
      { pid: m.pid, identity: m.identity },
      ...(m.version === 2 ? (m.owned ?? []) : []),
    ]).map((p) => [p.pid, p.identity]),
  );
  const signal = (kind: NodeJS.Signals) => {
    for (const p of current)
      if (p.pid !== process.pid && owned.get(p.pid) === p.identity)
        try {
          process.kill(p.pid, kind);
        } catch {
          /* Exited. */
        }
  };
  signal("SIGTERM");
  await new Promise((r) => setTimeout(r, 200));
  current = await processes();
  signal("SIGKILL");
}
async function reapScope(m: Manifest) {
  if (
    process.platform !== "darwin" ||
    m.version !== 2 ||
    m.scopeMarkers?.length !== 2
  )
    return false;
  const own = "/private/tmp/rs-scope-" + m.id;
  for (const expected of [own, own + "-foreign"]) {
    const marker = m.scopeMarkers.find((value) => value.path === expected);
    if (!marker) throw new Error("Invalid native ownership markers.");
    const stat = await lstat(marker.path).catch(() => null);
    if (!stat) return false;
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== 0 ||
      `${stat.dev}:${stat.ino}` !== marker.identity
    )
      throw new Error("Native ownership marker changed.");
  }
  await run(
    join(nativeRuntimeDirectory(), "studio-process-info"),
    ["--reap-scope", own],
    { timeout: 10000 },
  );
  return true;
}
export async function recordOwnedProcess(child: ChildProcess, pid: number) {
  if (Number.isSafeInteger(pid) && pid > 1) await trackers.get(child)?.add(pid);
}
export async function stopOwnedProcesses(child: ChildProcess) {
  const tracker = trackers.get(child);
  if (tracker) await tracker.stop();
  else if (child.pid && child.exitCode === null && child.signalCode === null)
    child.kill("SIGTERM");
}
export async function trackSandbox(
  child: ChildProcess,
  privateRoot: string,
  scope: Omit<Manifest, "pid" | "identity" | "version">,
) {
  if (!child.pid) throw new Error("Sandbox process could not start.");
  const folder = join(privateRoot, "owned-processes"),
    path = join(folder, scope.id + ".json");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const birth = await identity(child.pid);
  if (!birth) throw new Error("Cannot identify native process for recovery.");
  const manifest: Manifest = {
    ...scope,
    version: 2,
    pid: child.pid,
    identity: birth,
    owned: [],
  };
  await writeFile(path, JSON.stringify(manifest), { mode: 0o600, flag: "wx" });
  let queue = Promise.resolve(),
    ending = false,
    finished: Promise<void> | undefined;
  const sample = (pid?: number) => {
    if (ending || process.platform !== "darwin") return queue;
    queue = queue.then(async () => {
      const current = await processes();
      const next = ownedDescendants(current, [
        { pid: manifest.pid, identity: manifest.identity },
        ...(manifest.owned ?? []),
      ]);
      if (pid && !next.some((p) => p.pid === pid)) return;
      const children = next.filter((p) => p.pid !== manifest.pid);
      if (children.length === manifest.owned?.length) return;
      manifest.owned = children;
      const temp = path + ".tmp";
      await writeFile(temp, JSON.stringify(manifest), { mode: 0o600 });
      await rename(temp, path);
    });
    return queue;
  };
  let censusReady = false,
    stopped!: () => void,
    censusFailed!: () => void;
  const censusStop = new Promise<boolean>((resolve) => {
    stopped = () => resolve(true);
    censusFailed = () => {
      resolve(false);
      if (!ending) {
        (child.stdio[3] as Writable)?.end();
        child.emit(
          "error",
          new Error(
            "Native process scope observer failed. Project execution stopped.",
          ),
        );
        void stop().catch(() => {});
      }
    };
  });
  const censusInput = child.stdio[4] as Writable | undefined,
    censusOutput = (child.stdio as (Readable | Writable | null)[])[5] as
      Readable | undefined;
  if (censusOutput) {
    let buffer = "";
    censusOutput.setEncoding("utf8").on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) {
        censusFailed();
        return;
      }
      for (let at; (at = buffer.indexOf("\n")) >= 0;) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        try {
          const message = JSON.parse(line);
          if (message.type === "stopped") {
            stopped();
            continue;
          }
          if (ending) continue;
          if (
            message.type !== "scope" ||
            message.root !== manifest.pid ||
            !Array.isArray(message.processes)
          )
            throw new Error("Invalid native ownership proof.");
          const rows = message.processes as Owned[];
          if (
            rows.some(
              (p) =>
                !Number.isSafeInteger(p.pid) ||
                p.pid <= 1 ||
                p.pid === process.pid ||
                !p.identity,
            )
          )
            throw new Error("Invalid owned native process.");
          if (
            !censusReady &&
            !rows.some(
              (p) => p.pid === manifest.pid && p.identity === manifest.identity,
            )
          )
            throw new Error("Native root identity mismatch.");
          queue = queue.then(async () => {
            const saved = new Map(
              [
                ...(manifest.owned ?? []),
                ...rows.filter((p) => p.pid !== manifest.pid),
              ].map((p) => [p.pid, p]),
            );
            manifest.owned = [...saved.values()];
            const temp = path + ".tmp";
            await writeFile(temp, JSON.stringify(manifest), { mode: 0o600 });
            await rename(temp, path);
            if (!censusReady) {
              censusReady = true;
              (child.stdio[3] as Writable).end(Buffer.from([2]));
            }
          });
          void queue.catch(() => {
            censusFailed();
          });
        } catch {
          censusFailed();
        }
      }
    });
    censusOutput.once("end", censusFailed);
    censusInput?.on("error", () => {});
    child.stdio[3]?.on("error", () => {});
  }
  const timer =
    process.platform === "darwin" && !censusOutput
      ? setInterval(() => void sample().catch(() => {}), 250)
      : undefined;
  timer?.unref();
  const stop = () => {
    if (finished) return finished;
    const last = censusOutput ? queue : sample();
    ending = true;
    clearInterval(timer);
    finished = (async () => {
      try {
        await last;
        if (censusOutput) {
          if (!censusReady) (child.stdio[3] as Writable)?.end();
          censusInput?.end(Buffer.from([2]));
          let timeout: NodeJS.Timeout | undefined;
          const cleaned = await Promise.race([
            censusStop,
            new Promise<boolean>((res) => {
              timeout = setTimeout(() => res(false), 5000);
            }),
          ]);
          clearTimeout(timeout);
          if (!cleaned && !(censusReady && (await reapScope(manifest))))
            await terminate(manifest);
        } else await terminate(manifest);
        await cleanup(manifest);
        await rm(path, { force: true });
      } finally {
        trackers.delete(child);
      }
    })();
    return finished;
  };
  trackers.set(child, { add: sample, stop });
  child.once(
    "exit",
    () =>
      void stop().catch(() => {
        /* Retain metadata for recovery. */
      }),
  );
}
export async function recoverSandboxes(privateRoot: string) {
  const folder = join(privateRoot, "owned-processes"),
    errors: string[] = [];
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const path = join(folder, name);
    try {
      const m = JSON.parse(await readFile(path, "utf8")) as Manifest;
      if (
        m.id + ".json" !== name ||
        !Number.isSafeInteger(m.pid) ||
        m.pid <= 1 ||
        !m.identity ||
        !Array.isArray(m.reads)
      )
        throw new Error("Invalid owned-process manifest.");
      if (
        m.owned?.some(
          (p) => !Number.isSafeInteger(p.pid) || p.pid <= 1 || !p.identity,
        )
      )
        throw new Error("Invalid owned child identity.");
      if (!(await reapScope(m))) await terminate(m);
      await cleanup(m);
      await rm(path, { force: true });
    } catch (error) {
      errors.push(name + ": " + (error as Error).message);
    }
  }
  return errors;
}
