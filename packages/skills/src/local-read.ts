import { open, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { descriptorPath } from "../../security/src/descriptor";

// Native file picks are trusted authorization, but the selected content can
// still be hostile or changed by another process while it is being imported.
export async function readLocalBytes(
  path: string,
  limit: number,
  assertRoot: () => Promise<void>,
) {
  await assertRoot();
  const before = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > limit
  )
    throw new Error("Unsafe or oversized skill file.");
  const approved = await realpath(path);
  if (
    process.platform === "win32"
      ? approved.toLowerCase() !== path.toLowerCase()
      : approved !== path
  )
    throw new Error("Skill ancestor path changed during import.");
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    const bound = async () => {
      await assertRoot();
      const current = await lstat(path),
        opened = descriptorPath(fd.fd);
      const same =
        process.platform === "win32"
          ? opened.toLowerCase() === approved.toLowerCase()
          : opened === approved;
      if (
        !same ||
        current.isSymbolicLink() ||
        stat.dev !== before.dev ||
        stat.ino !== before.ino ||
        current.dev !== stat.dev ||
        current.ino !== stat.ino ||
        stat.nlink !== 1 ||
        stat.size !== before.size
      )
        throw new Error("Skill path changed during import.");
    };
    await bound();
    const bytes = Buffer.allocUnsafe(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await fd.read(bytes, size, bytes.length - size, size);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    const after = await fd.stat();
    if (
      size !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    )
      throw new Error("Skill file changed during import.");
    await bound();
    return bytes.subarray(0, size);
  } finally {
    await fd.close();
  }
}
