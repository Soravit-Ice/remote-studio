import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { Security, type Actor } from "../../security/src/index";
import { descriptorPath } from "../../security/src/descriptor";

// Bound the opened descriptor as well as the pathname; never load a video into
// agent memory in one allocation. Recheck grants and file identity after reads.
export async function readVideoBytes(
  security: Security,
  workspaceId: string,
  path: string,
  actor: Actor,
  range?: { offset: number; length: number },
  maxBytes = 1024 ** 3,
) {
  const approved = await security.path(workspaceId, path, actor);
  const fd = await open(approved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat({ bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(maxBytes))
      throw new Error(
        "Output must be a regular, unlinked file within the size budget.",
      );
    const bound = async () => {
      const ws = security.workspace(workspaceId, actor);
      const opened = descriptorPath(fd.fd);
      await security.path(
        workspaceId,
        relative(ws.path, opened).split(sep).join("/"),
        actor,
      );
      const current = await security.path(workspaceId, path, actor);
      const now = await lstat(current, { bigint: true });
      if (
        opened !== current ||
        now.dev !== stat.dev ||
        now.ino !== stat.ino ||
        now.size !== stat.size ||
        now.mtimeNs !== stat.mtimeNs ||
        now.ctimeNs !== stat.ctimeNs
      )
        throw new Error("Output changed during read.");
    };
    await bound();
    const size = Number(stat.size);
    const identity = createHash("sha256")
      .update(
        [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":"),
      )
      .digest("hex");
    if (range && range.offset > size)
      throw new Error("Offset exceeds output size.");
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(
      range ? Math.min(range.length, size - range.offset) : 256 * 1024,
    );
    let offset = range?.offset ?? 0,
      read = 0;
    while (offset < size && (!range || read < buffer.length)) {
      const result = await fd.read(
        buffer,
        range ? read : 0,
        Math.min(range ? buffer.length - read : buffer.length, size - offset),
        offset,
      );
      if (!result.bytesRead) throw new Error("Output truncated during read.");
      if (!range) digest.update(buffer.subarray(0, result.bytesRead));
      offset += result.bytesRead;
      read += result.bytesRead;
    }
    const after = await fd.stat({ bigint: true });
    if (
      after.size !== stat.size ||
      after.mtimeNs !== stat.mtimeNs ||
      after.ctimeNs !== stat.ctimeNs
    )
      throw new Error("Output changed during read.");
    await bound();
    return {
      bytes: size,
      hash: range ? undefined : digest.digest("hex"),
      buffer: range ? buffer.subarray(0, read) : undefined,
      nextOffset: offset,
      identity,
    };
  } finally {
    await fd.close();
  }
}
