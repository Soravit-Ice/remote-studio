import {
  spawn,
  execFile,
  type ChildProcess,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { existsSync } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
const run = promisify(execFile);
let publicCA: Promise<string> | undefined;
function certificates() {
  publicCA ??= (async () => {
    let additional = "";
    if (process.platform === "darwin")
      additional = (
        await run(
          "/usr/bin/security",
          [
            "find-certificate",
            "-a",
            "-p",
            "/Library/Keychains/System.keychain",
          ],
          { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
        ).catch(() => ({ stdout: "" }))
      ).stdout;
    if (additional.includes("PRIVATE KEY"))
      throw new Error("Invalid public certificate store.");
    return additional;
  })();
  return publicCA;
}
import { trackSandbox } from "./recovery";
import type { Workspace } from "../../contracts/src/index";
import { workspaceRoot } from "../../shared/src/workspace-root";
import {
  nativeRuntimeDirectory,
  activeRuntimeRoots,
  runtimeIsBuilt,
} from "../../shared/src/native-runtime";

export const serviceDirectory = nativeRuntimeDirectory;
const helperPath = () => join(serviceDirectory(), "studio-sandbox.exe");
export function sandboxStatus() {
  if (process.platform === "darwin")
    return {
      available: existsSync("/usr/bin/sandbox-exec") && runtimeIsBuilt(),
      backend: "macOS Seatbelt",
      reason: "Native Seatbelt required; no unrestricted fallback.",
    };
  if (process.platform === "win32")
    return {
      available: existsSync(helperPath()),
      backend: "Windows LPAC + Job Objects",
      reason:
        "Native studio-sandbox.exe must be built and bundled; no unrestricted fallback.",
    };
  return {
    available: false,
    backend: "Unavailable",
    reason: "Workspace Full Access currently requires macOS or Windows.",
  };
}
const inside = (root: string, path: string) => {
  const r = relative(root, path);
  return !isAbsolute(r) && r !== ".." && !r.startsWith(".." + sep);
};
function executionPath() {
  const defaults =
    process.platform === "win32"
      ? [
          join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs"),
          join(process.env.APPDATA ?? "", "npm"),
          join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
        ]
      : [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
        ];
  return [
    ...new Set([
      ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
      ...defaults,
    ]),
  ].join(delimiter);
}
export async function resolveExecutable(executable: string) {
  if (executable.includes("\0")) throw new Error("Invalid executable.");
  const paths = isAbsolute(executable)
    ? [executable]
    : executionPath()
        .split(delimiter)
        .flatMap((p) =>
          process.platform === "win32"
            ? [
                join(p, executable),
                join(p, executable + ".exe"),
                join(p, executable + ".cmd"),
              ]
            : [join(p, executable)],
        );
  for (const p of paths)
    try {
      await access(p);
      return await realpath(p);
    } catch {
      /* Try next PATH entry. */
    }
  throw new Error("ENOENT: executable not installed: " + executable);
}
async function runtimeRoots() {
  const roots =
    process.platform === "win32"
      ? [
          process.env.SystemRoot,
          process.env.ProgramFiles,
          process.env["ProgramFiles(x86)"],
        ]
      : [
          "/System",
          "/bin",
          "/sbin",
          "/usr/bin",
          "/usr/sbin",
          "/usr/libexec",
          "/opt/homebrew/Cellar",
          "/opt/homebrew/opt",
          "/opt/homebrew/bin",
          "/opt/homebrew/lib",
          "/usr/local/bin",
          "/usr/local/lib",
          "/Library/Frameworks",
          "/Library/Developer/CommandLineTools/usr",
          "/Applications/Xcode.app/Contents/Developer/Toolchains",
          "/opt/homebrew/etc/openssl@3/openssl.cnf",
          "/opt/homebrew/etc/openssl@3/cert.pem",
          "/usr/local/etc/openssl@3/openssl.cnf",
          "/usr/local/etc/openssl@3/cert.pem",
        ];
  const enginePath = await realpath(process.execPath);
  roots.push(dirname(enginePath), serviceDirectory());
  if (process.versions.electron && process.platform === "darwin")
    roots.push(dirname(dirname(enginePath)));
  for (const name of [
    "node",
    "npm",
    "pnpm",
    "yarn",
    "python3",
    "python",
    "git",
  ]) {
    const p = await resolveExecutable(name).catch(() => null);
    if (!p) continue;
    const dir = dirname(p);
    roots.push(
      /[\\/]bin$/.test(dir) &&
        !["/usr/bin", "/bin", "/sbin", "/usr/sbin"].includes(dir)
        ? dirname(dir)
        : dir,
    );
  }
  return (
    await Promise.all(
      roots
        .filter((r): r is string => !!r)
        .map((r) => realpath(r).catch(() => null)),
    )
  ).filter((r): r is string => !!r);
}
export async function sandboxEnvironment(ws: Workspace) {
  const { path: root } = await workspaceRoot(ws);
  const runtime = join(root, ".remote-studio", "runtime");
  const env: NodeJS.ProcessEnv = {
    PATH: executionPath(),
    LANG: process.env.LANG ?? "en_US.UTF-8",
    NO_COLOR: "1",
    HOME: join(runtime, "home"),
    USERPROFILE: join(runtime, "home"),
    TMPDIR: join(runtime, "tmp"),
    TEMP: join(runtime, "tmp"),
    TMP: join(runtime, "tmp"),
    XDG_CACHE_HOME: join(runtime, "cache"),
    XDG_CONFIG_HOME: join(runtime, "home", ".config"),
    npm_config_cache: join(runtime, "cache", "npm"),
    PIP_CACHE_DIR: join(runtime, "cache", "pip"),
    PYTHONPYCACHEPREFIX: join(runtime, "cache", "python"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  };
  if (process.platform === "win32") {
    env.SystemRoot = process.env.SystemRoot;
    env.WINDIR = process.env.WINDIR;
    env.COMSPEC = process.env.COMSPEC;
    env.APPDATA = join(runtime, "home", "AppData", "Roaming");
    env.LOCALAPPDATA = join(runtime, "home", "AppData", "Local");
  }
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}
export async function spawnSandbox(
  ws: Workspace,
  privateRoot: string,
  executable: string,
  args: string[],
  cwd: string,
  extraEnvironment: Record<string, string> = {},
  variant: "command" | "browser" | "desktop" = "command",
  desktopBundleId?: string,
): Promise<ChildProcess> {
  if (!sandboxStatus().available) throw new Error(sandboxStatus().reason);
  const root = await realpath(ws.path),
    privatePath = await realpath(privateRoot),
    executablePath = await resolveExecutable(executable);
  if (root !== ws.path || !inside(root, await realpath(cwd)))
    throw new Error("Execution path escapes or workspace root changed.");
  if (inside(root, privatePath) || inside(privatePath, root))
    throw new Error(
      "Workspace cannot contain application credentials/state. Select a project folder.",
    );
  // LPAC's inherited workspace write ACE cannot provide a read-only overlay
  // for a runtime embedded inside that workspace. Fail before granting ACLs.
  if (
    process.platform === "win32" &&
    activeRuntimeRoots().some(
      (path) => inside(root, path) || inside(path, root),
    )
  )
    throw new Error(
      "Select a workspace outside the active Remote Studio/Node runtime on Windows.",
    );
  const roots = await runtimeRoots();
  if (
    !inside(root, executablePath) &&
    !roots.some((r) => inside(r, executablePath))
  )
    throw new Error(
      "Executable is outside authorized workspace and installed runtime roots.",
    );
  const env = { ...(await sandboxEnvironment(ws)), ...extraEnvironment };
  const launchId = randomUUID();
  const scopeMarker = "/private/tmp/rs-scope-" + launchId,
    scopeMarkers: { path: string; identity: string }[] = [];
  if (process.platform === "darwin")
    for (const path of [scopeMarker, scopeMarker + "-foreign"]) {
      const fs = await import("node:fs/promises");
      await fs.writeFile(path, "", { mode: 0o600, flag: "wx" });
      const stat = await fs.lstat(path);
      scopeMarkers.push({ path, identity: `${stat.dev}:${stat.ino}` });
    }
  let temporaryRoot: string | undefined, temporaryIdentity: string | undefined;
  if (variant === "desktop" && process.platform === "darwin") {
    temporaryRoot = "/private/tmp/rs-desktop-" + randomUUID();
    await (
      await import("node:fs/promises")
    ).mkdir(temporaryRoot, { mode: 0o700 });
    const stat = await (await import("node:fs/promises")).lstat(temporaryRoot);
    temporaryIdentity = `${stat.dev}:${stat.ino}`;
    env.TMPDIR = temporaryRoot;
    env.TEMP = temporaryRoot;
    env.TMP = temporaryRoot;
    // Chromium uses this instead of TMPDIR on macOS (file_util_apple.mm).
    env.MAC_CHROMIUM_TMPDIR = temporaryRoot;
  }
  const command = [
    join(serviceDirectory(), "sandbox-bootstrap.mjs"),
    JSON.stringify({
      executable: executablePath,
      args,
      root,
      additionalCA: await certificates(),
      waitForRelease: process.platform === "darwin",
      scopeObserver:
        process.platform === "darwin"
          ? join(serviceDirectory(), "studio-process-info")
          : undefined,
      scopeMarker,
    }),
  ];
  const options: SpawnOptionsWithoutStdio = {
    cwd,
    env,
    shell: false,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio:
      process.platform === "darwin"
        ? ["pipe", "pipe", "pipe", "pipe", "pipe", "pipe"]
        : ["pipe", "pipe", "pipe", "pipe"],
  };
  if (process.platform === "darwin") {
    const policyDir = existsSync(join(serviceDirectory(), "policies"))
      ? join(serviceDirectory(), "policies")
      : resolve("resources/sandbox");
    const base = await readFile(
      join(policyDir, "seatbelt_base_policy.sbpl"),
      "utf8",
    );
    const defaults = await readFile(
      join(policyDir, "seatbelt_read_only_platform_defaults.sbpl"),
      "utf8",
    );
    const params = [
      "-D",
      "WORKSPACE=" + root,
      "-D",
      "PRIVATE=" + (await realpath(privateRoot)),
      "-D",
      "SCOPE_MARKER=" + scopeMarker,
    ];
    if (temporaryRoot) params.push("-D", "DESKTOP_TEMP=" + temporaryRoot);
    const reads = roots
      .map((r, i) => {
        params.push("-D", `RUNTIME_${i}=${r}`);
        return `(subpath (param "RUNTIME_${i}"))`;
      })
      .join(" ");
    params.push("-D", "SEALED_RUNTIME=" + serviceDirectory());
    const sealed = activeRuntimeRoots()
      .map((path, i) => {
        params.push("-D", `SEALED_${i}=${path}`);
        return `(subpath (param "SEALED_${i}"))`;
      })
      .join(" ");
    const sealedParents = activeRuntimeRoots()
      .map((_path, i) => `(path-ancestors (param "SEALED_${i}"))`)
      .join(" ");
    const browser =
      variant === "browser" || variant === "desktop"
        ? `
(allow mach-lookup (global-name "com.apple.coreservices.launchservicesd") (global-name "com.apple.CoreServices.coreservicesd") (global-name "com.apple.windowserver.active") (global-name "com.apple.distributed_notifications@Uv3") (global-name "com.apple.SystemConfiguration.configd") (global-name "com.apple.SystemConfiguration.DNSConfiguration") (global-name "com.apple.FontObjectsServer"))
(allow mach-register mach-lookup (global-name-regex #"^(org\\.chromium\\.(Chromium|Electron)|com\\.github\\.Electron)\\.MachPortRendezvousServer\\.[0-9]+$"))
(allow sysctl-read (sysctl-name "kern.willshutdown") (sysctl-name "kern.memorystatus_vm_pressure_level") (sysctl-name "kern.iossupportversion") (sysctl-name "security.mac.lockdown_mode_state"))
(allow system-info (info-type "vfs.disk-space") (info-type "net.link.addr"))
(allow file-read* (literal "/private/var/run/resolv.conf") (subpath "/Library/Fonts"))
`
        : "";
    if (
      desktopBundleId &&
      !/^[A-Za-z0-9][A-Za-z0-9.-]{0,159}$/.test(desktopBundleId)
    )
      throw new Error("Invalid desktop bundle identity.");
    const desktopRendezvous =
      variant === "desktop" && desktopBundleId
        ? `\n(allow mach-register mach-lookup (global-name-regex #"^${desktopBundleId.replaceAll(".", "\\.")}\\.MachPortRendezvousServer\\.[0-9]+$"))\n`
        : "";
    const profile =
      base +
      browser +
      desktopRendezvous +
      "\n" +
      defaults +
      (temporaryRoot
        ? `\n(allow file-read* file-write* (subpath (param "DESKTOP_TEMP")))\n(allow file-read-metadata (path-ancestors (param "DESKTOP_TEMP")))\n(deny file-write-unlink (literal (param "DESKTOP_TEMP")))\n(allow network-bind network-inbound (local unix-socket (subpath (param "DESKTOP_TEMP"))))\n`
        : "") +
      `\n(allow file-read* file-map-executable (subpath (param "WORKSPACE")) ${reads})
(allow process-info-listpids)
(allow file-read* (literal (param "SCOPE_MARKER")))
(allow file-read-metadata (path-ancestors (param "SCOPE_MARKER")))
(allow file-write* (subpath (param "WORKSPACE")))
(deny file-write-unlink (literal (param "WORKSPACE")))
(deny file-read* (require-all (subpath (param "PRIVATE")) (require-not (subpath (param "SEALED_RUNTIME")))))
(deny file-write* (subpath (param "PRIVATE")) ${sealed})
(deny file-write-unlink ${sealedParents})
(allow network-outbound)
(allow network-bind network-inbound (local ip "localhost:*"))
`;
    const child = spawn(
      "/usr/bin/sandbox-exec",
      ["-p", profile, ...params, process.execPath, ...command],
      options,
    );
    child.on("error", () => {});
    try {
      await trackSandbox(child, privateRoot, {
        id: launchId,
        workspace: root,
        reads: roots,
        temporaryRoot,
        temporaryIdentity,
        scopeMarkers,
      });
      // Release only after ownership is durable and callers can attach listeners.
      setImmediate(() =>
        (child.stdio[3] as import("node:stream").Writable)?.write(
          Buffer.from([1]),
        ),
      );
    } catch (error) {
      if (child.pid)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Exited. */
        }
      throw error;
    }
    return child;
  }
  const child = spawn(
    helperPath(),
    [
      "--id",
      launchId,
      "--workspace",
      root,
      "--private",
      await realpath(privateRoot),
      ...roots.flatMap((r) => ["--read", r]),
      "--",
      process.execPath,
      ...command,
    ],
    options,
  );
  child.on("error", () => {});
  const release = child.stdio[3] as import("node:stream").Writable;
  release.on("error", () => {});
  try {
    await trackSandbox(child, privateRoot, {
      id: launchId,
      workspace: root,
      reads: roots,
      helper: helperPath(),
    });
    await new Promise<void>((res, rej) =>
      release.write(Buffer.from([1]), (error) => {
        if (error) rej(error);
        else {
          release.end();
          res();
        }
      }),
    );
  } catch (error) {
    release.destroy();
    child.kill();
    throw error;
  }
  return child;
}
export async function sandboxProbe(ws: Workspace, privateRoot: string) {
  const child = await spawnSandbox(
    ws,
    privateRoot,
    process.execPath,
    ["-e", "process.stdout.write('sandbox-ready')"],
    ws.path,
  );
  let out = "",
    error = "";
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    child.stdout!.on("data", (b) => (out += b.toString()));
    child.stderr!.on("data", (b) => (error += b.toString()));
    const code = await new Promise<number | null>((res, rej) => {
      child.once("error", rej);
      child.once("close", res);
    });
    if (code !== 0 || out !== "sandbox-ready")
      throw new Error(
        "Native sandbox failed: " +
          error.slice(-1000) +
          ". Check native helper/runtime permissions.",
      );
  } finally {
    clearTimeout(timer);
  }
}
export async function fileWorker<T>(
  ws: Workspace,
  privateRoot: string,
  request: unknown,
  sandboxed: boolean,
): Promise<T> {
  const worker = join(serviceDirectory(), "files-worker.mjs");
  const child = sandboxed
    ? await spawnSandbox(ws, privateRoot, process.execPath, [worker], ws.path)
    : spawn(process.execPath, [worker], {
        cwd: ws.path,
        env: {
          ...(await sandboxEnvironment(ws)),
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
  let out = "",
    err = "";
  child.stdout!.on("data", (b) => {
    out += b.toString();
    if (out.length > 48 * 1024 * 1024) child.kill();
  });
  child.stderr!.on("data", (b) => (err = (err + b.toString()).slice(-2000)));
  child.stdin!.end(JSON.stringify(request));
  const timer = setTimeout(() => child.kill(), 60000);
  try {
    const code = await new Promise<number | null>((res, rej) => {
      child.once("error", rej);
      child.once("close", res);
    });
    if (code !== 0) throw new Error("File worker failed: " + err);
    const response = JSON.parse(out);
    if (response.error) throw new Error(response.error);
    return response.data as T;
  } finally {
    clearTimeout(timer);
  }
}
