# Remote Studio

A local-first Electron desktop application that connects compatible AI assistants to explicitly authorized folders and native scoped development tools. Source lives in the requested `Remotestudio` folder; the product name is **Remote Studio**.

This source prepares a licensed release candidate. Real customer activation, signing and platform acceptance remain commercial release gates. The advanced and release milestones in the original brief remain tracked in [TASKS.md](TASKS.md).

Source: [remote-studio](https://github.com/Soravit-Ice/remote-studio). Installers: [remote-studio-releases](https://github.com/Soravit-Ice/remote-studio-releases). Matching version tags build and test installers, publish immutable GitHub assets, and submit them to Store for verification. Follow the [Thai release setup guide](docs/RELEASE_TO_STORE_TH.md) before tagging.

Thai usage manual: [Remote Studio and ChatGPT Web guide](docs/Remote-Studio-User-Guide-TH.docx). It covers local setup, reviewed operations, and the in-app Secure MCP Tunnel configuration flow.

## Run

Use Node satisfying the package.json engine requirement and pnpm 11.5.2. This host was tested with Node 25.8.0 on macOS Apple Silicon.

```sh
cd remote-studio
pnpm install
pnpm dev
```

For a built UI ready to try, run `pnpm build` and then `pnpm start`. Quit older instances first; disable Background service before switching builds. When developing Remote Studio through its own tools, use the built UI and explicit restarts; active HMR source is protected.

The historical personal preview is `release/personal/mac-arm64/Remote Studio.app`; the licensed candidate is built separately under `release/license-rc`. Quit existing instances before switching builds. Rebuild it with `pnpm dist:mac:local`. It preserves the normal app's data and grants. New source builds include license enforcement; activate RS in Settings → License before protected work.

The packaged application uses its bundled Electron/Node runtime for the agent and stdio bridge. Users do not need a global Node installation for the core file tools. Project builds require the project’s own toolchain, diagnosed separately.

## What works

- Six desktop destinations, native directory selection, multiple persisted folders, independent read/write/execute grants, groups and names, light/dark/system themes, and first-run onboarding.
- Authenticated local Unix socket / Windows named-pipe agent. Separate UI credentials and revocable per-client credentials with explicit folder scopes.
- Official MCP SDK v2 stdio bridge, with validated input and output schemas and 75 implemented tools. See [docs/TOOLS.md](docs/TOOLS.md).
- File/folder operations, batch edits, binary assets and safe checkpoints/Undo, with Reviewed and immediate Full Access modes.
- Persistent SQLite command jobs, Reviewed or explicitly authorized Full Access execution inside the native sandbox, real stdout/stderr, exit codes, timeouts, bounded output, cancellation, process-group cleanup, idempotency, and interrupted-job recovery without replay.
- React/Vite, Astro/React, Next, local full-stack and Electron starters; bounded source intelligence, monorepo context and TS aliases. Tauri is an experimental scaffold.
- Git init/stage/commit/branch plus status/diff/log. Managed dev-server jobs and scoped Playwright page inspection, interaction and screenshots. Module enable/disable and a full local audit history.
- Scoped local connection configuration, configuration backup/merge for Claude Desktop and Cursor, copyable JSON/TOML, real MCP diagnostic handshake and tool-list checks.
- Close-to-tray behavior, native notifications, remembered window bounds, and explicit Quit semantics.
- Renderer crash recovery, a startup fallback and React error screen, bounded native startup diagnostics, disconnected-agent status and safe service reconnection without replaying work.

- Persistent plans, verification gates, explicit resume and task-bound image/diagnostic evidence.
- Scoped Skills, OS-backed project environment, safe Git checkpoints, Activity pagination and opt-in background helper.

## Important behavior

Folder and connection permissions must both allow the action. **Read only** hides write/execute tools; **Reviewed** waits for local approval; **Workspace Full Access** applies writes and starts commands continuously inside the native sandbox. Commands use Seatbelt on macOS or the built native LPAC helper on Windows, with no unrestricted fallback. File tools keep conflict-checked checkpoints; general command effects have no universal Undo.

Use [the current workspace access guide](docs/WORKSPACE-FULL-ACCESS.md) for setup and all development tools, and [the Windows verification handoff](docs/WINDOWS-VERIFICATION.md) for building/testing on another machine. The older DOCX describes the earlier Reviewed-only preview. Window close can keep jobs/tunnel active in the tray. Quit stops them by default; Background service is an explicit opt-in. A client disconnect does not stop a persistent preview. Restart interrupts old work without replay and recovers owned native processes.

Connection **Configured** means credentials were created. **Handshake verified** means the app’s diagnostic client performed a real MCP connection and tool call. It does not prove Claude, Cursor or Codex currently has an active connection. Module changes take effect on execution immediately; reconnect a stdio client to refresh its advertised tool list.

ChatGPT Web setup is available in **Connections → Set up ChatGPT Web**. Create a separate OpenAI tunnel for Remote Studio, enter its Tunnel ID and a runtime key with Tunnels Read + Use, select each folder's access mode, then **Save & start**. One running runtime should use each tunnel ID; the app blocks known local routing collisions. The app detects the official Homebrew runtime on macOS, encrypts the key using Electron OS-backed safeStorage, verifies the local MCP bridge, supervises the outbound tunnel, and displays local health, readiness, and the last successful OpenAI poll separately. A native picker supports other official runtime locations. New folders are never automatically added to the tunnel's scope.

Use **Open ChatGPT** to open Plugins, then **+ → Add custom MCP server → Connection: Tunnel**, select or paste the Tunnel ID, review authentication and warnings, and create/install the plugin. Test `workspace_list` from a chat. The tunnel needs Tunnels Read + Use and association with the target ChatGPT workspace. These steps follow [OpenAI's official Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels). Refresh the connection’s tools and start a new chat after grants/tools change, following [OpenAI’s metadata refresh guide](https://developers.openai.com/plugins/deploy/connect-chatgpt). Runtime and actual ChatGPT call evidence are recorded separately.

The agent keeps its private socket/pipe. The tunnel opens outbound HTTPS and an ephemeral loopback-only health listener. Runtime ready confirms local readiness, which can precede successful OpenAI authentication or a ChatGPT plugin install. **Run checks**, **Stop tunnel**, optional **Start tunnel when Remote Studio opens**, and **Edit ChatGPT settings → Remove** manage the saved setup. Closing to tray preserves the tunnel; Quit stops it unless Background service is enabled. Do not also run an external client with the same stdio tunnel ID.

## Commands

| Command                              | Purpose                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `pnpm dev`, `pnpm dev:desktop`       | Bundle services and launch Electron with Vite HMR                         |
| `pnpm dev:agent`                     | Run the independent agent with tsx                                        |
| `pnpm build`, `pnpm start`           | Production build / launch built Electron application                      |
| `pnpm typecheck`, `pnpm lint`        | TypeScript and ESLint verification                                        |
| `pnpm test`, `pnpm test:integration` | Full suite, including real template builds and optional runtime downloads |
| `pnpm test:core`                     | Core regression without the extended template matrix                      |
| `pnpm test:templates`                | Real Astro/Next/full-stack/Electron project acceptance                    |
| `pnpm test:mcp`                      | Build services and run a real SDK-v2 stdio client test                    |
| `pnpm test:e2e`                      | Build and drive the real Electron app with Playwright                     |
| `pnpm doctor`                        | Check actual runtime, Git, optional FFmpeg and SQLite availability        |
| `pnpm dist:dir`                      | Create a native unpacked application for smoke testing                    |
| `pnpm dist:mac`                      | Build DMG targets for Apple Silicon and Intel                             |
| `pnpm dist:mac:local`                | Build the unsigned Apple Silicon personal app under `release/personal`    |
| `pnpm dist:win`                      | Build Windows x64 NSIS installer; verify on Windows                       |

Integration tests use temporary folders and never run destructive tests against personal workspaces. The scaffold test downloads public React/Vite dependencies into a temporary directory. E2E tests simulate native picker results using real temporary directories. Tunnel tests use a clearly identified local process fixture for lifecycle checks; an additional optional test uses the installed official `tunnel-client` with a loopback control-plane fixture and the real MCP bridge. Neither sends test keys to OpenAI. Set `STUDIO_TEST_TUNNEL_RUNTIME` to an official executable for that test on a machine without a standard Homebrew installation.

## Packaging

Build on the target operating system. `electron-builder` includes the bundled agent and bridge outside ASAR via `extraResources`. SQLite comes from Node’s built-in `node:sqlite`; no native SQLite addon needs ABI rebuilding.

Unsigned local macOS preview:

```sh
pnpm build
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac dmg --arm64 --config.mac.notarize=false
```

For a signed macOS release, supply `CSC_LINK`, `CSC_KEY_PASSWORD`, and Apple notarization credentials (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, or supported Apple ID credentials) through CI secrets. Windows signing credentials must also be supplied by the release operator. Signing and notarization have not been performed in this preview. There is no automatic updater.

## Data and architecture

macOS state: `~/Library/Application Support/Remote Studio`. Windows: `%APPDATA%/Remote Studio`. `STUDIO_DATA_DIR` overrides the location for controlled testing. The directory and credential files use restrictive POSIX permissions; Windows ACL hardening remains a release task.

```text
AI client → stdio bridge → authenticated local agent → permissions → services → OS
ChatGPT → OpenAI tunnel → outbound tunnel-client → same stdio bridge
React renderer → narrow preload API → sender-validated Electron IPC → same agent
```

The renderer has no Node integration or unrestricted IPC. The main process handles native UI only; SQLite, file operations and execution run in the independent agent. See [DECISIONS.md](DECISIONS.md), [docs/SECURITY.md](docs/SECURITY.md), and [PROGRESS.md](PROGRESS.md).

## Commercial roadmap

The signed T2ETECH License SDK is integrated for RS. File changes and commands require a verified paid entitlement; browsing and setup remain available. Signed installers/updates, full Tauri automation and cross-platform clean-machine release certification remain open. No trial policy is invented. See [release preparation](docs/RELEASE.md). Files and outputs always belong to their owners.
