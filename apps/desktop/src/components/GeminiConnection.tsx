import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Copy,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Square,
} from "lucide-react";
import type {
  AccessMode,
  GeminiSettings,
  GeminiStatus,
  Snapshot,
} from "../../../../packages/contracts/src/index";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Switch } from "./ui/switch";
import { useUI } from "../lib/store";

type Form = {
  mode: "quick" | "named";
  publicOrigin: string;
  localPort: number;
  tunnelToken: string;
  workspaceIds: string[];
  modes: Record<string, AccessMode>;
  autoStart: boolean;
};
const labels: Record<GeminiStatus["phase"], string> = {
  unconfigured: "Set up required",
  stopped: "Stopped",
  starting: "Starting…",
  running: "Waiting for Cloudflare",
  ready: "Tunnel connected",
  error: "Needs attention",
};
export function GeminiConnection({ data }: { data: Snapshot }) {
  const cache = useQueryClient(),
    notify = useUI((s) => s.notify);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["gemini"],
    queryFn: () => window.studio.geminiStatus(),
    refetchInterval: 4000,
  });
  const status = query.data;
  const form = useForm<Form>({
    defaultValues: {
      mode: "quick",
      publicOrigin: "",
      localPort: 8766,
      tunnelToken: "",
      workspaceIds: [],
      modes: {},
      autoStart: false,
    },
  });
  useEffect(
    () =>
      window.studio.onChange(
        () => void cache.invalidateQueries({ queryKey: ["gemini"] }),
      ),
    [cache],
  );
  const running =
    status && ["starting", "running", "ready"].includes(status.phase);
  const run = async (action: () => Promise<GeminiStatus>) => {
    setBusy(true);
    try {
      const result = await action();
      cache.setQueryData(["gemini"], result);
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
      await cache.invalidateQueries({ queryKey: ["gemini"] });
    } finally {
      setBusy(false);
    }
  };
  const external = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      notify((error as Error).message, true);
    }
  };
  const configure = () => {
    form.reset({
      mode: status?.mode ?? "quick",
      publicOrigin: status?.publicOrigin ?? "",
      localPort: status?.localPort ?? 8766,
      tunnelToken: "",
      workspaceIds: status?.workspaceIds ?? [],
      autoStart: status?.autoStart ?? false,
      modes: Object.fromEntries(
        (status?.workspaceIds ?? []).map((id) => [
          id,
          status?.workspaceGrants?.find((g) => g.workspaceId === id)
            ?.accessMode ?? "readOnly",
        ]),
      ),
    });
    setOpen(true);
  };
  const save = async (values: Form, start: boolean) => {
    await run(async () => {
      const workspaceGrants = values.workspaceIds.map((workspaceId) => {
        const accessMode = values.modes[workspaceId] ?? "readOnly";
        return {
          workspaceId,
          accessMode,
          write: accessMode !== "readOnly",
          execute: accessMode !== "readOnly",
        };
      });
      for (const grant of workspaceGrants)
        if (grant.accessMode === "full")
          await window.studio.updateWorkspace({
            id: grant.workspaceId,
            accessMode: "full",
          });
      const settings: GeminiSettings = {
        mode: values.mode,
        publicOrigin: values.mode === "named" ? values.publicOrigin : "",
        localPort: values.localPort,
        workspaceIds: values.workspaceIds,
        workspaceGrants,
        write: workspaceGrants.some((g) => g.write),
        execute: workspaceGrants.some((g) => g.execute),
        accessMode:
          workspaceGrants.length &&
          workspaceGrants.every((g) => g.accessMode === "full")
            ? "full"
            : workspaceGrants.some((g) => g.write)
              ? "reviewed"
              : "readOnly",
        autoStart: values.autoStart,
        ...(values.mode === "named" && values.tunnelToken.trim()
          ? { tunnelToken: values.tunnelToken.trim() }
          : {}),
      };
      const saved = await window.studio.saveGemini(settings);
      form.setValue("tunnelToken", "");
      setOpen(false);
      return start ? window.studio.startGemini() : saved;
    });
  };
  return (
    <section className="gemini-panel" aria-label="Gemini Web connection">
      <div className="tunnel-heading">
        <span className="tunnel-icon">
          <Globe size={23} strokeWidth={1.5} />
        </span>
        <div>
          <span className="eyebrow">CLOUDFLARE HTTPS + MCP</span>
          <h3>Gemini Web</h3>
          <p>เชื่อม Gemini กับโฟลเดอร์ที่อนุญาตผ่าน HTTPS และ OAuth</p>
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
            <strong>1. Local MCP</strong>
            <small>
              {status?.bridge
                ? `${status.bridge.toolCount} tools · handshake verified locally`
                : "ตรวจเครื่องมือและสิทธิ์โฟลเดอร์ก่อนเริ่ม"}
            </small>
          </span>
        </div>
        <div>
          <Globe size={17} />
          <span>
            <strong>2. Public HTTPS</strong>
            <small>
              {status?.publicVerifiedAt
                ? "Public MCP metadata verified"
                : status?.runtime
                  ? `cloudflared ${status.runtime.version} · Run checks เพื่อทดสอบ URL`
                  : "Install cloudflared to start"}
            </small>
          </span>
        </div>
        <div>
          <ShieldCheck size={17} />
          <span>
            <strong>3. Gemini tools</strong>
            <small>
              {status?.lastToolAt
                ? `Tool request received · ${new Date(status.lastToolAt).toLocaleTimeString()}`
                : "ยังไม่พบคำขอใช้เครื่องมือจากการเชื่อมต่อนี้"}
            </small>
          </span>
        </div>
      </div>
      {(status?.error || query.error) && (
        <p className="tunnel-error" role="alert">
          {status?.error ??
            "Could not read Gemini status. Restart and try again."}
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
          {status?.configured ? "Edit Gemini settings" : "Set up Gemini Web"}
        </Button>
        {status?.configured && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || (!running && !status.runtime)}
              onClick={() =>
                void run(() =>
                  running
                    ? window.studio.stopGemini()
                    : window.studio.startGemini(),
                )
              }
            >
              {running ? <Square size={13} /> : <Play size={13} />}
              {running ? "Stop Gemini tunnel" : "Start Gemini tunnel"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => window.studio.testGemini())}
            >
              <RefreshCw size={13} />
              Check Gemini connection
            </Button>
          </>
        )}
        {busy && <Loader2 size={16} className="spin" aria-label="Working" />}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void external(() => window.studio.openGemini())}
        >
          Open Gemini
          <ArrowUpRight size={14} />
        </Button>
      </div>
      {status?.mcpUrl && (
        <div className="tunnel-detail">
          <div className="tunnel-id">
            <code>{status.mcpUrl}</code>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Copy Gemini MCP URL"
              onClick={() =>
                void external(async () => {
                  await navigator.clipboard.writeText(status.mcpUrl!);
                  notify("Gemini MCP URL copied.");
                })
              }
            >
              <Copy size={14} />
              Copy URL
            </Button>
          </div>
          <ol className="gemini-steps">
            <li>
              เปิด Gemini → เครื่องมือเชื่อมต่อ → กำหนดเอง แล้ววาง URL นี้
            </li>
            <li>
              ทำตามขั้นตอนเชื่อมบัญชี แล้วจับคู่รหัสและกด Allow ใน Remote Studio
            </li>
            <li>กลับไป Gemini เลือกแอปด้วย @ แล้วลองเรียก workspace_list</li>
          </ol>
          <p className="tunnel-note">
            {status.mode === "quick"
              ? "Quick Tunnel: URL เปลี่ยนทุกครั้งที่เริ่มใหม่ ต้องเพิ่ม URL ใหม่ใน Gemini"
              : "ใช้โดเมนคงที่จาก Cloudflare · เก็บการเชื่อมบัญชี OAuth แบบเข้ารหัสสำหรับเปิดแอปครั้งถัดไป"}{" "}
          </p>
        </div>
      )}
      {!!status?.pending.length && (
        <div className="gemini-requests">
          {status.pending.map((request) => (
            <div key={request.id} className="gemini-request">
              <div>
                <strong>คำขอเชื่อมบัญชี · {request.pairingCode}</strong>
                <p>
                  {request.clientName} · callback:{" "}
                  {new URL(request.redirectUri).host}
                </p>
                <small>ตรวจรหัสให้ตรงกับหน้าที่เปิดจาก Gemini ก่อนอนุญาต</small>
              </div>
              <div className="button-group">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      window.studio.approveGemini({
                        id: request.id,
                        allow: false,
                      }),
                    )
                  }
                >
                  Deny
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      window.studio.approveGemini({
                        id: request.id,
                        allow: true,
                      }),
                    )
                  }
                >
                  Allow connection
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            if (!value) form.setValue("tunnelToken", "");
          }
        }}
        title="Set up Gemini Web"
        description="เลือกโฟลเดอร์และวิธีสร้าง URL HTTPS สำหรับเชื่อม Gemini"
        wide
      >
        <form onSubmit={form.handleSubmit((values) => save(values, true))}>
          <label className="field-label">
            Cloudflare tunnel type
            <select className="input" {...form.register("mode")}>
              <option value="quick">
                Quick Tunnel — ลองใช้งาน ไม่ต้องมีบัญชี Cloudflare
              </option>
              <option value="named">
                Named Tunnel — ใช้งานประจำด้วยโดเมนคงที่
              </option>
            </select>
          </label>
          {form.watch("mode") === "named" ? (
            <>
              <div className="tunnel-form-grid">
                <label className="field-label">
                  Public HTTPS origin
                  <input
                    className="input"
                    placeholder="https://studio.example.com"
                    {...form.register("publicOrigin", {
                      validate: (value) =>
                        form.getValues("mode") !== "named" ||
                        /^https:\/\/[^/]+\/?$/.test(value) ||
                        "Enter an HTTPS origin without /mcp.",
                    })}
                  />
                  {form.formState.errors.publicOrigin && (
                    <small role="alert">
                      {form.formState.errors.publicOrigin.message}
                    </small>
                  )}
                </label>
                <label className="field-label">
                  Local MCP port
                  <input
                    className="input"
                    type="number"
                    min={1024}
                    max={65535}
                    {...form.register("localPort", {
                      valueAsNumber: true,
                      min: 1024,
                      max: 65535,
                    })}
                  />
                </label>
              </div>
              <label className="field-label">
                Cloudflare tunnel token
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    status?.hasToken
                      ? "Token saved · leave blank to keep"
                      : "Paste the tunnel token here"
                  }
                  {...form.register("tunnelToken", {
                    validate: (value) =>
                      form.getValues("mode") !== "named" ||
                      status?.hasToken ||
                      /^\S{20,8192}$/.test(value.trim()) ||
                      "Enter your Cloudflare tunnel token.",
                  })}
                />
                {form.formState.errors.tunnelToken && (
                  <small role="alert">
                    {form.formState.errors.tunnelToken.message}
                  </small>
                )}
              </label>
              <p className="tunnel-note">
                ใน Cloudflare ตั้ง Published application route
                ของโดเมนนี้ให้เป็น HTTP →{" "}
                <code>127.0.0.1:{form.watch("localPort")}</code> และเก็บ token
                เข้ารหัสด้วย OS credential storage
              </p>
              {!status?.secureStorage && (
                <p className="tunnel-error" role="alert">
                  Unlock OS encrypted storage before saving a named tunnel.
                </p>
              )}
            </>
          ) : (
            <p className="tunnel-note">
              สร้าง HTTPS URL ชั่วคราวให้ทันทีเมื่อเริ่ม Tunnel โดย URL
              เปลี่ยนเมื่อหยุดและเริ่มใหม่
            </p>
          )}
          <div className="tunnel-runtime">
            <div>
              <strong>Official cloudflared</strong>
              <small>
                {status?.runtime
                  ? `${status.runtime.path} · ${status.runtime.version}`
                  : "macOS: brew install cloudflared · Windows: ติดตั้ง cloudflared แล้วเลือกไฟล์"}
              </small>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(() => window.studio.selectGeminiRuntime())
              }
            >
              Choose cloudflared
            </Button>
          </div>
          <div className="tunnel-scopes">
            <p>โฟลเดอร์ที่ Gemini เข้าถึงได้</p>
            {!data.workspaces.length && (
              <p className="tunnel-note">
                เพิ่มโฟลเดอร์ใน Workspaces ก่อนเชื่อมต่อ
              </p>
            )}
            {data.workspaces.map((workspace) => (
              <div className="gemini-scope" key={workspace.id}>
                <label>
                  <input
                    type="checkbox"
                    value={workspace.id}
                    {...form.register("workspaceIds")}
                    disabled={!workspace.enabled || !!workspace.rootError}
                  />
                  <span>
                    <strong>{workspace.name}</strong>
                    <small>{workspace.path}</small>
                  </span>
                </label>
                <select
                  className="input"
                  aria-label={`${workspace.name} Gemini access mode`}
                  disabled={!form.watch("workspaceIds").includes(workspace.id)}
                  {...form.register(`modes.${workspace.id}`)}
                >
                  <option value="readOnly">Read only</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="full" disabled={!data.sandbox?.available}>
                    Workspace Full Access
                  </option>
                </select>
              </div>
            ))}
          </div>
          <p className="tunnel-note">
            Gemini ใช้ได้เฉพาะโฟลเดอร์ที่เลือกและสิทธิ์ที่อนุญาต · Reviewed
            รออนุมัติในเครื่อง · Full Access เขียนและรันคำสั่งใน native sandbox
            ตามสิทธิ์โฟลเดอร์
          </p>
          <div className="tunnel-option">
            <div>
              <strong>Start Gemini when Remote Studio opens</strong>
              <small>
                ปิดหน้าต่างแล้วทำงานต่อใน menu bar · Quit หยุด เว้นแต่เปิด
                Background service
              </small>
            </div>
            <Switch
              checked={form.watch("autoStart")}
              onCheckedChange={(value) => form.setValue("autoStart", value)}
              label="Start Gemini when app opens"
            />
          </div>
          <div className="dialog-actions between">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                void external(() =>
                  window.studio.openExternal(
                    "https://developers.cloudflare.com/tunnel/get-started/",
                  ),
                )
              }
            >
              Cloudflare setup guide
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
                    void run(() => window.studio.forgetGemini()).then(
                      (result) => {
                        if (result && !result.configured) setOpen(false);
                      },
                    )
                  }
                >
                  Remove Gemini
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={
                  busy ||
                  (form.watch("mode") === "named" && !status?.secureStorage)
                }
                onClick={() =>
                  void form.handleSubmit((values) => save(values, false))()
                }
              >
                Save only
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !status?.runtime ||
                  (form.watch("mode") === "named" && !status?.secureStorage)
                }
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
