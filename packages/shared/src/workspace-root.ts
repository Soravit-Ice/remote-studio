import { lstat, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { nativeRuntimeDirectory } from "./native-runtime";
import type { Workspace } from "../../contracts/src/index";

let native: { workspaceIdentity(fd: number): string } | undefined;
const changed = () =>
  new Error("Workspace root has changed. Re-authorize it locally.");

export async function workspaceRoot(
  ws: Pick<Workspace, "path" | "rootIdentity">,
) {
  const path = await realpath(ws.path);
  const info = await lstat(path, { bigint: true });
  if (path !== ws.path || !info.isDirectory()) throw changed();
  const legacy = `${info.dev}:${info.ino}`;
  let identity = `stat-v2:${legacy}:${info.birthtimeNs}`;
  if (process.platform === "darwin") {
    native ??= createRequire(import.meta.url)(
      join(nativeRuntimeDirectory(), "studio-files.node"),
    );
    const fd = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      identity = native!.workspaceIdentity(fd.fd);
      const opened = await fd.stat({ bigint: true });
      const now = await lstat(path, { bigint: true });
      if (
        opened.dev !== info.dev ||
        opened.ino !== info.ino ||
        now.dev !== opened.dev ||
        now.ino !== opened.ino ||
        now.birthtimeNs !== opened.birthtimeNs ||
        (await realpath(path)) !== path
      )
        throw changed();
    } finally {
      await fd.close();
    }
  }
  // Legacy grants may migrate only while their original dev:inode still
  // matches. A changed legacy mount requires one explicit local selection.
  if (
    ws.rootIdentity !== undefined &&
    ws.rootIdentity !== identity &&
    ws.rootIdentity !== legacy
  )
    throw changed();
  return { path, identity };
}
