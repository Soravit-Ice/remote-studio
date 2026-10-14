# Implemented MCP tools

84 registered tools. Inputs/outputs are validated with MCP SDK v2. Structured results retain `{ data }`; screenshot, video-frame and image-artifact tools also return MCP image content. Every call checks current workspace/client grants, module state and ownership.

Full Access applies checkpointed writes and queues native sandbox jobs without repeated approval. Reviewed actions may await trusted local approval. There is no unrestricted command fallback. Paths are workspace-relative; artifacts are read by scoped ID.

Tools accept optional `planId` and `taskId` together to record attempts, jobs, changes and evidence. Completion is only established through `task_verify`. Source/environment changes invalidate affected verification. `plan_resume` restores context without replaying writes or commands.

Browser screenshots support viewports, role/text/test-id/CSS locators and clip tiles. Original bytes, hashes, source revisions, capture time and viewport metadata are stored privately. `browser_check` stores an actual JSON diagnostics report; keyboard output is an eight-step focus sample, not a complete keyboard accessibility certification. Desktop tools automate Electron windows, with no arbitrary main-process evaluation.

Skills can also be listed/read as MCP resources. Import/update/enable/script authorization happen in the native UI; `allowed-tools` cannot increase grants. Environment tools reveal names/status only, with values restored from the OS-backed vault and injected into bound jobs.

| Tool | Module | Permission | Behavior |
| --- | --- | --- | --- |
| `video_guide` | Video | read | Read the complete authoring/execution workflow without installing runtimes. |
| `video_project_create` | Video | write | Save the brief and pinned HyperFrames/GSAP starter with file checkpoints. |
| `video_inspect` | Video | read | Read static root settings and source/asset revision. |
| `video_validate` | Video | execute | Start lint, timeline or complete browser check; wait and inspect actual findings. |
| `video_snapshot` | Video | execute | Capture 1–8 exact timestamps; status returns immutable PNG evidence and MCP images. |
| `video_preview` | Video | execute | Start/reuse an owned loopback Studio; status checks HTTP readiness; stop via job_cancel. |
| `video_render` | Video | execute | Encode unique MP4/WebM/MOV files after a current successful check; verify with FFprobe. |
| `video_status` | Video | read | Actual status, findings, source freshness, frames, verified metadata and local file paths. |
| `video_output_read` | Video | read | Bounded 512 KiB binary chunks of completed owned video; no public hosting is implied. |
| `workspace_list` | Files | read | List authorized folders and their independent read, write, and execution grants. |
| `workspace_info` | Files | read | Inspect one authorized workspace by ID. |
| `file_list` | Files | read | List a directory with pagination. Protected paths are omitted; symbolic links are never followed. |
| `file_read` | Files | read | Read a UTF-8 text file up to 2 MiB and get its SHA-256 hash for safe edits. |
| `file_search` | Files | read | Recursively search filenames or text. Skips binaries, dependencies, and protected files; bounded to 5000 entries. |
| `file_write` | Files | write | Create or replace a file. Workspace Full Access applies immediately with a checkpoint; Reviewed returns pending for Activity approval. expectedHash=null for new files; read existing files first. |
| `file_patch` | Files | write | Apply a unique exact text replacement in Full Access, or propose it in Reviewed mode. Rejects ambiguous matches and stale hashes. |
| `file_diff` | Files | read | Inspect the original and proposed content of a change owned by this client. |
| `file_restore` | Files | write | Request restoration of an applied checkpoint through LOCAL approval. Does not overwrite newer content. |
| `command_execute` | Terminal | execute | Run an executable with literal arguments. Full Access starts immediately in a native workspace sandbox; Reviewed awaits local approval. persistent=true keeps dev servers alive without a timeout. Use job_wait/logs/input/cancel to continue. |
| `job_list` | Jobs | read | Page this client's persistent jobs using limit/offset. Returns summaries by default; request actual output with job_logs or job_status. Status is based on actual execution. |
| `job_status` | Jobs | read | Get a persistent job status, exit code, and bounded actual output. |
| `job_logs` | Jobs | read | Read captured stdout and stderr from a job owned by this client. |
| `job_cancel` | Jobs | execute | Cancel this client’s pending or running job and terminate its tracked process group. |
| `project_create` | Projects | write | Create React/Vite, empty or supplied-source projects in a new child folder or path='.' for an empty workspace root. Never overwrite existing files. Full Access applies immediately; Reviewed returns a checkpoint for approval. Then use project_install, project_validate, preview_start and browser tools. |
| `project_inspect` | Projects | read | Detect the framework, package manager, and actual package.json scripts. |
| `git_status` | Git | read | Inspect Git status without modifying repository files. Git hooks, external diff tools, and optional locks are disabled. |
| `git_diff` | Git | read | Read bounded Git diff with external diff drivers and text converters disabled. |
| `git_log` | Git | read | Read the last 20 commits from an authorized repository. |
| `system_info` | System | read | Report OS platform, architecture, runtime versions, and agent memory; no environment secrets. |
| `permission_status` | System | read | Inspect current grants for this client. Permissions can only be changed through the trusted local UI. |
| `directory_create` | Files | write | Create a nested directory, including missing parents, within the selected folder. Full Access applies immediately; Reviewed requires Activity approval. |
| `file_write_binary` | Files | write | Create or replace an image or other binary asset up to 2 MiB from base64; preserves actual bytes for Undo. |
| `file_delete` | Files | write | Delete a file or directory with a recoverable checkpoint. Set recursive=true for nonempty directories. Workspace root and protected paths cannot be deleted. |
| `file_copy` | Files | write | Copy a file or directory within one workspace. Destination must not exist; symlinks and protected content are rejected. |
| `file_move` | Files | write | Move or rename a file/directory within one workspace without overwriting. A checkpoint restores both paths. |
| `file_batch` | Files | write | Create or replace up to 100 files as one reviewed or immediately applied checkpoint. Prevalidates all hashes and rolls back tool-owned writes on failure. |
| `file_patch_many` | Files | write | Patch multiple distinct files with exact unique replacements and current hashes as one checkpoint. |
| `shell_execute` | Terminal | execute | Run an explicitly requested shell command with operators/pipes. Full Access uses native folder isolation; shell profiles and inherited secrets are excluded. Use cwd relative to workspace, persistent=true for servers. |
| `job_input` | Jobs | execute | Send stdin to an owned running job; set eof=true to close input. Input is excluded from audit logs. |
| `job_wait` | Jobs | read | Wait up to 15 seconds for an owned job to finish; returns actual status when the wait expires. Repeat while running. |
| `toolchain_info` | Projects | read | Inspect installed Node/npm/pnpm/Python/Git executable paths. Null means missing; core file tools use the bundled Node runtime. |
| `project_install` | Projects | execute | Install project dependencies with its detected package manager and existing lockfile. Returns a persistent job; installation hooks remain inside the native sandbox in Full Access. |
| `project_run_script` | Projects | execute | Run an actual package.json script, with literal args and an optional persistent server job. |
| `project_validate` | Projects | execute | Run declared validation scripts and return jobs with actual logs/exit codes. Missing scripts are errors, not successful checks. |
| `git_init` | Git | execute | Initialize a local repository within the workspace; uses the same execution policy as terminal jobs. |
| `git_stage` | Git | execute | Stage explicit workspace-relative paths in a contained repository; no outside Git metadata or hooks. |
| `git_commit` | Git | execute | Create a local commit with the supplied message and no hooks. Configure project-local Git identity first if needed. |
| `git_branch` | Git | execute | Create or switch a local branch in a contained repository. Switching can change project files. |
| `preview_start` | Projects | execute | Start a persistent local dev server once using an actual package script. Choose an available port, bind loopback, and return job/url/readiness. Call preview_status until ready; browser_open inspects it. |
| `preview_status` | Projects | read | Inspect an owned managed preview and its live HTTP readiness. |
| `preview_stop` | Projects | execute | Stop an owned managed dev server and its child processes. |
| `browser_prepare` | Browser | execute | On demand, download pinned Playwright Chromium into this workspace's runtime. Requires Full Access. Wait for the returned job before browser_open; nothing is installed at idle. |
| `browser_open` | Browser | execute | Open an owned ready preview in a fresh isolated browser session under the native workspace sandbox. Only managed preview navigation is permitted. |
| `browser_snapshot` | Browser | read | Read an owned preview's accessibility tree, title, URL and real console/network errors. |
| `browser_action` | Browser | execute | Click, fill, press a key or reload in an owned preview session. No arbitrary JavaScript execution or external navigation. |
| `browser_screenshot` | Browser | write | Capture an owned preview as immutable PNG evidence and actual MCP image content. Optional path saves a checkpointed workspace copy. Capture a viewport, locator, or bounded clip tile for long pages. |
| `browser_close` | Browser | execute | Close an owned browser session and terminate its process tree. |
| `design_preset` | Projects | read | Read an owned project's design preset tokens, semantic CSS and verification checklist. |
| `design_registry_inspect` | Projects | read | Inspect a bounded official shadcn registry item before installation. Returns files/dependencies and a content hash without executing code. |
| `design_registry_add` | Projects | write | Apply the exact inspected official registry item using conflict-checked file checkpoints and configured aliases. Does not execute scripts or silently install dependencies. |
| `asset_inspect` | Projects | read | Inspect local asset sizes, formats, supported dimensions, hashes and duplicates. Large or unsupported assets are reported explicitly. |
| `git_checkpoint` | Git | execute | Create an internal checkpoint ref for explicit files using an isolated Git index. Preserve the current branch, user's staging area and existing dirty changes. Returns a real native job; does not hard-reset or stash. |
| `project_environment` | Projects | read | Inspect required/configured local environment variable names, connection authorization and loaded status. Never returns values. |
| `skill_list` | Skills | read | Discover global and workspace Agent Skills with content hashes, resources, enabled state and compatibility. Scripts are never run on import. |
| `skill_read` | Skills | read | Read an enabled skill's SKILL.md and metadata. Skill instructions and allowed-tools do not grant host permissions. |
| `skill_resource` | Skills | read | Read one integrity-checked resource from an enabled skill by a contained relative name. |
| `skill_run` | Skills | execute | Run a script from the exact locally authorized skill version inside the workspace sandbox. A Reviewed staging change and command may await local approval. Changed script bytes are rejected. |
| `desktop_launch` | Desktop | execute | Launch a built or packaged Electron project inside the native workspace scope with isolated test userData. packagedPath is a workspace-relative .app (macOS) or .exe (Windows). If the pinned project runtime is missing, return phase=preparing and an actual installation job; wait and retry. No arbitrary main-process evaluation is exposed. |
| `desktop_status` | Desktop | read | Inspect actual owned app process/window state. |
| `desktop_snapshot` | Desktop | read | Read the actual owned Electron window accessibility tree and diagnostics. |
| `desktop_action` | Desktop | execute | Interact with an owned Electron window using bounded locators. Native main-process evaluation and external navigation are not exposed. |
| `desktop_screenshot` | Desktop | write | Capture an actual Electron window as immutable PNG evidence and MCP image content. |
| `desktop_stop` | Desktop | execute | Close this client's owned native app and its worker/process tree. |
| `plan_create` | Planning | write | Persist a Quick/Auto/Full plan with task dependencies and concrete verification criteria. ChatGPT authors the plan; no model is called by Remote Studio. |
| `plan_get` | Planning | read | Read the owned plan, actual attempts, evidence, next tasks and progress. Changed source invalidates related verification. |
| `plan_update` | Planning | write | Update metadata, pause/cancel, or replace unexecuted tasks using the current revision. Cancellation stops only owned plan jobs. |
| `plan_resume` | Planning | write | Restore persisted context and recheck source/grants after interruption. Does not replay commands or changes. |
| `task_update` | Planning | write | Set a task pending/running/blocked/cancelled or record an assessment. Completed is controlled by task_verify and actual evidence. |
| `task_verify` | Planning | execute | Verify files, declared scripts, screenshots or browser quality against acceptance criteria. Repeat while verifying to collect actual job results; failed or stale checks never complete a task. |
| `artifact_read` | Planning | read | Read an owned immutable artifact by ID with integrity verification. PNG results also return actual MCP image content; the original hash/dimensions remain in metadata. |
| `browser_check` | Browser | write | Inspect the actual preview for WCAG accessibility violations, horizontal overflow, broken images, keyboard focus and runtime/network errors. Store a scoped immutable JSON report. |
| `browser_compare` | Browser | write | Compare two actual owned PNG artifacts at matching dimensions. Return a diff PNG, changed-pixel ratio and baseline source revision; this is not a subjective design score. |
| `project_context` | Projects | read | Map an authorized codebase including packages, routes, configs, assets, APIs and actual scripts. Report incomplete scans honestly. |
| `code_query` | Projects | read | Query JS/TS source symbols, definitions, references, diagnostics, or text. Runs the TypeScript language service in an isolated data-only worker; package code/plugins are never executed. Dependency types excluded from the source-only index are reported as a limitation. |
