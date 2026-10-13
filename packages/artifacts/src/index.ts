import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { Security, hash, type Actor } from "../../security/src/index";
import type { Artifact } from "../../contracts/src/index";
import { executionContext } from "../../shared/src/execution-context";
export class Artifacts {
  constructor(readonly security: Security) {}
  get(id: string, actor: Actor): Artifact {
    const a = this.security.store.developmentRecord<Artifact>("artifacts", id);
    if (!a || (!actor.ui && a.clientId !== actor.id))
      throw new Error("Artifact not found for this client.");
    this.security.workspace(a.workspaceId, actor);
    return a;
  }
  async bytes(id: string, actor: Actor) {
    const a = this.get(id, actor),
      bytes = await readFile(
        join(this.security.store.directory, "artifacts", a.id),
      );
    if (bytes.length !== a.bytes || hash(bytes) !== a.hash)
      throw new Error("Artifact integrity check failed.");
    this.get(id, actor);
    return bytes;
  }
  async create(
    input: {
      workspaceId: string;
      name: string;
      mimeType: Artifact["mimeType"];
      bytes: Buffer;
      sourceRevision: string;
      sourcePath?: string;
      role: Artifact["role"];
      capture?: Artifact["capture"];
      planId?: string;
      taskId?: string;
    },
    actor: Actor,
  ) {
    this.security.workspace(input.workspaceId, actor, "write");
    if (input.bytes.length > 4 * 1024 * 1024)
      throw new Error(
        "Artifact exceeds 4 MiB. Capture a viewport, element or tile.",
      );
    const a: Artifact = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      clientId: actor.id,
      name: input.name,
      mimeType: input.mimeType,
      bytes: input.bytes.length,
      hash: hash(input.bytes),
      createdAt: new Date().toISOString(),
      sourceRevision: input.sourceRevision,
      sourcePath: input.sourcePath ?? ".",
      role: input.role,
      capture: input.capture,
    };
    if (input.mimeType === "image/png") {
      if (
        input.bytes.length < 24 ||
        input.bytes.subarray(1, 4).toString() !== "PNG" ||
        input.bytes.readUInt32BE(16) * input.bytes.readUInt32BE(20) > 20000000
      )
        throw new Error("Invalid PNG or image exceeds pixel budget.");
      const png = PNG.sync.read(input.bytes);
      a.width = png.width;
      a.height = png.height;
    }
    const context = executionContext.getStore();
    if (context) {
      a.planId = context.planId;
      a.taskId = context.taskId;
    }
    if (input.planId || input.taskId) {
      const task = this.security.store.developmentRecord<{
        planId: string;
        workspaceId: string;
        clientId: string;
      }>("tasks", input.taskId ?? "");
      if (
        !task ||
        task.planId !== input.planId ||
        task.workspaceId !== input.workspaceId ||
        task.clientId !== actor.id
      )
        throw new Error("Artifact task ownership mismatch.");
      a.planId = input.planId;
      a.taskId = input.taskId;
    }
    const dir = join(this.security.store.directory, "artifacts");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, a.id), input.bytes, { flag: "wx", mode: 0o600 });
    this.security.workspace(a.workspaceId, actor, "write");
    this.security.store.saveDevelopment("artifacts", a);
    return a;
  }
  async read(id: string, actor: Actor) {
    const artifact = this.get(id, actor),
      bytes = await this.bytes(id, actor);
    if (artifact.mimeType !== "image/png")
      return { artifact, content: bytes.toString("utf8") };
    const png = PNG.sync.read(bytes),
      ratio = Math.min(1, 1440 / png.width, 1200 / png.height);
    const preview = new PNG({
      width: Math.max(1, Math.floor(png.width * ratio)),
      height: Math.max(1, Math.floor(png.height * ratio)),
    });
    for (let y = 0; y < preview.height; y++)
      for (let x = 0; x < preview.width; x++) {
        const from =
          (Math.floor(y / ratio) * png.width + Math.floor(x / ratio)) * 4;
        png.data.copy(
          preview.data,
          (y * preview.width + x) * 4,
          from,
          from + 4,
        );
      }
    return {
      artifact,
      image: {
        mimeType: "image/png",
        data: PNG.sync.write(preview).toString("base64"),
      },
    };
  }
  async compare(
    input: {
      workspaceId: string;
      beforeId: string;
      afterId: string;
      threshold: number;
    },
    actor: Actor,
  ) {
    const before = this.get(input.beforeId, actor),
      after = this.get(input.afterId, actor);
    if (
      before.workspaceId !== input.workspaceId ||
      after.workspaceId !== input.workspaceId ||
      before.mimeType !== "image/png" ||
      after.mimeType !== "image/png"
    )
      throw new Error("Comparison requires two PNGs in the same workspace.");
    const a = PNG.sync.read(await this.bytes(before.id, actor)),
      b = PNG.sync.read(await this.bytes(after.id, actor));
    if (a.width !== b.width || a.height !== b.height)
      throw new Error("Capture both images with matching dimensions.");
    const diff = new PNG({ width: a.width, height: a.height }),
      changedPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
        threshold: input.threshold,
      });
    const artifact = await this.create(
      {
        workspaceId: input.workspaceId,
        name: "visual-diff.png",
        mimeType: "image/png",
        bytes: PNG.sync.write(diff),
        sourceRevision: after.sourceRevision,
        sourcePath: after.sourcePath,
        role: "diff",
      },
      actor,
    );
    return {
      before,
      after,
      diff: artifact,
      changedPixels,
      ratio: changedPixels / (a.width * a.height),
      baselineRevision: before.sourceRevision,
    };
  }
}
