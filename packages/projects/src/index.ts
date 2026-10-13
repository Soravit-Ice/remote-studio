import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { Security, type Actor } from "../../security/src/index";
import type { Files, Mutation, Tree } from "../../filesystem/src/index";
import { projectTemplate, type Template, type Preset } from "./templates";
export const reactTemplate = (name: string): Record<string, string> =>
  projectTemplate(name, "react-vite");
export async function createProject(
  security: Security,
  input: {
    workspaceId: string;
    path: string;
    name: string;
    template?: Template;
    preset?: Preset;
    files?: { path: string; content: string }[];
  },
  actor: Actor,
  fileTools?: Files,
) {
  const path = await security.path(
    input.workspaceId,
    input.path,
    actor,
    "write",
    true,
  );
  const template = input.template ?? "react-vite";
  for (const file of input.files ?? [])
    if (
      file.path.includes("\\") ||
      file.path.startsWith("/") ||
      file.path.includes(":") ||
      file.path.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw new Error(
        "Custom project files must use paths inside the project.",
      );
  if (
    input.files &&
    new Set(input.files.map((f) => f.path)).size !== input.files.length
  )
    throw new Error("Duplicate project file paths.");
  const files =
    template === "empty"
      ? {}
      : template === "custom"
        ? Object.fromEntries(
            (input.files ?? []).map((f) => [f.path, f.content]),
          )
        : projectTemplate(input.name, template, input.preset);
  if (fileTools) {
    const ws = security.workspace(input.workspaceId, actor, "write");
    const atRoot = path === ws.path;
    if (
      atRoot &&
      (await readdir(path)).some(
        (name) => ![".DS_Store", ".remote-studio"].includes(name),
      )
    )
      throw new Error(
        "TARGET_NOT_EMPTY: choose a new child directory or edit existing files explicitly.",
      );
    let operations: Mutation[];
    if (atRoot)
      operations = Object.entries(files).map(([name, content]) => ({
        operation: "write",
        path: name,
        content,
        expectedHash: null,
      }));
    else {
      const tree: Exclude<Tree, null> = [
          { path: "", type: "directory", mode: 0o700 },
        ],
        directories = new Set<string>();
      for (const [name, content] of Object.entries(files)) {
        await security.path(
          input.workspaceId,
          posix.join(input.path, name),
          actor,
          "write",
          true,
        );
        const parts = name.split("/");
        for (let i = 1; i < parts.length; i++)
          directories.add(parts.slice(0, i).join("/"));
        tree.push({
          path: name,
          type: "file",
          content: Buffer.from(content).toString("base64"),
          mode: 0o600,
        });
      }
      tree.splice(
        1,
        0,
        ...[...directories].sort().map((name) => ({
          path: name,
          type: "directory" as const,
          mode: 0o700,
        })),
      );
      operations = [{ operation: "mkdir", path: input.path, tree }];
    }
    const change = operations.length
      ? await fileTools.mutate(input.workspaceId, operations, actor)
      : undefined;
    return {
      path: input.path,
      files: Object.keys(files),
      template,
      status: change?.status ?? "applied",
      changeId: change?.id,
    };
  }
  await mkdir(path, { recursive: false });
  for (const [name, content] of Object.entries(files)) {
    const destination = join(path, name);
    if (name.startsWith("src/"))
      await mkdir(join(path, "src"), { recursive: true });
    await writeFile(destination, content, { flag: "wx", mode: 0o600 });
  }
  security.store.audit(
    "project.create",
    actor.id,
    input.workspaceId,
    input.path,
  );
  return {
    path: input.path,
    files: Object.keys(files),
    template: "react-vite",
  };
}
export async function inspectProject(
  security: Security,
  input: { workspaceId: string; path: string },
  actor: Actor,
) {
  const path = await security.path(input.workspaceId, input.path, actor);
  const packageFile = await security.read(
    input.workspaceId,
    posix.join(input.path, "package.json"),
    actor,
  );
  const pkg = JSON.parse(packageFile.content);
  const dependencies = { ...pkg.devDependencies, ...pkg.dependencies },
    entries = await readdir(path),
    declared =
      typeof pkg.packageManager === "string"
        ? pkg.packageManager.split("@")[0]
        : null;
  const lockManagers = [
    entries.includes("pnpm-lock.yaml") ? "pnpm" : null,
    entries.includes("yarn.lock") ? "yarn" : null,
    entries.includes("package-lock.json") ? "npm" : null,
  ].filter(Boolean);
  if (lockManagers.length > 1)
    throw new Error(
      "Ambiguous package-manager lockfiles. Resolve the project configuration first.",
    );
  if (declared && !["npm", "pnpm", "yarn"].includes(declared))
    throw new Error("Unsupported declared package manager: " + declared);
  if (declared && lockManagers.length && declared !== lockManagers[0])
    throw new Error("Declared package manager conflicts with the lockfile.");
  return {
    name: String(pkg.name ?? "Unnamed project"),
    scripts: pkg.scripts ?? {},
    framework: dependencies.electron
      ? "Electron"
      : dependencies["@tauri-apps/api"]
        ? "Tauri"
        : dependencies.next
          ? "Next.js"
          : dependencies.astro
            ? "Astro"
            : dependencies.react
              ? "React"
              : "Node.js",
    packageManager: declared ?? lockManagers[0] ?? "npm",
    dependencies,
    packageManagerDeclaration: pkg.packageManager ?? null,
    lockfiles: entries.filter((e) =>
      ["pnpm-lock.yaml", "yarn.lock", "package-lock.json"].includes(e),
    ),
    workspaces: pkg.workspaces ?? null,
  };
}
