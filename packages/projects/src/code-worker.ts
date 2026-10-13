import type * as TS from "typescript";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import { dirname, join, resolve, posix } from "node:path";
import { sourceCompilerOptions } from "./compiler-options";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const ts = (
  await import(
    pathToFileURL(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "vendor/typescript/lib/typescript.js",
      ),
    ).href
  )
).default as typeof import("typescript");
const input = workerData as any,
  files = new Map<string, string>(
    input.files.map((f: any) => ["/virtual/" + f.path, f.content]),
  );
const results: any[] = [];
const configuration = sourceCompilerOptions(
  ts,
  files,
  input.file
    ? "/virtual/" + input.file
    : posix.join("/virtual", input.path ?? ".", "__query__.ts"),
);
let matched = 0;
const add = (v: any) => {
  matched++;
  if (results.length < input.limit) results.push(v);
};
try {
  if (input.action === "search") {
    for (const [path, content] of files)
      for (const [i, line] of content.split("\n").entries())
        if (
          input.query &&
          line.toLowerCase().includes(input.query.toLowerCase())
        )
          add({
            path: path.slice(9),
            line: i + 1,
            preview: line.slice(0, 400),
          });
  } else {
    const libraryDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "vendor/typescript/lib",
    );
    const libraries = new Map<string, string>();
    for (const name of readdirSync(libraryDir))
      if (/^lib\..*\.d\.ts$/.test(name))
        libraries.set(
          resolve(libraryDir, name),
          readFileSync(join(libraryDir, name), "utf8"),
        );
    const names = [...files.keys()].filter((p) => /\.[cm]?[jt]sx?$/.test(p));
    const options: TS.CompilerOptions = {
      allowJs: true,
      checkJs: true,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      ...configuration.options,
    };
    const host: TS.LanguageServiceHost = {
      getScriptFileNames: () => names,
      getScriptVersion: () => "1",
      getScriptSnapshot: (p) => {
        const content = files.get(p) ?? libraries.get(resolve(p));
        return content === undefined
          ? undefined
          : ts.ScriptSnapshot.fromString(content);
      },
      getCurrentDirectory: () => "/virtual",
      getCompilationSettings: () => options,
      getDefaultLibFileName: () =>
        join(libraryDir, ts.getDefaultLibFileName(options)),
      fileExists: (p) => files.has(p) || libraries.has(resolve(p)),
      readFile: (p) => files.get(p) ?? libraries.get(resolve(p)),
      readDirectory: () => names,
      directoryExists: (p) =>
        [...files.keys()].some((f) => f.startsWith(p + "/")) ||
        resolve(p) === resolve(libraryDir),
    };
    const service = ts.createLanguageService(host),
      target = input.file ? "/virtual/" + input.file : undefined;
    const position = (file: string) => {
      if (!input.line || !input.column)
        throw new Error(
          "Definitions/references require file, line and column.",
        );
      const source = service.getProgram()?.getSourceFile(file);
      if (!source)
        throw new Error("File is not a JS/TS source in this project.");
      return ts.getPositionOfLineAndCharacter(
        source,
        input.line - 1,
        input.column - 1,
      );
    };
    const location = (l: TS.DocumentSpan) => {
      const s = service.getProgram()?.getSourceFile(l.fileName),
        p = s
          ? ts.getLineAndCharacterOfPosition(s, l.textSpan.start)
          : { line: 0, character: 0 };
      return {
        path: l.fileName.replace(/^\/virtual\//, ""),
        line: p.line + 1,
        column: p.character + 1,
        length: l.textSpan.length,
      };
    };
    if (input.action === "symbols") {
      for (const file of target ? [target] : names) {
        const tree = service.getNavigationTree(file);
        const visit = (node: TS.NavigationTree) => {
          for (const child of node.childItems ?? []) {
            if (
              !input.query ||
              child.text.toLowerCase().includes(input.query.toLowerCase())
            )
              add({
                name: child.text,
                kind: child.kind,
                ...location({ fileName: file, textSpan: child.spans[0] }),
              });
            visit(child);
          }
        };
        visit(tree);
      }
    } else if (
      input.action === "definitions" ||
      input.action === "references"
    ) {
      if (!target) throw new Error("A source file is required.");
      const pos = position(target),
        found =
          input.action === "definitions"
            ? service.getDefinitionAtPosition(target, pos)
            : service.getReferencesAtPosition(target, pos);
      for (const l of found ?? []) add(location(l));
    } else if (input.action === "diagnostics")
      for (const file of target ? [target] : names)
        for (const d of [
          ...service.getSyntacticDiagnostics(file),
          ...service.getSemanticDiagnostics(file),
        ]) {
          const pos =
            d.file && d.start !== undefined
              ? ts.getLineAndCharacterOfPosition(d.file, d.start)
              : { line: 0, character: 0 };
          add({
            path: file.slice(9),
            line: pos.line + 1,
            column: pos.character + 1,
            code: d.code,
            message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
            category: ts.DiagnosticCategory[d.category],
          });
        }
    service.dispose();
  }
  parentPort!.postMessage({
    results,
    truncated: matched > input.limit,
    configuration: configuration.configuration,
    warnings: configuration.warnings,
  });
} catch (error) {
  parentPort!.postMessage({ error: (error as Error).message });
}
