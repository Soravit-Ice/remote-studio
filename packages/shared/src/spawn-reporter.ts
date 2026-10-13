import { createRequire, syncBuiltinESMExports } from "node:module";
export function reportSpawnedProcesses() {
  const cp = createRequire(import.meta.url)("node:child_process"),
    original = cp.spawn;
  cp.spawn = function (...args: any[]) {
    const child = original(...args);
    if (child.pid)
      process.stdout.write(
        JSON.stringify({ type: "spawned", pid: child.pid }) + "\n",
      );
    return child;
  };
  syncBuiltinESMExports();
}
