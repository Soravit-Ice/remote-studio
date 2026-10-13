import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
type RuntimeProcess = { pid: number; command: string };
type Conflict = { pid: number; profile?: string };
function option(command: string, name: string) {
  const match = command.match(
    new RegExp(
      "(?:^|\\s)--" + name + "(?:=|\\s+)(?:\"([^\"]+)\"|'([^']+)'|([^\\s]+))",
    ),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}
// Inspect only public routing metadata. Never return command lines or keys.
export async function findTunnelConflict(
  tunnelId: string,
  processes: RuntimeProcess[],
  readProfile: (profile: string, directory?: string) => Promise<string>,
  ownPid?: number,
): Promise<Conflict | null> {
  for (const process of processes) {
    if (
      process.pid === ownPid ||
      !/(?:^|[\\/])tunnel-client(?:\.exe)?(?:\s|["'])/.test(process.command) ||
      !/(?:^|\s)run(?:\s|$)/.test(process.command)
    )
      continue;
    const direct = option(process.command, "control-plane\\.tunnel-id");
    if (direct === tunnelId) return { pid: process.pid };
    // An explicit command-line ID overrides a profile's routing configuration.
    if (direct) continue;
    const profile = option(process.command, "profile");
    if (!profile || !/^[a-zA-Z0-9_-]+$/.test(profile)) continue;
    const directory = option(process.command, "profile-dir");
    const contents = await readProfile(profile, directory).catch(() => "");
    const configured = contents.match(
      /^\s*tunnel_id\s*:\s*["']?(tunnel_[0-9a-f]{32})["']?\s*(?:#.*)?$/m,
    )?.[1];
    if (configured === tunnelId) return { pid: process.pid, profile };
  }
  return null;
}
export async function detectTunnelConflict(tunnelId: string, ownPid?: number) {
  let processes: RuntimeProcess[];
  if (process.platform === "win32") {
    const result = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "@(Get-CimInstance Win32_Process -Filter \"Name = 'tunnel-client.exe'\" | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress",
      ],
      { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    const parsed = JSON.parse(result.stdout.trim() || "[]");
    processes = (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({
      pid: Number(p.ProcessId),
      command: String(p.CommandLine ?? ""),
    }));
  } else {
    const result = await run("/bin/ps", ["-axo", "pid=,args="], {
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
    });
    processes = result.stdout.split("\n").flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      return match ? [{ pid: Number(match[1]), command: match[2]! }] : [];
    });
  }
  return findTunnelConflict(
    tunnelId,
    processes,
    async (profile, directory) => {
      const root = directory ?? join(homedir(), ".config", "tunnel-client");
      if (!isAbsolute(root)) return "";
      const path = join(root, profile + ".yaml");
      if ((await stat(path)).size > 1024 * 1024) return "";
      return readFile(path, "utf8");
    },
    ownPid,
  );
}
export function conflictMessage(conflict: Conflict) {
  return `Another tunnel-client runtime (PID ${conflict.pid}${conflict.profile ? ", profile " + conflict.profile : ""}) uses this tunnel ID. Stop that runtime or select a different tunnel ID, then Refresh tools and start a new ChatGPT chat. Remote Studio has not stopped the other program.`;
}
