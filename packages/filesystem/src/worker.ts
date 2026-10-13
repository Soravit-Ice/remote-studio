import {
  lstat,
  readdir,
  readFile,
  mkdir,
  writeFile,
  rename,
  rm,
  chmod,
  realpath,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
type Entry = {
  path: string;
  type: "file" | "directory";
  content?: string;
  mode: number;
};
type Tree = Entry[] | null;
const root = await realpath(process.cwd());
function scoped(input: string) {
  if (input.includes("\0") || input.includes("\\") || isAbsolute(input))
    throw new Error("Use relative paths.");
  if (
    process.platform === "win32" &&
    (input.includes(":") ||
      input
        .split("/")
        .some(
          (p) =>
            /[ .]$/.test(p) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
        ))
  )
    throw new Error("Ambiguous Windows path.");
  const path = resolve(root, input),
    rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Cannot mutate workspace root or outside scope.");
  if (
    rel
      .split(sep)
      .map((p) => p.toLowerCase())
      .some(
        (p) =>
          [".git", ".env", ".ssh", ".aws", ".gnupg", ".remote-studio"].includes(
            p,
          ) || p.startsWith(".env."),
      )
  )
    throw new Error("Protected path.");
  return path;
}
async function checkAncestors(path: string) {
  let p = root;
  for (const part of relative(root, path).split(sep)) {
    p = join(p, part);
    try {
      const st = await lstat(p);
      if (st.isSymbolicLink() || (st.isFile() && st.nlink > 1))
        throw new Error("Symbolic/reparse/hard links are not allowed.");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
}
async function snapshot(input: string): Promise<Tree> {
  const path = scoped(input);
  await checkAncestors(path);
  try {
    await lstat(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const entries: Entry[] = [];
  let bytes = 0;
  async function visit(p: string) {
    scoped(relative(root, p).split(sep).join("/"));
    await checkAncestors(p);
    const stat = await lstat(p),
      rel = relative(path, p).split(sep).join("/");
    if (entries.length >= 10000)
      throw new Error("Checkpoint exceeds 10000 entries.");
    if (stat.isDirectory()) {
      entries.push({ path: rel, type: "directory", mode: stat.mode & 0o777 });
      for (const name of (await readdir(p)).sort()) await visit(join(p, name));
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > 32 * 1024 * 1024)
        throw new Error(
          "Checkpoint exceeds 32 MiB; use a scoped command for larger operations.",
        );
      entries.push({
        path: rel,
        type: "file",
        content: (await readFile(p)).toString("base64"),
        mode: stat.mode & 0o777,
      });
    } else throw new Error("Only regular files/directories are supported.");
  }
  await visit(path);
  return entries;
}
const signature = (tree: Tree) =>
  createHash("sha256").update(JSON.stringify(tree)).digest("hex");
async function install(input: string, tree: Tree) {
  const target = scoped(input);
  await checkAncestors(target);
  if (!tree) {
    await rm(target, { recursive: true, force: true });
    return;
  }
  if (tree.length === 1 && tree[0].type === "file") {
    await mkdir(dirname(target), { recursive: true });
    await checkAncestors(target);
    const temp = join(dirname(target), ".studio-" + randomUUID());
    try {
      await writeFile(temp, Buffer.from(tree[0].content!, "base64"), {
        mode: tree[0].mode,
        flag: "wx",
      });
      await checkAncestors(target);
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true });
    }
    return;
  }
  // Stage a complete tree first. A failed write never leaves a partial tree.
  await mkdir(dirname(target), { recursive: true });
  await checkAncestors(target);
  const staging = join(dirname(target), ".studio-" + randomUUID()),
    backup = staging + "-before";
  let moved = false,
    installed = false;
  try {
    for (const entry of tree) {
      const p = join(staging, entry.path);
      scoped(relative(root, p).split(sep).join("/"));
      await checkAncestors(p);
      if (entry.type === "directory") {
        await mkdir(p, { recursive: true, mode: entry.mode });
        await chmod(p, entry.mode);
      } else {
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, Buffer.from(entry.content!, "base64"), {
          flag: "wx",
          mode: entry.mode,
        });
      }
    }
    await checkAncestors(target);
    try {
      await rename(target, backup);
      moved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, target);
      installed = true;
    } catch (error) {
      if (moved) {
        await rename(backup, target);
        moved = false;
      }
      throw error;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
    if (installed || !moved) await rm(backup, { recursive: true, force: true });
  }
}
try {
  let input = "";
  for await (const b of process.stdin) {
    input += b.toString();
    if (input.length > 48 * 1024 * 1024) throw new Error("Request too large.");
  }
  const request = JSON.parse(input);
  if (request.action === "snapshot") {
    const data: Record<string, Tree> = {};
    for (const path of request.paths as string[])
      data[path] = await snapshot(path);
    process.stdout.write(JSON.stringify({ data }));
  } else if (request.action === "apply") {
    const edits = request.edits as {
      path: string;
      before: Tree;
      after: Tree;
    }[];
    for (const e of edits)
      if (signature(await snapshot(e.path)) !== signature(e.before))
        throw new Error("File conflict: changed since checkpoint.");
    const applied: typeof edits = [];
    try {
      for (const e of edits) {
        await install(e.path, e.after);
        applied.push(e);
      }
    } catch (error) {
      for (const e of applied.reverse()) {
        if (signature(await snapshot(e.path)) === signature(e.after))
          await install(e.path, e.before);
      }
      throw error;
    }
    process.stdout.write(JSON.stringify({ data: { applied: true } }));
  } else throw new Error("Unknown file operation.");
} catch (error) {
  process.stdout.write(JSON.stringify({ error: (error as Error).message }));
}
