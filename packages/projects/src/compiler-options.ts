import type * as TS from "typescript";
import { posix } from "node:path";

// Read only supplied source snapshots. Project plugins, packages and executable
// config files never run in this worker.
export function sourceCompilerOptions(
  ts: typeof TS,
  files: Map<string, string>,
  start: string,
) {
  const warnings: string[] = [];
  const allowed = new Set([
    "target",
    "module",
    "moduleResolution",
    "jsx",
    "lib",
    "strict",
    "strictNullChecks",
    "allowJs",
    "checkJs",
    "baseUrl",
    "paths",
    "resolveJsonModule",
    "esModuleInterop",
    "allowSyntheticDefaultImports",
    "allowImportingTsExtensions",
    "verbatimModuleSyntax",
    "moduleDetection",
    "useDefineForClassFields",
    "noUncheckedIndexedAccess",
    "exactOptionalPropertyTypes",
    "isolatedModules",
    "noUnusedLocals",
    "noUnusedParameters",
  ]);
  let directory = posix.dirname(start),
    configuration: string | null = null;
  while (directory.startsWith("/virtual")) {
    const candidate = posix.join(directory, "tsconfig.json");
    if (files.has(candidate)) {
      configuration = candidate;
      break;
    }
    if (directory === "/virtual") break;
    directory = posix.dirname(directory);
  }
  function load(path: string, stack: string[]): TS.CompilerOptions {
    if (stack.length >= 8 || stack.includes(path)) {
      warnings.push(
        "Local tsconfig inheritance is cyclic or exceeds eight levels.",
      );
      return {};
    }
    const content = files.get(path);
    if (!content) {
      warnings.push(
        "A local extended tsconfig was not included: " +
          path.replace("/virtual/", ""),
      );
      return {};
    }
    const parsed = ts.parseConfigFileTextToJson(path, content);
    if (parsed.error) {
      warnings.push(
        ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"),
      );
      return {};
    }
    const config = parsed.config,
      base = posix.dirname(path);
    let inherited: TS.CompilerOptions = {};
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      warnings.push("tsconfig must contain a JSON object.");
      return {};
    }
    const parents =
      typeof config.extends === "string"
        ? [config.extends]
        : Array.isArray(config.extends)
          ? config.extends.slice(0, 8)
          : [];
    for (const parent of parents) {
      if (typeof parent !== "string" || !parent.startsWith(".")) {
        warnings.push(
          "Package/absolute tsconfig inheritance requires project typecheck.",
        );
        continue;
      }
      let target = posix.resolve(base, parent);
      if (!target.startsWith("/virtual/")) {
        warnings.push(
          "Extended tsconfig escapes the supplied source snapshot.",
        );
        continue;
      }
      if (!files.has(target) && files.has(target + ".json")) target += ".json";
      inherited = { ...inherited, ...load(target, [...stack, path]) };
    }
    const raw = config.compilerOptions ?? {},
      safe = Object.fromEntries(
        Object.entries(raw).filter(([key]) => allowed.has(key)),
      );
    if (raw.plugins?.length)
      warnings.push("Project language-service plugins are ignored.");
    const converted = ts.convertCompilerOptionsFromJson(safe, base);
    warnings.push(
      ...converted.errors
        .slice(0, 10)
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, "\n"),
        ),
    );
    const current = converted.options;
    if (current.paths) {
      const pathsBase = current.baseUrl ?? inherited.baseUrl ?? base;
      current.paths = Object.fromEntries(
        Object.entries(current.paths)
          .slice(0, 200)
          .filter(([, targets]) => Array.isArray(targets))
          .map(([key, targets]) => [
            key,
            targets
              .filter((target) => typeof target === "string")
              .slice(0, 10)
              .map((target) => posix.resolve(pathsBase, target))
              .filter((target) => target.startsWith("/virtual/")),
          ]),
      );
    }
    return { ...inherited, ...current };
  }
  return {
    options: configuration ? load(configuration, []) : {},
    configuration: configuration?.replace("/virtual/", "") ?? null,
    warnings: warnings.slice(0, 20),
  };
}
