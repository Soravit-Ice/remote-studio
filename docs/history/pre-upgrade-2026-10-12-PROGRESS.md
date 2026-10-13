# Native workspace development update — 2026-10-12

Implemented 48 scoped MCP tools, Read only / Reviewed / Full Access intersection, immediate native Full Access file writes and jobs, batch/binary/structural checkpoints, nested/root project creation, lockfile install and validation, Git mutation, durable previews and private-pipe browser workers. Windows LPAC/Job Object helper, own-SID ACL cleanup and MSVC build are implemented but not executed on Windows.

## Verified native checkpoint

| Check | Actual result on this Mac |
| --- | --- |
| Typecheck, lint, production build | Passed |
| Vitest integration suite | 30 tests / 10 files passed, including native MCP, escapes, root substitution and crash recovery |
| Source Electron E2E | 3 workflows passed: desktop, ChatGPT setup and Full Access |
| Packaged native MCP workflow | Passed with the bundled Electron runtime: create/install/build/preview/browser actions/screenshot/reconnect/revoke |
| Packaged Electron E2E | All 3 workflows passed |
| Native arm64 DMG | Built; hdiutil checksum verification passed |
| Existing live gpt-tunnel connection | Full Access authorized only for gpt-tunnel; credential identity preserved and other client grants unchanged |
| Live MCP using that saved credential | 48 tools; nested folder/project/patch applied; dependency installation and build exit 0; preview survived disconnect; actual browser PNG saved |
| Windows native/package execution | Not run; source and friend-machine instructions provided |
| Actual ChatGPT web invocation | Pending resolution of a real routing collision: LocalBridge and Remote Studio use the same tunnel ID; MCPLocal retains the LocalBridge catalog |

Current package: `release/native-full-access/Remote Studio-0.1.0-arm64.dmg` (145,146,125 bytes). The new packaged application is running with normal app data. Its existing official tunnel auto-started; a successful upstream poll is distinct from a ChatGPT tool call.

The live MCP workflow created `/Users/soravit_ice/Desktop/gpt-tunnel/gpt-web`, installed dependencies, built `dist/index.html`, and served `http://127.0.0.1:53464`. Evidence is in `test-artifacts/live-native-verification.json`; the actual 22,018-byte screenshot is `/Users/soravit_ice/Desktop/gpt-tunnel/remote-studio-verification/preview.png`. This workflow used an SDK client with the existing ChatGPT credential, **not a ChatGPT web prompt**. The first screenshot attempt timed out; a fresh session subsequently produced a verified PNG. No failed action is counted as success.

Packaging smoke found that electron-builder excludes a nested `node_modules/playwright-core` extra-resource directory. The runtime is now explicitly vendored at `services/vendor/playwright-core`, dynamically imported by the worker, and its packaged native workflow passed after this correction. No runtime is downloaded at application idle.

Live ChatGPT debugging identified an additional configuration problem: the existing LocalBridge profile and Remote Studio both use `tunnel_6a8d7aff543081919e923197902dcf21`. An actual connector call returned LocalBridge projects, while another reached Remote Studio with an old tool name and was rejected. Remote Studio now checks local runtime routing conflicts before starting and reports a detected collision without altering the other program. Two regression cases cover blocked startup, unchanged grants/configuration, profile routing, Windows quoting and explicit overrides. User authorization was requested before stopping LocalBridge because it is another application.

The older preview notes below are historical and are superseded where they describe review-only commands, 21 tools, unavailable browser/Git mutation, or no native sandbox. Signing/notarization, Windows/Intel/clean-machine certification remain release work.

## Earlier preview progress

# Progress and verification

Verified checkpoint: **2026-10-11, Asia/Bangkok**. Implementation began on 2026-10-10.

## Current outcome

A functioning macOS Apple Silicon Electron preview with six desktop pages, real multi-folder permissions, an independent authenticated agent, **21 MCP v2 tools**, durable approved command jobs, reviewed text edits with actual Undo, read-only Git, a real React/Vite project generator, and in-app ChatGPT Secure MCP Tunnel configuration and supervision.

The new native packaged application passed both desktop and tunnel end-to-end workflows. The current unsigned arm64 DMG is at `release/chatgpt/Remote Studio-0.1.0-arm64.dmg`; the application is at `release/chatgpt/mac-arm64/Remote Studio.app`. The earlier package remains outside that subfolder. This is a verified development checkpoint, **not a commercial release certification**. After the user unlocked the Mac, the earlier app was quit and the new bundle was launched with the user's normal app data. The native Set up ChatGPT Web dialog is open, with blank credential fields and the installed official tunnel-client 0.0.12 detected. No personal runtime key, folder grant, or production ChatGPT connection was configured.

## Actual checks

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm typecheck` | Passed | Strict TypeScript 6.0.3, UI/preload/services/tests |
| `pnpm lint` | Passed | ESLint / typescript-eslint |
| `pnpm build` | Passed | Main, sandbox preload, renderer, bundled agent and bridge |
| `pnpm test` | **25 tests passed, 7 files** | Actual folders, SQLite, child processes, MCP bridge, generated project, tunnel lifecycle and official-runtime loopback forwarding |
| `pnpm test:e2e` | **2 workflows passed** | Real Electron application: desktop 4.4 seconds and tunnel 4.9 seconds on this host |
| Packaged application E2E | **2 workflows passed** | Native `release/chatgpt/mac-arm64/Remote Studio.app`: desktop 7.4 seconds and tunnel 4.6 seconds |
| Official tunnel runtime interoperability | Passed locally | Installed OpenAI tunnel-client 0.0.12 forwards real initialize/tools-list/workspace-list through a loopback control-plane fixture; no request to OpenAI |
| Generated React project | Passed | Public dependency installation, `tsc && vite build`, nonempty HTML and compiled assets |
| Native arm64 package / DMG | Built | Electron-builder 26.15.3, macOS arm64 |
| DMG integrity | Passed | `hdiutil verify` reports valid checksum |
| `pnpm doctor` | Passed | Node, pnpm, Git, SQLite, Electron, services; optional FFmpeg/FFprobe detected |

Test durations are entire workflow durations, not cold-start benchmarks.

## Verified behaviors

- Three distinct real folders authorized, server-side grants independent, outside access denied, client scopes and revocation enforced.
- Absolute/traversal/symlink/protected-path attacks refused. App data/credentials remain protected even when the parent directory is authorized.
- Exact unique text patch proposed, locally approved, output read from disk, real original content restored, and newer external edits protected from Undo.
- Every command begins awaiting local approval. Actual stdout/stderr and nonzero/zero exit codes persist. Missing executable errors are real.
- Process groups, including an actual spawned child, stop on cancellation. Timeouts, environment filtering, bounded output, and idempotency are tested.
- SQLite state reopens after restart; persisted running states become interrupted and are not replayed. This is a state-recovery test, not full OS service lifecycle certification.
- A real SDK-v2 client initializes the stdio bridge, lists validated tools, reads/patches a real file, disconnects during a durable job, reconnects, and obtains the actual result.
- Client JSON configuration preserves unrelated settings and has a byte-exact backup. No real personal AI-client configuration was changed by tests.
- Desktop UI adds folders, changes grants, reads/edits/reviews/undoes a file, switches themes, and verifies a real local MCP connection.
- Closing the real main window hides it to tray while an approved job creates a result file. Reopening exposes the completed result.
- A second Electron window at the same origin is refused privileged IPC. Renderer has no `require`, `process`, or generic `invoke` API.
- The packaged app performs these file, MCP, tray and IPC operations with its bundled runtime.
- The real Electron settings flow encrypts a test runtime key with OS-backed safeStorage, never echoes it to preload or plaintext JSON, selects an executable through the native picker, creates explicit folder grants, verifies the real MCP bridge, starts/stops an owned runtime process, restores encrypted config and auto-starts after relaunch, and removes config/key with revocation.
- A clearly identified test runtime fixture verifies process supervision, liveness/readiness, split-log redaction, and child-process shutdown. Its readiness never sets a successful OpenAI poll or claims a plugin install.
- A separate test runs the official installed OpenAI tunnel-client with a local control-plane fixture and real bridge. It verifies Go argv parsing for paths containing spaces/quotes, SDK-v2 initialization, 17 read-only tools, actual workspace results, response delivery, and the metrics format used for successful-poll timestamps. This verifies local interoperability, not production OpenAI authentication or a ChatGPT account.
- An unavailable OS vault/plaintext fallback blocks key saving. Revoked grants and failed bridge diagnostics prevent startup. Inherited transport/key/proxy/raw-logging overrides are excluded; health URLs reject nonloopback origins, credentials, query strings, paths, and redirects.
- The Thai DOCX guide was updated for in-app setup and rendered; all six page images were visually inspected.

## Measured artifacts

- Current unsigned arm64 DMG: **139,001,519 bytes / 132.56 MiB**.
- Current native app bundle: approximately **550.99 MiB** uncompressed on this host.
- Screenshots from real temporary-workspace tests: `test-results/home.png`, `test-results/connections.png`, `test-results/chatgpt-settings.png`, `test-results/chatgpt-runtime.png`.
- Agent memory is read from the actual process and displayed in About. No fabricated CPU/usage charts are present.

Cold startup, sustained idle CPU/memory, large-directory latency baselines, optional-worker memory and clean-install metrics still require a dedicated benchmark pass.

## Corrections verified during implementation

- Replaced incompatible Vite 8 / React plugin 6 with the electron-vite-supported Vite 7 / plugin 5 pair.
- Used TypeScript 6 for the host lint toolchain, with explicit Vite ambient types in the TS7 generated template.
- Corrected sandbox preload output to CommonJS `.cjs` and made Electron explicitly external to the bundle.
- Fixed Zod 4 optional/default patch behavior so changing theme never resets onboarding or unrelated preferences; added a regression test.
- Prevented recursive file search from entering protected app state and rejected Git discovery outside the granted workspace.

## Remaining work

License API / signed entitlements and local-client credential migration; OS-managed independent helper survival after full Quit; abrupt-crash orphan cleanup; mutating Git and dev-server automation; additional project templates; workflows/scheduling; FFmpeg/Whisper/browser/documents; production OpenAI authentication and eligible ChatGPT Web account validation; enterprise proxy/mTLS setup; full translations; signing/notarization, Intel and actual Windows execution, clean-machine installer tests and production security review.

Advanced modules display **Unavailable**, ChatGPT Web displays actual setup/runtime states, and the license section displays **Development preview**. No unfinished operation is registered as a working tool. Creating a ChatGPT plugin remains an action in the user's account, and runtime readiness is shown separately from upstream poll evidence.

Explicit Quit stops this preview’s tunnel and agent. Window-close-to-tray persistence is verified; full-quit survival is not claimed. The macOS preview is unsigned and not notarized. Native CI definitions are included but have not been run by this local session. See TASKS.md and docs/SECURITY.md for release gates.
