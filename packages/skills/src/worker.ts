import { readFileSync, lstatSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
const input = JSON.parse(process.argv[2]);
const hash = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
function file(root: string, path: string) {
  const target = resolve(root, path),
    rel = relative(root, target);
  if (
    rel === ".." ||
    rel.startsWith(".." + sep) ||
    path.includes("\\") ||
    path.includes(":")
  )
    throw new Error("Skill path escape.");
  let current = root;
  for (const p of rel.split(sep)) {
    current = join(current, p);
    const s = lstatSync(current);
    if (s.isSymbolicLink() || (s.isFile() && s.nlink > 1))
      throw new Error("Unsafe staged skill path.");
  }
  return target;
}
try {
  const stage = file(input.root, input.stage),
    manifestBytes = readFileSync(file(stage, ".manifest.json"));
  if (hash(manifestBytes) !== input.manifestHash)
    throw new Error("Approved skill manifest changed.");
  const manifest = JSON.parse(manifestBytes.toString());
  for (const f of manifest.files) {
    const bytes = readFileSync(file(stage, f.path));
    if (hash(bytes) !== f.hash)
      throw new Error("Approved skill content changed.");
  }
  if (!manifest.files.some((f: any) => f.path === input.script))
    throw new Error("Unapproved script.");
  const script = file(stage, input.script);
  let executable: string, args: string[];
  if (/\.[cm]?js$/.test(script)) {
    executable = process.execPath;
    args = [script, ...input.args];
  } else if (script.endsWith(".py")) {
    executable = process.platform === "win32" ? "python" : "python3";
    args = [script, ...input.args];
  } else if (script.endsWith(".sh")) {
    executable = "/bin/bash";
    args = ["--noprofile", "--norc", script, ...input.args];
  } else if (script.endsWith(".ps1") && process.platform === "win32") {
    executable = "powershell.exe";
    args = ["-NoProfile", "-NonInteractive", "-File", script, ...input.args];
  } else throw new Error("Unsupported script runtime.");
  const child = spawn(executable, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  child.once("error", (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
