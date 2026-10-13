import { lstat, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { descriptorPath } from "./descriptor";
import {
  activeRuntimeRoots,
  nativeRuntimeDirectory,
} from "../../shared/src/native-runtime";
import type { Workspace, ClientGrant } from "../../contracts/src/index";
import type { Store } from "../../database/src/index";
import { sandboxStatus } from "../../terminal/src/sandbox";
import { workspaceRoot } from "../../shared/src/workspace-root";
export const hash = (content: string | Buffer) =>
  createHash("sha256").update(content).digest("hex");
export const sameSecret = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export interface Actor {
  id: string;
  ui: boolean;
  workspaceIds: string[] | null;
  write: boolean;
}
export class Security {
  constructor(
    readonly store: Store,
    readonly authorize: () => Promise<void> = async () => {},
  ) {
    nativeRuntimeDirectory();
  }
  effective(id: string, actor: Actor): Workspace {
    const ws = this.workspace(id, actor);
    const grant = actor.ui
      ? undefined
      : this.store.get<ClientGrant>("client", actor.id);
    const scoped = grant?.workspaceGrants?.find((g) => g.workspaceId === id);
    const clientWrite = actor.ui || (scoped?.write ?? grant?.write ?? false);
    const clientExecute =
      actor.ui || (scoped?.execute ?? grant?.execute ?? grant?.write ?? false);
    const clientMode = actor.ui
      ? ws.accessMode
      : (scoped?.accessMode ?? grant?.accessMode);
    const readOnly = ws.accessMode === "readOnly" || clientMode === "readOnly";
    const full = ws.accessMode === "full" && clientMode === "full";
    const write =
      !readOnly && ws.write && clientWrite && this.store.modules().Files;
    const execute =
      !readOnly &&
      ws.execute &&
      this.store.modules().Terminal &&
      clientExecute &&
      (!full || write);
    return {
      ...ws,
      write,
      execute,
      accessMode:
        readOnly || (!write && !execute)
          ? "readOnly"
          : full
            ? "full"
            : "reviewed",
      permissionReason:
        !clientWrite && ws.write
          ? "Connection is read only; enable file access in Connections."
          : full && !sandboxStatus().available
            ? sandboxStatus().reason
            : !this.store.modules().Files
              ? "Files module is disabled."
              : !this.store.modules().Terminal
                ? "Terminal module is disabled."
                : !ws.execute
                  ? "Execution is disabled for this folder."
                  : "",
    };
  }
  isFull(id: string, actor: Actor) {
    return this.effective(id, actor).accessMode === "full";
  }
  workspace(
    id: string,
    actor: Actor,
    permission: "read" | "write" | "execute" = "read",
  ): Workspace {
    const ws = this.store.get<Workspace>("workspace", id);
    if (!ws?.enabled)
      throw new Error("Workspace is unavailable or access has been revoked.");
    if (!actor.ui) {
      const grant = this.store.get<ClientGrant>("client", actor.id);
      if (!grant || grant.revoked) throw new Error("Client access revoked.");
      if (grant.workspaceIds && !grant.workspaceIds.includes(id))
        throw new Error("This client is not authorized for this workspace.");
      const scoped = grant.workspaceGrants?.find((g) => g.workspaceId === id);
      if (grant.workspaceGrants && !scoped)
        throw new Error("This client is not authorized for this workspace.");
      if (permission === "write" && !(scoped?.write ?? grant.write))
        throw new Error("Client is read only.");
      if (
        permission === "execute" &&
        !(scoped?.execute ?? grant.execute ?? grant.write)
      )
        throw new Error("Connection does not permit command execution.");
      if (
        permission !== "read" &&
        (scoped?.accessMode ?? grant.accessMode) === "readOnly"
      )
        throw new Error("Connection is read only.");
    }
    if (permission === "write" && !ws.write)
      throw new Error("Workspace is read only.");
    if (permission === "execute" && !ws.execute)
      throw new Error("Command execution requires a separate workspace grant.");
    if (permission !== "read" && ws.accessMode === "readOnly")
      throw new Error("Workspace is read only.");
    return ws;
  }
  async path(
    id: string,
    input: string,
    actor: Actor,
    permission: "read" | "write" | "execute" = "read",
    allowMissing = false,
  ) {
    if (permission !== "read") await this.authorize();
    const ws = this.workspace(id, actor, permission);
    if (
      permission === "write" &&
      activeRuntimeRoots().some((root) => {
        const value = relative(root, resolve(ws.path, input));
        return (
          value === "" ||
          (!value.startsWith(".." + sep) &&
            value !== ".." &&
            !isAbsolute(value))
        );
      })
    )
      throw new Error(
        "Active application and execution runtime files are protected. Build changes in the project source and restart explicitly to use a new runtime.",
      );
    if (
      input.includes("\0") ||
      isAbsolute(input) ||
      input.includes("\\") ||
      /^[a-zA-Z]:/.test(input)
    )
      throw new Error("Use a relative workspace path.");
    if (
      process.platform === "win32" &&
      (input.includes(":") ||
        input
          .split("/")
          .some(
            (p) =>
              p !== "." &&
              p !== ".." &&
              (/[ .]$/.test(p) ||
                /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)),
          ))
    )
      throw new Error(
        "Ambiguous Windows paths, devices and alternate streams are not allowed.",
      );
    const { path: root } = await workspaceRoot(ws);
    const target = resolve(root, input);
    const rel = relative(root, target);
    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
      throw new Error("Path escapes the authorized workspace.");
    const privateRoot = await realpath(this.store.directory);
    const privateRel = relative(privateRoot, target);
    if (
      privateRel === "" ||
      (privateRel !== ".." &&
        !privateRel.startsWith(".." + sep) &&
        !isAbsolute(privateRel))
    )
      throw new Error("Application credentials and state are protected.");
    if (
      rel.split(sep).some((value) => {
        const part = value.toLowerCase();
        return (
          [".git", ".env", ".ssh", ".aws", ".gnupg", ".remote-studio"].includes(
            part,
          ) || part.startsWith(".env.")
        );
      })
    )
      throw new Error("Protected files cannot be accessed through file tools.");
    let current = root;
    for (const part of rel.split(sep).filter(Boolean)) {
      current = resolve(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink())
          throw new Error("Symbolic links are not allowed.");
        if (stat.isFile() && stat.nlink > 1)
          throw new Error("Hard-linked files are not allowed.");
      } catch (error) {
        if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT")
          continue;
        throw error;
      }
    }
    return target;
  }
  async read(id: string, path: string, actor: Actor) {
    const file = await this.path(id, path, actor);
    const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await fd.stat();
      if (!stat.isFile()) throw new Error("Path is not a regular file.");
      if (stat.size > 2 * 1024 * 1024)
        throw new Error("Text file exceeds the 2 MiB limit.");
      const boundPath = async () => {
        // Resolve the open descriptor, not the pathname that an attacker can
        // redirect after the ancestor checks. Recheck grants before returning.
        {
          const opened = descriptorPath(fd.fd);
          const ws = this.workspace(id, actor);
          await this.path(
            id,
            relative(ws.path, opened).split(sep).join("/"),
            actor,
          );
          const approved = await this.path(id, path, actor);
          const now = await lstat(approved);
          const same =
            process.platform === "win32"
              ? opened.toLowerCase() === approved.toLowerCase()
              : opened === approved;
          if (!same || now.dev !== stat.dev || now.ino !== stat.ino)
            throw new Error(
              "File path changed during read. Retry with the current file.",
            );
        }
      };
      await boundPath();
      // readFile can grow without bound if another process appends. Allocate
      // at most the checked size plus one byte and reject concurrent changes.
      const buffer = Buffer.allocUnsafe(stat.size + 1);
      let size = 0;
      while (size < buffer.length) {
        const result = await fd.read(buffer, size, buffer.length - size, size);
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
        throw new Error(
          "File changed during read. Retry with the current file.",
        );
      const bytes = buffer.subarray(0, size);
      await boundPath();
      if (bytes.includes(0))
        throw new Error("Binary files are not supported by text tools.");
      return { content: bytes.toString("utf8"), hash: hash(bytes) };
    } finally {
      await fd.close();
    }
  }
}
