import { createHash } from "node:crypto";
import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";

export async function videoRevision(
  root: string,
  authorize: (path: string) => Promise<unknown> = async () => {},
) {
  const digest = createHash("sha256");
  let count = 0;
  async function visit(directory: string, prefix: string) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        [
          "node_modules",
          "renders",
          "snapshots",
          ".git",
          ".hyperframes",
          ".remote-studio",
        ].includes(entry.name)
      )
        continue;
      if (++count > 10000)
        throw new Error(
          "Video project exceeds the 10000-entry revision budget.",
        );
      const path = prefix ? prefix + "/" + entry.name : entry.name;
      await authorize(path);
      const stat = await lstat(join(root, path), { bigint: true });
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1n))
        throw new Error("Video source links are not allowed: " + path);
      if (stat.isDirectory()) await visit(join(root, path), path);
      else if (stat.isFile())
        digest.update(
          JSON.stringify([
            path,
            String(stat.dev),
            String(stat.ino),
            String(stat.size),
            String(stat.mtimeNs),
            String(stat.ctimeNs),
          ]),
        );
      else
        throw new Error(
          "Video source must contain only regular files and directories.",
        );
    }
  }
  await visit(root, "");
  return digest.digest("hex");
}
