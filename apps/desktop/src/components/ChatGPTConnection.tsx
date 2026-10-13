import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
} from "lucide-react";
import type {
  Snapshot,
  AccessMode,
  TunnelStatus,
} from "../../../../packages/contracts/src/index";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Switch } from "./ui/switch";
import { useUI } from "../lib/store";

interface Form {
  tunnelId: string;
  apiKey: string;
  workspaceIds: string[];
  write: boolean;
  autoStart: boolean;
  modes: Record<string, AccessMode>;
}
const labels: Record<TunnelStatus["phase"], string> = {
  unconfigured: "Set up required",
  stopped: "Stopped",
  starting: "Starting…",
  running: "Runtime running",
  ready: "Runtime ready",
  error: "Needs attention",
};
export function ChatGPTConnection({ data }: { data: Snapshot }) {
  const cache = useQueryClient(),
    notify = useUI((s) => s.notify);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const query = useQuery({
    queryKey: ["tunnel"],
    queryFn: () => window.studio.tunnelStatus(),
    refetchInterval: 4000,
  });
  const status = query.data;
  const form = useForm<Form>({
    defaultValues: {
      tunnelId: "",
      apiKey: "",
      workspaceIds: [],
      write: false,
      modes: {},
      autoStart: false,
    },
  });
  const running =
    status && ["starting", "running", "ready"].includes(status.phase);
  useEffect(
    () =>
      window.studio.onChange(
        () => void cache.invalidateQueries({ queryKey: ["tunnel"] }),
      ),
    [cache],
  );
  const run = async (action: () => Promise<TunnelStatus>) => {
    setBusy(true);
    try {
      const result = await action();
      cache.setQueryData(["tunnel"], result);
      await cache.invalidateQueries({ queryKey: ["studio"] });
      return result;
    } catch (error) {
      notify(
        (error as Error).message.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
        true,
      );
      await cache.invalidateQueries({ queryKey: ["tunnel"] });
    } finally {
      setBusy(false);
    }
  };
  const configure = () => {
    form.reset({
      tunnelId: status?.tunnelId ?? "",
      apiKey: "",
      workspaceIds: status?.workspaceIds ?? [],
      write: status?.write ?? false,
      modes: Object.fromEntries(
        (status?.workspaceIds ?? []).map((id) => [
          id,
          status?.workspaceGrants?.find((g) => g.workspaceId === id)
            ?.accessMode ??
            status?.accessMode ??
            (status?.write ? "reviewed" : "readOnly"),
        ]),
      ),
      autoStart: status?.autoStart ?? false,
    });
    setOpen(true);
  };
  const save = async (values: Form, start: boolean) => {
    const result = await run(async () => {
      const grants = values.workspaceIds.map((workspaceId) => {
        const accessMode =
          values.modes[workspaceId] ?? (values.write ? "reviewed" : "readOnly");
        return {
          workspaceId,
          accessMode,
          write: accessMode !== "readOnly",
          execute: accessMode !== "readOnly",
        };
      });
      for (const grant of grants)
        if (grant.accessMode === "full")
          await window.studio.updateWorkspace({
            id: grant.workspaceId,
            accessMode: "full",
          });
      const { modes: _modes, ...settings } = values;
      const saved = await window.studio.saveTunnel({
        ...settings,
        workspaceGrants: grants,
        write: grants.some((g) => g.write),
        execute: grants.some((g) => g.execute),
        accessMode:
          grants.every((g) => g.accessMode === "full") && grants.length
            ? "full"
            : grants.some((g) => g.write)
              ? "reviewed"
              : "readOnly",
        apiKey: values.apiKey.trim() || undefined,
      });
      // Clear the transient field immediately after saving, even if start fails.
      form.setValue("apiKey", "");
      setOpen(false);
      return start ? window.studio.startTunnel() : saved;
    });
    if (result)
      notify(
        start
          ? "Saved. Check runtime and OpenAI polling below."
          : "ChatGPT configuration saved securely.",
      );
  };
  const external = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      notify((error as Error).message, true);
    }
  };
  return (
    <section className="tunnel-panel" aria-label="ChatGPT Web connection">
      <div className="tunnel-heading">
        <span className="tunnel-icon">
          <Globe size={23} strokeWidth={1.5} />
        </span>
        <div>
          <span className="eyebrow">OPENAI SECURE MCP TUNNEL</span>
          <h3>ChatGPT Web</h3>
          <p>
            เชื่อม ChatGPT กับโฟลเดอร์บนเครื่อง ผ่านการเชื่อมต่อออกไปยัง OpenAI
          </p>
        </div>
        <span
          className={
            "status status-" +
            (status?.phase === "ready"
              ? "green"
              : status?.phase === "error"
                ? "amber"
                : "neutral")
          }
        >
          <span />
          {status ? labels[status.phase] : "Checking…"}
        </span>
      </div>
      <div className="tunnel-checks">
        <div>
          <ShieldCheck size={17} />
          <span>
            <strong>1. Local bridge</strong>
            <small>
              {status?.bridge
                ? `${status.bridge.toolCount} tools · handshake verified locally`
                : "ตรวจ MCP ก่อนเปิด tunnel"}
            </small>
          </span>
        </div>
        <div>
          <Terminal size={17} />
          <span>
            <strong>2. Tunnel runtime</strong>
            <small>
              {status?.live
                ? status.ready
                  ? "Health and readiness passed"
                  : "Live · waiting for readiness"
                : status?.runtime
                  ? `Installed · ${status.runtime.version.split("+")[0]}`
                  : "Choose the official tunnel-client runtime"}
            </small>
          </span>
        </div>
        <div>
          <Globe size={17} />
          <span>
            <strong>3. ChatGPT plugin</strong>
            <small>เพิ่มและทดสอบในบัญชี ChatGPT ของคุณ</small>
          </span>
        </div>
      </div>
      {query.error && (
        <p className="tunnel-error" role="alert">
          Could not read the tunnel status. Restart the app and try again.
        </p>
      )}
      {status?.error && (
        <p className="tunnel-error" role="alert">
          {status.error}
        </p>
      )}
      <div className="tunnel-actions">
        <Button
          size="sm"
          variant={status?.configured ? "secondary" : "default"}
          disabled={busy || !status}
          onClick={configure}
        >
          <Settings2 size={14} />
          {status?.configured ? "Edit ChatGPT settings" : "Set up ChatGPT Web"}
        </Button>
        {status?.configured && (
          <>
            {running ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void run(() => window.studio.stopTunnel())}
              >
                <Square size={13} />
                Stop tunnel
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy || !status.runtime}
                onClick={() => void run(() => window.studio.startTunnel())}
              >
                <Play size={13} />
                Start tunnel
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => window.studio.testTunnel())}
            >
              <RefreshCw size={13} />
              Run checks
            </Button>
          </>
        )}
        {busy && <Loader2 size={16} className="spin" aria-label="Working" />}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void external(() => window.studio.openChatGPT())}
        >
          Open ChatGPT
          <ArrowUpRight size={14} />
        </Button>
      </div>
      {status?.configured && (
        <div className="tunnel-detail">
          <div className="tunnel-id">
            <code>{status.tunnelId}</code>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Copy tunnel ID"
              onClick={() =>
                void external(async () => {
                  await navigator.clipboard.writeText(status.tunnelId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy ID"}
            </Button>
          </div>
          <p className="tunnel-poll">
            OpenAI polling:{" "}
            {status.lastPollAt
              ? "last successful response " +
                new Date(status.lastPollAt).toLocaleTimeString()
              : "ยังไม่พบหลักฐานการตอบกลับจาก OpenAI"}
          </p>
          <p>
            {status.workspaceIds.length} folder grants ·{" "}
            {status.accessMode === "full"
              ? "Workspace Full Access"
              : status.write
                ? "Reviewed"
                : "Read only"}{" "}
            · {status.autoStart ? "Starts when this app opens" : "Manual start"}
          </p>
          <p className="tunnel-note">
            หลังเปลี่ยนสิทธิ์หรืออัปเดต tools ให้ Refresh connection ใน ChatGPT
            แล้วเริ่มแชตใหม่ เพื่อโหลดรายการ tools ล่าสุด
          </p>
          <ol className="tunnel-steps">
            <li>กด Open ChatGPT → Plugins → + → Add custom MCP server</li>
            <li>
              เลือก Connection: Tunnel แล้วเลือกหรือวาง Tunnel ID นี้ ตั้งชื่อ
              Remote Studio เลือก authentication ให้ตรงกับ MCP server (bridge
              นี้ไม่มี OAuth เพิ่มเติม)
            </li>
            <li>
              ตรวจและยอมรับคำเตือน → Create as a plugin → ติดตั้ง แล้วเรียก
              @Remote Studio ในแชต
            </li>
            <li>
              ทดลอง: “ใช้ Remote Studio เรียก workspace_list
              และบอกโฟลเดอร์ที่อนุญาต” แล้วตรวจคำขอใน Activity
            </li>
          </ol>
          <p>
            Runtime ready คือสถานะเครื่องนี้ การติดตั้ง plugin และผลทดสอบใน
            ChatGPT ต้องตรวจบนเว็บ เปิดแอปไว้หรือย่อไปที่ menu bar เพื่อให้
            tunnel ทำงาน
          </p>
          <details className="tunnel-logs">
            <summary>Runtime diagnostics (keys redacted)</summary>
            <pre>{status.logs || "ยังไม่มี runtime logs"}</pre>
          </details>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            if (!value) form.setValue("apiKey", "");
          }
        }}
        title="Set up ChatGPT Web"
        description="กรอกค่าในแอปนี้ ไม่ต้องส่ง API key ในแชต แอปจะสร้าง local credential ที่มีสิทธิ์เฉพาะโฟลเดอร์ที่คุณเลือก"
        wide
      >
        <form onSubmit={form.handleSubmit((values) => save(values, true))}>
          <div className="tunnel-form-grid">
            <label className="field-label">
              Tunnel ID
              <input
                className="input"
                autoComplete="off"
                placeholder="tunnel_…"
                {...form.register("tunnelId", {
                  required: "Enter your tunnel ID.",
                  pattern: {
                    value: /^tunnel_[a-z0-9]{32}$/,
                    message:
                      "Use tunnel_ followed by 32 lowercase letters or digits.",
                  },
                })}
              />
              <small>ใช้ Tunnel ID ที่สร้างแยกสำหรับ Remote Studio</small>
              {form.formState.errors.tunnelId && (
                <span role="alert">
                  {form.formState.errors.tunnelId.message}
                </span>
              )}
            </label>
            <label className="field-label">
              Runtime API key
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder={
                  status?.hasKey
                    ? "Key saved · leave blank to keep"
                    : "CONTROL_PLANE_API_KEY"
                }
                {...form.register("apiKey", {
                  validate: (value) =>
                    (!value && status?.hasKey) ||
                    /^\S{12,2048}$/.test(value.trim()) ||
                    "Enter a valid runtime API key.",
                })}
              />
              <small>
                {status?.hasKey
                  ? "เว้นว่างเพื่อใช้ key ที่เก็บไว้"
                  : "Runtime key ที่มี Tunnels Read + Use"}
              </small>
              {form.formState.errors.apiKey && (
                <span role="alert">{form.formState.errors.apiKey.message}</span>
              )}
            </label>
          </div>
          <div className="tunnel-storage">
            <KeyRound size={16} />
            <span>
              {status?.secureStorage
                ? "API key เข้ารหัสด้วย OS credential storage · ไม่บันทึก key แบบข้อความธรรมดา"
                : "OS encrypted storage unavailable. Unlock your keychain to save."}
            </span>
          </div>
          <div className="tunnel-runtime">
            <div>
              <strong>Official tunnel-client</strong>
              <small>
                {status?.runtime
                  ? status.runtime.path +
                    " · " +
                    status.runtime.version.split("+")[0]
                  : "macOS: brew install openai/tools/tunnel-client แล้วเลือกไฟล์ executable"}
              </small>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(() => window.studio.selectTunnelRuntime())
              }
            >
              Choose executable
            </Button>
          </div>
          <label className="field-label">Allowed folders</label>
          <div className="scope-list tunnel-scopes">
            {data.workspaces
              .filter((w) => w.enabled)
              .map((w) => (
                <label key={w.id}>
                  <input
                    type="checkbox"
                    value={w.id}
                    {...form.register("workspaceIds")}
                  />
                  <span>
                    {w.name}
                    <small>{w.path}</small>
                  </span>
                  <select
                    aria-label={"ChatGPT access for " + w.name}
                    className="input"
                    value={
                      form.watch("modes")[w.id] ??
                      (form.watch("write") ? "reviewed" : "readOnly")
                    }
                    onChange={(event) =>
                      form.setValue("modes", {
                        ...form.getValues("modes"),
                        [w.id]: event.target.value as AccessMode,
                      })
                    }
                    disabled={!form.watch("workspaceIds").includes(w.id)}
                  >
                    <option value="readOnly">Read only</option>
                    <option value="reviewed">Reviewed</option>
                    <option value="full" disabled={!data.sandbox?.available}>
                      Workspace Full Access
                    </option>
                  </select>
                </label>
              ))}
            {!data.workspaces.some((w) => w.enabled) && (
              <p>เพิ่มโฟลเดอร์ในหน้า Workspaces แล้วกลับมาเลือกสิทธิ์ที่นี่</p>
            )}
          </div>
          <p className="tunnel-note">
            ไม่มีโฟลเดอร์ที่เลือก = ไม่มีสิทธิ์อ่านไฟล์
            โฟลเดอร์ที่เพิ่มภายหลังจะไม่ถูกอนุญาตอัตโนมัติ
          </p>
          <p className="tunnel-note">
            ผลลัพธ์เครื่องมือจากโฟลเดอร์ที่คุณอนุญาตจะส่งไปยัง ChatGPT ผ่าน
            OpenAI
          </p>
          <p className="tunnel-note">
            Workspace Full Access อนุญาตเขียนไฟล์และรันคำสั่งต่อเนื่องใน native
            sandbox ของโฟลเดอร์นั้น มี checkpoint สำหรับ file tools;
            คำสั่งทั่วไปไม่มี Undo อัตโนมัติ · {data.sandbox?.backend} ·{" "}
            {data.sandbox?.reason}
          </p>
          <div className="tunnel-option">
            <div>
              <strong>Start tunnel when Remote Studio opens</strong>
              <small>
                ปิดหน้าต่างแล้วทำงานต่อใน menu bar · Quit หยุด tunnel
              </small>
            </div>
            <Switch
              checked={form.watch("autoStart")}
              onCheckedChange={(value) => form.setValue("autoStart", value)}
              label="Start tunnel when app opens"
            />
          </div>
          <div className="dialog-actions between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void external(() =>
                  window.studio.openExternal(
                    "https://developers.openai.com/api/docs/guides/secure-mcp-tunnels",
                  ),
                )
              }
            >
              Setup guide
              <ArrowUpRight size={13} />
            </Button>
            <div className="button-group">
              {status?.configured && (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void run(() => window.studio.forgetTunnel()).then(
                      (result) => {
                        if (result && !result.configured) {
                          form.reset();
                          setOpen(false);
                        }
                      },
                    )
                  }
                >
                  Remove
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !status?.secureStorage}
                onClick={() =>
                  void form.handleSubmit((values) => save(values, false))()
                }
              >
                Save only
              </Button>
              <Button
                type="submit"
                disabled={busy || !status?.secureStorage || !status?.runtime}
              >
                {busy ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Play size={14} />
                )}
                Save &amp; start
              </Button>
            </div>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
