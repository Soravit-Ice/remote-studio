import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  realpath,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { rootCertificates } from "node:tls";
import { randomUUID } from "node:crypto";
import { readSync, closeSync } from "node:fs";
// Runs only after the native policy has been installed. Workspace-controlled
// ancestors cannot redirect a privileged agent mkdir/write outside the scope.
const input = JSON.parse(process.argv[2]) as {
  executable: string;
  args: string[];
  root: string;
  additionalCA: string;
  waitForRelease?: boolean;
  scopeObserver?: string;
  scopeMarker?: string;
};
try {
  if (input.waitForRelease) {
    const release = Buffer.alloc(1);
    if (readSync(3, release, 0, 1, null) !== 1 || release[0] !== 1)
      throw new Error("Execution supervisor did not release the process.");
    if (input.scopeObserver) {
      const observer = spawn(
        input.scopeObserver,
        ["--scope-census", String(process.pid), input.scopeMarker!],
        { stdio: [4, 5, 2], env: process.env },
      );
      observer.unref();
      closeSync(4);
      closeSync(5);
      if (readSync(3, release, 0, 1, null) !== 1 || release.readUInt8(0) !== 2)
        throw new Error("Native ownership scope was not certified.");
    }
    closeSync(3);
  }
  if ((await realpath(input.root)) !== input.root)
    throw new Error("Workspace root changed during launch.");
  for (const name of [
    ".remote-studio",
    ".remote-studio/runtime",
    ".remote-studio/runtime/home",
    ".remote-studio/runtime/tmp",
    ".remote-studio/runtime/cache",
  ]) {
    const path = resolve(input.root, name);
    try {
      const st = await lstat(path);
      if (!st.isDirectory() || st.isSymbolicLink())
        throw new Error("Runtime directory must be a regular directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(path, { mode: 0o700 });
    }
  }
  const runtime = join(input.root, ".remote-studio", "runtime"),
    caPath = join(runtime, "ca.pem"),
    temp = caPath + "." + randomUUID();
  try {
    const st = await lstat(caPath);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink > 1)
      throw new Error("Public CA bundle must be a regular runtime file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await writeFile(
      temp,
      rootCertificates.join("\n") + "\n" + input.additionalCA,
      { mode: 0o600, flag: "wx" },
    );
    await rename(temp, caPath);
  } finally {
    await rm(temp, { force: true });
  }
  const child = spawn(input.executable, input.args, {
    cwd: process.cwd(),
    env: { ...process.env, NODE_EXTRA_CA_CERTS: caPath, SSL_CERT_FILE: caPath },
    shell: false,
    windowsHide: true,
    stdio: "inherit",
  });
  child.once("error", (error) => {
    console.error("Sandbox runtime:", error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 128 : 1);
  });
} catch (error) {
  console.error("Sandbox runtime:", (error as Error).message);
  process.exitCode = 1;
}
