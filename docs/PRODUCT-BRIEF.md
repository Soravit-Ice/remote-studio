# ULTIMATE MASTER PROMPT
# LOCAL STUDIO — PREMIUM DESKTOP MCP & AUTOMATION PLATFORM

**Build a Commercial-Grade Electron Desktop Application**

Project Name: **Local Studio** (working name)  
Platforms: **macOS + Windows**  
Business Model: **One-Time Purchase / Lifetime License**  
Architecture: **Local-First, Modular, Secure, Lightweight**  
Design: **Premium / Clean / Modern / Minimal / Rounded / Professional**

---

# 0. YOUR ROLE

You are an elite engineering and product design team consisting of:

- Principal Software Architect
- Senior Electron Engineer
- Senior React / TypeScript Engineer
- MCP Protocol Expert
- Operating System Engineer
- Product Security Engineer
- Senior UX/UI Designer
- Design System Architect
- Background Processing Engineer
- QA / Test Automation Engineer

Your mission is to **BUILD, IMPLEMENT, INTEGRATE, TEST, DEBUG AND PACKAGE** a real commercial desktop application.

This must be functional software, not a design exercise.

**Non-negotiable requirements:**

- Implement working features, not mocks.
- Create real MCP tools that perform actual operations.
- Use proper security and permission boundaries.
- Build polished, professional UI.
- Keep the application fast and responsive.
- Package everything required for normal operation.
- Make installation simple for non-technical users.
- Support macOS and Windows.
- Never fake successful commands or job progress.
- Test functionality before claiming completion.

Inspect the existing repository before changing anything.

If the repository is empty, initialize the application from scratch.

Continue autonomously through the implementation milestones. Do not stop after producing a plan or UI mockup.

---

# 1. PRODUCT VISION

Create an exceptional desktop application that bridges AI assistants with the user's own computer.

The customer purchases the software once, installs it, authorizes folders, connects a supported AI client and immediately gains access to powerful local automation tools.

Users should be able to ask their AI assistant to:

- Read files from their computer.
- Search large directories.
- Edit code safely.
- Create and organize files.
- Manage multiple workspaces.
- Run approved terminal commands.
- Start and stop development servers.
- Create websites and desktop applications.
- Run tests and production builds.
- Inspect and modify Git repositories.
- Process video and audio files.
- Extract information from documents.
- Run repeatable automation workflows.
- Monitor long-running background jobs.

**Core Product Philosophy**

The AI assistant is the intelligence.

Local Studio is the secure execution engine.

The desktop application is the beautiful, easy-to-use control center.

Do not create a redundant AI chat interface in V1.

The user should continue using ChatGPT, Codex, Claude or another compatible AI client.

## Product Experience

Target onboarding:

1. Download and install.
2. Launch Local Studio.
3. Activate license or start trial.
4. Add one or more folders.
5. Configure folder permissions.
6. Connect a supported AI application.
7. Start using tools.

No manual JSON editing for supported one-click local integrations.

No global Node.js installation required for the packaged core application.

No terminal setup required for basic usage.

No mandatory cloud database for local operations.

---

# 2. REQUIRED TECH STACK

Use the following architecture unless a compatibility issue requires a documented change.

## Desktop

- Electron
- electron-vite
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Radix UI primitives
- Lucide React
- Zustand
- TanStack Query
- React Hook Form
- Zod

Use the current stable shadcn/ui components wherever applicable.

Do not introduce additional UI libraries without a clear reason.

## Local Backend

- Node.js LTS
- TypeScript
- Official MCP TypeScript SDK v2
- SQLite
- Drizzle ORM where useful
- Persistent Job Engine
- Pino structured logging

## System Integration

- Electron IPC
- Node.js child_process
- Native OS folder picker
- OS keychain / credential storage
- Process management
- Native notifications
- macOS Menu Bar
- Windows System Tray

## Optional Workers

- FFmpeg / FFprobe
- Whisper-compatible local transcription
- Playwright
- Document processing libraries

Optional workers must be loaded or launched only when needed.

## Packaging

- electron-builder
- macOS DMG
- Windows NSIS installer
- GitHub Actions
- Code signing and notarization support

## Testing

- Vitest
- Playwright
- Electron integration tests
- MCP Inspector
- Real OS-level smoke tests

Verify actual dependency versions and official APIs before coding.

Use the SDK v2 APIs consistently. Do not mix outdated MCP SDK examples with current APIs.

---

# 3. CORE APPLICATION ARCHITECTURE

Use a modular monorepo.

The major components are:

**Electron Main Process**

Responsible for:

- Window management
- Native menus
- Tray integration
- Application lifecycle
- Secure IPC
- OS notifications
- Native folder picker
- Agent lifecycle supervision

**Electron Renderer**

Responsible for:

- React UI
- Settings
- Workspaces
- Tools
- Connection management
- Activity monitoring
- Permission dialogs

Never perform privileged file or command execution directly in the renderer.

**Independent Local Agent**

Responsible for:

- Workspace security
- File operations
- MCP execution
- Command processing
- Background jobs
- Persistent state
- Worker management

**MCP Bridge**

Responsible for:

- MCP protocol
- stdio transport
- Tool registration
- Tool input/output validation
- Communication with the local agent

**Specialized Workers**

Responsible for:

- Command execution
- Project builds
- Video rendering
- Transcription
- Browser automation

The data flow:

AI Client → MCP Bridge → Local Agent → Permission Engine → Worker → Operating System

Desktop UI → Secure IPC → Local Agent → Same execution services

**Important:** Do not depend on Electron's renderer or main-window lifecycle for durable background execution.

Closing the UI window should allow the application to remain active in the system tray when the user enables background operation.

For survival after a full Electron process exit, implement and package a truly independent local agent executable with OS-supported lifecycle management.

An Electron utility process alone is not sufficient for persistence after the parent application completely exits.

Do not claim this behavior is working until it passes process-lifecycle tests.

---

# 4. MONOREPO STRUCTURE

Create approximately:

local-studio/
- apps/
  - desktop/
    - electron/
      - main/
      - preload/
      - tray/
      - windows/
    - src/
      - app/
      - components/
      - features/
      - hooks/
      - lib/
      - styles/
      - routes/

- services/
  - local-agent/
  - mcp-bridge/

- packages/
  - contracts/
  - filesystem/
  - terminal/
  - projects/
  - git/
  - jobs/
  - security/
  - database/
  - connections/
  - video/
  - browser/
  - documents/
  - licensing/
  - shared/

- templates/
  - react-vite/
  - nextjs/
  - astro/
  - electron/
  - tauri/

- scripts/
- tests/
- docs/

Use pnpm workspaces.

Build clean module boundaries.

Avoid premature microservices.

The whole application should remain maintainable by a solo developer.

---

# 5. DESIGN SYSTEM — CRITICAL PRIORITY

Act as a world-class UI/UX designer.

Build one of the cleanest, most refined and visually consistent desktop utility interfaces possible.

The design should feel like a carefully crafted professional macOS application that also works beautifully on Windows.

## Design References

Study the design principles of:

- Linear
- Raycast
- Arc
- Vercel
- Notion
- Apple System Settings
- shadcn/ui

Do not copy any product's design or branding directly.

## Design Personality

- Clean
- Modern
- Minimal
- Premium
- Professional
- Friendly
- Rounded
- Precise
- Calm
- Beautiful
- Lightweight
- Approachable

The UI should be beautiful because of its proportions, typography, hierarchy, spacing and interaction quality.

Not because of unnecessary decorations.

## Anti-AI-Slop Rules

STRICTLY AVOID:

- Excessive gradients
- Purple AI themes
- Large glowing backgrounds
- Decorative particles
- Random floating shapes
- Huge dashboard cards
- Unnecessary statistics
- Overly rounded pill-shaped containers everywhere
- Inconsistent button radii
- Excessive shadows
- Excessive glassmorphism
- Giant empty spaces
- Low-contrast text
- Inconsistent icon sizing
- Emoji-heavy UI
- Generic AI illustrations
- Unnecessary animations
- Overly complicated navigation

Use a restrained, intentional visual system.

Every visual element must serve a real usability purpose.

## Color System

Light mode:

- App Background: #FAFAFA
- Surface: #FFFFFF
- Primary Text: #111827
- Secondary Text: #6B7280
- Subtle Text: #9CA3AF
- Border: #E5E7EB
- Primary Blue: #075EF7
- Blue Hover: #0550D4
- Selection Surface: #EFF6FF
- Success: #16A34A
- Warning: #D97706
- Danger: #DC2626

Dark mode:

- Background: #0B0F17
- Surface: #141A23
- Elevated Surface: #1B2230
- Primary Text: #F8FAFC
- Secondary Text: #94A3B8
- Border: #2A3342
- Primary Blue: #3B82F6

Use CSS variables and semantic theme tokens rather than hardcoded colors in individual components.

## Rounded Design

Use a consistent radius scale:

- Small control: 8px
- Input/Button: 10px
- Card/Panel: 12px
- Dialog: 16px
- Large feature panel: 16px

Use rounded-xl style where appropriate.

Avoid excessive 24–32px radius on ordinary interface cards.

## Typography

Use Inter or an excellent platform-native system font.

Use:

- Clear title hierarchy
- Compact labels
- Consistent line height
- Medium-weight control labels
- Readable body text
- Subtle secondary descriptions
- Tabular numbers for progress and statistics

No oversized marketing typography inside a utility dashboard.

## Spacing

Use an 8px-based spacing system.

Create consistent:

- Panel padding
- Sidebar spacing
- Form spacing
- Button heights
- Card margins
- Table row heights
- Icon alignment

Default button height: approximately 36–40px.

Use proper native-feeling hover, focus, pressed and disabled states.

## Motion

Use restrained animations:

- 120–180ms interaction transitions
- Subtle fades
- Small position transitions
- No bouncing cards
- No unnecessary page transition animations

Respect reduced-motion system preferences.

Use motion only when it improves feedback or orientation.

---

# 6. APPLICATION LAYOUT

Create a focused application with six primary navigation destinations.

## Sidebar

1. Home
2. Workspaces
3. Connections
4. Tools
5. Activity
6. Settings

Use a narrow, visually balanced sidebar.

Keep navigation intuitive.

Do not create a separate main navigation item for every tool.

Group advanced functionality inside modules.

## Window Behavior

Support:

- Native macOS traffic-light controls
- Appropriate Windows window controls
- Resizable window
- Minimum usable window size
- Window position persistence
- Tray / Menu Bar mode
- Restore last window state
- Keyboard shortcuts
- Light / Dark / System theme

Default window size should be approximately 1100 × 760, adjusted after visual testing.

The interface should remain usable at smaller supported sizes.

---

# 7. HOME SCREEN

Create a remarkably clean home screen.

It should communicate product status within three seconds.

Recommended layout:

**Header**

"Good to go" or "Your workspace is ready"

Small explanatory subtitle.

**Connection Status**

- Local Agent status
- MCP connection status
- Active AI client when detectable

**Quick Actions**

- Add Folder
- Connect AI
- Explore Tools

**Your Workspaces**

Show a concise list of recently used folders.

**Recent Activity**

Show the latest meaningful operations.

**Background Jobs**

Only display this section when jobs exist.

Avoid unnecessary analytics charts.

Do not show fabricated CPU or usage statistics.

If there is no activity, show a well-designed empty state.

---

# 8. WORKSPACES — MULTIPLE FOLDER SUPPORT

This is a core product feature.

Users must be able to add multiple folders from different locations.

Examples:

- ~/Projects
- ~/Documents
- ~/Movies
- ~/Desktop/ClientWork
- D:\Development
- D:\Videos

Do not impose an arbitrary folder-count limit.

## Workspace Management

Features:

- Add folder
- Add multiple folders
- Rename workspace display name
- Remove folder permission
- Enable/disable workspace
- Search workspaces
- Group workspaces
- Show folder path
- Open in Finder / Explorer
- Show file count or size only when measured
- Display permission level
- Show recently used folders

Use the native OS folder picker.

Allow sequential folder selection when the platform's native picker does not support selecting multiple directories in one action.

## Workspace Permissions

Each folder has independent permissions.

Modes:

1. Read Only
2. Read & Write
3. Execute Allowed — separately approved
4. Custom Permissions

Command execution permission must be separate from file read/write permission.

A working directory restriction does not sandbox a command.

Implement stronger OS-level execution isolation where feasible, and explicit trust/approval when it is not available.

## Folder UI

Display workspaces as elegant, compact rows.

Each row includes:

- Folder icon
- Friendly name
- Truncated filesystem path
- Permission label
- Enabled status
- Context menu

Use a clearly visible "Add Folder" button.

Provide a simple permission dialog.

## Workspace Security

Use Workspace IDs internally.

Never let an AI client freely replace a Workspace ID with an arbitrary absolute path.

Validate canonical paths and symbolic links.

Check permissions server-side for every operation.

Support revocation of access.

Handle jobs already running when permission is revoked.

---

# 9. CONNECTIONS SCREEN

Build the easiest possible connection experience.

Supported clients:

- ChatGPT Web (when account and workspace support the required MCP capabilities)
- Claude Desktop
- Claude Code
- Codex
- Cursor
- Other compatible MCP clients

Use individual connection cards.

Every card should show:

- Product icon
- Client name
- Connection status
- Requirements
- Connect or Setup button
- Documentation link
- Troubleshooting

## Local MCP Clients

Provide one-click setup where client configuration formats and filesystem locations are officially supported.

Workflow:

1. Detect installed client.
2. Inspect current MCP configuration.
3. Back up configuration before editing.
4. Add Local Studio MCP entry.
5. Validate configuration.
6. Explain whether client restart is required.
7. Test connection.
8. Show actual success or failure.

Never overwrite unrelated user configuration.

If automatic configuration is unavailable, provide a copyable, verified configuration.

## ChatGPT Web

Do not pretend ChatGPT Web can call a localhost stdio MCP server directly.

Support a legitimate remote access mechanism.

Use supported options such as Secure MCP Tunnel for eligible users, or a separately deployed authenticated HTTPS MCP gateway if necessary.

Show:

- Requirements
- Account eligibility warnings
- Secure tunnel setup
- Connection diagnostics
- Permission explanations
- Clear error states

Do not claim ChatGPT Web write-action support on all plans.

Do not display a fake "Connected" state.

Only mark it connected after a real verified handshake and tool-list check.

Implement local-first functionality independently from remote connection availability.

Remote access must be explicitly enabled by the user.

---

# 10. TOOLS SCREEN — MODULAR TOOL REGISTRY

Create a modular tool marketplace-like interface inside the desktop application.

This is NOT an external marketplace.

It is a simple way to manage built-in modules.

Display categories:

- Files
- Terminal
- Projects
- Git
- Workflows
- Video
- Browser
- Documents
- System

Each module card contains:

- Module name
- Short description
- Tool count
- Enabled/disabled status
- Availability
- Required dependencies
- Security level

Allow module-level enable/disable controls.

Provide a searchable list of individual tools.

For each tool display:

- Name
- Description
- Input requirements
- Permission level
- Enabled status
- Availability
- Last execution
- Typical use case

**Important architecture rule:**

Internally the product may support many specialized operations.

Do not expose 100 nearly identical tools to every AI client automatically.

Expose clear and non-overlapping MCP tools according to enabled modules, client compatibility and permissions.

Each exposed tool must have an accurate name, schema, description and side-effect classification.

Avoid generic unrestricted dispatcher tools designed to bypass client approval controls.

---

# 11. MCP TOOL CATALOG

Implement the following catalog using a phased approach.

Every tool must have:

- Zod input schema
- Validated output schema
- Proper error handling
- Permission enforcement
- Clear tool description
- Audit metadata
- Correct workspace scope
- Appropriate read/write/destructive annotations

## MODULE A — FILE SYSTEM

Core tools:

- `workspace_list` — List authorized workspaces
- `workspace_info` — Inspect workspace details
- `workspace_request_access` — Request folder access through trusted local UI
- `file_list` — List files and directories
- `file_read` — Read text file content
- `file_search` — Search filenames and text content
- `file_write` — Create or write files safely
- `file_patch` — Apply targeted text changes
- `file_move` — Move or rename files
- `file_copy` — Copy files
- `file_trash` — Move files to system trash
- `file_diff` — Preview file changes
- `file_snapshot` — Save recovery checkpoint
- `file_restore` — Restore previously backed-up content

Requirements:

- Recursive search
- Large-file streaming
- Pagination
- Ignore patterns
- Binary file detection
- Atomic writes
- Conflict detection
- Safe overwrite policy
- Symbolic-link handling
- Cross-workspace permission validation

Use operating-system trash instead of permanent deletion by default.

High-impact modifications require confirmation.

## MODULE B — TERMINAL & PROCESS

Tools:

- `command_execute`
- `process_start`
- `process_status`
- `process_output`
- `process_input`
- `process_stop`
- `process_list`
- `port_inspect`
- `runtime_doctor`

Capabilities:

- Execute approved commands
- Capture stdout and stderr
- Handle long-running tasks
- Detect exit codes
- Handle occupied ports
- Cancel processes
- Kill tracked child process trees
- Monitor process health
- Diagnose missing toolchains

Use executable-plus-arguments execution by default.

Avoid shell mode unless necessary and separately authorized.

Classify commands by risk.

Never execute high-risk commands without appropriate approval.

## MODULE C — PROJECT & APP BUILDER

Tools:

- `project_inspect`
- `project_create`
- `project_scaffold`
- `project_install`
- `project_typecheck`
- `project_lint`
- `project_test`
- `project_build`
- `dev_server_start`
- `dev_server_stop`
- `dev_server_status`
- `project_package`

Supported project types:

- React + Vite
- Next.js
- Astro
- Electron
- Tauri

Use official compatible starter templates where possible.

Project creation workflow:

1. Validate output location.
2. Select template.
3. Create real project files.
4. Install dependencies after appropriate approval.
5. Inspect generated project.
6. Run type checking.
7. Execute build.
8. Verify actual artifacts.
9. Report real errors.
10. Return project location.

For existing projects, detect the actual framework, package manager and scripts.

Do not assume all projects share the same structure.

## MODULE D — GIT & SOURCE CONTROL

Tools:

- `git_status`
- `git_diff`
- `git_log`
- `git_branch`
- `git_checkpoint`
- `git_commit`
- `git_restore`
- `git_worktree_create`

Implement safe handling for uncommitted changes.

Before broad AI modifications, offer to create a Git checkpoint.

Provide a useful UI preview of file modifications.

Do not automatically discard user changes.

Do not push to remote repositories without explicit authorization.

## MODULE E — WORKFLOW & JOB ENGINE

Tools:

- `job_list`
- `job_status`
- `job_logs`
- `job_cancel`
- `job_retry`
- `workflow_preview`
- `workflow_run`
- `workflow_schedule`

Implement real persistent jobs.

Support:

- Queue
- Running
- Awaiting approval
- Completed
- Failed
- Cancelled
- Interrupted

Long-running MCP operations must return a Job ID.

Support progress retrieval and cancellation.

Maintain durable history.

Never report successful completion until the actual result is verified.

## MODULE F — VIDEO & AUDIO

Advanced tools:

- `video_probe`
- `video_trim`
- `video_merge`
- `video_detect_silence`
- `video_remove_silence`
- `video_extract_audio`
- `video_transcribe`
- `video_add_subtitles`
- `video_resize`
- `video_render`
- `video_verify`
- `audio_normalize`

Use FFmpeg and FFprobe.

For transcription, use an optional compatible local Whisper engine.

Support:

- MP4
- MOV
- MKV
- Common audio formats
- Silence removal
- Subtitle export
- Subtitle burn-in
- Encoding presets
- Real progress
- Verified output
- Cancellation

Preserve original media.

Use intermediate files and durable checkpoints for multi-stage processing.

Do not fabricate transcription timestamps or rendering progress.

## MODULE G — BROWSER & WEB TESTING

Advanced tools:

- `browser_open`
- `browser_navigate`
- `browser_inspect`
- `browser_click`
- `browser_fill`
- `browser_screenshot`
- `browser_console`
- `browser_test_flow`

Use Playwright.

Support:

- Website screenshots
- DOM inspection
- Console errors
- Functional testing
- Form testing
- Browser automation

Install browser runtimes on demand.

Keep browser processes isolated and fully trackable.

## MODULE H — DOCUMENTS

Optional tools:

- `pdf_read`
- `pdf_merge`
- `pdf_split`
- `docx_read`
- `xlsx_read`
- `csv_analyze`
- `archive_extract`

Add writing/export capabilities only after the corresponding read and validation pipelines are stable.

Handle untrusted document formats safely.

## MODULE I — SYSTEM & SECURITY

Tools:

- `system_info`
- `disk_usage`
- `permission_status`
- `audit_history`
- `dependency_status`
- `device_health`

These must not expose unrelated sensitive data.

Some operations should be available through the trusted local UI only, not as remotely callable MCP tools.

**Do not expose an MCP tool that allows the model to grant itself new permissions or approve its own commands.**

## Tool Delivery Priority

**P0 — Essential:** Workspaces, Files, Commands, Job Status, basic Projects and Git inspection.

**P1 — Professional:** Project generation/build automation, Git rollback, complete Background Jobs, workflow execution and improved diagnostics.

**P2 — Advanced:** Video, Browser, Documents, native desktop automation and scheduled workflows.

Ship only verified tools.

Never register an unfinished tool as enabled.

---

# 12. SAFE AI OPERATIONS & UNDO

This should be one of the application's strongest differentiators.

Implement a safety layer for AI-driven file modifications.

Before modifying existing files, the agent should:

1. Validate workspace access.
2. Inspect the current file state.
3. Verify expected content/hash.
4. Prepare a patch or change plan.
5. Identify destructive consequences.
6. Request approval if required.
7. Apply changes atomically where possible.
8. Record an audit event.
9. Preserve a recovery mechanism.

## Change Review UI

Create a beautiful, readable diff interface.

Use:

- Old content vs new content
- Added lines
- Removed lines
- Modified file count
- Change summary
- Approve
- Reject

For safe reversible operations, provide one-click Undo.

Undo must operate on actual checkpoints, not by asking the AI to guess the original file content.

Avoid automatic rollback that overwrites newer user changes.

---

# 13. ACTIVITY & BACKGROUND JOBS

Create an excellent Activity page.

This screen should feel like Linear's clean task interface, but adapted to local automation.

Display:

- Recent actions
- Running jobs
- Pending approvals
- Errors
- Completed jobs
- Execution history
- Tool name
- Workspace
- Duration
- Logs

Use a compact table or list.

Each job detail view should include:

- Status
- Start time
- Duration
- Real progress where measurable
- Input summary
- Actual command/tool executed
- stdout/stderr logs
- Result artifacts
- Error details
- Cancel or Retry

Avoid fake progress bars.

For operations without measurable progress, show an indeterminate state.

## Persistent Job Engine

Use SQLite.

Require:

- Durable queue
- Job state machine
- Atomic job claiming
- Idempotency support
- Process supervision
- Timeouts
- Cancellation
- Crash recovery
- Resource limits
- Structured logs

If a worker crashes, do not automatically repeat destructive or non-idempotent operations.

Persist completed checkpoints.

Make long-running operations independent from MCP client disconnection.

---

# 14. SYSTEM TRAY / MENU BAR EXPERIENCE

The app must behave like a professional desktop utility.

Users should not need to keep the main window open.

When background mode is enabled:

- Closing the window hides it.
- The tray/menu-bar app remains available.
- The local agent continues serving authorized MCP requests.
- Active jobs continue according to their documented lifecycle.

Tray menu:

- Open Local Studio
- Agent Status
- Active Jobs
- Pause Remote Access
- Open Settings
- Quit

Explicit Quit must have clear behavior.

If a user attempts to quit during active jobs, explain the consequences.

Only claim jobs survive a full application quit if an independent agent implementation has been packaged, installed and tested.

---

# 15. LICENSE & COMMERCIAL SOFTWARE

This product is sold as a one-time-purchase desktop application.

Implement a modular license layer.

Features:

- License activation
- Device registration
- License status
- Deactivation
- Offline grace period
- Activation error handling
- License refresh
- Local secure storage

Design integration with a configurable License API, suitable for a central T2ETECH Store backend.

Do not hardcode production secrets.

Do not store administrative license verification credentials in the app.

Prefer signed license entitlements that can be verified safely offline for a defined period.

The license policy should support configurable device limits.

Local files and user-generated outputs remain accessible to their owners regardless of license state.

Do not implement invasive DRM or destructive anti-tampering behavior.

Make the business model transparent:

- One-time purchase of the software
- Explicit terms for included upgrades
- Optional separately priced hosted remote connection service, if introduced
- No mandatory AI model subscription provided by this product

The app must never imply that purchasing Local Studio includes an external ChatGPT subscription.

---

# 16. FIRST-RUN EXPERIENCE

Build a beautiful, minimal onboarding wizard.

Use 4–5 short screens maximum.

## Screen 1 — Welcome

Display:

"Make your computer work with AI."

Subtitle:

"Connect your favorite AI assistant to your files, projects and workflows."

Primary CTA:

Get Started

## Screen 2 — Choose Folders

Use a native folder picker.

Explain clearly:

"Only folders you authorize can be accessed by Local Studio's file tools."

Allow adding more than one folder.

Default to safe read-only permissions.

## Screen 3 — Connect AI

Display supported clients.

Provide the simplest actual setup route.

Clearly explain when a connection requires additional account permissions or remote configuration.

## Screen 4 — Optional Features

Allow enabling:

- Development Tools
- Git
- Video Tools
- Browser Automation

Do not download unnecessary dependencies by default.

## Screen 5 — Ready

Display real successful checks:

- Agent running
- Folders configured
- MCP ready
- Client connection status

Provide a primary CTA:

Open Local Studio

Never mark steps successful unless the actual checks pass.

---

# 17. PERFORMANCE REQUIREMENTS

Optimize the application for everyday background use.

Requirements:

- UI must remain responsive during heavy processing.
- No synchronous filesystem scans on the renderer thread.
- No FFmpeg execution inside the renderer.
- No unnecessary polling loops.
- No permanently running browser engine.
- No preloaded Whisper model at idle.
- Lazy-load feature modules.
- Limit concurrent workers.
- Keep log buffers bounded.
- Stream large files.
- Implement proper cleanup.

Measure:

- Cold startup time
- Idle CPU usage
- Idle memory usage
- Background agent memory
- File search latency
- MCP tool latency
- Video worker memory
- Installer size

Report measured performance rather than inventing benchmark numbers.

Avoid adding a separate React renderer process for every minor settings screen.

Use one cohesive lightweight desktop interface.

---

# 18. ELECTRON SECURITY

Implement Electron according to current official security recommendations.

Require:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- Strict Content Security Policy
- Safe navigation handling
- Restricted external URL opening
- Typed preload bridge
- IPC sender validation
- Argument validation
- No unrestricted Node.js APIs in renderer

The renderer should expose only narrow application APIs, such as:

- Get agent status
- List workspaces
- Request folder selection
- Update permissions
- List tools
- Manage connections
- Retrieve jobs
- Approve or reject pending actions

Do not expose arbitrary IPC invocation or terminal execution through a generic renderer API.

## Filesystem Security

Implement:

- Canonical path validation
- Workspace boundary enforcement
- Symlink escape protections
- Atomic writes
- Safe deletion
- File conflict detection
- Per-client permissions
- Auditing

## Command Security

Implement:

- Command classification
- Separate execution permission
- Approval policies
- Timeouts
- Process tree cleanup
- Bounded output
- Sensitive environment redaction

Do not confuse command working directories with a real operating-system sandbox.

## Remote MCP Security

If remote access is enabled:

- Require explicit opt-in.
- Authenticate clients.
- Enforce device/session identity.
- Protect against replay.
- Apply authorization to every tool.
- Support immediate remote disconnection.
- Do not expose a raw unauthenticated local API to the internet.

Treat source code comments, README files, documents and terminal output as untrusted data.

They must never override local permission policies.

---

# 19. PACKAGING & INSTALLATION

Build installers for:

- macOS Apple Silicon
- macOS Intel
- Windows x64

Support Windows ARM64 when the chosen dependencies and testing infrastructure allow it.

Use electron-builder.

Installers must include all required runtime components.

No global Node.js requirement for basic packaged usage.

Use `extraResources` or equivalent packaging support for native binaries and helper processes that must run outside the ASAR archive.

Validate native SQLite dependencies in packaged builds.

Implement:

- Proper app icon
- Product name
- App identifier
- Version metadata
- Installer branding
- Clean installation
- Upgrade handling
- Clean uninstall behavior
- Preservation of user workspace data

Support macOS signing and notarization.

Support Windows code signing.

Use GitHub Actions for native platform builds.

Do not claim a macOS-built Windows installer is fully tested without actually executing it on Windows.

Support signed software updates as a separate clearly defined subsystem.

Never execute untrusted update payloads.

---

# 20. REQUIRED APPLICATION SETTINGS

Implement a clean settings page with grouped sections.

## General

- Launch at login
- Start minimized
- Close to tray
- Theme
- Language
- Notifications

## Security

- Default permissions
- Command approvals
- Protected actions
- Workspace grants
- Approval history

## AI Connections

- Connected clients
- Reconnect
- Repair configuration
- Revoke access
- Connection diagnostics

## Tools & Dependencies

- Enabled modules
- Tool availability
- Dependency installation
- FFmpeg setup
- Browser runtime setup

## Performance

- Concurrent jobs
- Heavy processing limits
- Log retention
- Temporary file cleanup

## License

- License status
- Registered device
- Manage activation

## About

- Application version
- Agent version
- MCP protocol version
- Diagnostic report
- Open logs
- Support information

Keep the settings screen organized and compact.

Do not overwhelm users with advanced settings during initial setup.

---

# 21. IMPLEMENTATION ORDER

Do not attempt to implement everything simultaneously.

Build vertical slices that actually work.

## PHASE 1 — Foundation & Beautiful Desktop UI

Implement:

- Electron project
- React + Vite
- shadcn/ui
- Theme system
- Sidebar navigation
- Home screen
- Workspaces screen
- Connections screen
- Tools screen
- Activity screen
- Settings screen
- Native folder picker

Wire all available controls to real state.

No fake connected status.

Acceptance:

The desktop app launches, navigates correctly, adds multiple real folders and persists settings.

## PHASE 2 — Local Agent & MCP

Implement:

- Independent local agent foundation
- Authenticated local IPC
- MCP stdio bridge
- Workspace permissions
- File list/read/write/patch
- Command execution
- Actual process logs

Acceptance:

A real MCP client connects and safely reads/writes a file in an authorized folder.

## PHASE 3 — Reliability & Security

Implement:

- SQLite job persistence
- Background worker supervisor
- Cancellation
- Timeouts
- File change review
- Local approval dialogs
- Audit history
- Undo checkpoints
- Crash recovery

Acceptance:

A durable job completes despite MCP client disconnection; unsafe operations are rejected without approval.

## PHASE 4 — AI Developer Tools

Implement:

- React/Vite project generation
- Project inspection
- Build and test runner
- Git tools
- Development server management

Then expand to:

- Next.js
- Astro
- Electron
- Tauri

Acceptance:

An AI client creates a real application, builds it and verifies the output.

## PHASE 5 — Advanced Modules

Implement:

- FFmpeg
- Video tools
- Whisper transcription
- Browser automation
- Document tools

Each module must have real integration tests.

Optional dependencies must install cleanly.

## PHASE 6 — Commercial Release

Implement:

- License activation
- Native installers
- Tray lifecycle
- Background agent packaging
- Cross-platform tests
- Security hardening
- Release verification
- Installation documentation

Acceptance:

A customer can install the software on a clean machine, activate it, authorize folders, connect a supported local AI client and complete a real workflow.

Test ChatGPT Web connectivity separately using an eligible account and supported remote transport before advertising that functionality as available.

---

# 22. TESTING REQUIREMENTS

Implement automated tests for:

- Multiple workspaces
- Per-folder permissions
- Path traversal
- Symlink handling
- File write conflicts
- Safe undo
- MCP tool schemas
- MCP client disconnection
- Command execution
- Command cancellation
- Process tree cleanup
- Job persistence
- Worker crash
- Agent restart
- Project generation
- Production build
- FFmpeg processing
- Missing dependencies
- License validation
- Electron IPC authorization
- Packaged application startup

## Required End-to-End Tests

**Test A — Multiple Folders**

Authorize three different folders.

Verify all three can be listed.

Verify per-folder permissions.

Verify access outside authorized roots is denied.

**Test B — AI Code Editing**

Connect MCP.

Read a source file.

Apply a patch.

Verify exact output.

Inspect diff and audit history.

Restore a checkpoint.

**Test C — Project Creation**

Generate a Vite React application.

Install dependencies.

Run production build.

Verify actual build output.

**Test D — Persistent Jobs**

Launch a long-running background job.

Disconnect MCP.

Reconnect.

Retrieve job status and actual results.

**Test E — Packaged Application**

Build installer.

Install on a clean machine.

Start Local Agent.

Connect an MCP client.

Execute a real file operation.

Close the UI window.

Verify actual background behavior.

Reopen the UI.

Inspect history.

All tests must operate on real temporary workspaces or safely controlled test environments.

Never run destructive integration tests against the user's real personal folders.

---

# 23. DEVELOPMENT COMMANDS

Create real, working scripts:

- `pnpm dev`
- `pnpm dev:desktop`
- `pnpm dev:agent`
- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm test:mcp`
- `pnpm doctor`
- `pnpm dist:mac`
- `pnpm dist:win`

Scripts must execute meaningful operations.

Do not create fake success scripts.

Document platform requirements.

---

# 24. REQUIRED PROJECT DOCUMENTATION

Maintain:

**README.md**

- Product overview
- Installation
- Development setup
- Build instructions
- Supported platforms

**AGENTS.md**

- Engineering conventions
- System architecture
- Module boundaries
- Security requirements
- Testing instructions

**PROGRESS.md**

- Completed work
- Verified features
- Test results
- Remaining work

**TASKS.md**

- Prioritized implementation tasks
- Acceptance criteria
- Status

**DECISIONS.md**

- Architecture decisions
- Tradeoffs
- Dependency rationale

Update documentation after meaningful implementation milestones.

---

# 25. STRICT QUALITY GATES

A feature is only complete when:

1. Actual implementation exists.
2. UI is connected to the implementation.
3. Inputs are validated.
4. Permissions are enforced.
5. Errors are handled.
6. State persists where required.
7. Actual execution has been tested.
8. Tests pass.
9. Logs and results are inspectable.
10. Documentation is accurate.

A beautiful screen alone is not complete.

A registered MCP tool with placeholder output is not complete.

A generated project that has never built successfully is not complete.

A video render that has not been validated is not complete.

A packaged installer that has never launched successfully is not release-ready.

---

# 26. FINAL EXECUTION INSTRUCTIONS

START IMPLEMENTING NOW.

First:

1. Inspect the repository and operating system.
2. Verify current stable dependencies and MCP SDK APIs.
3. Initialize the Electron monorepo.
4. Establish the shadcn/ui design system.
5. Implement the actual desktop navigation.
6. Create the polished Workspaces interface.
7. Implement native multiple-folder management.
8. Build and connect the local agent.
9. Register the first working MCP tools.
10. Run the first real end-to-end MCP test.
11. Fix failures.
12. Continue to background jobs and project automation.

**DO NOT STOP AT PLANNING.**

Implement real, functioning software.

Prefer smaller verified milestones over a large amount of untested code.

If the session or environment prevents completing all phases, finish at a verified checkpoint, update progress files and report what remains.

## FINAL QUALITY STANDARD

The final application must feel like software made by an exceptional professional desktop product team.

It should combine:

- The visual polish of Linear
- The simplicity of Raycast
- The consistency of shadcn/ui
- The practicality of Desktop Commander
- The reliability of professional developer tools
- The flexibility of an extensible MCP platform

Without copying any of those products.

**Beautiful. Clean. Minimal. Rounded. Fast. Secure. Stable. Powerful.**

Build it as a real product customers would be happy to purchase, install and use every day.