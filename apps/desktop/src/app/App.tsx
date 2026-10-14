import { LicensePanel } from "../features/licensing/LicensePanel";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Activity as ActivityIcon,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Home as HomeIcon,
  Info,
  Layers3,
  Link2,
  Loader2,
  Monitor,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Shield,
  Square,
  Terminal,
  Trash2,
  Undo2,
  X,
  Zap,
  Video,
  Globe,
  Workflow,
  Sun,
  Moon,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  Change,
  AccessMode,
  ConnectionConfig,
  Job,
  Settings,
  Snapshot,
  StudioAPI,
  Workspace,
} from "../../../../packages/contracts/src/index";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/ui/dialog";
import { Switch } from "../components/ui/switch";
import { EnvironmentPanel } from "../features/development/EnvironmentPanel";
import {
  DevelopmentPanel,
  SkillsPanel,
} from "../features/development/DevelopmentPanel";
import { ChatGPTConnection } from "../components/ChatGPTConnection";
import { GeminiConnection } from "../components/GeminiConnection";
import { time } from "../lib/utils";
import { useUI, type Page } from "../lib/store";
declare global {
  interface Window {
    studio: StudioAPI;
  }
}
function chatGPTAccess(data: Snapshot, ws: Workspace) {
  const client = data.clients.find(
    (c) => !c.revoked && c.name === "ChatGPT Web · Secure Tunnel",
  );
  if (!client || (client.workspaceIds && !client.workspaceIds.includes(ws.id)))
    return "ChatGPT: no folder grant";
  const grant = client.workspaceGrants?.find((g) => g.workspaceId === ws.id);
  if (client.workspaceGrants && !grant) return "ChatGPT: no folder grant";
  const mode = grant?.accessMode ?? client.accessMode;
  const write =
    ws.enabled &&
    ws.write &&
    data.modules.Files &&
    (grant?.write ?? client.write) &&
    mode !== "readOnly" &&
    ws.accessMode !== "readOnly";
  const execute =
    ws.enabled &&
    ws.execute &&
    data.modules.Terminal &&
    (grant?.execute ?? client.execute ?? client.write) &&
    mode !== "readOnly" &&
    ws.accessMode !== "readOnly";
  if (!write)
    return "ChatGPT: Read only · connection, folder or Files module blocks writing";
  if (ws.accessMode === "full" && mode === "full")
    return data.sandbox?.available
      ? execute
        ? "ChatGPT: Full Access · native sandbox"
        : "ChatGPT: Full Access · execution disabled"
      : "ChatGPT: execution blocked · sandbox unavailable";
  return execute
    ? "ChatGPT: Reviewed · writes and execution"
    : "ChatGPT: Reviewed · execution disabled";
}
const nav: { page: Page; icon: LucideIcon }[] = [
  { page: "Home", icon: HomeIcon },
  { page: "Workspaces", icon: FolderOpen },
  { page: "Connections", icon: Link2 },
  { page: "Tools", icon: Layers3 },
  { page: "Activity", icon: ActivityIcon },
  { page: "Settings", icon: SettingsIcon },
];
const textTH: Record<string, string> = {
  Home: "หน้าหลัก",
  Workspaces: "พื้นที่ทำงาน",
  Connections: "การเชื่อมต่อ",
  Tools: "เครื่องมือ",
  Activity: "กิจกรรม",
  Settings: "การตั้งค่า",
};
const moduleIcons: Record<string, LucideIcon> = {
  Files: FolderOpen,
  Terminal,
  Projects: Code2,
  Git: GitBranch,
  Jobs: Workflow,
  Planning: Workflow,
  Skills: FileText,
  Desktop: Monitor,
  System: Monitor,
  Video,
  Browser: Globe,
  Documents: FileText,
};
const moduleDescriptions: Record<string, string> = {
  Files: "Read, search, and safely edit your files.",
  Terminal: "Native scoped commands. Real process output.",
  Projects: "Create, inspect and validate web and desktop projects.",
  Planning: "Persistent plans, task verification and execution evidence.",
  Skills: "Import Agent Skills and authorize versioned scripts.",
  Desktop: "Scoped Electron app testing and screenshots.",
  Git: "Inspect status, diffs, and commit history.",
  Jobs: "Durable jobs with cancellation and logs.",
  System: "Local runtime and permission diagnostics.",
  Video:
    "HyperFrames motion graphics, frame previews and verified video renders.",
  Browser: "Isolated browser automation with Playwright.",
  Documents: "PDF, spreadsheets, and document processing.",
};
function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={"status status-" + tone}>
      <span />
      {children}
    </span>
  );
}
function Empty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={25} strokeWidth={1.5} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function SectionTitle({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {detail && <span>{detail}</span>}
      </div>
      {action}
    </div>
  );
}
type Perform = <T>(
  fn: () => Promise<T>,
  message?: string,
) => Promise<T | undefined>;
export function App() {
  const queryClient = useQueryClient();
  const { page, navigate, search, setSearch, toast, notify } = useUI();
  const [palette, setPalette] = useState(false);
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["studio"],
    queryFn: () => window.studio.snapshot(),
    enabled: !!window.studio,
    refetchInterval: 10000,
  });
  const data = query.data;
  const perform: Perform = async (fn, message) => {
    setBusy(true);
    try {
      const result = await fn();
      await queryClient.invalidateQueries({ queryKey: ["studio"] });
      if (message) notify(message);
      return result;
    } catch (error) {
      notify(
        (error as Error).message.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
        true,
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(
    () =>
      window.studio?.onChange(() => {
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
      }),
    [queryClient],
  );
  useEffect(() => {
    const p = () => setPalette(true),
      s = () => navigate("Settings"),
      a = () => navigate("Activity");
    window.addEventListener("studio:palette", p);
    window.addEventListener("studio:settings", s);
    window.addEventListener("studio:activity", a);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("studio:palette", p);
      window.removeEventListener("studio:settings", s);
      window.removeEventListener("studio:activity", a);
      window.removeEventListener("keydown", key);
    };
  }, [navigate]);
  useEffect(() => {
    if (!data) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        data.settings.theme === "dark" ||
          (data.settings.theme === "system" && media.matches),
      );
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [data?.settings.theme]);
  if (!window.studio)
    return (
      <div className="startup">
        <Layers3 size={40} />
        <h1>The desktop connection could not load</h1>
        <p>Close and reopen Remote Studio to reconnect the interface.</p>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </div>
    );
  if (!data)
    return (
      <div className="startup">
        <Layers3 size={40} />
        <h1>
          {query.error
            ? "The local agent needs attention"
            : "Starting your local studio"}
        </h1>
        <p>{query.error?.message ?? "Connecting to the execution engine…"}</p>
        {query.error ? (
          <Button onClick={() => void query.refetch()}>
            <RefreshCw size={16} />
            Try again
          </Button>
        ) : (
          <Loader2 className="spin" size={20} />
        )}
      </div>
    );
  const pending =
    data.changes.filter((c) => c.status === "pending").length +
    data.jobs.filter((j) => j.status === "awaiting_approval").length;
  const add = () => perform(() => window.studio.addFolders());
  return (
    <div className="app-shell" aria-busy={busy}>
      <aside className="sidebar">
        <div className="mac-drag-space" />
        <div className="brand">
          <div className="brand-mark">
            <Layers3 size={21} />
          </div>
          <div>
            Remote Studio<span>LOCAL WORKSPACE ENGINE</span>
          </div>
        </div>
        <button
          className="workspace-selector"
          onClick={() => navigate("Workspaces")}
        >
          <span className="mini-avatar">
            <Monitor size={16} />
          </span>
          <span>
            My computer<small>Personal workspace</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(({ page: p, icon: Icon }) => (
            <button
              key={p}
              aria-label={p}
              onClick={() => navigate(p)}
              className={"nav-item " + (page === p ? "active" : "")}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{data.settings.language === "th" ? textTH[p] : p}</span>
              {p === "Activity" && pending > 0 && (
                <b className="count-badge">{pending}</b>
              )}
              {p === "Settings" && <span className="nav-shortcut">⌘,</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="command-search" onClick={() => setPalette(true)}>
            <Search size={15} />
            <span>Quick navigation</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="local-note">
            <ShieldCheck size={18} />
            <div>
              Local by design<span>Your files stay on your computer.</span>
            </div>
          </div>
          <div className="sidebar-footer">
            <span className={"dot " + (query.isError ? "red" : "green")} />
            {query.isError ? "Agent disconnected" : "Agent online"}
            <span>v{data.version}</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            My computer
            <ChevronRight size={13} />
            <strong>
              {data.settings.language === "th" ? textTH[page] : page}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="local-chip">
              <span className={"dot " + (query.isError ? "red" : "green")} />
              {query.isError ? "Agent disconnected" : "Local agent running"}
            </span>
            <span className="separator" />
            <button
              className="icon-button"
              aria-label="MCP documentation"
              onClick={() =>
                void perform(() =>
                  window.studio.openExternal(
                    "https://modelcontextprotocol.io/docs/getting-started/intro",
                  ),
                )
              }
            >
              <BookOpen size={17} />
            </button>
          </div>
        </header>
        <main className="content">
          {query.isError && (
            <div className="connection-warning" role="alert">
              <span>
                The agent is disconnected. Showing the last saved status.
              </span>
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Reconnect
              </Button>
            </div>
          )}
          {page === "Home" && (
            <Home data={data} add={add} navigate={navigate} />
          )}
          {page === "Workspaces" && (
            <Workspaces
              data={data}
              search={search}
              setSearch={setSearch}
              perform={perform}
              add={add}
            />
          )}
          {page === "Connections" && (
            <Connections data={data} perform={perform} />
          )}
          {page === "Tools" && (
            <Tools
              data={data}
              search={search}
              setSearch={setSearch}
              perform={perform}
            />
          )}
          {page === "Activity" && <Activity data={data} perform={perform} />}
          {page === "Settings" && (
            <SettingsPage data={data} perform={perform} />
          )}
        </main>
        <footer className="bottom-bar">
          <span>
            <ShieldCheck size={13} />
            Authorized folders only
          </span>
          <span>Built for your computer. Controlled by you.</span>
        </footer>
      </div>
      <Dialog
        open={palette}
        onOpenChange={setPalette}
        title="Go to…"
        description="Navigate your local studio."
      >
        <input
          autoFocus
          className="input"
          placeholder="Search pages"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="palette-list">
          {nav
            .filter((n) => n.page.toLowerCase().includes(search.toLowerCase()))
            .map(({ page: p, icon: Icon }) => (
              <button
                key={p}
                onClick={() => {
                  navigate(p);
                  setPalette(false);
                }}
              >
                <Icon size={17} />
                {p}
                <ArrowRight size={16} />
              </button>
            ))}
        </div>
      </Dialog>
      {!data.settings.onboarded && <Onboarding data={data} perform={perform} />}
      {toast && (
        <div
          className={"toast " + (toast.error ? "toast-error" : "")}
          role="status"
        >
          {toast.error ? <Info size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => useUI.setState({ toast: null })}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function Home({
  data,
  add,
  navigate,
}: {
  data: Snapshot;
  add: () => unknown;
  navigate: (p: Page) => void;
}) {
  const workspaces = data.workspaces.filter((w) => w.enabled);
  const active = data.jobs.filter((j) =>
    ["running", "queued"].includes(j.status),
  );
  const grants = data.clients.filter((c) => !c.revoked);
  const lastClient = grants.find((c) => c.lastSeen);
  const recent = data.audit.slice(0, 5);
  return (
    <>
      <Heading
        eyebrow="YOUR LOCAL CONTROL CENTER"
        title={
          workspaces.length
            ? "Your workspace is ready."
            : "Your computer, connected."
        }
        description="A secure bridge between your AI assistant and the work on your computer."
      />
      <div className="connection-strip">
        <div className="connection-strip-icon">
          <Monitor size={24} strokeWidth={1.5} />
        </div>
        <div className="connection-strip-title">
          <strong>Everything starts here.</strong>
          <span>Your execution engine is running locally.</span>
        </div>
        <div className="connection-strip-status">
          <span>
            <span className="dot green" />
            Local agent <b>Online</b>
          </span>
          <span>
            <span className={"dot " + (lastClient ? "green" : "gray")} />
            MCP bridge <b>{lastClient ? "Verified" : "Ready to configure"}</b>
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate("Connections")}
        >
          {lastClient ? "Manage" : "Connect AI"}
          <ArrowUpRight size={14} />
        </Button>
      </div>
      <div className="quick-grid">
        {[
          {
            icon: FolderPlus,
            title: "Add a folder",
            desc: "Choose what AI can access.",
            onClick: add,
            color: "blue",
          },
          {
            icon: Link2,
            title: "Connect your AI",
            desc: "Bring your favorite assistant.",
            onClick: () => navigate("Connections"),
            color: "orange",
          },
          {
            icon: Layers3,
            title: "Explore tools",
            desc: "More possibilities, locally.",
            onClick: () => navigate("Tools"),
            color: "green",
          },
        ].map(({ icon: Icon, title, desc, onClick, color }) => (
          <button className="quick-action" key={title} onClick={onClick}>
            <span className={"quick-icon " + color}>
              <Icon size={20} strokeWidth={1.7} />
            </span>
            <div>
              <strong>{title}</strong>
              <span>{desc}</span>
            </div>
            <ArrowUpRight size={16} />
          </button>
        ))}
      </div>
      <section className="section">
        <SectionTitle
          title="Your workspaces"
          detail={
            workspaces.length
              ? `${workspaces.length} authorized ${workspaces.length === 1 ? "folder" : "folders"}`
              : "Only the folders you choose."
          }
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("Workspaces")}
            >
              View all
              <ArrowRight size={14} />
            </Button>
          }
        />
        <div className="panel">
          {workspaces.length ? (
            <div>
              {workspaces.slice(0, 4).map((w) => (
                <div className="home-workspace-row" key={w.id}>
                  <span className="folder-tile">
                    <Folder size={20} strokeWidth={1.5} />
                  </span>
                  <div>
                    <strong>{w.name}</strong>
                    <span>{w.path}</span>
                  </div>
                  <Status tone={w.write ? "blue" : "neutral"}>
                    {chatGPTAccess(data, w)}
                  </Status>
                  <button
                    className="icon-button"
                    aria-label={"Open " + w.name}
                    onClick={() => void window.studio.openWorkspace(w.id)}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={FolderOpen}
              title="Give your ideas a place to work"
              description="Authorize a folder to let your assistant read files, build projects, and get things done."
              action={
                <Button variant="secondary" onClick={add}>
                  <Plus size={15} />
                  Add your first folder
                </Button>
              }
            />
          )}
        </div>
      </section>
      {active.length > 0 && (
        <section className="section">
          <SectionTitle
            title="Background jobs"
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("Activity")}
              >
                Inspect jobs
                <ArrowRight size={14} />
              </Button>
            }
          />
          <div className="panel">
            {active.map((j) => (
              <div className="activity-row" key={j.id}>
                <Loader2 size={18} className="spin" />
                <div>
                  <strong>{j.label}</strong>
                  <span>
                    {data.workspaces.find((w) => w.id === j.workspaceId)?.name}
                  </span>
                </div>
                <Status tone="blue">{j.status}</Status>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="section">
        <SectionTitle
          title="Recent activity"
          detail="A clear record of what happens."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("Activity")}
            >
              View activity
              <ArrowRight size={14} />
            </Button>
          }
        />
        <div className="panel">
          {recent.length ? (
            recent.map((a) => (
              <div className="activity-row" key={a.id}>
                <span className={"activity-icon " + (a.success ? "" : "error")}>
                  <Check size={15} />
                </span>
                <div>
                  <strong>
                    {a.action.replaceAll(".", " · ").replaceAll("_", " ")}
                  </strong>
                  <span>
                    {a.detail || "Local operation"}
                    {data.workspaces.find((w) => w.id === a.workspaceId)
                      ? " · " +
                        data.workspaces.find((w) => w.id === a.workspaceId)
                          ?.name
                      : ""}
                  </span>
                </div>
                <time>{time(a.at)}</time>
              </div>
            ))
          ) : (
            <div className="activity-empty">
              <Clock3 size={19} />
              <div>
                <strong>A fresh start.</strong>
                <span>
                  Your assistant’s actions will appear here, with every step
                  accounted for.
                </span>
              </div>
            </div>
          )}
        </div>
      </section>
      <div className="home-tip">
        <span className="tip-icon">
          <ShieldCheck size={18} />
        </span>
        <div>
          <strong>You’re always in control.</strong>
          <span>
            Folder permissions, command approvals, and recoverable file changes.
            Built in.
          </span>
        </div>
        <button onClick={() => navigate("Settings")}>
          Security settings
          <ArrowRight size={14} />
        </button>
      </div>
    </>
  );
}
function Workspaces({
  data,
  search,
  setSearch,
  perform,
  add,
}: {
  data: Snapshot;
  search: string;
  setSearch: (s: string) => void;
  perform: Perform;
  add: () => unknown;
}) {
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [fileWS, setFileWS] = useState<Workspace | null>(null);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [reauthorizing, setReauthorizing] = useState(false);
  const current =
    data.workspaces.find((w) => w.id === selected?.id) ?? selected;
  const reauthorize = async (ws: Workspace) => {
    setReauthorizing(true);
    try {
      const restored = await perform(() =>
        window.studio.reauthorizeWorkspace(ws.id),
      );
      if (restored) setSelected(restored);
    } finally {
      setReauthorizing(false);
    }
  };
  const workspaces = data.workspaces.filter((w) =>
    (w.name + w.path + w.group).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Heading
        title="Workspaces"
        description="A place for every project. Permissions for every folder."
        action={
          <Button onClick={add}>
            <Plus size={16} />
            Add folder
          </Button>
        }
      />
      <div className="toolbar">
        <div className="search-input">
          <Search size={16} />
          <input
            aria-label="Search workspaces"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search folders, paths, or groups…"
          />
        </div>
        <span>
          {data.workspaces.length} authorized{" "}
          {data.workspaces.length === 1 ? "folder" : "folders"}
        </span>
      </div>
      <div className="panel workspace-table">
        <div className="table-head">
          <span>WORKSPACE</span>
          <span>PERMISSIONS</span>
          <span>ACCESS</span>
          <span />
        </div>
        {workspaces.length ? (
          workspaces.map((ws) => (
            <div className="workspace-row" key={ws.id}>
              <div className="workspace-identity">
                <span className="folder-tile">
                  <Folder size={21} strokeWidth={1.5} />
                </span>
                <div>
                  <strong>
                    {ws.name}
                    {ws.group && <em>{ws.group}</em>}
                  </strong>
                  <span title={ws.path}>{ws.path}</span>
                </div>
              </div>
              <div className="permission-stack">
                {ws.rootError && (
                  <Status tone="neutral">Folder needs re-authorization</Status>
                )}
                <Status tone={ws.write ? "blue" : "neutral"}>
                  {chatGPTAccess(data, ws)}
                </Status>
                {ws.execute && (
                  <small>
                    <Terminal size={12} />
                    Execution allowed
                  </small>
                )}
              </div>
              <Switch
                checked={ws.enabled}
                label={"Enable " + ws.name}
                onCheckedChange={(enabled) =>
                  void perform(() =>
                    window.studio.updateWorkspace({ id: ws.id, enabled }),
                  )
                }
              />
              <div className="row-actions">
                {ws.rootError && (
                  <button
                    className="icon-button"
                    aria-label={"Re-authorize " + ws.name}
                    title="Re-authorize folder"
                    disabled={reauthorizing}
                    onClick={() => void reauthorize(ws)}
                  >
                    <RefreshCw size={17} />
                  </button>
                )}
                <button
                  className="icon-button"
                  title="Read or edit a file"
                  aria-label={"Files in " + ws.name}
                  onClick={() => setFileWS(ws)}
                >
                  <FileCode2 size={17} />
                </button>
                <button
                  className="icon-button"
                  title="Open folder"
                  aria-label={"Open " + ws.name}
                  onClick={() =>
                    void perform(() => window.studio.openWorkspace(ws.id))
                  }
                >
                  <ExternalLink size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={"Permissions for " + ws.name}
                  onClick={() => {
                    setSelected(ws);
                    setName(ws.name);
                    setGroup(ws.group);
                  }}
                >
                  <MoreHorizontal size={19} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <Empty
            icon={FolderOpen}
            title={
              search ? "No matching workspaces" : "Your workspace, your rules"
            }
            description={
              search
                ? "Try another folder name or path."
                : "Add folders from anywhere on your computer. Each starts with read-only access."
            }
            action={
              !search && (
                <Button onClick={add}>
                  <FolderPlus size={16} />
                  Choose folders
                </Button>
              )
            }
          />
        )}
      </div>
      <div className="inline-note">
        <ShieldCheck size={17} />
        <p>
          Access is checked on every operation. Removing a folder revokes access
          and cancels its active jobs.
        </p>
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title="Workspace permissions"
        description={selected?.path}
      >
        {selected && (
          <>
            <div className="setting-row workspace-authorization">
              <div>
                <strong>
                  {current?.rootError
                    ? "Folder access needs recovery"
                    : "Folder authorization"}
                </strong>
                <p>
                  {current?.rootError
                    ? "Select the original folder to restore its saved access."
                    : "Restore this folder’s saved access when needed."}
                </p>
              </div>
              <Button
                variant="secondary"
                disabled={reauthorizing}
                onClick={() => void reauthorize(selected)}
              >
                <RefreshCw size={15} />
                {reauthorizing ? "Restoring…" : "Re-authorize folder"}
              </Button>
            </div>
            <label className="field-label">
              Display name
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field-label">
              Group
              <input
                className="input"
                placeholder="Optional"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
            </label>
            <label className="field-label">
              Folder access mode
              <select
                className="input"
                aria-label="Folder access mode"
                disabled={!!current?.rootError || reauthorizing}
                value={
                  data.workspaces.find((w) => w.id === selected.id)
                    ?.accessMode ?? "reviewed"
                }
                onChange={(event) =>
                  void perform(() =>
                    window.studio.updateWorkspace({
                      id: selected.id,
                      accessMode: event.target.value as
                        "readOnly" | "reviewed" | "full",
                    }),
                  )
                }
              >
                <option value="readOnly">Read only</option>
                <option value="reviewed">Reviewed</option>
                <option value="full" disabled={!data.sandbox?.available}>
                  Workspace Full Access
                </option>
              </select>
              <small>
                Full Access: continuous file changes and commands within this
                folder’s native sandbox. File tools keep recovery checkpoints.
                Commands retain logs, without automatic Undo.
              </small>
              <small>
                {chatGPTAccess(data, selected)} · {data.sandbox?.backend}
              </small>
            </label>
            <div className="setting-row">
              <div>
                <strong>Read & write</strong>
                <p>
                  File tools retain recovery checkpoints. Reviewed mode waits
                  for approval.
                </p>
              </div>
              <Switch
                checked={
                  data.workspaces.find((w) => w.id === selected.id)?.write ??
                  false
                }
                label="Allow file writes"
                disabled={!!current?.rootError || reauthorizing}
                onCheckedChange={(write) =>
                  void perform(() =>
                    window.studio.updateWorkspace({ id: selected.id, write }),
                  )
                }
              />
            </div>
            <div className="setting-row">
              <div>
                <strong>Command execution</strong>
                <p>
                  Full Access uses the native sandbox. Reviewed mode requires
                  approval for each command.
                </p>
              </div>
              <Switch
                checked={
                  data.workspaces.find((w) => w.id === selected.id)?.execute ??
                  false
                }
                label="Allow execution requests"
                disabled={!!current?.rootError || reauthorizing}
                onCheckedChange={(execute) =>
                  void perform(() =>
                    window.studio.updateWorkspace({ id: selected.id, execute }),
                  )
                }
              />
            </div>
            <div className="dialog-actions between">
              <Button
                variant="destructive"
                onClick={() =>
                  void perform(
                    () => window.studio.removeWorkspace(selected.id),
                    "Folder access removed",
                  ).then(() => setSelected(null))
                }
              >
                <Trash2 size={15} />
                Remove access
              </Button>
              <Button
                onClick={() =>
                  void perform(
                    () =>
                      window.studio.updateWorkspace({
                        id: selected.id,
                        name,
                        group,
                      }),
                    "Workspace updated",
                  ).then(() => setSelected(null))
                }
              >
                Save changes
              </Button>
            </div>
          </>
        )}
      </Dialog>
      <FileEditor
        workspace={fileWS}
        onClose={() => setFileWS(null)}
        perform={perform}
      />
    </>
  );
}
function FileEditor({
  workspace,
  onClose,
  perform,
}: {
  workspace: Workspace | null;
  onClose: () => void;
  perform: Perform;
}) {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState<{
    path: string;
    hash: string | null;
  } | null>(null);
  useEffect(() => {
    setPath("");
    setContent("");
    setOriginal(null);
  }, [workspace?.id]);
  return (
    <Dialog
      open={!!workspace}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="File workspace"
      description={
        workspace?.name +
        " · Relative paths only. Protected files and symbolic links are blocked."
      }
      wide
    >
      <div className="file-path-row">
        <input
          className="input"
          aria-label="Relative file path"
          placeholder="src/main.tsx"
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setOriginal(null);
          }}
        />
        <Button
          variant="secondary"
          disabled={!path}
          onClick={() =>
            void perform(() =>
              window.studio.readFile({ workspaceId: workspace!.id, path }),
            ).then((result) => {
              if (result) {
                setContent(result.content);
                setOriginal({ path, hash: result.hash });
              }
            })
          }
        >
          Read file
        </Button>
        {workspace?.write && (
          <Button
            variant="ghost"
            disabled={!path}
            onClick={() => {
              setOriginal({ path, hash: null });
              setContent("");
            }}
          >
            New file
          </Button>
        )}
      </div>
      <textarea
        className="file-editor"
        aria-label="File content"
        value={content}
        readOnly={!workspace?.write}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Read a file to inspect its content, or choose New file."
      />
      <div className="dialog-actions between">
        <span className="muted">
          <Shield size={14} />
          Changes go to Activity for review.
        </span>
        <Button
          disabled={!workspace?.write || !original}
          onClick={() =>
            void perform(
              () =>
                window.studio.proposeFile({
                  workspaceId: workspace!.id,
                  path,
                  content,
                  expectedHash: original!.hash,
                }),
              "Change is ready to review in Activity",
            ).then((result) => {
              if (result) onClose();
            })
          }
        >
          Request change
          <ArrowRight size={15} />
        </Button>
      </div>
    </Dialog>
  );
}
function Connections({ data, perform }: { data: Snapshot; perform: Perform }) {
  const [config, setConfig] = useState<ConnectionConfig | null>(null);
  const [kind, setKind] = useState("Claude Desktop");
  const [scope, setScope] = useState<string[]>([]);
  const [write, setWrite] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [modes, setModes] = useState<Record<string, AccessMode>>({});
  const [tested, setTested] = useState<Record<string, number>>({});
  const clients = [
    {
      name: "Claude Desktop",
      letter: "✳",
      desc: "A local connection, with one-click configuration.",
      doc: "https://modelcontextprotocol.io/docs/develop/connect-local-servers",
      auto: "claude",
    },
    {
      name: "Codex",
      letter: "⌘",
      desc: "Add a local MCP server with the generated TOML.",
      doc: "https://developers.openai.com/codex/mcp/",
    },
    {
      name: "Cursor",
      letter: "↗",
      desc: "Your editor, with a secure local execution engine.",
      doc: "https://cursor.com/docs/mcp",
      auto: "cursor",
    },
    {
      name: "Claude Code",
      letter: ">_",
      desc: "Use a stdio MCP entry in your local configuration.",
      doc: "https://code.claude.com/docs/en/mcp",
    },
    {
      name: "Other MCP client",
      letter: "◈",
      desc: "Works with clients that support stdio transport.",
      doc: "https://modelcontextprotocol.io/docs/getting-started/intro",
    },
  ];
  const create = async () => {
    const grants = scope.map((workspaceId) => {
      const accessMode =
        modes[workspaceId] ?? (write ? "reviewed" : "readOnly");
      return {
        workspaceId,
        accessMode,
        write: accessMode !== "readOnly",
        execute: accessMode !== "readOnly",
      };
    });
    const result = await perform(async () => {
      for (const grant of grants)
        if (grant.accessMode === "full")
          await window.studio.updateWorkspace({
            id: grant.workspaceId,
            accessMode: "full",
          });
      const input = {
        workspaceIds: scope,
        write: grants.some((g) => g.write),
        execute: grants.some((g) => g.execute),
        accessMode:
          grants.length && grants.every((g) => g.accessMode === "full")
            ? ("full" as const)
            : grants.some((g) => g.write)
              ? ("reviewed" as const)
              : ("readOnly" as const),
        workspaceGrants: grants,
      };
      if (editing) {
        await window.studio.updateConnection({ id: editing, ...input });
        return true;
      }
      return window.studio.createConnection({ name: kind, ...input });
    });
    if (result) {
      setCreating(false);
      setEditing(null);
      if (typeof result !== "boolean") setConfig(result);
    }
  };
  return (
    <>
      <Heading
        title="Connections"
        description="Keep the intelligence in your assistant. Bring the execution here."
      />
      <div className="notice">
        <ShieldCheck size={20} />
        <div>
          <strong>Private, by default.</strong>
          <p>
            Each connection has its own credentials and folder grants. You can
            revoke it at any time.
          </p>
        </div>
      </div>
      <ChatGPTConnection data={data} />
      <GeminiConnection data={data} />
      <SectionTitle
        title="Choose your assistant"
        detail="Local stdio connections"
      />
      <div className="client-grid">
        {clients.map((c) => (
          <div className="client-card" key={c.name}>
            <div className="client-card-top">
              <span className="client-logo">{c.letter}</span>
              <Status>Local MCP</Status>
            </div>
            <h3>{c.name}</h3>
            <p>{c.desc}</p>
            <div className="client-card-footer">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setKind(c.name);
                  setScope(
                    data.workspaces.filter((w) => w.enabled).map((w) => w.id),
                  );
                  setWrite(false);
                  setModes({});
                  setEditing(null);
                  setCreating(true);
                }}
              >
                Set up
                <ArrowRight size={14} />
              </Button>
              <button
                className="icon-button"
                aria-label={"Documentation for " + c.name}
                onClick={() =>
                  void perform(() => window.studio.openExternal(c.doc))
                }
              >
                <ExternalLink size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {data.clients.length > 0 && (
        <section className="section">
          <SectionTitle
            title="Your connections"
            detail="A verified handshake is shown separately from configuration."
          />
          <div className="panel">
            {data.clients.map((c) => (
              <div className="connection-row" key={c.id}>
                <span className="small-icon">
                  <Link2 size={18} />
                </span>
                <div>
                  <strong>{c.name}</strong>
                  <span>
                    {c.workspaceIds?.length ?? data.workspaces.length} folder
                    grants ·{" "}
                    {c.accessMode === "full"
                      ? "Workspace Full Access"
                      : c.write
                        ? "Reviewed"
                        : "Read only"}
                    {c.lastSeen ? " · MCP tool call " + time(c.lastSeen) : ""}
                    {c.lastTool && (
                      <small>
                        Server {c.lastTool.serverId.slice(0, 8)} ·{" "}
                        {c.lastTool.name} · {c.lastTool.clientName}
                      </small>
                    )}
                  </span>
                </div>
                <Status
                  tone={
                    c.revoked ? "neutral" : tested[c.id] ? "green" : "neutral"
                  }
                >
                  {c.revoked
                    ? "Revoked"
                    : tested[c.id]
                      ? "Handshake verified"
                      : "Configured"}
                </Status>
                {!c.revoked && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void perform(() =>
                          window.studio.testConnection(c.id),
                        ).then((result) => {
                          if (result) {
                            setTested((old) => ({
                              ...old,
                              [c.id]: result.toolCount,
                            }));
                            useUI
                              .getState()
                              .notify(
                                "MCP handshake verified · " +
                                  result.toolCount +
                                  " tools",
                              );
                          }
                        })
                      }
                    >
                      <RefreshCw size={14} />
                      Test
                    </Button>
                    {c.name !== "ChatGPT Web · Secure Tunnel" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setKind(c.name);
                          setScope(
                            c.workspaceIds ??
                              data.workspaces
                                .filter((w) => w.enabled)
                                .map((w) => w.id),
                          );
                          setWrite(c.write);
                          setModes(
                            Object.fromEntries(
                              (c.workspaceIds ?? []).map((id) => [
                                id,
                                c.workspaceGrants?.find(
                                  (g) => g.workspaceId === id,
                                )?.accessMode ??
                                  c.accessMode ??
                                  (c.write ? "reviewed" : "readOnly"),
                              ]),
                            ),
                          );
                          setEditing(c.id);
                          setCreating(true);
                        }}
                      >
                        Permissions
                      </Button>
                    )}
                    <button
                      className="icon-button"
                      aria-label={"Revoke " + c.name}
                      onClick={() =>
                        void perform(
                          () => window.studio.revokeConnection(c.id),
                          "Connection revoked",
                        )
                      }
                    >
                      <X size={16} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title={"Connect " + kind}
        description="Choose the folders this client can access. No permissions are granted to other clients."
      >
        <div className="scope-list">
          {data.workspaces
            .filter((w) => w.enabled)
            .map((w) => (
              <label key={w.id}>
                <input
                  type="checkbox"
                  checked={scope.includes(w.id)}
                  onChange={(e) =>
                    setScope(
                      e.target.checked
                        ? [...scope, w.id]
                        : scope.filter((id) => id !== w.id),
                    )
                  }
                />
                <Folder size={17} />
                <span>
                  {w.name}
                  <small>{w.path}</small>
                </span>
                <select
                  className="input"
                  aria-label={"Client access for " + w.name}
                  value={modes[w.id] ?? (write ? "reviewed" : "readOnly")}
                  disabled={!scope.includes(w.id)}
                  onChange={(event) =>
                    setModes({
                      ...modes,
                      [w.id]: event.target.value as AccessMode,
                    })
                  }
                >
                  <option value="readOnly">Read only</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="full" disabled={!data.sandbox?.available}>
                    Workspace Full Access
                  </option>
                </select>
              </label>
            ))}
          {!data.workspaces.length && (
            <p className="muted">
              No folders yet. You can configure a client with zero folder
              access.
            </p>
          )}
        </div>
        <div className="setting-row">
          <div>
            <strong>Allow file change requests</strong>
            <p>
              Workspace write permission and local review are still required.
            </p>
          </div>
          <Switch
            checked={write}
            label="Allow client write requests"
            onCheckedChange={setWrite}
          />
        </div>
        <div className="dialog-actions">
          <Button onClick={() => void create()}>
            Create connection
            <ArrowRight size={15} />
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!config}
        onOpenChange={(open) => {
          if (!open) setConfig(null);
        }}
        title="Your connection is ready to configure"
        description="The bridge uses the bundled Electron runtime. No global Node.js is required."
        wide
      >
        {config && (
          <>
            <pre className="config-code">
              {kind === "Codex" ? config.toml : config.json}
            </pre>
            <p className="muted">
              Restart the AI client after installation. Test verifies the bridge
              locally; it does not prove an external AI application is
              connected.
            </p>
            <div className="dialog-actions between">
              <Button
                variant="secondary"
                onClick={() =>
                  void perform(
                    () =>
                      navigator.clipboard.writeText(
                        kind === "Codex" ? config.toml : config.json,
                      ),
                    "Configuration copied",
                  )
                }
              >
                <Copy size={15} />
                Copy configuration
              </Button>
              <div className="button-group">
                {["Claude Desktop", "Cursor"].includes(kind) && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void perform(() =>
                        window.studio.installConnection({
                          id: config.clientId,
                          client: kind === "Cursor" ? "cursor" : "claude",
                        }),
                      ).then((result) => {
                        if (result)
                          useUI
                            .getState()
                            .notify(
                              "Configuration saved. Restart " +
                                kind +
                                "." +
                                (result.backup ? " Backup preserved." : ""),
                            );
                      })
                    }
                  >
                    Install configuration
                  </Button>
                )}
                <Button
                  onClick={() =>
                    void perform(() =>
                      window.studio.testConnection(config.clientId),
                    ).then((result) => {
                      if (result) {
                        setTested((old) => ({
                          ...old,
                          [config.clientId]: result.toolCount,
                        }));
                        useUI
                          .getState()
                          .notify(
                            "Verified handshake · " +
                              result.toolCount +
                              " tools",
                          );
                      }
                    })
                  }
                >
                  Test bridge
                  <Zap size={15} />
                </Button>
              </div>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}
function Tools({
  data,
  search,
  setSearch,
  perform,
}: {
  data: Snapshot;
  search: string;
  setSearch: (s: string) => void;
  perform: Perform;
}) {
  const [tab, setTab] = useState("Modules");
  const [tool, setTool] = useState<Snapshot["tools"][number] | null>(null);
  const modules = [
    "Files",
    "Terminal",
    "Projects",
    "Planning",
    "Skills",
    "Desktop",
    "Git",
    "Jobs",
    "System",
    "Video",
    "Browser",
    "Documents",
  ];
  return (
    <>
      <Heading
        title="Small tools. Real possibilities."
        description="Enable just what you need. Everything runs on your computer."
      />
      <div className="toolbar">
        <div className="tabs">
          {["Modules", "All tools"].map((t) => (
            <button
              className={tab === t ? "selected" : ""}
              onClick={() => setTab(t)}
              key={t}
            >
              {t}
              {t === "All tools" && <span>{data.tools.length}</span>}
            </button>
          ))}
        </div>
        <div className="search-input compact">
          <Search size={16} />
          <input
            aria-label="Search tools"
            placeholder="Search tools…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {tab === "Modules" ? (
        <div className="module-grid">
          {modules
            .filter((m) =>
              (m + moduleDescriptions[m])
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((m) => {
              const Icon = moduleIcons[m];
              const tools = data.tools.filter((t) => t.module === m);
              const available = tools.length > 0;
              return (
                <div
                  className={"module-card " + (!available ? "unavailable" : "")}
                  key={m}
                >
                  <div className="module-header">
                    <span className="module-icon">
                      <Icon size={23} strokeWidth={1.6} />
                    </span>
                    <Switch
                      checked={!!data.modules[m]}
                      label={"Enable " + m + " module"}
                      disabled={!available}
                      onCheckedChange={(enabled) =>
                        void perform(() =>
                          window.studio.setModule({ name: m, enabled }),
                        )
                      }
                    />
                  </div>
                  <h3>{m}</h3>
                  <p>{moduleDescriptions[m]}</p>
                  <div className="module-meta">
                    <span>
                      {available ? `${tools.length} tools` : "Planned module"}
                    </span>
                    <Status
                      tone={available && data.modules[m] ? "green" : "neutral"}
                    >
                      {available
                        ? data.modules[m]
                          ? "Enabled"
                          : "Disabled"
                        : "Unavailable"}
                    </Status>
                  </div>
                  {available && (
                    <div className="module-security">
                      <Shield size={12} />
                      {m === "Terminal"
                        ? "Reviewed or native Full Access"
                        : m === "Files"
                          ? "Workspace mode · file checkpoints"
                          : m === "Projects"
                            ? "New files only · write grant"
                            : "Workspace scoped"}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      ) : (
        <div className="panel tools-list">
          {data.tools
            .filter((t) =>
              (t.name + t.description)
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((t) => (
              <button key={t.name} onClick={() => setTool(t)}>
                <span className="small-icon">
                  {(() => {
                    const Icon = moduleIcons[t.module];
                    return <Icon size={17} />;
                  })()}
                </span>
                <div>
                  <strong>{t.name}</strong>
                  <span>{t.description}</span>
                </div>
                <span className="tool-permission">{t.permission}</span>
                <Status tone={t.enabled ? "green" : "neutral"}>
                  {t.enabled ? "Enabled" : "Disabled"}
                </Status>
                <ChevronRight size={15} />
              </button>
            ))}
        </div>
      )}
      <SkillsPanel data={data} perform={perform} />
      <Dialog
        open={!!tool}
        onOpenChange={(open) => {
          if (!open) setTool(null);
        }}
        title={tool?.name ?? "Tool"}
        description={tool?.description}
      >
        {tool && (
          <div className="tool-details">
            <div>
              <span>Module</span>
              <strong>{tool.module}</strong>
            </div>
            <div>
              <span>Required permission</span>
              <strong>{tool.permission}</strong>
            </div>
            <div>
              <span>Availability</span>
              <strong>{tool.enabled ? "Enabled" : "Module disabled"}</strong>
            </div>
            <p>
              Input schemas are published through MCP tools/list and validated
              by the agent. File paths are relative to an authorized workspace
              ID.
            </p>
            <p>
              {tool.permission === "execute"
                ? "Commands use the native workspace sandbox. Reviewed mode requires local approval; Full Access uses the folder and connection grants."
                : tool.permission === "write"
                  ? "File changes retain conflict-checked checkpoints. Reviewed mode requests approval; Full Access applies within the authorized folder."
                  : "This tool inspects data without changing your files."}
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
function Activity({ data, perform }: { data: Snapshot; perform: Perform }) {
  const [tab, setTab] = useState("All activity");
  const [job, setJob] = useState<Job | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [command, setCommand] = useState(false);
  const [filter, setFilter] = useState("");
  const [history, setHistory] = useState<Job[]>([]);
  const [historyOffset, setHistoryOffset] = useState(100);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const jobs = [
    ...new Map([...history, ...data.jobs].map((j) => [j.id, j])).values(),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const rows = await perform(() =>
        window.studio.listJobs({ limit: 100, offset: historyOffset }),
      );
      if (rows) {
        setHistory((previous) => [...previous, ...rows]);
        setHistoryOffset((previous) => previous + rows.length);
        setHasMoreHistory(rows.length === 100);
      }
    } finally {
      setLoadingHistory(false);
    }
  };
  const pending =
    data.jobs.filter((j) => j.status === "awaiting_approval").length +
    data.changes.filter((c) => c.status === "pending").length;
  useEffect(() => {
    if (!job) return;
    const current = data.jobs.find((j) => j.id === job.id);
    if (
      (current && current.status !== job.status) ||
      current?.status === "running"
    )
      void window.studio
        .getJob(job.id)
        .then(setJob)
        .catch(() => {});
  }, [data.jobs]);
  const showJob = (id: string) =>
    void perform(() => window.studio.getJob(id)).then((result) => {
      if (result) setJob(result);
    });
  const showChange = (id: string) =>
    void perform(() => window.studio.getChange(id)).then((result) => {
      if (result) setChange(result);
    });
  return (
    <>
      <Heading
        title="Activity"
        description="Every action, every approval, and every result. All in one place."
        action={
          <div className="button-group">
            <Button
              variant="secondary"
              onClick={() =>
                void perform(
                  () => window.studio.stopAll(),
                  "All owned work stopped.",
                )
              }
            >
              Stop all work
            </Button>
            <Button variant="secondary" onClick={() => setCommand(true)}>
              <Terminal size={16} />
              Run command
            </Button>
          </div>
        }
      />
      <DevelopmentPanel data={data} perform={perform} />
      <div className="toolbar">
        <div className="tabs">
          {["All activity", "Jobs", "Approvals"].map((t) => (
            <button
              key={t}
              className={tab === t ? "selected" : ""}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Approvals" && pending > 0 && <span>{pending}</span>}
            </button>
          ))}
        </div>
        <div className="search-input compact">
          <Search size={15} />
          <input
            aria-label="Filter activity"
            placeholder="Filter activity…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      {pending > 0 && tab !== "Jobs" && (
        <div className="approval-banner">
          <Shield size={20} />
          <div>
            <strong>
              {pending} {pending === 1 ? "action needs" : "actions need"} your
              approval
            </strong>
            <span>Inspect the exact change or command before allowing it.</span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setTab("Approvals")}
          >
            Review actions
            <ArrowRight size={14} />
          </Button>
        </div>
      )}
      <div className="panel activity-list">
        {data.changes
          .filter(
            (c) =>
              tab !== "Jobs" &&
              (tab !== "Approvals" || c.status === "pending") &&
              c.path.toLowerCase().includes(filter.toLowerCase()),
          )
          .map((c) => (
            <button
              className="activity-table-row"
              key={c.id}
              onClick={() => showChange(c.id)}
            >
              <span className="small-icon">
                <FileCode2 size={17} />
              </span>
              <div>
                <strong>
                  {c.status === "pending"
                    ? "Review file change"
                    : "File change"}
                  <code>{c.path}</code>
                </strong>
                <span>
                  {data.workspaces.find((w) => w.id === c.workspaceId)?.name ??
                    "Revoked workspace"}
                </span>
              </div>
              <Status
                tone={
                  c.status === "pending"
                    ? "orange"
                    : c.status === "applied"
                      ? "green"
                      : "neutral"
                }
              >
                {c.status}
              </Status>
              <time>{time(c.createdAt)}</time>
              <ChevronRight size={16} />
            </button>
          ))}
        {jobs
          .filter(
            (j) =>
              (tab !== "Approvals" || j.status === "awaiting_approval") &&
              j.label.toLowerCase().includes(filter.toLowerCase()),
          )
          .map((j) => (
            <button
              className="activity-table-row"
              key={j.id}
              onClick={() => showJob(j.id)}
            >
              <span className="small-icon">
                {j.status === "running" ? (
                  <Loader2 size={17} className="spin" />
                ) : (
                  <Terminal size={17} />
                )}
              </span>
              <div>
                <strong>{j.label}</strong>
                <span>
                  {data.workspaces.find((w) => w.id === j.workspaceId)?.name ??
                    "Revoked workspace"}
                </span>
              </div>
              <Status
                tone={
                  j.status === "completed"
                    ? "green"
                    : j.status === "failed"
                      ? "red"
                      : j.status === "awaiting_approval"
                        ? "orange"
                        : j.status === "running"
                          ? "blue"
                          : "neutral"
                }
              >
                {j.status.replaceAll("_", " ")}
              </Status>
              <time>{time(j.createdAt)}</time>
              <ChevronRight size={16} />
            </button>
          ))}
        {tab === "All activity" &&
          data.audit
            .filter((a) =>
              (a.action + a.detail)
                .toLowerCase()
                .includes(filter.toLowerCase()),
            )
            .map((a) => (
              <div className="activity-table-row audit-row" key={a.id}>
                <span className="small-icon">
                  <ArrowDownLeft size={17} />
                </span>
                <div>
                  <strong>{a.action.replaceAll(".", " · ")}</strong>
                  <span>{a.detail || a.clientId}</span>
                </div>
                <Status tone={a.success ? "green" : "red"}>
                  {a.success ? "Recorded" : "Denied"}
                </Status>
                <time>{time(a.at)}</time>
                <span />
              </div>
            ))}
        {((tab === "All activity" &&
          !data.audit.length &&
          !jobs.length &&
          !data.changes.length) ||
          (tab === "Jobs" && !jobs.length) ||
          (tab === "Approvals" && !pending)) && (
          <Empty
            icon={tab === "Approvals" ? ShieldCheck : ActivityIcon}
            title={
              tab === "Approvals" ? "All caught up" : "Nothing to report yet"
            }
            description={
              tab === "Approvals"
                ? "There are no actions waiting for your approval."
                : "Operations from your assistant and this app will appear here with real results."
            }
          />
        )}
      </div>
      {tab !== "Approvals" &&
        hasMoreHistory &&
        (data.jobs.length >= 100 || history.length > 0) && (
          <div className="toolbar">
            <Button
              variant="secondary"
              disabled={loadingHistory}
              onClick={() => void loadHistory()}
            >
              {loadingHistory ? "Loading history…" : "Load older jobs"}
            </Button>
          </div>
        )}
      <Dialog
        open={!!job}
        onOpenChange={(open) => {
          if (!open) setJob(null);
        }}
        title="Job details"
        description={job?.id}
        wide
      >
        {job && (
          <>
            <div className="job-detail-meta">
              <Status
                tone={
                  job.status === "completed"
                    ? "green"
                    : job.status === "awaiting_approval"
                      ? "orange"
                      : "blue"
                }
              >
                {job.status.replaceAll("_", " ")}
              </Status>
              <span>{time(job.createdAt)}</span>
              <span>
                {job.exitCode !== null
                  ? "Exit code " + job.exitCode
                  : "No exit code yet"}
              </span>
            </div>
            <pre className="command-code">
              {job.command.executable}
              {job.command.args
                .map((arg) => " " + JSON.stringify(arg))
                .join("")}
            </pre>
            <div className="job-context">
              <span>Working directory</span>
              <strong>
                {data.workspaces.find((w) => w.id === job.workspaceId)?.path}/
                {job.command.cwd}
              </strong>
              <span>Timeout</span>
              <strong>{job.command.timeoutMs / 1000} seconds</strong>
            </div>
            {job.status === "awaiting_approval" && (
              <div className="warning-note">
                <Shield size={17} />
                <p>
                  This command runs with your user privileges and may access
                  files outside its working directory. Review the executable and
                  every argument before approving.
                </p>
              </div>
            )}
            <pre className="job-logs">
              {job.logs || "No process output yet."}
            </pre>
            {job.error && <p className="error-text">{job.error}</p>}
            <div className="dialog-actions">
              {job.status === "awaiting_approval" ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void perform(() =>
                        window.studio.resolveJob({
                          id: job.id,
                          decision: "reject",
                        }),
                      ).then(() => setJob(null))
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    onClick={() =>
                      void perform(
                        () =>
                          window.studio.resolveJob({
                            id: job.id,
                            decision: "approve",
                          }),
                        "Command approved",
                      ).then(() => setJob(null))
                    }
                  >
                    <Play size={14} />
                    Approve & run
                  </Button>
                </>
              ) : ["running", "queued"].includes(job.status) ? (
                <Button
                  variant="destructive"
                  onClick={() =>
                    void perform(() =>
                      window.studio.resolveJob({
                        id: job.id,
                        decision: "cancel",
                      }),
                    ).then(() => setJob(null))
                  }
                >
                  <Square size={13} />
                  Cancel job
                </Button>
              ) : ["failed", "interrupted", "cancelled"].includes(
                  job.status,
                ) ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    void perform(
                      () =>
                        window.studio.resolveJob({
                          id: job.id,
                          decision: "retry",
                        }),
                      "Retry requested · review required",
                    ).then(() => setJob(null))
                  }
                >
                  <RefreshCw size={14} />
                  Request retry
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setJob(null)}>
                  Done
                </Button>
              )}
            </div>
          </>
        )}
      </Dialog>
      <Dialog
        open={!!change}
        onOpenChange={(open) => {
          if (!open) setChange(null);
        }}
        title="Review file change"
        description={change?.path + " · " + change?.status}
        wide
      >
        {change && (
          <>
            <div className="diff-labels">
              <span>Original content</span>
              <span>Proposed content</span>
            </div>
            <div className="diff-grid">
              <pre className="diff-before">{change.before ?? "(New file)"}</pre>
              <pre className="diff-after">{change.after}</pre>
            </div>
            <div className="inline-note">
              <ShieldCheck size={15} />
              <p>
                SHA-256 conflict protection prevents overwriting newer changes.
              </p>
            </div>
            <div className="dialog-actions">
              {change.status === "pending" ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void perform(() =>
                        window.studio.resolveChange({
                          id: change.id,
                          decision: "reject",
                        }),
                      ).then(() => setChange(null))
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    onClick={() =>
                      void perform(
                        () =>
                          window.studio.resolveChange({
                            id: change.id,
                            decision: "approve",
                          }),
                        "Change applied · checkpoint saved",
                      ).then(() => setChange(null))
                    }
                  >
                    <Check size={15} />
                    Approve change
                  </Button>
                </>
              ) : change.status === "applied" ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    void perform(
                      () =>
                        window.studio.resolveChange({
                          id: change.id,
                          decision: "undo",
                        }),
                      "Checkpoint restored",
                    ).then(() => setChange(null))
                  }
                >
                  <Undo2 size={15} />
                  Undo change
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setChange(null)}>
                  Done
                </Button>
              )}
            </div>
          </>
        )}
      </Dialog>
      <CommandDialog
        open={command}
        onClose={() => setCommand(false)}
        data={data}
        perform={perform}
      />
    </>
  );
}
function CommandDialog({
  open,
  onClose,
  data,
  perform,
}: {
  open: boolean;
  onClose: () => void;
  data: Snapshot;
  perform: Perform;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<{
    workspaceId: string;
    executable: string;
    args: string;
    cwd: string;
  }>({
    defaultValues: { workspaceId: "", executable: "", args: "[]", cwd: "." },
  });
  const workspaces = data.workspaces.filter((w) => w.enabled && w.execute);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      title="Request a command"
      description="Executable plus arguments. Commands always require a separate local approval."
    >
      <form
        onSubmit={handleSubmit(async (values) => {
          await perform(async () => {
            const args = JSON.parse(values.args);
            return window.studio.runCommand({
              ...values,
              args,
              timeoutMs: 120000,
            });
          }, "Command ready to review in Activity").then((result) => {
            if (result) {
              onClose();
              reset();
            }
          });
        })}
      >
        <label className="field-label">
          Workspace
          <select
            className="input"
            {...register("workspaceId", { required: true })}
          >
            <option value="">Select a workspace</option>
            {workspaces.map((w) => (
              <option value={w.id} key={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        {!workspaces.length && (
          <p className="warning-text">
            Enable command execution in a workspace’s permissions first.
          </p>
        )}
        <label className="field-label">
          Executable
          <input
            className="input mono"
            placeholder="npm"
            {...register("executable", { required: true })}
          />
        </label>
        <label className="field-label">
          Arguments as JSON
          <input
            className="input mono"
            placeholder='["run", "build"]'
            {...register("args", { required: true })}
          />
        </label>
        <label className="field-label">
          Relative working directory
          <input
            className="input mono"
            {...register("cwd", { required: true })}
          />
        </label>
        {Object.keys(errors).length > 0 && (
          <p className="error-text">Complete all required fields.</p>
        )}
        <div className="dialog-actions">
          <Button type="submit" disabled={!workspaces.length}>
            <Shield size={15} />
            Request approval
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function SettingsPage({ data, perform }: { data: Snapshot; perform: Perform }) {
  const set = (input: Partial<Settings>) =>
    void perform(() => window.studio.setSettings(input));
  return (
    <>
      <Heading
        title="Make it yours."
        description="Simple defaults. Thoughtful controls."
      />
      <section className="settings-section">
        <SectionTitle title="General" detail="Your everyday experience" />
        <EnvironmentPanel data={data} perform={perform} />
        <div className="development-actions">
          <Button
            variant="secondary"
            onClick={() =>
              void perform(() => window.studio.exportSupportBundle())
            }
          >
            Export support bundle
          </Button>
        </div>
        <div className="panel settings-panel">
          <div className="setting-row">
            <div>
              <strong>Appearance</strong>
              <p>Choose the theme that feels right.</p>
            </div>
            <div className="theme-control">
              {[
                { name: "light", icon: Sun },
                { name: "dark", icon: Moon },
                { name: "system", icon: Monitor },
              ].map(({ name, icon: Icon }) => (
                <button
                  key={name}
                  className={data.settings.theme === name ? "selected" : ""}
                  onClick={() => set({ theme: name as Settings["theme"] })}
                >
                  <Icon size={15} />
                  {name}
                </button>
              ))}
            </div>
          </div>
          {[
            {
              key: "launchAtLogin",
              title: "Launch at login",
              description: "Have your studio ready when you sign in.",
            },
            {
              key: "startMinimized",
              title: "Start in the menu bar",
              description: "Keep the main window out of the way on launch.",
            },
            {
              key: "closeToTray",
              title: "Keep running when the window closes",
              description:
                "Your agent and approved jobs continue in the menu bar.",
            },
            {
              key: "notifications",
              title: "Job notifications",
              description:
                "A native notification when a job finishes or fails.",
            },
          ].map((s) => (
            <div className="setting-row" key={s.key}>
              <div>
                <strong>{s.title}</strong>
                <p>{s.description}</p>
              </div>
              <Switch
                checked={Boolean(data.settings[s.key as keyof Settings])}
                label={s.title}
                onCheckedChange={(value) => set({ [s.key]: value })}
              />
            </div>
          ))}
          <div className="setting-row">
            <div>
              <strong>Background service</strong>
              <p>
                Keep the agent and MCP tunnel running after Quit. Packaged
                builds start a per-user helper at login.
              </p>
            </div>
            <Switch
              checked={data.settings.backgroundService}
              label="Background service"
              onCheckedChange={(value) => set({ backgroundService: value })}
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Navigation language</strong>
              <p>Language for the primary navigation labels.</p>
            </div>
            <select
              className="input small-select"
              value={data.settings.language}
              onChange={(e) =>
                set({ language: e.target.value as Settings["language"] })
              }
            >
              <option value="en">English</option>
              <option value="th">ไทย</option>
            </select>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <SectionTitle title="Security" detail="Local control, always" />
        <div className="panel settings-panel">
          <div className="setting-row">
            <div>
              <strong>Evidence retention</strong>
              <p>
                Remove expired captures after the selected number of days.
                Evidence referenced by verification is preserved. Zero keeps
                everything.
              </p>
            </div>
            <input
              type="number"
              min={0}
              max={3650}
              aria-label="Artifact retention days"
              defaultValue={data.settings.artifactRetentionDays}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 0 && n <= 3650)
                  set({ artifactRetentionDays: n });
              }}
            />
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              void perform(
                () => window.studio.cleanArtifacts(),
                "Expired unreferenced evidence cleaned.",
              )
            }
          >
            Clean expired captures
          </Button>
        </div>
        <div className="panel settings-panel">
          <div className="setting-row">
            <div>
              <strong>Default folder permissions</strong>
              <p>New folders begin with read-only access.</p>
            </div>
            <Status>Read only</Status>
          </div>
          <div className="setting-row">
            <div>
              <strong>Command approval</strong>
              <p>
                Reviewed mode requests approval. Full Access uses the selected
                folder and connection grants.
              </p>
            </div>
            <Status tone="blue">Scoped</Status>
          </div>
          <div className="setting-row">
            <div>
              <strong>Remote access</strong>
              <p>No public listener or internet gateway is enabled.</p>
            </div>
            <Status>Off</Status>
          </div>
          <div className="setting-row">
            <div>
              <strong>File recovery</strong>
              <p>Real checkpoints with protection against newer edits.</p>
            </div>
            <Status tone="green">Enabled</Status>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <SectionTitle
          title="Performance"
          detail="Keep your computer responsive"
        />
        <div className="panel settings-panel">
          <div className="setting-row">
            <div>
              <strong>Concurrent jobs</strong>
              <p>Maximum approved processes running at once.</p>
            </div>
            <select
              className="input small-select"
              value={data.settings.concurrency}
              onChange={(e) => set({ concurrency: Number(e.target.value) })}
            >
              {[1, 2, 3, 4].map((n) => (
                <option value={n} key={n}>
                  {n} {n === 1 ? "job" : "jobs"}
                </option>
              ))}
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>Bounded process output</strong>
              <p>
                The latest 128 KiB of output per job. Sensitive key/value
                patterns are redacted.
              </p>
            </div>
            <Status>128 KiB</Status>
          </div>
        </div>
      </section>
      <LicensePanel />
      <section className="settings-section">
        <SectionTitle title="About Remote Studio" />
        <div className="panel settings-panel">
          <div className="setting-row">
            <div>
              <strong>Remote Studio {data.version}</strong>
              <p>
                MCP SDK v2 · Local agent PID {data.agent.pid} ·{" "}
                {Math.round(data.agent.memoryBytes / 1024 / 1024)} MiB agent
                memory
              </p>
              <p>
                Quit stops owned work by default. Enable Background service in
                Settings to keep authorized work and the MCP tunnel running.
              </p>
            </div>
            <span className="about-logo">
              <Layers3 size={25} />
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
function Onboarding({ data, perform }: { data: Snapshot; perform: Perform }) {
  const [step, setStep] = useState(0);
  const titles = [
    "Make your computer work with AI.",
    "Choose your folders.",
    "Bring your assistant.",
    "You’re ready to begin.",
  ];
  return (
    <Dialog
      open
      onOpenChange={() => {}}
      title="Welcome to Remote Studio"
      description="A few small steps. A whole new way to work."
      wide
    >
      <div className="onboarding-progress">
        {titles.map((_t, i) => (
          <span key={i} className={i <= step ? "complete" : ""} />
        ))}
      </div>
      <div className="onboarding-body">
        <span className="onboarding-mark">
          {step === 0 ? (
            <Layers3 size={33} />
          ) : step === 1 ? (
            <FolderOpen size={33} />
          ) : step === 2 ? (
            <Link2 size={33} />
          ) : (
            <ShieldCheck size={33} />
          )}
        </span>
        <h2>{titles[step]}</h2>
        {step === 0 ? (
          <>
            <p>
              Connect your favorite AI assistant to your files, projects, and
              workflows. You choose the access. Your computer does the work.
            </p>
            <div className="onboarding-values">
              <span>
                <Shield size={15} />
                Private by default
              </span>
              <span>
                <Folder size={15} />
                Local first
              </span>
              <span>
                <Undo2 size={15} />
                Recoverable edits
              </span>
            </div>
          </>
        ) : step === 1 ? (
          <>
            <p>
              Only folders you authorize can be accessed by file tools. Each
              starts with safe, read-only permissions.
            </p>
            <Button
              variant="secondary"
              onClick={() => void perform(() => window.studio.addFolders())}
            >
              <FolderPlus size={16} />
              Choose folders
            </Button>
            <div className="onboarding-folders">
              {data.workspaces.map((w) => (
                <span key={w.id}>
                  <Folder size={14} />
                  {w.name}
                  <Check size={14} />
                </span>
              ))}
            </div>
          </>
        ) : step === 2 ? (
          <>
            <p>
              Claude Desktop, Codex, Cursor, and compatible MCP clients use a
              local stdio bridge. Create scoped credentials on the Connections
              page.
            </p>
            <div className="onboarding-clients">
              <span>Claude Desktop</span>
              <span>Codex</span>
              <span>Cursor</span>
            </div>
            <p className="muted">
              ChatGPT Web requires a separate authenticated remote gateway,
              which is not available in this preview.
            </p>
          </>
        ) : (
          <>
            <p>
              Your local execution engine is running. You can add folders and
              connect a client whenever you’re ready.
            </p>
            <div className="ready-checks">
              <span>
                <CheckCircle2 size={17} />
                Local agent running
              </span>
              <span>
                {data.workspaces.length ? (
                  <CheckCircle2 size={17} />
                ) : (
                  <Clock3 size={17} />
                )}{" "}
                {data.workspaces.length} folders authorized
              </span>
              <span>
                <CheckCircle2 size={17} />
                {data.tools.filter((t) => t.enabled).length} local tools
                available
              </span>
              <span>
                <Clock3 size={17} />
                AI client not connected yet
              </span>
            </div>
          </>
        )}
      </div>
      <div className="dialog-actions between">
        <Button
          variant="ghost"
          onClick={() =>
            step > 0
              ? setStep(step - 1)
              : void perform(() =>
                  window.studio.setSettings({ onboarded: true }),
                )
          }
        >
          {step > 0 ? "Back" : "Set up later"}
        </Button>
        <Button
          onClick={() =>
            step < 3
              ? setStep(step + 1)
              : void perform(() =>
                  window.studio.setSettings({ onboarded: true }),
                )
          }
        >
          {step === 0
            ? "Get started"
            : step === 3
              ? "Open Remote Studio"
              : "Continue"}
          <ArrowRight size={15} />
        </Button>
      </div>
    </Dialog>
  );
}
