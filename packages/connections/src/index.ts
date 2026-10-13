import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  lstat,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
export interface BridgeEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}
export function configuration(entry: BridgeEntry, clientId: string) {
  return {
    clientId,
    json: JSON.stringify({ mcpServers: { "remote-studio": entry } }, null, 2),
    toml:
      "[mcp_servers.remote-studio]\ncommand = " +
      JSON.stringify(entry.command) +
      "\nargs = " +
      JSON.stringify(entry.args) +
      '\n\n[mcp_servers.remote-studio.env]\nELECTRON_RUN_AS_NODE = "1"\n',
  };
}
export function clientPath(client: "claude" | "cursor") {
  return client === "cursor"
    ? join(homedir(), ".cursor", "mcp.json")
    : process.platform === "darwin"
      ? join(
          homedir(),
          "Library",
          "Application Support",
          "Claude",
          "claude_desktop_config.json",
        )
      : join(
          process.env.APPDATA ?? homedir(),
          "Claude",
          "claude_desktop_config.json",
        );
}
export async function installConfig(path: string, entry: BridgeEntry) {
  let current: Record<string, any> = {};
  let backup: string | null = null;
  let original: string | null = null;
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new Error("Refusing to edit symbolic-link configuration.");
    original = await readFile(path, "utf8");
    current = z.record(z.string(), z.unknown()).parse(JSON.parse(original));
    if (current.mcpServers !== undefined)
      z.record(z.string(), z.unknown()).parse(current.mcpServers);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const previous = current.mcpServers?.["remote-studio"];
  const owned =
    previous?.command === entry.command &&
    Array.isArray(previous.args) &&
    previous.args.length === 3 &&
    entry.args.length === 3 &&
    previous.args[1] === "--credential" &&
    entry.args[1] === "--credential" &&
    previous.args[2] === entry.args[2] &&
    typeof previous.args[0] === "string" &&
    /[\\/]bridge\.mjs$/.test(previous.args[0]) &&
    previous.env?.ELECTRON_RUN_AS_NODE === "1";
  if (previous && JSON.stringify(previous) === JSON.stringify(entry))
    return { path, backup: null };
  if (previous && !owned)
    throw new Error(
      "A remote-studio entry already exists with a different runtime or credential. Remove or rename it in the client before installing a new connection.",
    );
  await mkdir(dirname(path), { recursive: true });
  if (original !== null) {
    backup =
      path + ".studio-backup-" + Date.now() + "-" + randomUUID() + ".json";
    await copyFile(path, backup);
  }
  const next = {
    ...current,
    mcpServers: { ...current.mcpServers, "remote-studio": entry },
  };
  const bytes = JSON.stringify(next, null, 2) + "\n";
  JSON.parse(bytes);
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, bytes, { mode: 0o600, flag: "wx" });
    let now: string | null = null;
    try {
      now = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (now !== original)
      throw new Error(
        "Client configuration changed. Try again after reviewing it.",
      );
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
  return { path, backup };
}
