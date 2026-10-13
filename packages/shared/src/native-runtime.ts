import {
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  mkdtempSync,
  realpathSync,
  lstatSync,
  rmSync,
  existsSync,
  renameSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";

const copies = new Map<string, string>();
const revisions = new Map<string, string>();

function fingerprint(source: string, name: string) {
  const digest = createHash("sha256");
  function visit(path: string, relative: string) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new Error("Active runtime files must not be symlinks.");
    if (
      relative.endsWith(".map") ||
      (name === "ui" && relative === "package.json")
    )
      return;
    digest.update(JSON.stringify([relative, stat.mode & 0o777]));
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort())
        visit(join(path, entry), relative ? relative + "/" + entry : entry);
    } else if (stat.isFile()) digest.update(readFileSync(path));
    else throw new Error("Active runtime contains an unsupported file type.");
  }
  visit(source, "");
  return digest.digest("hex");
}

function snapshot(source: string, name: string, ownerRoot?: string) {
  source = resolve(source);
  const key = source + "|" + (ownerRoot ?? "");
  const existing = copies.get(key);
  if (existing) return existing;
  source = realpathSync(source);
  const configuredParent = ownerRoot
    ? join(ownerRoot, "active-code")
    : tmpdir();
  mkdirSync(configuredParent, { recursive: true, mode: 0o700 });
  const parent = realpathSync(configuredParent);
  const revision = fingerprint(source, name);
  const retained = ownerRoot
    ? join(parent, "rs-trusted-" + name + "-" + revision)
    : undefined;
  if (retained && existsSync(retained)) {
    if (
      lstatSync(retained).isSymbolicLink() ||
      fingerprint(join(retained, name), name) !== revision
    )
      throw new Error("Retained execution runtime failed its integrity check.");
    const target = join(retained, name);
    copies.set(key, target);
    revisions.set(target, revision);
    return target;
  }
  const root = realpathSync(
    mkdtempSync(join(parent, "rs-trusted-" + name + "-")),
  );
  let target = join(root, name);
  try {
    cpSync(source, target, {
      recursive: true,
      dereference: false,
      filter: (path) => {
        if (lstatSync(path).isSymbolicLink())
          throw new Error("Active runtime files must not be symlinks.");
        return (
          !path.endsWith(".map") &&
          !(name === "ui" && path === join(source, "package.json"))
        );
      },
    });
    if (fingerprint(target, name) !== revision)
      throw new Error(
        "Runtime source changed while preparing execution. Build and restart again.",
      );
    if (retained) {
      try {
        renameSync(root, retained);
      } catch (error) {
        // Another owned GUI/helper may have prepared this exact revision.
        if (
          !existsSync(retained) ||
          lstatSync(retained).isSymbolicLink() ||
          fingerprint(join(retained, name), name) !== revision
        )
          throw error;
        rmSync(root, { recursive: true, force: true });
      }
      target = join(retained, name);
    } else {
      process.once("exit", () => {
        try {
          rmSync(root, { recursive: true, force: true });
        } catch {
          /* Crash leftovers can be recovered without changing the live runtime. */
        }
      });
    }
    copies.set(key, target);
    revisions.set(target, revision);
    return target;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function nativeSourceDirectory() {
  return process.argv[1]?.endsWith("agent.mjs")
    ? dirname(process.argv[1])
    : resolve("dist/services");
}
export function nativeRuntimeDirectory() {
  return snapshot(nativeSourceDirectory(), "services");
}
export function runtimeRevision(directory: string) {
  const revision = revisions.get(directory);
  if (!revision) throw new Error("Execution runtime has not been frozen.");
  return revision;
}
// Installed client configurations and the optional helper retain stable entry
// points. Reuse equal revisions; old versions stay available to existing configs.
export function frozenServices(source: string, ownerRoot: string) {
  return snapshot(source, "services", ownerRoot);
}
export function frozenUI(source: string, ownerRoot: string) {
  const target = snapshot(source, "ui", ownerRoot);
  writeFileSync(
    join(target, "package.json"),
    JSON.stringify({
      name: "remotestudio",
      version: "0.1.0",
      type: "module",
      main: "main/index.js",
    }),
    { mode: 0o600 },
  );
  return target;
}
export function activeRuntimeRoots() {
  return [
    ...copies.values(),
    ...(process.env.ELECTRON_RENDERER_URL ? [resolve("apps/desktop")] : []),
    process.platform === "darwin" && process.versions.electron
      ? dirname(dirname(process.execPath))
      : dirname(process.execPath),
  ];
}
export function runtimeIsBuilt() {
  return existsSync(join(nativeRuntimeDirectory(), "studio-files.node"));
}
