import { z } from "zod";
import { posix } from "node:path";
import { lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { Security, hash, type Actor } from "../../security/src/index";
import { Files } from "../../filesystem/src/index";
import { projectMap } from "../../projects/src/map";
import { presets, designCSS, type Preset } from "../../projects/src/templates";
const registrySchema = z.object({
  name: z.string(),
  type: z.string(),
  dependencies: z.array(z.string()).optional(),
  devDependencies: z.array(z.string()).optional(),
  registryDependencies: z.array(z.string()).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        type: z.string(),
        content: z.string().max(2 * 1024 * 1024),
        target: z.string().optional(),
      }),
    )
    .max(100),
});
export class Design {
  constructor(
    readonly security: Security,
    readonly files: Files,
  ) {}
  preset(name: Preset) {
    return {
      name,
      tokens: presets[name],
      css: designCSS(name),
      checks: [
        "responsive overflow",
        "WCAG accessibility",
        "keyboard focus",
        "reduced motion",
        "actual screenshot review",
      ],
    };
  }
  async inspect(item: string) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item) || item.length > 80)
      throw new Error("Invalid official registry item name.");
    const url = `https://ui.shadcn.com/r/styles/new-york/${item}.json`,
      response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    if (!response.ok)
      throw new Error("Registry request failed: " + response.status);
    const reader = response.body!.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Registry item exceeds the response budget.");
      }
      chunks.push(r.value);
    }
    const registry = registrySchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    return {
      url,
      registry,
      hash: hash(JSON.stringify(registry)),
      fetchedAt: new Date().toISOString(),
    };
  }
  async add(
    input: {
      workspaceId: string;
      path: string;
      item: string;
      expectedRegistryHash: string;
      overwrite: boolean;
    },
    actor: Actor,
  ) {
    this.security.workspace(input.workspaceId, actor, "write");
    const result = await this.inspect(input.item);
    if (result.hash !== input.expectedRegistryHash)
      throw new Error(
        "Registry content changed since inspection. Inspect and review the new item first.",
      );
    const config = JSON.parse(
        (
          await this.security.read(
            input.workspaceId,
            posix.join(input.path, "components.json"),
            actor,
          )
        ).content,
      ),
      tsconfig = JSON.parse(
        (
          await this.security.read(
            input.workspaceId,
            posix.join(input.path, "tsconfig.json"),
            actor,
          )
        ).content,
      );
    const aliases: Record<string, string> = config.aliases ?? {},
      paths: Record<string, string[]> = tsconfig.compilerOptions?.paths ?? {};
    const aliasPath = (alias: string) => {
      if (alias.startsWith("@/")) {
        const prefix = paths["@/*"]?.[0];
        if (!prefix || !prefix.endsWith("*"))
          throw new Error("Configure the @/* alias in tsconfig.json.");
        return posix.join(input.path, prefix.slice(0, -1), alias.slice(2));
      }
      return posix.join(input.path, alias);
    };
    const operations: any[] = [];
    for (const file of result.registry.files) {
      if (
        ![
          "registry:ui",
          "registry:component",
          "registry:lib",
          "registry:hook",
        ].includes(file.type)
      )
        throw new Error(
          "This registry file type requires a dedicated installation recipe: " +
            file.type,
        );
      const alias =
        aliases[
          file.type === "registry:lib"
            ? "lib"
            : file.type === "registry:hook"
              ? "hooks"
              : "ui"
        ];
      if (!alias) throw new Error("Missing component path alias.");
      const target = posix.join(aliasPath(alias), posix.basename(file.path));
      await this.security.path(input.workspaceId, posix.dirname(target), actor);
      let expectedHash: string | null = null;
      try {
        expectedHash = (
          await this.security.read(input.workspaceId, target, actor)
        ).hash;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (expectedHash && !input.overwrite)
        throw new Error(
          "Registry would overwrite an existing file; explicitly review overwrite first.",
        );
      operations.push({
        operation: "write",
        path: target,
        content: file.content,
        expectedHash,
      });
    }
    const change = await this.files.mutate(
      input.workspaceId,
      operations,
      actor,
    );
    return {
      change,
      registryHash: result.hash,
      dependencies: result.registry.dependencies ?? [],
      devDependencies: result.registry.devDependencies ?? [],
      registryDependencies: result.registry.registryDependencies ?? [],
      next: "Resolve and pin any missing dependencies in package.json, install them with project_install, then run actual typecheck/build and browser checks.",
    };
  }
  async assets(input: { workspaceId: string; path: string }, actor: Actor) {
    const map = await projectMap(this.security, input, actor),
      assets: any[] = [];
    for (const f of map.files.filter((f) => f.kind === "asset").slice(0, 100)) {
      const path = await this.security.path(input.workspaceId, f.path, actor),
        stat = await lstat(path);
      if (stat.size > 8 * 1024 * 1024) {
        assets.push({ ...f, limited: true });
        continue;
      }
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let bytes: Buffer;
      try {
        const st = await handle.stat();
        if (!st.isFile() || st.nlink > 1 || st.size > 8 * 1024 * 1024)
          throw new Error("Unsafe asset file.");
        bytes = await handle.readFile();
      } finally {
        await handle.close();
      }
      let width: number | null = null,
        height: number | null = null;
      if (bytes.length >= 24 && bytes.subarray(1, 4).toString() === "PNG") {
        width = bytes.readUInt32BE(16);
        height = bytes.readUInt32BE(20);
      } else if (f.path.endsWith(".svg")) {
        const text = bytes.toString("utf8");
        const view =
          /viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)["']/.exec(
            text,
          );
        if (view) {
          width = Number(view[1]);
          height = Number(view[2]);
        }
      }
      assets.push({
        path: f.path,
        bytes: bytes.length,
        hash: hash(bytes),
        format: f.path.split(".").pop(),
        width,
        height,
      });
    }
    const groups = new Map<string, string[]>();
    for (const a of assets)
      if (a.hash) {
        const same = groups.get(a.hash) ?? [];
        same.push(a.path);
        groups.set(a.hash, same);
      }
    return {
      assets,
      duplicates: [...groups.values()].filter((p) => p.length > 1),
      truncated:
        map.truncated ||
        map.files.filter((f) => f.kind === "asset").length > 100,
      revision: map.revision,
    };
  }
}
