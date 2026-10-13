# Native workspace development status — 2026-10-12

- [x] Per-connection/per-folder access modes and truthful effective permissions.
- [x] Native Full Access file/directory/binary/batch tools with conflict-safe checkpoints.
- [x] Native commands, shell, stdin/log cursor/wait, dependencies/scripts/Git.
- [x] Persistent preview jobs and private-pipe browser inspection/actions/screenshots.
- [x] Mac native MCP workflow, filesystem escape/child cancellation and crash-recovery tests.
- [x] Windows LPAC/Job Object helper source, build integration and test handoff.
- [ ] Actual Windows native/package/clean-installer verification (user will test on a friend’s machine).
- [x] Final native arm64 package, bundled-runtime MCP smoke and all three packaged Electron E2E workflows.
- [x] Live gpt-tunnel grant migration with unchanged credential identity/other clients, actual MCP create/install/build/preview/screenshot evidence.
- [x] Detect known local tunnel-ID routing collisions and block startup without stopping another application.
- [ ] Actual ChatGPT web refresh/new-chat invocation using the correct Remote Studio plugin/account.
- [ ] Signed/notarized release, Intel Mac and production security review.

## Earlier preview task list (historical)

# Implementation tasks and acceptance criteria

`[x]` means implemented; verification details are in PROGRESS.md. `[ ]` means not complete or not certified.

## P0: Verified local desktop foundation

- [x] Electron monorepo, secure renderer/preload, six destinations, theme and onboarding.
- [x] Multiple native-picked folders, read-only defaults, independent writes/execute, group/rename/enable/revoke.
- [x] SQLite agent, authenticated local transport, scoped/revocable clients, MCP SDK v2.
- [x] File list/read/search/write/patch/diff/restore requests, trusted review and actual Undo.
- [x] SHA-256 conflicts, symlink/traversal rejection, protected files/application credentials, audit.
- [x] Durable jobs, atomic claiming, local command approval, true logs, timeout/cancel/idempotency.
- [x] Read-only Git and system diagnostics; disabled modules are enforced server-side.
- [x] Real MCP handshake/tool-schema/file-operation/disconnection tests.
- [x] Real React/Vite scaffold with installation and production-artifact test.
- [x] Backup-preserving JSON setup, copyable stdio config, local diagnostic handshake.
- [x] In-app ChatGPT tunnel ID/runtime key settings, OS-encrypted key, explicit grants, native runtime detection/picker, bridge check, health/readiness/poll evidence, Start/Stop/Remove and opt-in app-launch auto-start.
- [x] Tray/window-close behavior, native notification, remembered bounds and safe Quit policy.
- [ ] Full IPC-origin attack suite and all OS folder-picker variants.

## P1: Reliability and developer automation

- [ ] Independent signed helper binary, macOS LaunchAgent / Windows lifecycle management; pass full-quit and reboot tests.
- [ ] Abrupt agent SIGKILL worker-orphan cleanup with verified process identities and cross-platform job objects.
- [ ] Streaming/paginated large-file pipeline, descriptor-relative ancestor-race protections and binary-safe recovery.
- [ ] File move/copy/system trash, snapshots, multi-file staged diff and checkpoint retention.
- [ ] Dedicated project install/test/lint/build tools, verified artifacts and dev-server management.
- [ ] Next.js, Astro, Electron, Tauri templates; build each in native CI.
- [ ] Git checkpoint/commit/restore/worktrees with safe dirty-worktree behavior.
- [ ] Workflow preview/run and durable checkpoints before scheduling.
- [ ] Per-tool grant editor, dependency installation, complete navigation/content translations, configurable retention.
- [ ] On-demand configuration recovery for an existing client grant and one-click Codex/Claude Code installers.
- [ ] Performance baselines: cold/idle CPU and memory, large searches, installer and worker resource measurements.

## P2: Optional advanced modules

- [ ] FFmpeg probe/trim/extract/resize/render/verify with original preservation, real progress and cancellation.
- [ ] Whisper-compatible on-demand transcription and verified timestamps.
- [ ] On-demand Playwright browser runtime and scoped tracked sessions.
- [ ] Safe PDF/DOCX/XLSX/CSV/archive reads and format-specific integration tests.
- [ ] Public HTTPS MCP gateway with authentication for deployments that require a Server URL; the private OpenAI Secure MCP Tunnel transport is implemented separately.
- [ ] Eligible ChatGPT Web account handshake/tool/write-action tests before advertising support.

## Commercial release gate

- [ ] Configurable T2ETECH license activation/device/deactivation API, signed offline entitlements, grace policy and keychain storage.
- [ ] Independent native helper packaging and credential isolation review.
- [ ] macOS arm64/Intel signed and notarized DMG plus clean-machine install/upgrade/uninstall tests.
- [ ] Windows x64 signed NSIS installer plus real Windows ACL, process-tree, startup and lifecycle tests.
- [ ] Optional Windows ARM64 compatibility verification.
- [ ] Signed update subsystem and user-facing upgrade terms.
- [ ] Security review for path races, local token protection, MCP approvals and command isolation.
- [ ] No feature declared commercial-ready without implementation, UI, validation, grants, errors, persistence, actual execution tests, inspectable results and accurate documentation.
