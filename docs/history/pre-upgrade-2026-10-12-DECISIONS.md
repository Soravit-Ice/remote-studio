# Current native workspace development decisions — 2026-10-12

The user explicitly selected native sandboxing, Mac and Windows, and per-folder continuous Full Access. This supersedes the earlier review-only execution/file policy below. All commands now require the native backend; Full Access uses explicit intersected folder/client grants, while Reviewed retains approval. Native browser workers inherit the outer policy and use private pipes; Chromium inner sandboxing is disabled to avoid forbidden nested Seatbelt initialization. Structural/binary file checkpoints support conflict-checked recovery. Startup interrupts both running and queued jobs and cleans owned native launches without replay. Windows helper source and build/test handoff are included, but Windows execution is unverified. See docs/WORKSPACE-FULL-ACCESS.md and docs/SECURITY.md for current boundaries.

## Earlier preview decisions (historical)

# Architecture decisions

## 2026-10-10: Desktop and SDK

Use Electron 44.7.0, electron-vite 5.0.0, React 19.3.0, Tailwind 4.3.3, Radix primitives and shadcn-style owned components. The renderer never executes privileged code. The official stable MCP v2 packages are `@modelcontextprotocol/server` and `@modelcontextprotocol/client`, both pinned to 2.3.1; `serveStdio` selects the compatible protocol era.

Registry metadata and official docs were inspected before implementation. The latest Vite 8.3.4 is outside electron-vite 5’s supported peer range and incorrectly bundled Electron during initial testing, so the app uses Vite 7.3.7 / React plugin 5.2.0. TypeScript 7.0.2 is not supported by typescript-eslint 8.71.1, so the host app uses TypeScript 6.0.3. The independently built React template uses TypeScript 7.0.2 and includes `vite/client` ambient types.

## Agent and transport

One independent Node process hosts SQLite and services, accessed over a private Unix socket or Windows named pipe. The agent and bridge are bundled with esbuild. Packaged execution uses the bundled Electron executable with `ELECTRON_RUN_AS_NODE=1`, outside ASAR. This avoids a global Node dependency. The process is separate from the main window and MCP connection lifecycle, but an OS-managed helper installer and service registration have not been implemented. Explicit Quit intentionally stops the preview agent.

The UI token and client tokens are distinct. The database stores only hashes of client tokens. Client credential files are private and referenced by generated configurations, so plaintext tokens are not copied into AI-client JSON/TOML. Future releases should replace private files with OS credential storage and harden Windows ACLs.

The optional ChatGPT connection uses OpenAI's official Secure MCP Tunnel with the existing stdio bridge. The desktop creates a dedicated scoped client grant, verifies that bridge with the official SDK v2, and supervises the official external tunnel runtime. The agent remains off TCP. Only the runtime's health listener uses an ephemeral loopback port; no public ingress or custom OAuth gateway is introduced.

The runtime API key is encrypted through Electron safeStorage and stored as private ciphertext separately from a nonsecret JSON config. Plaintext fallback is refused, including Linux basic_text. The renderer receives only hasKey. Keys are passed to the owned runtime in its minimal environment, never in argv or JSON config; the bridge deletes inherited upstream API-key variables. The native executable picker cannot receive a path or arbitrary command from renderer input. Generated stdio argv is quoted for tunnel-client's parser and launched without a shell.

Local bridge evidence, process liveness/readiness, successful OpenAI poll timestamps, and manual ChatGPT plugin setup are separate states. Runtime readiness alone does not imply upstream authentication. Installing a plugin remains a user action in the appropriate ChatGPT account and workspace. Auto-start is opt-in on application launch; window-close-to-tray keeps the runtime alive, while Stop, revocation and Quit terminate the owned process group. Abrupt desktop crashes and Windows process-tree behavior still require platform hardening.

## Persistence

Use Node’s built-in SQLite API in the agent with WAL and atomic job claiming. This removes native-addon ABI/rebuild complexity. Drizzle is intentionally omitted because this small schema uses fixed prepared SQL with typed service boundaries. The database stores workspaces, settings, client grants, change checkpoints, audit entries, and a durable job state machine.

Running jobs found after an agent restart become `interrupted`, never automatically retried. Retrying always creates a fresh approval request. Approved queued jobs may start once execution is permitted. Process output is bounded to 128 KiB. Audit retention is currently a fixed 2,000 entries; configurable retention and checkpoint lifecycle remain tasks.

## File editing

Symlinks are refused instead of attempting permissive symlink resolution. Text tools cap individual reads at 2 MiB, reject NUL-containing binary content, and require exact SHA-256 preconditions. All writes are first proposals; existing and new files are only changed after local review. Recovery stores actual original text and checks the post-change hash before Undo. File creation proposals require their parent directory to already exist.

Atomic replacement preserves ordinary file modes. File-content restoration supports UTF-8 text; it is not a byte-preserving backup pipeline for arbitrary encodings. A malicious local process can still race ancestor renames; full OS-level handle-relative filesystem isolation remains a release hardening task.

## Execution policy

Every command requires local UI approval, including commands from a client with an execute-enabled folder. Spawn uses executable plus argument array, with `shell:false`, a minimal inherited environment, a reviewed timeout, and a tracked process group. Workspace trust is explicit. This is not a security sandbox. Windows shell built-ins / `.cmd` wrappers require an explicit reviewed `cmd.exe` invocation; do not silently enable shell execution.

Git inspection disables optional locks, global config, hooks, fsmonitor, external diff and text conversion. Mutating Git operations are not registered. Additional repository-discovery isolation requires more adversarial testing before release.

## Verified source references

- [Official MCP v2 packages](https://github.com/modelcontextprotocol/typescript-sdk)
- [SDK v2 client API](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-client.html)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [electron-vite setup](https://electron-vite.org/guide/)
- [Node SQLite](https://nodejs.org/api/sqlite.html)
- [shadcn Vite integration](https://ui.shadcn.com/docs/installation/vite)
- [Cursor MCP configuration](https://cursor.com/docs/mcp)
- [Claude local server setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
