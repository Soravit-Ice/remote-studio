# Engineering conventions

Keep this a real desktop product. Do not seed fake workspaces, fabricate connection status, invent job progress, or register unfinished tools.

## Boundaries

- `apps/desktop/electron/main`: native OS interactions, tray/window lifecycle, narrow validated IPC and credential-protected calls into the agent.
- `apps/desktop/electron/preload`: fixed typed application methods only; never expose generic invoke, filesystem primitives, or Node modules.
- `apps/desktop/src`: React UI, Radix/shadcn-style primitives, Zustand navigation, TanStack Query cache, React Hook Form forms, semantic Tailwind/CSS tokens.
- `services/local-agent`: authenticated request routing, validated catalog, local-only administration, audit and orchestration.
- `services/mcp-bridge`: official MCP SDK **v2** only. Never import `@modelcontextprotocol/sdk` v1 APIs.
- `packages/security`: server-side grants, canonical relative paths, protected application state, symlink rejection.
- `packages/filesystem`: reviewed writes, conflict hashes, actual undo and same-directory atomic replacement.
- `packages/database`: SQLite/WAL persistence. Do not use renderer localStorage for privileged state.
- `packages/jobs`: durable states and execution supervisor. Reviewed commands require trusted local approval; Workspace Full Access uses explicit per-folder and per-client authorization. Every command must use the native sandbox with no unrestricted fallback.
- `packages/projects`, `connections`, `contracts`, `shared`: narrow reusable implementation modules.

## Security

Keep Electron sandbox/contextIsolation enabled and nodeIntegration disabled. Validate both the sender and top-level frame on every IPC. Disallow external navigation and window creation. Keep privileged services off TCP. Never publish UI credentials in MCP configuration or tool results. Per-client grants must be rechecked on execution, not only at registration.

Do not treat cwd as a sandbox. Do not add automatic command approval heuristics without a security design and adversarial tests. Configuration edits must preserve unrelated entries and backup the original bytes. Revocation must stop queued/running jobs. Rejected actions must never be reported as successful.

Document platform limits honestly. macOS tests do not certify Windows. Quit stops owned work by default. The opt-in source background helper is exercised; do not claim packaged login/reboot/upgrade certification without actual platform tests.

## Verification

Run relevant Vitest tests using temporary folders. For UI changes, launch real Electron via Playwright and inspect screenshots. Before handing off an implementation milestone run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, and `pnpm build` as applicable. `pnpm test:mcp` builds services before exercising the actual bridge. Build a native package and smoke test it before claiming packaging works. Keep PROGRESS, TASKS, and DECISIONS accurate.

Prefer plain, explicit TypeScript and small feature modules. Keep packages pinned and pnpm-lock.yaml committed. No destructive tests on user folders. Do not install optional media/browser runtimes at idle.
