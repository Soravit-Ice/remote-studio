# Windows build and verification handoff

Windows implementation is present but has **not been executed or certified on Windows in this Mac session**. Do not label Windows support verified until all native checks below pass. No Docker is required.

## Prerequisites

- Windows 10/11 x64 with a local NTFS test folder.
- Node.js 24 LTS, pnpm 11.5.2 and Git.
- Visual Studio 2022 C++ Build Tools, including the Windows 10/11 SDK and MSVC x64 tools. `build:services` discovers MSVC with `vswhere` and compiles `native/windows/sandbox.cpp` into `dist/services/studio-sandbox.exe`.
- Native LPAC setup requires permission to add its unique SID read ACLs to runtime directories and configure a per-container loopback exemption. This implementation reports an actionable error if Windows refuses it; run native verification in an Administrator PowerShell for initial testing. It does not fall back to unrestricted execution.

## Run from the extracted source directory

```powershell
corepack enable
corepack prepare pnpm@11.5.2 --activate
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:mcp
pnpm test:e2e
pnpm exec electron-builder --win nsis --x64
```

`pnpm test` includes native MCP website creation/install/build/preview/browser tests, Node/Python/shell escape tests, junction and hard-link guards, child cancellation, root replacement, Git, and abrupt-agent-restart recovery. Chromium is downloaded on demand to a disposable test workspace. The tests never use personal folders, credentials or a production tunnel.

## Packaged smoke

```powershell
$env:STUDIO_ELECTRON_EXE = (Resolve-Path 'release/win-unpacked/Remote Studio.exe').Path
pnpm exec playwright test
Remove-Item Env:STUDIO_ELECTRON_EXE
$env:STUDIO_NATIVE_NODE = (Resolve-Path 'release/win-unpacked/Remote Studio.exe').Path
$env:STUDIO_NATIVE_SERVICES = (Resolve-Path 'release/win-unpacked/resources/services').Path
pnpm exec vitest run tests/integration/native-workflow.test.ts
Remove-Item Env:STUDIO_NATIVE_NODE
Remove-Item Env:STUDIO_NATIVE_SERVICES
```

Also run the native MCP workflow with the packaged runtime (a bundled helper and the copied Playwright core are mandatory). Verify its Full Access probe succeeds, nested folders and files actually exist, builds produce `dist`, previews bind 127.0.0.1, screenshots contain the page, and revocation stops all owned processes. Verify the LPAC profile, loopback exemption and **only Remote Studio’s unique SID ACL entries** are removed on normal completion, cancellation and restart recovery. Preserve unrelated ACL entries and concurrent user ACL changes. Test paths with spaces and non-ASCII characters and repeat in a standard-user session to record exact setup requirements.

Run the installed NSIS application on a clean machine and repeat the tests before distributing it. Preserve `test-results`, failed-test traces, native helper errors and version information. Never include runtime API keys, local MCP credentials, the app database, or a personal workspace in the test report.

The existing `.github/workflows/native-ci.yml` includes macOS and Windows builds/tests plus packaged native MCP/Electron verification; it has not run against a remote repository in this session. Before release run the packaged native workflow and clean-installer checks on both hosts.
