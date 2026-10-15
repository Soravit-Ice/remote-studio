# Current architecture decisions — 2026-10-12

## Responsibility and scope

ChatGPT authors plans and chooses actions. Remote Studio persists context, enforces grants, executes locally and records actual evidence. There is no new chat/model loop and no autonomous replanning after disconnection. The product stays Electron; user-project Electron support precedes full Tauri support. Commercial licensing/distribution follows personal workflow acceptance.

All existing per-folder/per-client Read only, Reviewed and Full Access modes remain. Full Access keeps routine development continuous inside the native boundary; Reviewed retains local approval. Every project command is sandboxed, with no unrestricted fallback. Git/hosting/production deployment integrations were not added.

## Persistence and verification

Use Node SQLite/WAL with schema v2, explicit migrations, backups and scoped development tables. Tasks depend on concrete verification, not a client-supplied completed flag. Source and bound environment revisions invalidate affected proof. Retry creates another attempt; resume rechecks context and never replays writes/commands. File and Git checkpoints preserve user changes, including the real staging index.

Module/grant revocation stops affected owned work. Job approval decisions and colliding workspace mutations are serialized. Independent source-only reads/checks can run concurrently. Qualitative visual assessments stay separate from automated pass/fail.

## Evidence and project context

Original immutable PNG/JSON evidence lives in private app storage and is read by authorized ID. MCP image blocks accompany JSON metadata while structured results retain `{ data }`. Images retain capture/source metadata and bounded previews. Browser checks use actual axe/runtime/layout output; eight Tab samples do not certify every keyboard interaction.

The project index is lazy and bounded. Unchanged source hashes reuse file identity/ctime/mtime metadata, while path/grant checks still run. TypeScript runs in a worker using supplied text and vendored trusted libraries; project language-service plugins never execute. Local JSON tsconfig inheritance and aliases are supported. Dependency-generated types and Astro semantics remain the responsibility of real project checks.

## Native and runtime boundaries

Services and built UI are copied into integrity-checked immutable runtime revisions before execution. Retained versions provide stable installed bridge paths; matching revisions are reused. Existing configurations can migrate only when the runtime and scoped credential identify the same owned connection. An older agent or mismatched bridge catalog is refused explicitly; owned jobs are preserved for a deliberate restart.

macOS ownership uses per-launch isolated Seatbelt read capabilities and native process birth identity, including detached/reparented descendants. Private control descriptors are not inherited by project code. Recovery falls back only to verified identities; missing parents never imply ownership. Open descriptors use native final-path checks on macOS/Windows and proc descriptors on Linux. Windows source is not Windows certification. LPAC cannot apply a safe writable-workspace/read-only-runtime overlap, so that overlap is refused on Windows.

Development HMR is a trusted development surface. Its active `apps/desktop` source is protected from scoped writes while running. Use the built UI (`pnpm start`) and explicit restart when developing Remote Studio through its own tools.

## Skills and secrets

Skills import instructions/resources only. No dependencies or scripts run during import. Updates are atomic; identical bytes preserve local authorization, changed bytes disable execution and clear authorization. Script permission binds the content hash and never increases grants from allowed-tools. ZIP/network/local reads have budgets and path guards.

Project secrets use Electron safeStorage without plaintext fallback. The agent receives ephemeral values for explicitly bound jobs; SQLite stores metadata and private revision HMACs. Vault failures preserve ciphertext and block overwrites/injection. Known plaintext values are redacted separately across stdout/stderr chunks. Granting a project arbitrary execution also grants its code use of injected values; log redaction does not prevent encoded or deliberate exfiltration by that code.

## Lifecycle and release

Normal Quit stops owned work. Background service is opt-in; a separate credential-protected native helper owns the agent/tunnel after GUI Quit. Source tests do not register OS login entries. Packaged LaunchAgent/Startup registration and reboot/upgrade behavior must be certified separately. Optional browser/desktop/skills runtimes are loaded on demand.

No signing, notarization, price/license policy, publisher keys or commercial SDK behavior is invented. Existing bundles are historical checkpoints. Current source checks and remaining gates live in PROGRESS.md and TASKS.md. Earlier decisions are archived under docs/history/.

The personal Apple Silicon bundle now lives under `release/personal`, separate from those historical packages. Interface recovery may reload the renderer or reconnect an unavailable owned agent, but never repeats commands, writes or planning decisions. Startup health reads have shorter deadlines than long-running tool calls. Repeated renderer failures require a visible native recovery choice; diagnostic logs record bounded event categories rather than project data or credentials. This local package is unsigned and does not certify commercial or cross-platform release behavior.

## Workspace authorization across mounts — 2026-10-13

The user's saved workspace device number was `16777233`, while the current device was `16777232`; both canonical paths and inode numbers were unchanged. Persisting only `st_dev:st_ino` falsely rejected those folders after reboot. macOS now reads the persistent volume UUID and directory inode/birth identity from an opened directory using the native Node-API helper. No volume-identity cache or ignored-device fallback is used. Other platforms retain device/inode checks with birth time in the versioned identity; macOS testing does not certify them.

Matching legacy identities migrate when the trusted local UI reads its snapshot. Changed legacy identities cannot be inferred safely and require explicit local recovery once. Recovery uses a native folder picker, accepts only the original canonical workspace path, displays a native confirmation of the retained folder/client permissions, and rechecks the selected identity in the agent before committing. MCP clients cannot inspect or re-authorize roots. Recovery preserves workspace IDs, permission flags and client grants, cancels owned jobs/sessions, rejects pending file changes and records an audit entry. A different folder must be added as a separate workspace.

The GUI receives a transient root error in its snapshot and provides Re-authorize folder without deleting connection setup or workspace history. Permission increases stay disabled until root recovery succeeds. The volume helper runs in the frozen agent runtime so packaged recovery does not depend on the GUI's working directory.

## License SDK and public release source — 2026-10-13

The user authorized public Remote Studio source and explicitly authorized the signed License SDK archive in that public repository. Keep product/server private signing keys, native certificate files, tunnel credentials, installation state and customer data excluded. The separately pinned SDK release key verifies archive version/signature/hash before installation and release.

Use the real registered public OAuth client `42332f55-29df-42ee-9aba-56fa8fd937eb`, product RS and exact com.t2etech.remotestudio callback. Store's existing RS policy grants `export`; that feature authorizes this product's development operations. Do not invent another feature or a trial policy. Verified paid activation gates writes and commands in the authenticated agent and is rechecked through Security.path at command launch. SDK runWithAccess wraps protected entry points; paid claims are rechecked inside its callback to prevent rc.1 trial fallback from authorizing unpaid operations. Reads, setup and stopping owned work remain available. Logout/deactivation stop owned jobs/sessions. Active jobs are rechecked once per minute against signed/offline-grace policy.

One agent owns SDK state, including background mode. Electron's OS secure storage wraps an installation-specific AES key; only authenticated local administration passes it to the agent in memory. NodeEncryptedFileStorage persists encrypted SDK state and retains product namespace/device identity across restart. No key, OAuth token, authorization callback or SDK state is exposed to the renderer or MCP. Cold/warm native callbacks go to the SDK after initialization for state/PKCE verification.

Development fixtures require an explicit unpackaged temporary-data test run. A packaged GUI ignores fixture environment flags; the packaged agent rejects the fixture switch. No production plaintext/enforcement fallback is permitted.

This host has zero code-signing identities; Store's RS product is DRAFT and its SDK Integration record has not been saved. The candidate source and unsigned native package can be prepared, but signed customer release requires actual certificate pins, secrets and real account/platform acceptance. CI defaults to unsigned installers and fails closed when a signed run lacks prerequisites. GitHub installer publication and commercial Store publication are separate deliberate steps.

## Separate source and installers (2026-10-13)

Remote Studio follows Precut's per-product public downloads repository architecture. The source remains public as authorized; installer delivery uses remote-studio-releases with immutable assets. A version-tagged caller invokes the trusted reusable workflow on main so Store's workflow_ref remains stable across versions while installer builds use the original tagged commit. A scoped App/PAT writes downloads, and original Actions OIDC submits RS verification. Store Admin publishes only after READY. Unsigned metadata remains truthful, and no broad developer credential is installed as a CI secret.

Template Rollup resolves to 4.64.3 through npm/pnpm overrides matching the tested source lockfile, avoiding first-install transitive drift that produced the observed registry 404. Windows dot components pass to canonical containment checks; ambiguous names and escapes remain rejected. POSIX tunnel fixtures do not stand in for native Windows tunnel acceptance.

Windows launcher startup uses a supervisor-only MSVCRT pipe to persist native ownership before granting ACLs or starting LPAC project code. The child allowlist inherits only stdin/stdout/stderr. Win32 GetProcessTimes replaces a racing PowerShell query while retaining its DateTime epoch for recovery manifests; an exited process returns no identity and never proves ownership.

## Gemini Web and Cloudflare HTTPS — 2026-10-14

Gemini uses a separate scoped client grant and a supervised HTTP adapter process, while the privileged agent stays on its private socket/pipe. Share the existing SDK v2 server factory between stdio and HTTP; retain input/output validation, server identity, catalog fingerprints and execution-time grant checks. Use stateless JSON responses for legacy Streamable HTTP and the modern v2 handler, so Quick Tunnels do not depend on SSE.

Support both account-free Quick Tunnels and remotely managed Named Tunnels with a stable HTTPS origin. Detect installed cloudflared or use a native executable picker. Launch with explicit arguments, a controlled environment, loopback-only HTTP/metrics and no shell. Keep Cloudflare tokens out of arguments, logs, renderer state, and the bridge environment; store them with Electron OS encryption and pass them only in the provider process environment. Do not expose local administration through HTTP.

OAuth uses protected-resource/authorization-server discovery, bounded Dynamic Client Registration, exact HTTPS callbacks, S256 PKCE, one-use codes and locally approved browser pairing. Public clients cannot approve requests. Confidential clients use their registered Basic/Post method; access tokens bind to this MCP resource, and rotating refresh tokens revoke their family on replay. Named-origin client/token hashes persist only in OS encrypted storage through private parent IPC, with storage acknowledgement before returning credentials. Pending approvals and codes stay ephemeral; saving a new connection revokes its prior grant and OAuth state.

Local bridge verification, public HTTPS verification and authenticated tool requests are separate evidence. Source tests and real cloudflared acceptance do not certify a user's Gemini account, Windows or packaged login/reboot behavior. Foreground/background ownership supports both adapters; ChatGPT auto-start must not reinitialize a running Gemini controller. After settings updates, refresh the actual agent snapshot rather than treating its acknowledgement as settings.

## HyperFrames motion execution — 2026-10-14

Keep Remote Studio as the execution gateway: the connected assistant owns briefs, narrative and HTML/GSAP authoring. Nine Video tools expose guidance, checkpointed starters, static settings/revisions, lint/timeline/browser checks, PNG evidence, managed Studio, render status and bounded output reads. Pin the adapter to HyperFrames 0.8.153 and project GSAP to 3.14.2. Optional runtime/browser installation only occurs on requested jobs; FFmpeg/FFprobe remain explicit host prerequisites. Follow the [upstream render contract](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-cli/references/preview-render.md).

Use the durable native Jobs supervisor and execution-time grant/module checks. Video adds existing browser OS capabilities and, on macOS, scheduling only `(target self)` plus read-only `kern.boottime`; unrelated process scheduling and sibling-folder access stay denied. The latter is the [libuv uptime query](https://github.com/libuv/libuv/blob/v1.x/src/unix/darwin.c). Managed Chrome stays in the workspace sandbox cache, avoiding an unrestricted system-Chrome fallback.

A successful browser check must match the current source/asset revision before render. Queued/during-job source changes fail. Encodes use unique output paths and must match FFprobe dimensions/duration/fps; SHA-256 and descriptor-bound file identity detect post-render edits. Stream bounded binary chunks and cache verified identity rather than hashing a large file on every chunk/status poll. Serialize evidence collection so repeated status calls reuse immutable artifact IDs. Decode CLI stdout as UTF-8 across chunk boundaries.

PNG frames travel as native MCP image content. Studio URLs and videos remain local; do not fabricate public/download URLs or claim inline web video delivery. A separately authorized storage/publishing integration is required for HTTPS video delivery. New source tools also require restarting the updated app and refreshing the connected client's tool metadata. No new video installer, user-account acceptance or Windows certification is claimed by source tests.

## Activation before assistant access — 2026-10-16

An unactivated 0.2.2 installation could create connections and read workspace files through MCP by design. A paid RS activation now gates connection creation/credential export, bridge initialization and every client data request, including read-only tools, skills and artifacts. Existing credentials are retained for reactivation but cannot bypass paid access. The authenticated local UI keeps setup, local reads and cleanup. Key activation remains a supported alternative to account sign-in; a valid paid key does not require OAuth. The ChatGPT monitor rechecks authorization and stops its runtime on loss, matching Gemini's monitor. Device deactivation stops both providers before removing activation.

Remote-studio-icon.png is the canonical supplied artwork. Generated PNG/ICNS/ICO assets are checked in; scripts/generate-icons.py reproduces them without changing the original. The storefront icon uses an immutable content-hashed media URL through existing admin gallery services.
