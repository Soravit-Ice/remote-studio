# Workspace development access

Remote Studio now exposes 75 implemented MCP tools. Each connection has explicit folder grants and one of `Read only`, `Reviewed`, or `Workspace Full Access`. The effective permissions intersect the folder grant, the connection’s grant for that folder, and enabled modules. A write-enabled folder does not make a read-only connection writable. Existing connections retain their grants unless changed explicitly.

In **Connections → Edit ChatGPT settings**, select each allowed folder and its access mode. Full Access enables that folder’s write/execute grants after a real native sandbox probe. Saving replaces only that ChatGPT connection’s scoped grant and keeps the saved OS-encrypted runtime key when its field is blank. Other connections have independent grants. Their **Permissions** button edits their existing credential’s scopes.

After changing grants or updating Remote Studio, reconnect stdio clients. In ChatGPT, **Refresh the connection’s tools and start a new chat** as described in [OpenAI’s connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt). The bridge publishes the permitted tools at initialization and rechecks current grants on every call. Old metadata cannot override a revoked grant.

Use one running tunnel runtime per tunnel ID. Two runtimes using the same ID can deliver calls to different MCP servers and expose inconsistent tool metadata. At startup Remote Studio checks other local tunnel-client processes, explicit tunnel-ID arguments and named YAML profiles. A detected collision blocks startup with the PID/profile and remediation; it does not stop or change the other application. Stop that runtime explicitly or configure an independent tunnel ID, then Refresh tools. This local check cannot inspect remote machines or routing supplied only through another process's environment.

Full Access file tools return `applied` only after writing to disk. Reviewed tools return `pending` and wait in Activity. Structural and binary changes retain byte-preserving checkpoints; Undo and `file_restore` refuse conflicting external edits. Terminal commands retain actual status, log cursor and exit code; their effects do not have a universal Undo.

## Development workflow

All file/project paths are relative to the selected workspace; use `/` separators. Job and browser IDs are bound to their originating client and folder.

1. `workspace_list` / `permission_status`: inspect the effective grants and reasons.
2. `directory_create`: create nested folders; or `project_create` with `react-vite`, `astro`, `next`, `next-fullstack`, `electron`, experimental `tauri`, `empty`, or `custom` in a new child directory or an empty root (`path: "."`). Existing roots are refused.
3. `file_write`, `file_patch_many`, `file_batch`, binary write, copy/move/delete: edit using current hashes. Read first; `expectedHash: null` means the file must not exist.
4. `toolchain_info`, `project_install`: inspect installed tools and use the detected lockfile/package manager. Project scripts and install hooks execute inside the native scope. Framework CLIs can run through `command_execute` or the explicit `shell_execute` tool.
5. `project_run_script` / `project_validate`: run actual declared scripts. Poll `job_status`, `job_wait`, and `job_logs`; a missing script or failed command is an error.
6. `preview_start`: run the declared dev script as a persistent loopback job. Poll readiness, then use its job ID with `browser_open`. `browser_prepare` downloads pinned Chromium on demand into this folder before first use.
7. `browser_snapshot`, `browser_action`, `browser_screenshot`: inspect the real page, use role/text/test-id/CSS locators, navigation/viewport/hover/scroll/waits, and retain actual diagnostics and immutable PNG evidence (also MCP image content). Optional path stores a checkpointed workspace copy. Each session has a fresh context and only managed preview navigation is permitted. Control uses private process pipes, without a public CDP endpoint.
8. `git_init`, `git_stage`, `git_commit`, `git_branch`: perform local Git work, with hooks disabled and contained metadata. Commit identity must be configured locally. Read status/diff/log are also available.

Preview jobs survive an MCP client disconnect. Revoking a folder/connection stops its jobs and browser sessions. Quit stops the agent by default; the opt-in Background service can preserve explicitly authorized work. Restart interrupts old jobs and recovers owned native processes using their recorded birth identity; old work is never replayed automatically.

Use `project_context`/`code_query` before editing existing projects. Link operations to a persistent plan with `planId`/`taskId`, verify criteria with `task_verify`, and resume with `plan_resume` after interruption. Read evidence with scoped `artifact_read`, and use `browser_check`/`browser_compare` for actual UI diagnostics/diffs. Skills and secret bindings are managed in the native UI; desktop tools currently automate Electron.

## Native boundaries and limits

macOS uses `/usr/bin/sandbox-exec` with a pinned, attributed OpenAI Seatbelt baseline and project-specific grants. Windows builds a native LPAC/AppContainer launcher with Job Objects and unique per-launch SID ACL entries. Native startup failure is reported; no command is launched unrestricted as a fallback, including in Reviewed mode.

HOME, package caches and temp files live in `.remote-studio/runtime` under the workspace. Bootstrap creation itself runs inside the native policy, avoiding a privileged agent write through a swapped ancestor. The environment excludes agent/tunnel/API credentials and global Git config. Public TLS certificates are exported separately; private keys are not copied. Runtime directories are read-only; unrelated projects are denied. Network is allowed for dependencies/services, with server binding restricted to loopback on macOS. Managed preview flags bind loopback on both platforms.

The browser worker and every Chromium descendant inherit the outer native scope. Chromium’s inner sandbox is disabled deliberately because macOS forbids nested Seatbelt initialization. This does not launch a browser outside the native boundary. It means browser content is isolated to the workspace with the same outer policy, rather than Chromium’s usual narrower child policies. The browser receives only controlled preview commands, without arbitrary evaluation tools.

File tools reject symlinks/junctions, hard links, protected metadata/secret paths, ambiguous Windows device/stream paths, and workspace-root mutation. Scoped commands can operate on project metadata such as `.git`, while OS isolation prevents filesystem escapes. File writes are bounded to 2 MiB per file; checkpoints are bounded to 10,000 entries / 32 MiB and worker requests to 48 MiB. Use scoped commands for larger assets; their history is not a checkpoint.

The agent still uses private credential files for local MCP credentials. Release signing/notarization, a production security audit, Intel Mac verification, and actual Windows execution remain release gates. macOS results do not certify Windows. The older DOCX guide describes the Reviewed-only preview; this Markdown guide defines the new access modes.
