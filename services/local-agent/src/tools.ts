import { z } from "zod";
import {
  workspaceSchema,
  commandSchema,
  id,
  relativePath,
} from "../../../packages/contracts/src/index";
import { proposeSchema } from "../../../packages/filesystem/src/index";
import {
  browserActionSchema,
  locatorSchema,
} from "../../../packages/contracts/src/index";
import { developmentCatalog, artifactSchema } from "./development-tools";
const scope = z.object({ workspaceId: id, path: relativePath });
const change = z.object({
  id,
  workspaceId: id,
  path: z.string(),
  before: z.string().nullable(),
  after: z.string(),
  expectedHash: z.string().nullable(),
  status: z.enum(["pending", "applied", "rejected", "undone"]),
  createdAt: z.string(),
  clientId: z.string(),
  operation: z
    .enum(["write", "delete", "mkdir", "move", "copy", "batch"])
    .optional(),
  destination: z.string().optional(),
  encoding: z.enum(["utf8", "base64"]).optional(),
});
const job = z.object({
  id,
  workspaceId: id,
  clientId: z.string(),
  label: z.string(),
  command: commandSchema,
  status: z.enum([
    "awaiting_approval",
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  exitCode: z.number().nullable(),
  logs: z.string(),
  error: z.string().nullable(),
  pid: z.number().nullable(),
  sandboxed: z.boolean().optional(),
  authorization: z.enum(["reviewed", "full"]).optional(),
  logOffset: z.number().optional(),
  planId: id.optional(),
  taskId: id.optional(),
  attemptId: id.optional(),
  dependsOn: z.array(id).optional(),
  originModule: z.string().optional(),
});
function tool(
  name: string,
  module: string,
  permission: "read" | "write" | "execute",
  description: string,
  input: z.ZodType,
  output: z.ZodType,
) {
  return { name, module, permission, description, input, output };
}
export const catalog = [
  tool(
    "workspace_list",
    "Files",
    "read",
    "List authorized folders and their independent read, write, and execution grants.",
    z.object({}),
    z.array(workspaceSchema),
  ),
  tool(
    "workspace_info",
    "Files",
    "read",
    "Inspect one authorized workspace by ID.",
    z.object({ workspaceId: id }),
    workspaceSchema,
  ),
  tool(
    "file_list",
    "Files",
    "read",
    "List a directory with pagination. Protected paths are omitted; symbolic links are never followed.",
    scope.extend({
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(200).default(100),
    }),
    z.object({
      entries: z.array(
        z.object({
          name: z.string(),
          type: z.enum(["directory", "file", "symlink"]),
        }),
      ),
      total: z.number(),
    }),
  ),
  tool(
    "file_read",
    "Files",
    "read",
    "Read a UTF-8 text file up to 2 MiB and get its SHA-256 hash for safe edits.",
    scope,
    z.object({ content: z.string(), hash: z.string() }),
  ),
  tool(
    "file_search",
    "Files",
    "read",
    "Recursively search filenames or text. Skips binaries, dependencies, and protected files; bounded to 5000 entries.",
    scope.extend({
      query: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(200).default(50),
      content: z.boolean().default(false),
    }),
    z.object({
      matches: z.array(
        z.object({
          path: z.string(),
          line: z.number().nullable(),
          preview: z.string().nullable(),
        }),
      ),
      scanned: z.number(),
      truncated: z.boolean(),
    }),
  ),
  tool(
    "file_write",
    "Files",
    "write",
    "Create or replace a file. Workspace Full Access applies immediately with a checkpoint; Reviewed returns pending for Activity approval. expectedHash=null for new files; read existing files first.",
    proposeSchema,
    change,
  ),
  tool(
    "file_patch",
    "Files",
    "write",
    "Apply a unique exact text replacement in Full Access, or propose it in Reviewed mode. Rejects ambiguous matches and stale hashes.",
    scope.extend({
      find: z.string().min(1),
      replace: z.string(),
      expectedHash: z.string(),
    }),
    change,
  ),
  tool(
    "file_diff",
    "Files",
    "read",
    "Inspect the original and proposed content of a change owned by this client.",
    z.object({ workspaceId: id.optional(), changeId: id }),
    change,
  ),
  tool(
    "file_restore",
    "Files",
    "write",
    "Request restoration of an applied checkpoint through LOCAL approval. Does not overwrite newer content.",
    z.object({ workspaceId: id.optional(), changeId: id }),
    change,
  ),
  tool(
    "command_execute",
    "Terminal",
    "execute",
    "Run an executable with literal arguments. Full Access starts immediately in a native workspace sandbox; Reviewed awaits local approval. persistent=true keeps dev servers alive without a timeout. Use job_wait/logs/input/cancel to continue.",
    commandSchema,
    job,
  ),
  tool(
    "job_list",
    "Jobs",
    "read",
    "Page this client's persistent jobs using limit/offset. Returns summaries by default; request actual output with job_logs or job_status. Status is based on actual execution.",
    z.object({
      workspaceId: id.optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).max(1000000).default(0),
      includeLogs: z.boolean().default(false),
    }),
    z.array(job),
  ),
  tool(
    "job_status",
    "Jobs",
    "read",
    "Get a persistent job status, exit code, and bounded actual output.",
    z.object({ workspaceId: id.optional(), jobId: id }),
    job,
  ),
  tool(
    "job_logs",
    "Jobs",
    "read",
    "Read captured stdout and stderr from a job owned by this client.",
    z.object({
      workspaceId: id.optional(),
      jobId: id,
      cursor: z.number().int().min(0).default(0),
    }),
    z.object({
      logs: z.string(),
      status: z.string(),
      cursor: z.number(),
      truncated: z.boolean(),
    }),
  ),
  tool(
    "job_cancel",
    "Jobs",
    "execute",
    "Cancel this client’s pending or running job and terminate its tracked process group.",
    z.object({ workspaceId: id.optional(), jobId: id }),
    job,
  ),
  tool(
    "project_create",
    "Projects",
    "write",
    "Create React/Vite, empty or supplied-source projects in a new child folder or path='.' for an empty workspace root. Never overwrite existing files. Full Access applies immediately; Reviewed returns a checkpoint for approval. Then use project_install, project_validate, preview_start and browser tools.",
    scope.extend({
      path: relativePath,
      template: z
        .enum([
          "react-vite",
          "astro",
          "next",
          "next-fullstack",
          "electron",
          "tauri",
          "empty",
          "custom",
        ])
        .default("react-vite"),
      preset: z
        .enum(["premium-saas", "modern-minimal", "corporate", "dashboard"])
        .default("modern-minimal"),
      files: z
        .array(
          z.object({
            path: z.string().min(1),
            content: z.string().max(2 * 1024 * 1024),
          }),
        )
        .max(100)
        .optional(),
      name: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*$/)
        .max(80),
    }),
    z.object({
      path: z.string(),
      files: z.array(z.string()),
      template: z.string(),
      status: z.string().optional(),
      changeId: id.optional(),
    }),
  ),
  tool(
    "project_inspect",
    "Projects",
    "read",
    "Detect the framework, package manager, and actual package.json scripts.",
    scope,
    z.object({
      name: z.string(),
      scripts: z.record(z.string(), z.string()),
      framework: z.string(),
      packageManager: z.string(),
      dependencies: z.record(z.string(), z.string()).optional(),
      packageManagerDeclaration: z.string().nullable().optional(),
      lockfiles: z.array(z.string()).optional(),
      workspaces: z.unknown().optional(),
    }),
  ),
  tool(
    "git_status",
    "Git",
    "read",
    "Inspect Git status without modifying repository files. Git hooks, external diff tools, and optional locks are disabled.",
    scope,
    z.object({ output: z.string() }),
  ),
  tool(
    "git_diff",
    "Git",
    "read",
    "Read bounded Git diff with external diff drivers and text converters disabled.",
    scope,
    z.object({ output: z.string() }),
  ),
  tool(
    "git_log",
    "Git",
    "read",
    "Read the last 20 commits from an authorized repository.",
    scope,
    z.object({ output: z.string() }),
  ),
  tool(
    "system_info",
    "System",
    "read",
    "Report OS platform, architecture, runtime versions, and agent memory; no environment secrets.",
    z.object({}),
    z.object({
      platform: z.string(),
      arch: z.string(),
      node: z.string(),
      agentVersion: z.string(),
      memoryBytes: z.number(),
      serverId: z.string().optional(),
      catalogFingerprint: z.string().optional(),
    }),
  ),
  tool(
    "permission_status",
    "System",
    "read",
    "Inspect current grants for this client. Permissions can only be changed through the trusted local UI.",
    z.object({}),
    z.array(workspaceSchema),
  ),
];
const scopedJob = z.object({ workspaceId: id, jobId: id });
const preview = z.object({ job, url: z.string(), ready: z.boolean() });
const snapshot = z.object({
  sessionId: id,
  url: z.string(),
  title: z.string(),
  content: z.string(),
  logs: z.array(z.string()),
  diagnostics: z.array(z.record(z.string(), z.unknown())).optional(),
  viewport: z
    .object({ width: z.number(), height: z.number() })
    .nullable()
    .optional(),
});
const hashInput = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .nullable();
catalog.push(
  tool(
    "directory_create",
    "Files",
    "write",
    "Create a nested directory, including missing parents, within the selected folder. Full Access applies immediately; Reviewed requires Activity approval.",
    scope,
    change,
  ),
  tool(
    "file_write_binary",
    "Files",
    "write",
    "Create or replace an image or other binary asset up to 2 MiB from base64; preserves actual bytes for Undo.",
    scope.extend({
      base64: z
        .string()
        .max(2800000)
        .regex(
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        ),
      expectedHash: hashInput,
    }),
    change,
  ),
  tool(
    "file_delete",
    "Files",
    "write",
    "Delete a file or directory with a recoverable checkpoint. Set recursive=true for nonempty directories. Workspace root and protected paths cannot be deleted.",
    scope.extend({
      recursive: z.boolean().default(false),
      expectedHash: hashInput.optional(),
    }),
    change,
  ),
  tool(
    "file_copy",
    "Files",
    "write",
    "Copy a file or directory within one workspace. Destination must not exist; symlinks and protected content are rejected.",
    scope.extend({ destination: z.string().min(1) }),
    change,
  ),
  tool(
    "file_move",
    "Files",
    "write",
    "Move or rename a file/directory within one workspace without overwriting. A checkpoint restores both paths.",
    scope.extend({ destination: z.string().min(1) }),
    change,
  ),
  tool(
    "file_batch",
    "Files",
    "write",
    "Create or replace up to 100 files as one reviewed or immediately applied checkpoint. Prevalidates all hashes and rolls back tool-owned writes on failure.",
    z.object({
      workspaceId: id,
      files: z
        .array(proposeSchema.omit({ workspaceId: true }))
        .min(1)
        .max(100),
    }),
    change,
  ),
  tool(
    "file_patch_many",
    "Files",
    "write",
    "Patch multiple distinct files with exact unique replacements and current hashes as one checkpoint.",
    z.object({
      workspaceId: id,
      patches: z
        .array(
          z.object({
            path: z.string().min(1),
            find: z.string().min(1),
            replace: z.string(),
            expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .min(1)
        .max(100),
    }),
    change,
  ),
  tool(
    "shell_execute",
    "Terminal",
    "execute",
    "Run an explicitly requested shell command with operators/pipes. Full Access uses native folder isolation; shell profiles and inherited secrets are excluded. Use cwd relative to workspace, persistent=true for servers.",
    z.object({
      workspaceId: id,
      cwd: relativePath,
      command: z.string().min(1).max(32768),
      shell: z
        .enum(["default", "zsh", "bash", "sh", "powershell", "cmd"])
        .default("default"),
      timeoutMs: z.number().int().min(100).max(3600000).default(120000),
      persistent: z.boolean().default(false),
      idempotencyKey: z.string().max(100).optional(),
    }),
    job,
  ),
  tool(
    "job_input",
    "Jobs",
    "execute",
    "Send stdin to an owned running job; set eof=true to close input. Input is excluded from audit logs.",
    z.object({
      workspaceId: id,
      jobId: id,
      input: z.string().max(65536),
      eof: z.boolean().default(false),
    }),
    z.object({ accepted: z.boolean() }),
  ),
  tool(
    "job_wait",
    "Jobs",
    "read",
    "Wait up to 15 seconds for an owned job to finish; returns actual status when the wait expires. Repeat while running.",
    z.object({
      workspaceId: id,
      jobId: id,
      timeoutMs: z.number().int().min(0).max(15000).default(10000),
    }),
    job,
  ),
  tool(
    "toolchain_info",
    "Projects",
    "read",
    "Inspect installed Node/npm/pnpm/Python/Git executable paths. Null means missing; core file tools use the bundled Node runtime.",
    scope,
    z.object({
      tools: z.array(
        z.object({ name: z.string(), path: z.string().nullable() }),
      ),
      platform: z.string(),
      bundledNode: z.string(),
    }),
  ),
  tool(
    "project_install",
    "Projects",
    "execute",
    "Install project dependencies with its detected package manager and existing lockfile. Returns a persistent job; installation hooks remain inside the native sandbox in Full Access.",
    scope,
    job,
  ),
  tool(
    "project_run_script",
    "Projects",
    "execute",
    "Run an actual package.json script, with literal args and an optional persistent server job.",
    scope.extend({
      script: z.string().min(1),
      args: z.array(z.string()).max(100).default([]),
      persistent: z.boolean().default(false),
    }),
    job,
  ),
  tool(
    "project_validate",
    "Projects",
    "execute",
    "Run declared validation scripts and return jobs with actual logs/exit codes. Missing scripts are errors, not successful checks.",
    scope.extend({
      checks: z
        .array(z.enum(["typecheck", "lint", "test", "build"]))
        .min(1)
        .max(4)
        .default(["build"]),
    }),
    z.object({ jobs: z.array(job) }),
  ),
  tool(
    "git_init",
    "Git",
    "execute",
    "Initialize a local repository within the workspace; uses the same execution policy as terminal jobs.",
    scope,
    job,
  ),
  tool(
    "git_stage",
    "Git",
    "execute",
    "Stage explicit workspace-relative paths in a contained repository; no outside Git metadata or hooks.",
    scope.extend({ paths: z.array(z.string().min(1)).min(1).max(100) }),
    job,
  ),
  tool(
    "git_commit",
    "Git",
    "execute",
    "Create a local commit with the supplied message and no hooks. Configure project-local Git identity first if needed.",
    scope.extend({ message: z.string().min(1).max(8192) }),
    job,
  ),
  tool(
    "git_branch",
    "Git",
    "execute",
    "Create or switch a local branch in a contained repository. Switching can change project files.",
    scope.extend({
      action: z.enum(["create", "switch"]),
      branch: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z0-9][A-Za-z0-9/_\.\-]*$/),
    }),
    job,
  ),
  tool(
    "preview_start",
    "Projects",
    "execute",
    "Start a persistent local dev server once using an actual package script. Choose an available port, bind loopback, and return job/url/readiness. Call preview_status until ready; browser_open inspects it.",
    scope.extend({
      script: z.string().default("dev"),
      port: z.number().int().min(1024).max(65535).optional(),
    }),
    preview,
  ),
  tool(
    "preview_status",
    "Projects",
    "read",
    "Inspect an owned managed preview and its live HTTP readiness.",
    z.object({ jobId: id }),
    preview,
  ),
  tool(
    "preview_stop",
    "Projects",
    "execute",
    "Stop an owned managed dev server and its child processes.",
    z.object({ jobId: id }),
    job,
  ),
  tool(
    "browser_prepare",
    "Browser",
    "execute",
    "On demand, download pinned Playwright Chromium into this workspace's runtime. Requires Full Access. Wait for the returned job before browser_open; nothing is installed at idle.",
    z.object({ workspaceId: id }),
    job,
  ),
  tool(
    "browser_open",
    "Browser",
    "execute",
    "Open an owned ready preview in a fresh isolated browser session under the native workspace sandbox. Only managed preview navigation is permitted.",
    scopedJob.extend({
      width: z.number().int().min(320).max(1920).default(1440),
      height: z.number().int().min(320).max(1440).default(900),
    }),
    z.object({ sessionId: id, url: z.string(), title: z.string() }),
  ),
  tool(
    "browser_snapshot",
    "Browser",
    "read",
    "Read an owned preview's accessibility tree, title, URL and real console/network errors.",
    z.object({ workspaceId: id, sessionId: id }),
    snapshot,
  ),
  tool(
    "browser_action",
    "Browser",
    "execute",
    "Click, fill, press a key or reload in an owned preview session. No arbitrary JavaScript execution or external navigation.",
    browserActionSchema,
    snapshot,
  ),
  tool(
    "browser_screenshot",
    "Browser",
    "write",
    "Capture an owned preview as immutable PNG evidence and actual MCP image content. Optional path saves a checkpointed workspace copy. Capture a viewport, locator, or bounded clip tile for long pages.",
    z.object({
      workspaceId: id,
      sessionId: id,
      path: z.string().min(1).optional(),
      fullPage: z.boolean().default(false),
      selector: z.string().max(1000).optional(),
      locator: locatorSchema.optional(),
      clip: z
        .object({
          x: z.number().min(0),
          y: z.number().min(0),
          width: z.number().min(1).max(1920),
          height: z.number().min(1).max(1440),
        })
        .optional(),
    }),
    z.object({
      path: z.string().optional(),
      bytes: z.number(),
      changeId: id.optional(),
      artifact: artifactSchema,
    }),
  ),
  tool(
    "browser_close",
    "Browser",
    "execute",
    "Close an owned browser session and terminate its process tree.",
    z.object({ workspaceId: id, sessionId: id }),
    z.object({ closed: z.boolean() }),
  ),
);
catalog.push(...developmentCatalog);
for (const tool of catalog) {
  const input = tool.input as z.ZodObject;
  if (!input.shape.planId && !input.shape.taskId)
    tool.input = input.extend({ planId: id.optional(), taskId: id.optional() });
}
