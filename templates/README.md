# Project templates

`packages/projects/src/templates.ts` defines the current starters and design tokens. The legacy `reactTemplate()` export delegates to this source rather than maintaining a second scaffold.

| Template | Workflow |
| --- | --- |
| react-vite | React + TypeScript + Tailwind and owned shadcn-compatible components |
| astro | Astro routes + React islands + Tailwind |
| next | Next App Router + TypeScript + Tailwind |
| next-fullstack | Next API + Prisma/SQLite + Better Auth; run setup after install |
| electron | Electron main/preload/renderer + React, isolated test data, narrow IPC and package recipe |
| tauri | Experimental React/Rust/capabilities scaffold; native driver/toolchain/package certification is pending |
| empty/custom | Explicit empty or supplied contained files |

JavaScript versions are pinned. Design presets are premium-saas, modern-minimal, corporate and dashboard. Registry additions are inspected before checkpointed writes and report dependency requirements.

Run `pnpm test:templates` for real native install/check/build/preview/desktop/package workflows. To choose a subset, set `STUDIO_TEMPLATE_TEST_ONLY=astro`, `next-fullstack` or `electron`. Tests use temporary workspaces and download optional runtimes on demand. Earlier probes passed, but the full latest matrix is a separate acceptance step; see ../PROGRESS.md.
