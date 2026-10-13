import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { Security, type Actor } from "../../security/src/index";
import { serviceDirectory } from "../../terminal/src/sandbox";
import { projectMap } from "./map";
import { inspectProject } from "./index";
export async function projectContext(
  security: Security,
  input: { workspaceId: string; path: string },
  actor: Actor,
) {
  const project = await inspectProject(security, input, actor),
    map = await projectMap(security, input, actor),
    packages: any[] = [];
  for (const file of map.files
    .filter((f) => f.path.endsWith("package.json"))
    .slice(0, 100)) {
    try {
      const p = JSON.parse(
        (await security.read(input.workspaceId, file.path, actor)).content,
      );
      packages.push({
        path: file.path,
        name: p.name ?? null,
        scripts: p.scripts ?? {},
        dependencies: p.dependencies ?? {},
        devDependencies: p.devDependencies ?? {},
        workspaces: p.workspaces ?? null,
      });
    } catch {
      packages.push({ path: file.path, error: "Invalid package manifest" });
    }
  }
  return {
    project,
    map: {
      ...map,
      files: map.files.slice(0, 200),
      truncated: map.truncated || map.files.length > 200,
    },
    packages,
    routes: map.files
      .filter((f) => /(?:pages|app|routes)\//.test(f.path))
      .map((f) => f.path)
      .slice(0, 100),
    configs: map.files
      .filter((f) =>
        /config\.|\.config|tsconfig|lock\.yaml|workspace\.yaml/.test(f.path),
      )
      .map((f) => f.path)
      .slice(0, 100),
    assets: map.files.filter((f) => f.kind === "asset").slice(0, 100),
    apis: map.files
      .filter((f) => /(?:api|server)\//.test(f.path))
      .map((f) => f.path)
      .slice(0, 100),
    validation: ["typecheck", "lint", "test", "build"].filter((k) =>
      Object.hasOwn(project.scripts, k),
    ),
  };
}
export async function codeQuery(security: Security, input: any, actor: Actor) {
  const map = await projectMap(security, input, actor),
    files: any[] = [];
  let bytes = 0,
    truncated = map.truncated;
  for (const f of map.files.filter((f) => f.kind === "source")) {
    if (bytes + f.bytes > 16 * 1024 * 1024) {
      truncated = true;
      break;
    }
    const r = await security.read(input.workspaceId, f.path, actor);
    if (r.hash !== f.hash)
      throw new Error(
        "Source changed while building the code index. Query again.",
      );
    files.push({ path: f.path, content: r.content });
    bytes += f.bytes;
  }
  if (input.file) await security.path(input.workspaceId, input.file, actor);
  const answer = await new Promise<{
    results: any[];
    truncated: boolean;
    configuration: string | null;
    warnings: string[];
  }>((resolve, reject) => {
    const worker = new Worker(join(serviceDirectory(), "code-worker.mjs"), {
        workerData: { ...input, files },
      }),
      timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error("Code query exceeded its time budget."));
      }, 15000);
    worker.once("message", (v) => {
      clearTimeout(timer);
      void worker.terminate();
      if (v.error) reject(new Error(v.error));
      else resolve(v);
    });
    worker.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error("Code worker exited."));
      }
    });
  });
  security.workspace(input.workspaceId, actor);
  return {
    action: input.action,
    results: answer.results,
    revision: map.revision,
    truncated: truncated || answer.truncated,
    limitations: [
      "Source-only semantic index; dependency declarations and framework-generated types are checked by the project's actual typecheck/build scripts.",
      ...(input.action === "search"
        ? []
        : [
            answer.configuration
              ? `Compiler options and local path aliases from ${answer.configuration}. Project plugins are not loaded.`
              : "Default JS/TS compiler options; no tsconfig found in the supplied source snapshot.",
            ...answer.warnings,
          ]),
      ...(map.omitted.length
        ? ["Some source paths were inaccessible; see project_context."]
        : []),
    ],
  };
}
