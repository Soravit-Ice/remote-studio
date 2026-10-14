import { build } from "esbuild";
import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await mkdir("dist/services/policies", { recursive: true });
await cp("resources/sandbox", "dist/services/policies", { recursive: true });
// electron-builder excludes node_modules from extraResources. Vendor the
// complete pinned runtime explicitly so a packaged agent works independently.
await rm("dist/services/node_modules", { recursive: true, force: true });
await rm("dist/services/vendor/playwright-core", {
  recursive: true,
  force: true,
});
await cp(
  "node_modules/playwright-core",
  "dist/services/vendor/playwright-core",
  { recursive: true, dereference: true },
);
await mkdir("dist/services/vendor/typescript/lib", { recursive: true });
await cp(
  "node_modules/typescript/package.json",
  "dist/services/vendor/typescript/package.json",
);
await cp(
  "node_modules/typescript/lib/typescript.js",
  "dist/services/vendor/typescript/lib/typescript.js",
);
await cp(
  "node_modules/typescript/LICENSE.txt",
  "dist/services/vendor/typescript/LICENSE.txt",
);
for (const file of await readdir("node_modules/typescript/lib"))
  if (/^lib\..*\.d\.ts$/.test(file))
    await cp(
      "node_modules/typescript/lib/" + file,
      "dist/services/vendor/typescript/lib/" + file,
    );
if (process.platform === "win32")
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "scripts/build-windows-sandbox.ps1",
    ],
    { stdio: "inherit" },
  );
if (process.platform === "darwin")
  execFileSync(
    "/usr/bin/clang++",
    [
      "-std=c++17",
      "-O2",
      "-arch",
      "arm64",
      "-arch",
      "x86_64",
      "native/macos/process-info.cpp",
      "-lsandbox",
      "-o",
      "dist/services/studio-process-info",
    ],
    { stdio: "inherit" },
  );
if (process.platform === "darwin")
  execFileSync(
    "/usr/bin/clang++",
    [
      "-std=c++17",
      "-O2",
      "-dynamiclib",
      "-undefined",
      "dynamic_lookup",
      "-arch",
      "arm64",
      "-arch",
      "x86_64",
      "-I",
      "node_modules/node-api-headers/include",
      "native/files/descriptor.cpp",
      "-o",
      "dist/services/studio-files.node",
    ],
    { stdio: "inherit" },
  );
await build({
  entryPoints: {
    agent: "services/local-agent/src/index.ts",
    bridge: "services/mcp-bridge/src/index.ts",
    "http-bridge": "services/mcp-bridge/src/http-entry.ts",
    "files-worker": "packages/filesystem/src/worker.ts",
    "browser-worker": "packages/browser/src/worker.ts",
    "sandbox-bootstrap": "packages/terminal/src/bootstrap.ts",
    "code-worker": "packages/projects/src/code-worker.ts",
    "desktop-worker": "packages/desktop/src/worker.ts",
    "skill-worker": "packages/skills/src/worker.ts",
    "git-checkpoint-worker": "packages/git/src/checkpoint-worker.ts",
    "video-worker": "packages/video/src/worker.ts",
  },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outdir: "dist/services",
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
  external: ["playwright-core"],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
