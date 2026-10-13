import { createRequire } from "node:module";
import { readlinkSync } from "node:fs";
import { join } from "node:path";
import { nativeRuntimeDirectory } from "../../shared/src/native-runtime";
let native: { descriptorPath(fd: number): string } | undefined;
export function descriptorPath(fd: number) {
  if (process.platform === "darwin" || process.platform === "win32") {
    native ??= createRequire(import.meta.url)(
      join(nativeRuntimeDirectory(), "studio-files.node"),
    );
    return native!.descriptorPath(fd);
  }
  if (process.platform === "linux") return readlinkSync("/proc/self/fd/" + fd);
  throw new Error(
    "Open-file path verification is unavailable on this platform.",
  );
}
