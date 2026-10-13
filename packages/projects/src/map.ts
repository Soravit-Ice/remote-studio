import { readdir, lstat } from "node:fs/promises";
import { posix, join } from "node:path";
import { createHash } from "node:crypto";
import { Security, type Actor } from "../../security/src/index";
const excluded = new Set([
  "node_modules",
  ".git",
  ".remote-studio",
  "dist",
  "out",
  "build",
  ".next",
  ".astro",
  "coverage",
  "test-results",
  "playwright-report",
  "release",
  "target",
  ".turbo",
  "remote-studio-skills",
]);
const source =
  /\.(?:[cm]?[jt]sx?|json|html|css|scss|astro|md|ya?ml|toml|rs|sql)$/i;
export interface ProjectEntry {
  path: string;
  hash: string;
  bytes: number;
  kind: "source" | "asset";
}
const sourceHashes = new WeakMap<
  Security,
  Map<string, { signature: string; hash: string; bytes: number }>
>();
export async function projectMap(
  security: Security,
  input: { workspaceId: string; path: string },
  actor: Actor,
  limit = 50000,
) {
  const root = await security.path(input.workspaceId, input.path, actor);
  const files: ProjectEntry[] = [];
  const omitted: string[] = [];
  let truncated = false,
    scanned = 0;
  let cache = sourceHashes.get(security);
  if (!cache) {
    cache = new Map();
    sourceHashes.set(security, cache);
  }
  async function visit(directory: string, relative: string) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++scanned > limit) {
        truncated = true;
        return;
      }
      const path = posix.join(relative, entry.name);
      if (
        excluded.has(entry.name) ||
        entry.name.startsWith(".env") ||
        entry.name.startsWith(".")
      )
        continue;
      if (entry.isSymbolicLink()) {
        omitted.push(path);
        continue;
      }
      await security.path(input.workspaceId, path, actor);
      if (entry.isDirectory()) await visit(join(directory, entry.name), path);
      else if (entry.isFile() && source.test(path)) {
        const key = input.workspaceId + ":" + path;
        try {
          // ctime and file identity detect replacements and edits that preserve
          // mtime. Grants and canonical paths are still checked on every scan.
          const stat = await lstat(join(directory, entry.name), {
            bigint: true,
          });
          if (!stat.isFile() || stat.isSymbolicLink())
            throw new Error("Source path changed during indexing.");
          const signature = [
            stat.dev,
            stat.ino,
            stat.nlink,
            stat.size,
            stat.mtimeNs,
            stat.ctimeNs,
          ].join(":");
          let cached = cache!.get(key);
          if (cached?.signature !== signature) {
            const read = await security.read(input.workspaceId, path, actor);
            cached = {
              signature,
              hash: read.hash,
              bytes: Buffer.byteLength(read.content),
            };
            cache!.set(key, cached);
          }
          files.push({
            path,
            hash: cached.hash,
            bytes: cached.bytes,
            kind: "source",
          });
          if (cache!.size > 10000) cache!.delete(cache!.keys().next().value!);
        } catch (error) {
          cache!.delete(key);
          omitted.push(path + ": " + (error as Error).message);
        }
      } else if (
        entry.isFile() &&
        /(?:^|\/)(?:src|public|assets|resources)\//.test(path) &&
        /\.(png|jpe?g|webp|svg|gif|woff2?|ico)$/i.test(path)
      ) {
        const stat = await lstat(join(directory, entry.name), { bigint: true });
        if (!stat.isFile() || stat.isSymbolicLink()) {
          omitted.push(path + ": asset changed during indexing");
          continue;
        }
        files.push({
          path,
          hash: createHash("sha256")
            .update(
              [
                stat.dev,
                stat.ino,
                stat.nlink,
                stat.size,
                stat.mtimeNs,
                stat.ctimeNs,
              ].join(":"),
            )
            .digest("hex"),
          bytes: Number(stat.size),
          kind: "asset",
        });
      }
      if (truncated) return;
    }
  }
  await visit(root, input.path === "." ? "" : input.path);
  security.workspace(input.workspaceId, actor);
  const revision = createHash("sha256")
    .update(JSON.stringify(files.map((f) => [f.path, f.hash])))
    .update(
      security.store.get<string>("environmentRevision", input.workspaceId) ??
        "",
    )
    .digest("hex");
  return {
    files,
    revision,
    truncated,
    omitted: omitted.slice(0, 100),
    complete: !truncated && !omitted.length,
    scanned,
  };
}
