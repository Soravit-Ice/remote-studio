import {
  mkdir,
  readdir,
  lstat,
  readFile,
  writeFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, posix, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { parse } from "yaml";
import { Unzip, UnzipInflate } from "fflate";
import { Security, hash, type Actor } from "../../security/src/index";
import { Files, type Tree } from "../../filesystem/src/index";
import { Jobs } from "../../jobs/src/index";
import { serviceDirectory } from "../../terminal/src/sandbox";
import { readLocalBytes } from "./local-read";
export interface Skill {
  id: string;
  name: string;
  description: string;
  scope: "global" | "workspace";
  workspaceId: string | null;
  enabled: boolean;
  hash: string;
  authorizedHash: string | null;
  source: string;
  commit: string | null;
  createdAt: string;
  files: { path: string; bytes: number; hash: string }[];
  compatibility: string;
}
const maxFile = 2 * 1024 * 1024,
  maxTotal = 32 * 1024 * 1024;
function safePath(path: string) {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    path
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          p.startsWith(".env") ||
          [".git", ".ssh", ".aws", ".remote-studio"].includes(p),
      )
  )
    throw new Error("Unsafe skill resource path: " + path);
  return path;
}
export function unzipSkill(bytes: Uint8Array): Map<string, Buffer> {
  if (bytes.length > 8 * 1024 * 1024)
    throw new Error("Skill ZIP exceeds 8 MiB compressed.");
  const files = new Map<string, Buffer>();
  let total = 0,
    count = 0;
  const unzip = new Unzip((file) => {
    if (++count > 1000) throw new Error("Skill ZIP has too many entries.");
    if (file.name.endsWith("/")) {
      safePath(file.name.slice(0, -1));
      return;
    }
    safePath(file.name);
    if (file.originalSize !== undefined && file.originalSize > maxFile)
      throw new Error("Skill ZIP entry is too large.");
    if (files.has(file.name)) throw new Error("Duplicate ZIP entry.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.length;
      total += data.length;
      if (size > maxFile || total > maxTotal)
        throw new Error("Skill archive expands beyond its size budget.");
      chunks.push(data);
      if (final) files.set(file.name, Buffer.concat(chunks));
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.push(bytes, true);
  return files;
}
export class Skills {
  constructor(
    readonly security: Security,
    readonly files: Files,
    readonly jobs: Jobs,
    readonly changed: () => void,
  ) {}
  list(workspaceId: string, actor: Actor) {
    this.security.workspace(workspaceId, actor);
    return this.security.store
      .all<Skill>("skill")
      .filter((s) => s.scope === "global" || s.workspaceId === workspaceId);
  }
  private get(id: string, workspaceId: string, actor: Actor) {
    const s = this.list(workspaceId, actor).find((s) => s.id === id);
    if (!s) throw new Error("Skill not found in this workspace.");
    return s;
  }
  private async bytes(skill: Skill, path: string) {
    safePath(path);
    const entry = skill.files.find((f) => f.path === path);
    if (!entry) throw new Error("Skill resource not found.");
    const bytes = await readFile(
      join(this.security.store.directory, "skills", skill.id, path),
    );
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.hash)
      throw new Error("Skill resource integrity failed.");
    return bytes;
  }
  async read(input: { workspaceId: string; skillId: string }, actor: Actor) {
    const skill = this.get(input.skillId, input.workspaceId, actor);
    if (!skill.enabled && !actor.ui) throw new Error("Skill is disabled.");
    return {
      skill,
      content: (await this.bytes(skill, "SKILL.md")).toString("utf8"),
    };
  }
  async resource(
    input: { workspaceId: string; skillId: string; resource: string },
    actor: Actor,
  ) {
    const skill = this.get(input.skillId, input.workspaceId, actor);
    if (!skill.enabled && !actor.ui) throw new Error("Skill is disabled.");
    const bytes = await this.bytes(skill, input.resource),
      binary =
        bytes.includes(0) ||
        /\.(png|jpe?g|webp|gif|zip|woff2?)$/i.test(input.resource);
    return {
      path: input.resource,
      hash: hash(bytes),
      encoding: binary ? "base64" : "utf8",
      content: bytes.toString(binary ? "base64" : "utf8"),
    };
  }
  async inspect(input: { skillId: string; resource: string }, actor: Actor) {
    if (!actor.ui) throw new Error("Local UI required.");
    const skill = this.security.store.get<Skill>("skill", input.skillId);
    if (!skill) throw new Error("Skill not found.");
    const bytes = await this.bytes(skill, input.resource);
    return {
      hash: hash(bytes),
      encoding: bytes.includes(0) ? "base64" : "utf8",
      content: bytes.toString(bytes.includes(0) ? "base64" : "utf8"),
    };
  }
  async import(
    input: {
      kind: "directory" | "zip" | "github";
      path?: string;
      url?: string;
      commit?: string;
      workspaceId?: string;
      replaceSkillId?: string;
    },
    actor: Actor,
  ) {
    if (!actor.ui) throw new Error("Only the local UI can import skills.");
    const previous = input.replaceSkillId
      ? this.security.store.get<Skill>("skill", input.replaceSkillId)
      : undefined;
    if (input.replaceSkillId && !previous)
      throw new Error("Skill to update was not found.");
    if (previous) input.workspaceId = previous.workspaceId ?? undefined;
    if (input.workspaceId) this.security.workspace(input.workspaceId, actor);
    let files: Map<string, Buffer>;
    if (input.kind === "directory") {
      files = new Map();
      const original = await lstat(input.path!);
      if (!original.isDirectory() || original.isSymbolicLink())
        throw new Error("Skill folder must be a real directory.");
      const root = await realpath(input.path!);
      const assertRoot = async () => {
        const current = await lstat(input.path!);
        if (
          !current.isDirectory() ||
          current.isSymbolicLink() ||
          current.dev !== original.dev ||
          current.ino !== original.ino ||
          (await realpath(input.path!)) !== root
        )
          throw new Error("Skill folder changed during import.");
      };
      let total = 0;
      const visit = async (dir: string, prefix: string) => {
        if (
          !(await lstat(dir)).isDirectory() ||
          (await lstat(dir)).isSymbolicLink()
        )
          throw new Error("Skill folder must be a real directory.");
        await assertRoot();
        if ((await realpath(dir)) !== dir)
          throw new Error("Skill ancestor path changed during import.");
        for (const e of await readdir(dir, { withFileTypes: true })) {
          const path = posix.join(prefix, e.name);
          safePath(path);
          if (e.isSymbolicLink())
            throw new Error("Skill symlinks are not accepted.");
          if (e.isDirectory()) await visit(join(dir, e.name), path);
          else if (e.isFile()) {
            const stat = await lstat(join(dir, e.name));
            if (stat.nlink > 1 || stat.size > maxFile)
              throw new Error("Unsafe or oversized skill file.");
            const bytes = await readLocalBytes(
              join(dir, e.name),
              maxFile,
              assertRoot,
            );
            total += bytes.length;
            if (total > maxTotal || files.size >= 1000)
              throw new Error("Skill exceeds its size budget.");
            files.set(path, bytes);
          }
        }
      };
      await visit(root, "");
      await assertRoot();
      if (!files.has("SKILL.md"))
        throw new Error("Select a skill directory containing SKILL.md.");
    } else if (input.kind === "zip") {
      const original = await lstat(input.path!),
        path = await realpath(input.path!);
      const assertFile = async () => {
        const current = await lstat(input.path!);
        if (
          current.isSymbolicLink() ||
          current.dev !== original.dev ||
          current.ino !== original.ino ||
          (await realpath(input.path!)) !== path
        )
          throw new Error("Skill archive changed during import.");
      };
      files = unzipSkill(
        await readLocalBytes(path, 8 * 1024 * 1024, assertFile),
      );
    } else {
      if (
        !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(
          input.url ?? "",
        ) ||
        !/^([a-f0-9]{40})$/.test(input.commit ?? "")
      )
        throw new Error(
          "GitHub imports require a repository HTTPS URL and full commit SHA.",
        );
      const url = new URL(input.url!),
        parts = url.pathname.split("/").filter(Boolean),
        response = await fetch(
          `https://codeload.github.com/${parts[0]}/${parts[1]}/zip/${input.commit}`,
          { redirect: "error", signal: AbortSignal.timeout(30000) },
        );
      if (!response.ok)
        throw new Error("GitHub archive download failed: " + response.status);
      if (Number(response.headers.get("content-length") ?? 0) > 8 * 1024 * 1024)
        throw new Error("Archive is too large.");
      const reader = response.body!.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.length;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Archive is too large.");
        }
        chunks.push(r.value);
      }
      files = unzipSkill(Buffer.concat(chunks));
    }
    const roots = [...files.keys()]
      .filter((p) => p === "SKILL.md" || p.endsWith("/SKILL.md"))
      .map((p) => p.slice(0, -8));
    if (!roots.length) throw new Error("No SKILL.md found.");
    const imported: Skill[] = [];
    const selected = previous
      ? roots.filter(
          (root) =>
            basename(root.slice(0, -1)) === previous.name ||
            (!root &&
              input.kind === "directory" &&
              basename(input.path!) === previous.name),
        )
      : roots;
    if (previous && selected.length !== 1)
      throw new Error(
        "Choose an update containing exactly one matching skill name.",
      );
    try {
      for (const root of selected) {
        const bytes = files.get(root + "SKILL.md")!,
          content = bytes.toString("utf8"),
          match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
        if (!match) throw new Error("SKILL.md requires YAML frontmatter.");
        const meta = parse(match[1], {
          maxAliasCount: 0,
          uniqueKeys: true,
        }) as any;
        if (
          !meta ||
          !/^([a-z0-9]+(?:-[a-z0-9]+)*)$/.test(meta.name ?? "") ||
          meta.name.length > 64 ||
          typeof meta.description !== "string" ||
          !meta.description.trim() ||
          meta.description.length > 1024
        )
          throw new Error("Invalid Agent Skills name or description.");
        const parent = root
          ? basename(root.slice(0, -1))
          : input.kind === "directory"
            ? basename(input.path!)
            : meta.name;
        if (parent !== meta.name)
          throw new Error("Skill name must match its parent directory.");
        const resources = [...files]
          .filter(
            ([p]) =>
              p.startsWith(root) &&
              !roots.some(
                (r) => r !== root && r.startsWith(root) && p.startsWith(r),
              ),
          )
          .map(([p, b]) => ({ path: p.slice(root.length), bytes: b }));
        const manifest = resources
          .map((r) => ({
            path: r.path,
            bytes: r.bytes.length,
            hash: hash(r.bytes),
          }))
          .sort((a, b) => a.path.localeCompare(b.path));
        const skill: Skill = {
          id: randomUUID(),
          name: meta.name,
          description: meta.description,
          scope: input.workspaceId ? "workspace" : "global",
          workspaceId: input.workspaceId ?? null,
          enabled: false,
          hash: hash(JSON.stringify(manifest)),
          authorizedHash: null,
          source: input.kind === "github" ? input.url! : `${input.kind} import`,
          commit: input.commit ?? null,
          createdAt: new Date().toISOString(),
          files: manifest,
          compatibility:
            typeof meta.compatibility === "string" ? meta.compatibility : "",
        };
        const directory = join(
          this.security.store.directory,
          "skills",
          skill.id,
        );
        await mkdir(directory, { recursive: true, mode: 0o700 });
        try {
          for (const r of resources) {
            await mkdir(join(directory, posix.dirname(r.path)), {
              recursive: true,
              mode: 0o700,
            });
            await writeFile(join(directory, r.path), r.bytes, {
              flag: "wx",
              mode: 0o600,
            });
          }
          if (previous && skill.hash === previous.hash) {
            skill.enabled = previous.enabled;
            skill.authorizedHash = previous.authorizedHash;
          }
          imported.push(skill);
        } catch (error) {
          await rm(directory, { recursive: true, force: true });
          throw error;
        }
      }
      this.security.store.transaction(() => {
        for (const skill of imported)
          this.security.store.put("skill", skill.id, skill);
        if (previous) this.security.store.delete("skill", previous.id);
      });
    } catch (error) {
      for (const skill of imported)
        await rm(join(this.security.store.directory, "skills", skill.id), {
          recursive: true,
          force: true,
        });
      throw error;
    }
    this.changed();
    return imported;
  }
  configure(
    input: {
      skillId: string;
      enabled?: boolean;
      authorize?: boolean;
      uninstall?: boolean;
    },
    actor: Actor,
  ) {
    if (!actor.ui)
      throw new Error("Only the local UI can manage or authorize skills.");
    const skill = this.security.store.get<Skill>("skill", input.skillId);
    if (!skill) throw new Error("Skill not found.");
    if (input.uninstall) {
      this.security.store.delete("skill", skill.id);
    } else {
      if (input.enabled !== undefined) skill.enabled = input.enabled;
      if (input.authorize) skill.authorizedHash = skill.hash;
      this.security.store.put("skill", skill.id, skill);
    }
    this.changed();
    return skill;
  }
  async run(
    input: {
      workspaceId: string;
      skillId: string;
      script: string;
      args: string[];
      cwd: string;
    },
    actor: Actor,
  ) {
    const skill = this.get(input.skillId, input.workspaceId, actor);
    this.security.workspace(input.workspaceId, actor, "execute");
    this.security.workspace(input.workspaceId, actor, "write");
    if (!skill.enabled || skill.authorizedHash !== skill.hash)
      throw new Error(
        "This exact skill version requires local script authorization.",
      );
    safePath(input.script);
    if (
      !input.script.startsWith("scripts/") ||
      !skill.files.some((f) => f.path === input.script)
    )
      throw new Error("Choose a script listed in this skill.");
    const stage = "remote-studio-skills/" + skill.hash;
    const manifest = JSON.stringify({
      files: skill.files,
      skillHash: skill.hash,
    });
    let exists = true;
    try {
      await this.security.path(input.workspaceId, stage, actor);
    } catch {
      exists = false;
    }
    if (!exists) {
      const tree: Exclude<Tree, null> = [
          { path: "", type: "directory", mode: 0o700 },
        ],
        directories = new Set<string>();
      for (const f of skill.files) {
        const b = await this.bytes(skill, f.path);
        const parts = f.path.split("/");
        for (let i = 1; i < parts.length; i++)
          directories.add(parts.slice(0, i).join("/"));
        tree.push({
          path: f.path,
          type: "file",
          content: b.toString("base64"),
          mode: 0o600,
        });
      }
      tree.push({
        path: ".manifest.json",
        type: "file",
        content: Buffer.from(manifest).toString("base64"),
        mode: 0o600,
      });
      tree.splice(
        1,
        0,
        ...[...directories]
          .sort()
          .map((path) => ({ path, type: "directory" as const, mode: 0o700 })),
      );
      const change = await this.files.mutate(
        input.workspaceId,
        [{ operation: "mkdir", path: stage, tree }],
        actor,
      );
      if (change.status === "pending")
        return { status: "awaiting_approval", changeId: change.id };
    }
    const job = await this.jobs.create(
      {
        workspaceId: input.workspaceId,
        cwd: input.cwd,
        executable: process.execPath,
        args: [
          join(serviceDirectory(), "skill-worker.mjs"),
          JSON.stringify({
            root: this.security.workspace(input.workspaceId, actor).path,
            stage,
            manifestHash: hash(manifest),
            script: input.script,
            args: input.args,
          }),
        ],
        timeoutMs: 180000,
      },
      actor,
    );
    return { status: job.status, job };
  }
}
