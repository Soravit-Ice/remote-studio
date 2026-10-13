# Upgrade tasks

Checked items mean implemented in source. Verification and certification limits are recorded in PROGRESS.md; a checked implementation does not certify every OS or every project.

## M0 — Baseline and identity

- [x] Secret/runtime-free source baseline archive.
- [x] Regression maintenance, SDK-v2 schemas, backward-compatible `{ data }`, current grants.
- [x] Persistent server identity, catalog fingerprint, matching bridge diagnostics and agent build identity.
- [x] Separate diagnostic handshake, runtime readiness, upstream polling and external tool-call records.
- [x] Preserve owned client credentials during configuration upgrades.
- [ ] Actual ChatGPT account routing, Refresh metadata/new-chat acceptance (user will exercise).

## P0-A — Persistent execution

- [x] Versioned SQLite tables/backups and task dependency/cycle validation.
- [x] Attempts, jobs, changes, artifacts, errors, assessments and verified progress.
- [x] Actual acceptance checks, stale-proof invalidation, explicit criteria revisions.
- [x] Pause/resume/retry and owned cancellation without replay after restart.
- [x] Serialize colliding workspace writes and job approval decisions; prevent duplicate active task operations.
- [ ] Larger crash/revoke/cancel stress matrix and disk-full injection.

## P0-B — Browser evidence

- [x] Actual MCP images, immutable evidence, viewport/element/clip captures and before/after/diff.
- [x] Role/text/test-id/CSS actions, managed navigation, viewport, hover, scroll and waits.
- [x] Console/page/HTTP/request diagnostics, axe accessibility, overflow/broken images and focus sampling.
- [x] Task-bound diagnostic report artifacts and source/capture metadata.
- [ ] Persisted Playwright traces and an automatic long-page tile collector.
- [ ] Complete keyboard-flow assessment, dark-mode/responsive project acceptance and actual ChatGPT image acceptance.

## P0-C — Web and code intelligence

- [x] Monorepo/packages/routes/config/assets/API/script context with explicit output budgets/omissions.
- [x] JS/TS language-service worker, local tsconfig/aliases, source-only Astro indexing and lazy hash cache.
- [x] React/Vite, Astro/React, Next, local Better Auth/Prisma/SQLite and Electron starter source.
- [x] Native install/run/validation ordering, managed preview ports and missing-script failures.
- [x] OS-backed environment editor, scoped injection and locked-vault failure handling.
- [x] Dirty-worktree-preserving Git checkpoints and conflict-safe file Undo.
- [ ] Full current scaffold matrix, negative multi-user/session cases and user’s existing-codebase acceptance.

## P0-D — Electron development

- [x] Main/preload/renderer boundaries, narrow IPC, CSP, context isolation and renderer sandbox template.
- [x] Native worker for owned app windows, interactions, logs and screenshots with isolated test data.
- [x] Development and packaged Electron launch paths, packaging recipes and actual earlier macOS smoke.
- [ ] Dedicated renderer/native-integration/packaged-smoke recipes and native-dialog stubs in test builds.
- [ ] Multi-window/IPC failure fixture matrix and actual Windows package acceptance.

## P1-A — Design and Skills

- [x] Four design presets, light/dark/reduced-motion tokens and stored design brief/assessment.
- [x] Official shadcn inspection/checkpointed addition and dependency reporting.
- [x] Asset sizes/hashes/duplicate and PNG/SVG dimension inspection.
- [x] Local/ZIP/pinned GitHub Skills, scoped discovery/resources and native UI lifecycle.
- [x] Inert import, bounded archive/local reads, hash-specific sandboxed script execution and update invalidation.
- [ ] Broader registry/CSS-token integration and additional asset-format dimensions.
- [ ] User’s functional/visual review against real brand/design briefs.

## P1-B — Daily reliability

- [x] Plan/evidence/Skills/environment feature panels; paginated job history and bounded snapshots.
- [x] Lazy bounded indexing with no idle language/browser/desktop worker.
- [x] Private support bundle, configurable artifact retention and conservative proof preservation.
- [x] Opt-in source background helper, packaged macOS LaunchAgent/Windows per-user Startup source.
- [x] Owned Stop all, native recovery, frozen runtime copies and explicit build mismatch handling.
- [x] White-screen recovery, startup/render error screens, bounded agent boot and safe transport reconnection without replay.
- [x] Updated personal Apple Silicon package; source/packaged renderer and agent recovery smoke and existing-data launch.
- [ ] Split remaining large UI pages, broader retention/cleanup policies and cancellation during indexing.
- [ ] Backup restore UI/testing, disk-full recovery and large-history stress tests.
- [ ] Packaged login/reboot/upgrade/shutdown certification and idle/cold/10k/100k performance baselines.

## P2 — Tauri and commercial release

- [x] Experimental Tauri/React source scaffold with basic capabilities.
- [ ] Pinned Rust/toolchain diagnostics and tested native checks/package adapters.
- [ ] Embedded Tauri driver in test builds, desktop lifecycle support and production driver exclusion.
- [x] Verified T2ETECH SDK archive, RS public OAuth configuration, encrypted activation and paid enforcement in GUI/agent/MCP.
- [ ] Actual installer publisher pins, signing certificates and customer-account activation/platform acceptance.
- [ ] Verified updates, Store flow, installer manifests, hashes and release notes.
- [ ] Signed/notarized Mac arm64/Intel and signed Windows x64 clean-machine install/upgrade/uninstall.
- [ ] Electron fuse review after replacing or accommodating ELECTRON_RUN_AS_NODE.

Personal project acceptance comes before commercial certification. No GitHub push, hosting or production-deployment integration was added.

## Workspace reboot recovery — 2026-10-13

- [x] Diagnose the real saved/current mount-device mismatch without modifying project files.
- [x] Persist macOS volume UUID plus directory inode/birth identity; migrate only matching legacy identities.
- [x] Add native original-folder recovery, retained grants, selection recheck, owned-work cancellation and audit.
- [x] Surface unavailable/changed roots in Workspaces; disable permission increases until recovered.
- [x] Cover simulated device changes, replacement/volume mismatch, local-only access, cancellation, persisted grants and relaunch in temporary folders.
- [ ] Actual physical reboot/remount acceptance for the new identity on the user's Mac; Windows/Linux volume portability remains unverified.
- [x] Final current-source core suite: 67 tests / 19 files; final source UI suite: 6 workflows; current personal package recovery and renderer/agent smoke.
- [x] Recover the user's two original workspace roots, preserve five saved connections/credential hashes and confirm both root directories through the actual connector.

## RS licensed release candidate — 2026-10-13

- [x] Vendor and verify signed SDK archive; owner explicitly permits SDK archive in public source.
- [x] Bind RS to its registered public OAuth client and exact installer callback.
- [x] Agent-owned encrypted SDK storage, OS-protected installation key, native cold/warm callbacks and main/preload/renderer activation controls.
- [x] Paid signed-feature checks at GUI/MCP entry points, file access, command launch and active-work expiry checks; logout/deactivation stop owned work.
- [x] Real signed-claim negatives, encrypted-storage corruption/race preservation, PKCE and production fixture-bypass rejection.
- [x] Final core 71 tests, source UI 7 workflows, current Mac arm64 packaged enforcement/recovery smoke, public-source/SDK/source-release checks.
- [x] Public repository setup, unsigned Mac arm64/x64 DMGs/checksums and native draft-release workflow.
- [ ] Save the RS SDK Integration metadata in Store Admin and complete actual customer account sign-in/ownership activation evidence.
- [ ] Actual Mac/Windows publisher pins and signing secrets, native Intel/Windows acceptance and packaged physical reboot/login certification.
- [ ] Commercial Store product/repository/delivery/release verification and deliberate customer publication.

## Separate installer repository — 2026-10-13

- [x] Public remote-studio-releases repository, source link, immutable-release setting and source download Variables.
- [x] Matching tag/package/version-note validation, native build/test/package gates and separate GitHub installer delivery.
- [x] Hash-checked immutable assets, signed/notarized metadata from actual verified builds and Store OIDC verification submission.
- [x] Generic uploader/ref/manifest regressions: 22 tests; typecheck/lint/SDK/public/config checks.
- [ ] Final template regression and updated Mac/Windows CI confirmation.
- [ ] Install GitHub App on download repo and set DOWNLOADS_APP_ID / DOWNLOADS_APP_PRIVATE_KEY, or set scoped DOWNLOADS_RELEASE_TOKEN.
- [ ] Store RS SDK Integration, numeric source/download repository bindings and real paid activation acceptance.
