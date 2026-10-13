import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Security, type Actor } from "../../security/src/index";
export async function repositoryDirectory(
  security: Security,
  workspaceId: string,
  path: string,
  actor: Actor,
) {
  const cwd = await security.path(workspaceId, path, actor);
  const root = security.workspace(workspaceId, actor).path;
  let directory = cwd;
  while (true) {
    try {
      const metadata = await lstat(join(directory, ".git"));
      if (metadata.isSymbolicLink() || !metadata.isDirectory())
        throw new Error(
          "External Git metadata and linked worktrees are not supported in this preview.",
        );
      let scanned = 0;
      async function validate(dir: string) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (++scanned > 20000)
            throw new Error(
              "Git metadata exceeds safe inspection limit; use a native scoped command.",
            );
          const p = join(dir, entry.name),
            st = await lstat(p);
          if (st.isSymbolicLink() || (st.isFile() && st.nlink > 1))
            throw new Error("External Git metadata links are not permitted.");
          if (st.isDirectory()) await validate(p);
          else if (
            ["alternates", "http-alternates", "commondir", "gitdir"].includes(
              entry.name,
            ) &&
            (await readFile(p, "utf8")).trim()
          )
            throw new Error("External Git metadata is not permitted.");
        }
      }
      await validate(join(directory, ".git"));
      const config = await readFile(
        join(directory, ".git", "config"),
        "utf8",
      ).catch(() => "");
      if (/^\s*\[include(?:If)?(?:\s|\])/im.test(config))
        throw new Error(
          "Git config includes are not permitted; keep configuration inside this repository.",
        );
      return cwd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (directory === root) break;
    directory = dirname(directory);
  }
  throw new Error("No Git repository exists within this authorized workspace.");
}
