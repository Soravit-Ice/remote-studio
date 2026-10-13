import { readdir, writeFile, rename, unlink, lstat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Change } from "../../contracts/src/index";
import { Security, hash, type Actor } from "../../security/src/index";
import { fileWorker } from "../../terminal/src/sandbox";
export type Tree =
  | {
      path: string;
      type: "file" | "directory";
      content?: string;
      mode: number;
    }[]
  | null;
export type FileEdit = { path: string; before: Tree; after: Tree };
export type Mutation = {
  operation: "write" | "delete" | "mkdir" | "copy" | "move";
  path: string;
  destination?: string;
  content?: string;
  encoding?: "utf8" | "base64";
  expectedHash?: string | null;
  recursive?: boolean;
  tree?: Exclude<Tree, null>;
};
export const proposeSchema = z.object({
  workspaceId: z.string().uuid(),
  path: z.string().min(1),
  content: z.string().max(2 * 1024 * 1024),
  expectedHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export class Files {
  private locks = new Map<string, Promise<unknown>>();
  constructor(
    readonly security: Security,
    readonly changed: () => void,
  ) {}
  async lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const before = this.locks.get(key) ?? Promise.resolve();
    const next = before.catch(() => {}).then(fn);
    this.locks.set(key, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }
  async list(
    input: { workspaceId: string; path: string; offset: number; limit: number },
    actor: Actor,
  ) {
    const path = await this.security.path(input.workspaceId, input.path, actor);
    const entries = (await readdir(path, { withFileTypes: true }))
      .filter(
        (e) =>
          ![
            ".git",
            ".env",
            ".ssh",
            ".aws",
            ".gnupg",
            ".remote-studio",
          ].includes(e.name) && !e.name.startsWith(".env."),
      )
      .sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name),
      );
    return {
      entries: entries
        .slice(input.offset, input.offset + input.limit)
        .map((e) => ({
          name: e.name,
          type: e.isSymbolicLink()
            ? "symlink"
            : e.isDirectory()
              ? "directory"
              : "file",
        })),
      total: entries.length,
    };
  }
  async search(
    input: {
      workspaceId: string;
      query: string;
      path: string;
      limit: number;
      content: boolean;
    },
    actor: Actor,
  ) {
    const root = await this.security.path(input.workspaceId, input.path, actor);
    const base = this.security.workspace(input.workspaceId, actor).path;
    const matches: {
      path: string;
      line: number | null;
      preview: string | null;
    }[] = [];
    let scanned = 0;
    let truncated = false;
    const visit = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (matches.length >= input.limit || scanned >= 5000) {
          truncated = true;
          return;
        }
        if (
          entry.isSymbolicLink() ||
          [
            "node_modules",
            ".git",
            "dist",
            ".env",
            ".ssh",
            ".aws",
            ".gnupg",
            ".remote-studio",
          ].includes(entry.name) ||
          entry.name.startsWith(".env.")
        )
          continue;
        const path = join(dir, entry.name);
        const rel = relative(base, path).split(sep).join("/");
        scanned++;
        if (entry.name.toLowerCase().includes(input.query.toLowerCase()))
          matches.push({ path: rel, line: null, preview: null });
        if (entry.isDirectory()) {
          try {
            await this.security.path(input.workspaceId, rel, actor);
          } catch {
            continue;
          }
          await visit(path);
        } else if (input.content && matches.length < input.limit) {
          try {
            const { content } = await this.security.read(
              input.workspaceId,
              rel,
              actor,
            );
            const lines = content.split("\n");
            for (
              let i = 0;
              i < lines.length && matches.length < input.limit;
              i++
            )
              if (lines[i].toLowerCase().includes(input.query.toLowerCase()))
                matches.push({
                  path: rel,
                  line: i + 1,
                  preview: lines[i].slice(0, 240),
                });
          } catch {
            /* Binary and oversized files are skipped. */
          }
        }
      }
    };
    await visit(root);
    return { matches, scanned, truncated };
  }
  async propose(raw: unknown, actor: Actor) {
    if (!this.security.store.modules().Files)
      throw new Error("Files module is disabled.");
    const input = proposeSchema.parse(raw);
    if (this.security.isFull(input.workspaceId, actor))
      return this.mutate(
        input.workspaceId,
        [{ ...input, operation: "write" }],
        actor,
      );
    return this.lock(input.workspaceId + input.path, async () => {
      await this.security.path(
        input.workspaceId,
        input.path,
        actor,
        "write",
        true,
      );
      let before: string | null = null,
        currentHash: string | null = null;
      try {
        const result = await this.security.read(
          input.workspaceId,
          input.path,
          actor,
        );
        before = result.content;
        currentHash = result.hash;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (currentHash !== input.expectedHash)
        throw new Error(
          "File conflict: read the current file and use its exact hash.",
        );
      const change: Change = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        path: input.path,
        before,
        after: input.content,
        expectedHash: currentHash,
        status: "pending",
        createdAt: new Date().toISOString(),
        clientId: actor.id,
      };
      this.security.store.put("change", change.id, change);
      this.security.store.audit(
        "file.review_requested",
        actor.id,
        input.workspaceId,
        input.path,
      );
      this.changed();
      return change;
    });
  }
  async atomic(
    change: Change,
    actor: Actor,
    content: string | null,
    expectedHash: string | null,
  ) {
    const target = await this.security.path(
      change.workspaceId,
      change.path,
      actor,
      "write",
      true,
    );
    let currentHash: string | null = null;
    let mode = 0o600;
    try {
      currentHash = (
        await this.security.read(change.workspaceId, change.path, actor)
      ).hash;
      mode = (await lstat(target)).mode & 0o777;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (currentHash !== expectedHash)
      throw new Error(
        "File changed since review. Refusing to overwrite newer changes.",
      );
    if (content === null) {
      await unlink(target);
      return;
    }
    const temp = join(dirname(target), ".studio-" + randomUUID());
    try {
      await writeFile(temp, content, { flag: "wx", mode });
      await this.security.path(
        change.workspaceId,
        change.path,
        actor,
        "write",
        true,
      );
      await rename(temp, target);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  async resolve(
    id: string,
    decision: "approve" | "reject" | "undo",
    actor: Actor,
  ) {
    if (!actor.ui)
      throw new Error("Only the trusted local interface can approve changes.");
    const original = this.security.store.get<Change>("change", id);
    if (!original) throw new Error("Change not found.");
    const checkpoint = this.security.store.get<FileEdit[]>(
      "fileCheckpoint",
      id,
    );
    if (checkpoint)
      return this.lock(original.workspaceId, async () => {
        const change = this.security.store.get<Change>("change", id)!;
        if (decision === "undo" && change.status !== "applied")
          throw new Error("This change cannot be undone.");
        if (decision !== "undo" && change.status !== "pending")
          throw new Error("Change already reviewed.");
        if (decision !== "reject") {
          const owner: Actor =
            decision === "undo"
              ? actor
              : {
                  ...actor,
                  id: change.clientId,
                  ui: change.clientId === "local-ui",
                };
          const ws = this.security.workspace(
            change.workspaceId,
            owner,
            "write",
          );
          const edits =
            decision === "undo"
              ? checkpoint.map((e) => ({
                  path: e.path,
                  before: e.after,
                  after: e.before,
                }))
              : checkpoint;
          await fileWorker(
            ws,
            this.security.store.directory,
            { action: "apply", edits },
            this.security.isFull(ws.id, owner),
          );
        }
        change.status =
          decision === "undo"
            ? "undone"
            : decision === "reject"
              ? "rejected"
              : "applied";
        this.security.store.put("change", id, change);
        this.security.store.audit(
          "file." + decision,
          actor.id,
          change.workspaceId,
          change.path,
        );
        this.changed();
        return change;
      });
    return this.lock(original.workspaceId + original.path, async () => {
      const change = this.security.store.get<Change>("change", id)!;
      if (decision === "undo") {
        if (change.status !== "applied")
          throw new Error("This change cannot be undone.");
        await this.atomic(change, actor, change.before, hash(change.after));
        change.status = "undone";
      } else {
        if (change.status !== "pending")
          throw new Error("Change has already been reviewed.");
        if (decision === "approve") {
          await this.atomic(
            change,
            {
              ...actor,
              id: change.clientId,
              ui: change.clientId === "local-ui",
            },
            change.after,
            change.expectedHash,
          );
          change.status = "applied";
        } else change.status = "rejected";
      }
      this.security.store.put("change", id, change);
      this.security.store.audit(
        "file." + decision,
        actor.id,
        change.workspaceId,
        change.path,
      );
      this.changed();
      return change;
    });
  }
  async restore(id: string, actor: Actor): Promise<Change> {
    const old = this.security.store.get<Change>("change", id);
    if (!old || old.clientId !== actor.id || old.status !== "applied")
      throw new Error("No restorable checkpoint for this client.");
    const checkpoint = this.security.store.get<FileEdit[]>(
      "fileCheckpoint",
      id,
    );
    if (!checkpoint) {
      if (old.before === null)
        return this.mutate(
          old.workspaceId,
          [
            {
              operation: "delete",
              path: old.path,
              expectedHash: hash(old.after),
            },
          ],
          actor,
        );
      return this.propose(
        {
          workspaceId: old.workspaceId,
          path: old.path,
          content: old.before,
          expectedHash: hash(old.after),
        },
        actor,
      );
    }
    return this.lock(old.workspaceId, async () => {
      const ws = this.security.workspace(old.workspaceId, actor, "write"),
        full = this.security.isFull(ws.id, actor);
      const edits = checkpoint.map((e) => ({
        path: e.path,
        before: e.after,
        after: e.before,
      }));
      const current = await fileWorker<Record<string, Tree>>(
        ws,
        this.security.store.directory,
        { action: "snapshot", paths: edits.map((e) => e.path) },
        full,
      );
      for (const edit of edits)
        if (JSON.stringify(current[edit.path]) !== JSON.stringify(edit.before))
          throw new Error("File conflict: newer changes prevent restore.");
      const change: Change = {
        ...old,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        before: old.after,
        after: old.before ?? "Restore checkpoint",
        status: "pending",
      };
      this.security.store.put("fileCheckpoint", change.id, edits);
      this.security.store.put("change", change.id, change);
      if (full) {
        await fileWorker(
          ws,
          this.security.store.directory,
          { action: "apply", edits },
          true,
        );
        change.status = "applied";
        this.security.store.put("change", change.id, change);
      }
      this.security.store.audit("file.restore", actor.id, ws.id, change.path);
      this.changed();
      return change;
    });
  }
  async mutate(
    workspaceId: string,
    operations: Mutation[],
    actor: Actor,
  ): Promise<Change> {
    if (!this.security.store.modules().Files)
      throw new Error("Files module is disabled.");
    return this.lock(workspaceId, async () => {
      const ws = this.security.workspace(workspaceId, actor, "write");
      const full = this.security.isFull(workspaceId, actor);
      const paths = operations.flatMap((o) =>
        o.destination ? [o.path, o.destination] : [o.path],
      );
      const normalized = paths.map((p) => {
        const path = join(ws.path, p);
        return process.platform === "win32" ? path.toLowerCase() : path;
      });
      if (
        new Set(normalized).size !== paths.length ||
        normalized.some((p, i) =>
          normalized.some((other, j) => i !== j && other.startsWith(p + sep)),
        )
      )
        throw new Error("Overlapping batch paths are not supported.");
      for (const p of paths) {
        const target = await this.security.path(
          workspaceId,
          p,
          actor,
          "write",
          true,
        );
        if (target === ws.path)
          throw new Error("Workspace root cannot be mutated.");
      }
      const before = await fileWorker<Record<string, Tree>>(
        ws,
        this.security.store.directory,
        { action: "snapshot", paths },
        full,
      );
      const edits: FileEdit[] = [];
      for (const op of operations) {
        const tree = before[op.path];
        if (op.expectedHash !== undefined) {
          const current =
            tree === null
              ? null
              : tree.length === 1 && tree[0].type === "file"
                ? hash(Buffer.from(tree[0].content!, "base64"))
                : "directory";
          if (current !== op.expectedHash)
            throw new Error(
              "File conflict: read the current file and use its exact hash.",
            );
        }
        if (op.operation === "write") {
          if (tree && tree[0].type !== "file")
            throw new Error("Cannot overwrite a directory with a file.");
          const bytes = Buffer.from(
            op.content ?? "",
            op.encoding === "base64" ? "base64" : "utf8",
          );
          if (bytes.length > 2 * 1024 * 1024)
            throw new Error("File exceeds 2 MiB tool limit.");
          edits.push({
            path: op.path,
            before: tree,
            after: [
              {
                path: "",
                type: "file",
                content: bytes.toString("base64"),
                mode: tree?.[0].mode ?? 0o600,
              },
            ],
          });
        } else if (op.operation === "mkdir") {
          if (tree) throw new Error("Directory already exists.");
          edits.push({
            path: op.path,
            before: null,
            after: op.tree ?? [{ path: "", type: "directory", mode: 0o700 }],
          });
        } else if (op.operation === "delete") {
          if (!tree) throw new Error("Path does not exist.");
          if (tree.length > 1 && !op.recursive)
            throw new Error(
              "Deleting a nonempty directory requires recursive=true.",
            );
          edits.push({ path: op.path, before: tree, after: null });
        } else {
          if (!tree || !op.destination)
            throw new Error(
              "Copy/move requires an existing source and destination.",
            );
          if (before[op.destination])
            throw new Error("Destination exists; no overwrite performed.");
          edits.push({ path: op.destination, before: null, after: tree });
          if (op.operation === "move")
            edits.push({ path: op.path, before: tree, after: null });
        }
      }
      const first = operations[0];
      const change: Change = {
        id: randomUUID(),
        workspaceId,
        path: first.path,
        destination: first.destination,
        operation: operations.length === 1 ? first.operation : "batch",
        encoding: first.encoding,
        before:
          before[first.path]?.length === 1 &&
          before[first.path]?.[0].type === "file"
            ? Buffer.from(before[first.path]![0].content!, "base64").toString(
                first.encoding === "base64" ? "base64" : "utf8",
              )
            : null,
        after:
          first.content ??
          JSON.stringify(
            operations.map((o) => ({
              operation: o.operation,
              path: o.path,
              destination: o.destination,
            })),
          ),
        expectedHash: first.expectedHash ?? null,
        status: "pending",
        clientId: actor.id,
        createdAt: new Date().toISOString(),
      };
      this.security.store.put("fileCheckpoint", change.id, edits);
      this.security.store.put("change", change.id, change);
      if (full) {
        await fileWorker(
          ws,
          this.security.store.directory,
          { action: "apply", edits },
          true,
        );
        change.status = "applied";
        this.security.store.put("change", change.id, change);
      }
      this.security.store.audit(
        full ? "file.applied" : "file.review_requested",
        actor.id,
        workspaceId,
        first.path,
      );
      this.changed();
      return change;
    });
  }
}
