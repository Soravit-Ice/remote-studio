import {
  frozenUI,
  frozenServices,
  runtimeRevision,
} from "../../../../packages/shared/src/native-runtime";
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  protocol,
  net,
  safeStorage,
} from "electron";
import { join, resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  openSync,
  closeSync,
} from "node:fs";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  rpc,
  adminToken,
  subscribe,
} from "../../../../packages/shared/src/rpc";
import {
  configuration,
  installConfig,
  clientPath,
  type BridgeEntry,
} from "../../../../packages/connections/src/index";
import {
  commandSchema,
  id,
  settingsPatchSchema,
  tunnelSettingsSchema,
  accessModeSchema,
  workspaceGrantSchema,
  type Snapshot,
} from "../../../../packages/contracts/src/index";
import { proposeSchema } from "../../../../packages/filesystem/src/index";
import { TunnelController } from "../../../../packages/tunnel/src/index";
import {
  BackgroundService,
  TunnelProxy,
  serveBackground,
  backgroundCall,
} from "./background";
import { EnvironmentVault } from "./environment-vault";
import { validateEnvironmentName } from "../../../../packages/environment/src/index";
import { WorkspaceLocks } from "../../../../packages/shared/src/execution-context";
import { windowRecovery, recordDesktopEvent } from "./window-recovery";
import { installationLicenseKey } from "./license-vault";
import { createHash } from "node:crypto";
import productConfig from "../../../../product.config.json";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "studio",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.setName("Remote Studio");
const explicitData = process.argv.indexOf("--studio-data");
if (explicitData >= 0 && process.argv[explicitData + 1])
  app.setPath("userData", process.argv[explicitData + 1]);
if (process.env.STUDIO_DATA_DIR)
  app.setPath("userData", process.env.STUDIO_DATA_DIR);
let main: BrowserWindow;
let tray: Tray;
let quitting = false;
let state: Snapshot;
let notifyReady = false;
const data = app.getPath("userData");
const environmentVault = new EnvironmentVault(data);
const runtime = process.execPath;
const uiRoot = app.isPackaged
  ? resolve(import.meta.dirname, "..")
  : frozenUI(resolve(import.meta.dirname, ".."), data);
const explicitServices = process.argv.indexOf("--studio-services");
const servicesRoot = frozenServices(
  explicitServices >= 0
    ? process.argv[explicitServices + 1]
    : app.isPackaged
      ? join(process.resourcesPath, "services")
      : resolve(import.meta.dirname, "../../dist/services"),
  data,
);
const service = (name: string) => join(servicesRoot, name + ".mjs");
let token: string;
let events: ReturnType<typeof subscribe>;
let tunnel: TunnelController | TunnelProxy;
const lifecycle = new WorkspaceLocks();
const background = new BackgroundService(
  data,
  runtime,
  app.isPackaged ? app.getAppPath() : uiRoot,
  app.isPackaged,
  servicesRoot,
);
const call = (method: string, input: unknown = {}) =>
  rpc(data, token, method, input, "ui", method === "snapshot" ? 5000 : 60000);
async function initializeLicensing() {
  try {
    await call("license.initialize", {
      key: await installationLicenseKey(data),
    });
  } catch {
    recordDesktopEvent(data, "license-storage-locked");
  }
}
let finishLicenseReady!: () => void;
const licenseReady = new Promise<void>((resolve) => {
  finishLicenseReady = resolve;
});
let lastCallback: string | undefined;
function receiveLicenseCallback(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "com.t2etech.remotestudio:" ||
      url.hostname !== "oauth" ||
      url.pathname !== "/callback" ||
      url.hash ||
      url.username ||
      url.password ||
      value.length > 4096
    )
      return;
    const digest = createHash("sha256").update(value).digest("hex");
    if (digest === lastCallback) return;
    lastCallback = digest;
    void Promise.all([app.whenReady(), licenseReady])
      .then(() => call("license.complete", value))
      .catch(() => recordDesktopEvent(data, "license-callback-failed"));
  } catch {
    /* Unrelated URLs never reach the SDK. */
  }
}
const entry = (clientId: string): BridgeEntry => ({
  command: runtime,
  args: [
    service("bridge"),
    "--credential",
    join(data, "clients", clientId + ".json"),
  ],
  env: { ELECTRON_RUN_AS_NODE: "1" },
});
async function testBridge(clientId: string) {
  await call("connection.secret", clientId);
  const config = entry(clientId);
  const client = new Client({
    name: "remote-studio-diagnostics",
    version: "0.1.0",
  });
  try {
    await client.connect(
      new StdioClientTransport({
        ...config,
        env: { ...config.env },
        stderr: "pipe",
      }),
    );
    const { tools } = await client.listTools();
    const result = await client.callTool({
      name: "workspace_list",
      arguments: {},
    });
    if (result.isError) throw new Error("MCP workspace check failed.");
    const expected: Snapshot = await call("snapshot");
    if (
      client.getServerVersion()?.title !==
      `Remote Studio · ${expected.agent.serverId}`
    )
      throw new Error(
        "Bridge routing identity mismatch. This connection reached a different Remote Studio server.",
      );
    return {
      toolCount: tools.length,
      serverId: expected.agent.serverId,
      catalogFingerprint: (result._meta as any)?.[
        "remote-studio/catalogFingerprint"
      ],
    };
  } finally {
    await client.close();
  }
}
async function ensureAgent() {
  token = await adminToken(data);
  const matchingBuild = (snapshot: Snapshot) => {
    if (snapshot.agent.buildFingerprint !== runtimeRevision(servicesRoot))
      throw new Error(
        "A different Remote Studio build still owns this agent. Stop owned work, disable Background service, Quit the previous app, then reopen this build. Existing jobs were preserved.",
      );
  };
  let existing: Snapshot | undefined;
  try {
    existing = await call("snapshot");
  } catch {
    /* Launch the service. */
  }
  if (existing) {
    matchingBuild(existing);
    return;
  }
  const errorLog = openSync(join(data, "agent-startup.log"), "a", 0o600);
  const child = spawn(
    runtime,
    [
      service("agent"),
      "--data",
      data,
      ...(!app.isPackaged &&
      process.env.STUDIO_TEST_LICENSE === "1" &&
      process.env.STUDIO_DATA_DIR
        ? ["--test-license"]
        : []),
    ],
    {
      detached: true,
      stdio: ["ignore", "ignore", errorLog],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", STUDIO_DATA_DIR: data },
    },
  );
  closeSync(errorLog);
  let startError: Error | undefined;
  child.once("error", (error) => {
    startError = error;
  });
  child.unref();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (startError) throw startError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        "Local agent stopped during startup. See agent-startup.log in " + data,
      );
    let ready: Snapshot | undefined;
    try {
      ready = await rpc(data, token, "snapshot", {}, "ui", 1000);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (ready) {
      matchingBuild(ready);
      return;
    }
  }
  child.kill("SIGTERM");
  throw new Error(
    "Local agent did not start. See agent-startup.log in " + data,
  );
}
async function backgroundCallForShutdown() {
  await backgroundCall(data, token, "shutdown").catch(() => {});
}
function watchAgent() {
  events?.destroy();
  events = subscribe(data, token, async () => {
    try {
      const next: Snapshot = await call("snapshot");
      if (notifyReady && next.settings.notifications) {
        const fresh = next.jobs.filter(
          (j) =>
            ["completed", "failed"].includes(j.status) &&
            !state.jobs.some(
              (old) => old.id === j.id && old.status === j.status,
            ),
        );
        for (const job of fresh)
          new Notification({
            title: "Remote Studio · " + job.status,
            body: job.label.slice(0, 100),
          }).show();
      }
      state = next;
      notifyReady = true;
      if (main && !main.isDestroyed()) main.webContents.send("studio:changed");
    } catch {
      /* The renderer's health query surfaces a disconnected agent. */
    }
  });
}
async function readSnapshot(): Promise<Snapshot> {
  try {
    return await call("snapshot");
  } catch (error) {
    if (
      !new Set(["ENOENT", "ECONNREFUSED", "ECONNRESET", "EPIPE"]).has(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
    return lifecycle.run("agent-recovery", async () => {
      await ensureAgent();
      await initializeLicensing();
      const entries = await environmentVault.load();
      if (!environmentVault.locked) await call("environment.restore", entries);
      state = await call("snapshot");
      watchAgent();
      recordDesktopEvent(data, "agent-reconnected");
      return state;
    });
  }
}
function makeTunnel() {
  return new TunnelController({
    directory: data,
    vault: {
      available: () =>
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== "linux" ||
          safeStorage.getSelectedStorageBackend() !== "basic_text"),
      encrypt: (key) => safeStorage.encryptString(key),
      decrypt: (bytes) => safeStorage.decryptString(bytes),
    },
    createGrant: async (settings) =>
      (
        await call("connection.create", {
          name: "ChatGPT Web · Secure Tunnel",
          workspaceIds: settings.workspaceIds,
          write: settings.write,
          execute: settings.execute,
          accessMode: settings.accessMode,
          workspaceGrants: settings.workspaceGrants,
        })
      ).clientId,
    revokeGrant: (clientId) => call("connection.revoke", clientId),
    checkGrant: async (clientId) => {
      await call("connection.secret", clientId);
    },
    testBridge,
    bridge: entry,
    changed: () => {
      if (main && !main.isDestroyed()) main.webContents.send("studio:changed");
    },
  });
}
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (
    event.sender !== main.webContents ||
    event.senderFrame !== main.webContents.mainFrame
  )
    throw new Error("Untrusted IPC sender.");
  const url = event.senderFrame.url;
  if (
    process.env.ELECTRON_RENDERER_URL
      ? url !== process.env.ELECTRON_RENDERER_URL &&
        url !== process.env.ELECTRON_RENDERER_URL + "/"
      : !url.startsWith("studio://app/")
  )
    throw new Error("Untrusted renderer origin.");
}
function handle(name: string, schema: z.ZodType, fn: (input: any) => unknown) {
  ipcMain.handle("studio:" + name, async (event, input) => {
    trusted(event);
    return fn(schema.parse(input));
  });
}
const empty = z.undefined();
function register() {
  handle("licenseStatus", empty, () => call("license.status"));
  handle("licenseLogin", empty, async () => {
    const result: { url: string } = await call("license.login");
    const url = new URL(result.url);
    if (
      url.origin !== productConfig.supabaseUrl ||
      url.pathname !== "/auth/v1/oauth/authorize"
    )
      throw new Error("Unexpected sign-in URL.");
    await shell.openExternal(url.href);
  });
  handle(
    "licenseActivate",
    z.string().trim().min(1).max(200).optional(),
    (key) => call("license.activate", key),
  );
  handle("licenseLogout", empty, () => call("license.logout"));
  handle("licenseDeactivate", empty, async () => {
    const answer = await dialog.showMessageBox(main, {
      type: "question",
      message: "Deactivate Remote Studio on this device?",
      detail:
        "Active work will stop. Your workspaces and project files are preserved.",
      buttons: ["Keep activation", "Deactivate"],
      defaultId: 0,
      cancelId: 0,
    });
    return answer.response === 1
      ? call("license.deactivate")
      : call("license.status");
  });
  handle("licenseOpenStore", empty, () =>
    shell.openExternal(
      new URL("/th/products/remote-studio", productConfig.licenseApiOrigin)
        .href,
    ),
  );
  handle("stopAll", empty, () => call("jobs.stopAll"));
  handle(
    "listJobs",
    z.object({
      limit: z.number().int().min(1).max(100),
      offset: z.number().int().min(0).max(1000000),
    }),
    (input) => call("jobs.page", input),
  );
  handle("cleanArtifacts", empty, () => call("maintenance.cleanup"));
  handle("exportSupportBundle", empty, async () => {
    const bundle = await call("maintenance.support"),
      picked = await dialog.showSaveDialog(main, {
        title: "Export diagnostics without source, logs or credentials",
        defaultPath: "remote-studio-support.json",
        filters: [{ name: "JSON diagnostics", extensions: ["json"] }],
      });
    if (picked.canceled || !picked.filePath) return { saved: false };
    writeFileSync(picked.filePath, JSON.stringify(bundle, null, 2) + "\n", {
      mode: 0o600,
    });
    return { saved: true };
  });
  handle("getEnvironment", id, (input) => environmentVault.summary(input));
  handle(
    "setEnvironment",
    z.object({
      workspaceId: id,
      name: z.string().regex(/^[A-Z_][A-Z0-9_]{0,79}$/),
      value: z.string().max(16384).optional(),
      clientIds: z.array(id).max(100),
      remove: z.boolean().optional(),
    }),
    async (input) => {
      validateEnvironmentName(input.name);
      const snapshot: Snapshot = await call("snapshot");
      if (
        !snapshot.workspaces.some(
          (w) => w.id === input.workspaceId && w.enabled,
        )
      )
        throw new Error("Workspace is unavailable.");
      for (const id of input.clientIds)
        if (!snapshot.clients.some((c) => c.id === id && !c.revoked))
          throw new Error("Connection is unavailable.");
      const entries = await environmentVault.set(input);
      await call("environment.restore", entries);
      return environmentVault.summary(input.workspaceId);
    },
  );
  handle(
    "inspectSkill",
    z.object({ skillId: id, resource: z.string().min(1).max(4096) }),
    (input) => call("skills.inspect", input),
  );
  handle(
    "getPlan",
    z.object({ workspaceId: id, planId: id, refresh: z.boolean().optional() }),
    (input) => call("plan.get", input),
  );
  handle(
    "controlPlan",
    z.object({
      workspaceId: id,
      planId: id,
      revision: z.number().int(),
      action: z.enum(["resume", "pause", "cancel"]),
    }),
    (input) => call("plan.control", input),
  );
  handle(
    "getArtifact",
    z.object({ workspaceId: id, artifactId: id }),
    (input) => call("artifact.get", input),
  );
  handle(
    "importSkills",
    z.object({
      kind: z.enum(["directory", "zip", "github"]),
      url: z.string().optional(),
      commit: z.string().optional(),
      workspaceId: id.optional(),
      replaceSkillId: id.optional(),
    }),
    async (input) => {
      if (input.kind === "github") return call("skills.import", input);
      const picked = await dialog.showOpenDialog(main, {
        title:
          input.kind === "directory"
            ? "Import an Agent Skill folder"
            : "Import a Skills ZIP",
        properties:
          input.kind === "directory" ? ["openDirectory"] : ["openFile"],
        ...(input.kind === "zip"
          ? { filters: [{ name: "ZIP archive", extensions: ["zip"] }] }
          : {}),
      });
      if (picked.canceled) return [];
      return call("skills.import", { ...input, path: picked.filePaths[0] });
    },
  );
  handle(
    "configureSkill",
    z.object({
      skillId: id,
      enabled: z.boolean().optional(),
      authorize: z.boolean().optional(),
      uninstall: z.boolean().optional(),
    }),
    async (input) => {
      if (input.authorize || input.uninstall) {
        const state: Snapshot = await call("snapshot"),
          skill = state.skills?.find((s) => s.id === input.skillId);
        if (!skill) throw new Error("Skill not found.");
        const result = await dialog.showMessageBox(main, {
          type: "warning",
          buttons: [
            "Cancel",
            input.authorize ? "Authorize this version" : "Remove skill",
          ],
          defaultId: 0,
          cancelId: 0,
          message: input.authorize
            ? `Authorize scripts in ${skill.name}?`
            : `Remove ${skill.name}?`,
          detail: input.authorize
            ? `Only this content hash is authorized: ${skill.hash}. Scripts still run inside the selected folder's native sandbox. Review SKILL.md and script resources before continuing.`
            : "Removes the skill from the catalog. Historical copied files are preserved.",
        });
        if (result.response !== 1) return;
      }
      return call("skills.configure", input);
    },
  );
  handle("tunnelStatus", empty, () => tunnel.snapshot());
  handle("saveTunnel", tunnelSettingsSchema, (input) => tunnel.save(input));
  handle("startTunnel", empty, () => tunnel.start());
  handle("stopTunnel", empty, () => tunnel.stop());
  handle("testTunnel", empty, () => tunnel.test());
  handle("forgetTunnel", empty, async () => {
    const result = await dialog.showMessageBox(main, {
      type: "question",
      buttons: ["Keep connection", "Remove connection"],
      defaultId: 0,
      cancelId: 0,
      message: "Remove the saved ChatGPT connection?",
      detail:
        "Stops the tunnel, revokes its local folder grants, and deletes the encrypted key on this device. The tunnel and plugin in your OpenAI account remain available to manage there.",
    });
    return result.response === 1 ? tunnel.forget() : tunnel.snapshot();
  });
  handle("selectTunnelRuntime", empty, async () => {
    const result = await dialog.showOpenDialog(main, {
      title: "Choose the official tunnel-client executable",
      properties: ["openFile"],
    });
    return result.canceled
      ? tunnel.snapshot()
      : tunnel.selectRuntime(result.filePaths[0]);
  });
  handle("openChatGPT", empty, () =>
    shell.openExternal("https://chatgpt.com/plugins"),
  );
  handle("snapshot", empty, readSnapshot);
  handle("addFolders", empty, async () => {
    const result = await dialog.showOpenDialog(main, {
      title: "Authorize folders",
      properties:
        process.platform === "darwin"
          ? ["openDirectory", "multiSelections"]
          : ["openDirectory"],
    });
    return result.canceled
      ? []
      : call("workspace.add", { paths: result.filePaths });
  });
  handle("reauthorizeWorkspace", id, async (input) => {
    const snapshot: Snapshot = await call("snapshot");
    const ws = snapshot.workspaces.find((w) => w.id === input);
    if (!ws) throw new Error("Workspace not found.");
    const picked = await dialog.showOpenDialog(main, {
      title: "Re-authorize the original workspace folder",
      defaultPath: ws.path,
      properties: ["openDirectory"],
      buttonLabel: "Select original folder",
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const root: { path: string; identity: string } = await call(
      "workspace.inspectRoot",
      {
        id: ws.id,
        path: picked.filePaths[0],
      },
    );
    const confirmed = await dialog.showMessageBox(main, {
      type: "warning",
      title: "Restore workspace access?",
      message: `Re-authorize ${ws.name}?`,
      detail: `${ws.path}\n\nRestores this folder's saved permissions for its existing connections. Active jobs and sessions will stop, and pending file changes will be rejected.`,
      buttons: ["Cancel", "Restore access"],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmed.response !== 1) return null;
    return call("workspace.reauthorize", {
      id: ws.id,
      path: root.path,
      identity: root.identity,
    });
  });
  handle(
    "updateWorkspace",
    z
      .object({
        id,
        name: z.string().optional(),
        group: z.string().optional(),
        enabled: z.boolean().optional(),
        write: z.boolean().optional(),
        execute: z.boolean().optional(),
        accessMode: accessModeSchema.optional(),
      })
      .strict(),
    async (input) => {
      if (input.execute === true && input.accessMode !== "full") {
        const result = await dialog.showMessageBox(main, {
          type: "warning",
          buttons: ["Cancel", "Allow command requests"],
          defaultId: 0,
          cancelId: 0,
          title: "Trust this workspace for execution?",
          message: "Commands run within this folder’s native sandbox.",
          detail:
            "Reviewed mode requires approval in Activity for each command. Full Access authorizes continuous commands in the same native scope.",
        });
        if (result.response !== 1)
          throw new Error("Execution grant cancelled.");
      }
      return call("workspace.update", input);
    },
  );
  handle("removeWorkspace", id, async (input) => {
    const result = await dialog.showMessageBox(main, {
      type: "question",
      buttons: ["Keep access", "Remove access"],
      defaultId: 0,
      cancelId: 0,
      message: "Remove this workspace’s access?",
      detail:
        "Running and queued jobs in this workspace will be cancelled. Your files are preserved.",
    });
    if (result.response !== 1) return;
    return call("workspace.remove", input);
  });
  handle("openWorkspace", id, async (input) => {
    const snapshot: Snapshot = await call("snapshot");
    const workspace = snapshot.workspaces.find((w) => w.id === input);
    if (!workspace) throw new Error("Workspace not found.");
    const error = await shell.openPath(workspace.path);
    if (error) throw new Error(error);
  });
  handle("setSettings", settingsPatchSchema, (input) =>
    lifecycle.run("settings", async () => {
      state = await call("snapshot");
      if (
        input.backgroundService !== undefined &&
        input.backgroundService !== state.settings.backgroundService
      ) {
        if (input.backgroundService) {
          const wasLive = (await tunnel.snapshot()).live;
          await tunnel.stop();
          try {
            await background.register();
            await background.ensure(token);
            tunnel = new TunnelProxy(data, token);
            if (wasLive) await tunnel.start();
          } catch (error) {
            await background.unregister();
            await backgroundCallForShutdown();
            tunnel = makeTunnel();
            await tunnel.initialize(
              process.platform === "darwin"
                ? [
                    "/opt/homebrew/bin/tunnel-client",
                    "/usr/local/bin/tunnel-client",
                  ]
                : [],
            );
            if (wasLive) await tunnel.start();
            throw error;
          }
        } else {
          await tunnel.stop();
          await background.unregister();
          await backgroundCallForShutdown();
          tunnel = makeTunnel();
          await tunnel.initialize(
            process.platform === "darwin"
              ? [
                  "/opt/homebrew/bin/tunnel-client",
                  "/usr/local/bin/tunnel-client",
                ]
              : [],
          );
        }
      }
      if (input.launchAtLogin !== undefined)
        app.setLoginItemSettings({ openAtLogin: input.launchAtLogin });
      if (input.theme) nativeTheme.themeSource = input.theme;
      const settings = await call("settings.set", input);
      state = { ...state, settings };
      return settings;
    }),
  );
  handle(
    "setModule",
    z.object({ name: z.string(), enabled: z.boolean() }),
    (input) => call("module.set", input),
  );
  handle(
    "resolveChange",
    z.object({ id, decision: z.enum(["approve", "reject", "undo"]) }),
    (input) => call("change.resolve", input),
  );
  handle("getChange", id, (input) => call("change.get", input));
  handle("getJob", id, (input) => call("job.get", input));
  handle(
    "resolveJob",
    z.object({
      id,
      decision: z.enum(["approve", "reject", "cancel", "retry"]),
    }),
    (input) => call("job.resolve", input),
  );
  handle(
    "createConnection",
    z.object({
      name: z.string(),
      workspaceIds: z.array(id).nullable(),
      write: z.boolean(),
      execute: z.boolean().optional(),
      accessMode: accessModeSchema.optional(),
      workspaceGrants: z.array(workspaceGrantSchema).optional(),
    }),
    async (input) => {
      const result = await call("connection.create", input);
      return configuration(entry(result.clientId), result.clientId);
    },
  );
  handle(
    "updateConnection",
    z
      .object({
        id,
        workspaceIds: z.array(id),
        write: z.boolean(),
        execute: z.boolean(),
        accessMode: accessModeSchema,
        workspaceGrants: z.array(workspaceGrantSchema),
      })
      .strict(),
    (input) => call("connection.update", input),
  );
  handle("testConnection", id, testBridge);
  handle("revokeConnection", id, async (input) => {
    if ((await tunnel.snapshot()).clientId === input) await tunnel.stop();
    return call("connection.revoke", input);
  });
  handle(
    "installConnection",
    z.object({ id, client: z.enum(["claude", "cursor"]) }),
    async (input) => {
      await call("connection.secret", input.id);
      return installConfig(clientPath(input.client), entry(input.id));
    },
  );
  handle("runCommand", commandSchema, (input) =>
    call("command.request", input),
  );
  handle("readFile", z.object({ workspaceId: id, path: z.string() }), (input) =>
    call("file.read", input),
  );
  handle("proposeFile", proposeSchema, (input) => call("file.propose", input));
  handle("openExternal", z.string().url(), async (url) => {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      ![
        "modelcontextprotocol.io",
        "ts.sdk.modelcontextprotocol.io",
        "cursor.com",
        "code.claude.com",
        "developers.openai.com",
        "help.openai.com",
        "support.claude.com",
      ].includes(parsed.hostname)
    )
      throw new Error("External destination is not allowed.");
    await shell.openExternal(url);
  });
}
function openWindow() {
  if (main && !main.isDestroyed()) {
    main.show();
    main.focus();
    return;
  }
  let bounds: { width: number; height: number; x?: number; y?: number } = {
    width: 1160,
    height: 800,
  };
  try {
    bounds = {
      ...bounds,
      ...JSON.parse(readFileSync(join(data, "window.json"), "utf8")),
    };
  } catch {
    /* Default bounds. */
  }
  main = new BrowserWindow({
    ...bounds,
    minWidth: 940,
    minHeight: 640,
    title: "Remote Studio",
    backgroundColor: "#fafafa",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: join(uiRoot, "preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  main.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  main.webContents.on("will-navigate", (event) => event.preventDefault());
  main.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  main.once("ready-to-show", () => {
    if (!state.settings.startMinimized) main.show();
  });
  main.on("close", (event) => {
    writeFileSync(join(data, "window.json"), JSON.stringify(main.getBounds()));
    if (!quitting && state.settings.closeToTray) {
      event.preventDefault();
      main.hide();
    }
  });
  main.webContents.on("before-input-event", (event, input) => {
    if ((input.meta || input.control) && input.key.toLowerCase() === "k") {
      event.preventDefault();
      main.webContents.send("studio:palette");
    }
    if ((input.meta || input.control) && input.key === ",") {
      event.preventDefault();
      main.webContents.send("studio:settings");
    }
  });
  void windowRecovery(
    main,
    data,
    process.env.ELECTRON_RENDERER_URL ?? "studio://app/index.html",
    quit,
  )();
}
async function quit() {
  let snapshot: Snapshot;
  try {
    snapshot = await call("snapshot");
  } catch {
    // Never signal a cached PID after losing authenticated agent ownership.
    quitting = true;
    events?.destroy();
    if (!state?.settings.backgroundService)
      await tunnel?.stop().catch(() => {});
    app.quit();
    return;
  }
  const active = snapshot.jobs.filter((j) =>
    ["running", "queued"].includes(j.status),
  );
  if (active.length && !snapshot.settings.backgroundService) {
    const result = await dialog.showMessageBox(main, {
      buttons: ["Keep running", "Cancel jobs and quit"],
      defaultId: 0,
      cancelId: 0,
      message: "There are active jobs.",
      detail:
        "Quitting this preview stops its agent and cancels running jobs. Close the window to keep jobs running in the menu bar.",
    });
    if (result.response !== 1) return;
    for (const job of active)
      await call("job.resolve", { id: job.id, decision: "cancel" });
  }
  quitting = true;
  if (!snapshot.settings.backgroundService) await tunnel?.stop();
  events?.destroy();
  try {
    if (!snapshot.settings.backgroundService)
      process.kill(snapshot.agent.pid, "SIGTERM");
  } catch {
    /* Agent already stopped. */
  }
  app.quit();
}
if (process.argv.includes("--studio-background")) {
  app.setPath("userData", join(data, "background-instance"));
  if (!app.requestSingleInstanceLock()) app.quit();
  else
    app
      .whenReady()
      .then(async () => {
        await ensureAgent();
        await initializeLicensing();
        state = await call("snapshot");
        {
          const entries = await environmentVault.load();
          if (!environmentVault.locked)
            await call("environment.restore", entries);
        }
        await serveBackground(data, token, makeTunnel());
      })
      .catch((error) => {
        writeFileSync(join(data, "background-error.log"), String(error), {
          mode: 0o600,
        });
        app.quit();
      });
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("open-url", (event, url) => {
    if (url.startsWith("com.t2etech.remotestudio:")) {
      event.preventDefault();
      receiveLicenseCallback(url);
    }
  });
  app.on("second-instance", (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith("com.t2etech.remotestudio:"));
    if (url) receiveLicenseCallback(url);
  });
  const initialCallback = process.argv.find((arg) =>
    arg.startsWith("com.t2etech.remotestudio:"),
  );
  if (initialCallback) receiveLicenseCallback(initialCallback);
  if (
    app.isPackaged &&
    !app.setAsDefaultProtocolClient("com.t2etech.remotestudio")
  )
    recordDesktopEvent(data, "license-protocol-registration-failed");
  app.on("second-instance", () => openWindow());
  app
    .whenReady()
    .then(async () => {
      mkdirSync(data, { recursive: true });
      await ensureAgent();
      await initializeLicensing();
      finishLicenseReady();
      {
        const entries = await environmentVault.load();
        if (!environmentVault.locked)
          await call("environment.restore", entries);
      }
      state = await call("snapshot");
      if (state.settings.backgroundService) {
        await background.ensure(token);
        tunnel = new TunnelProxy(data, token);
      } else {
        tunnel = makeTunnel();
        await tunnel.initialize(
          process.platform === "darwin"
            ? [
                "/opt/homebrew/bin/tunnel-client",
                "/usr/local/bin/tunnel-client",
              ]
            : [],
        );
      }
      nativeTheme.themeSource = state.settings.theme;
      const rendererRoot = join(uiRoot, "renderer");
      protocol.handle("studio", (request) => {
        const url = new URL(request.url);
        const file = resolve(
          rendererRoot,
          decodeURIComponent(url.pathname).slice(1) || "index.html",
        );
        const rel = relative(rendererRoot, file);
        if (
          url.hostname !== "app" ||
          rel === ".." ||
          rel.startsWith(".." + sep)
        )
          return new Response("Forbidden", { status: 403 });
        return net.fetch(pathToFileURL(file).href);
      });
      register();
      openWindow();
      void tunnel.autoStart();
      const trayImage = nativeImage.createFromDataURL(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAABhElEQVR4nM3WvU4UYRQG4GfZhRgDBZGEHjFB4zWQoPwkFlwDCcZGCddAaOzsMIEO1AuwMZBgI1wHawHxAiwIBVrMGfj4dmZhdzHxTSbzd857ft7zzTcNd0cDzbi+jONekBKnaMW7gZASj+I9vmAqs+k5UBNDcd3CCk7xB+eK9mzgUU0ytcjbsYh2EB/iCcaxlQR7l/jUtbMD8zgKkmO8qLCZwW7Y/MRqlmhH5g08xnY4neB1YjMUR57lyySZfcwmfFdoxfltGH7DcEI8UlFBK3u+Eb5f4/5Gq8qI09gZoIKDugpyLOldgzdZwpVoKqakxCs3p2ha5xStu27nAzysClKWvIzfWEuchhUTchakF4p1sInJrOpf+JBxXkVr4Bk+qx69sSDdUayHEvlIL7qDBrnTQoXNc3wKm7Zb1kGJbhp8Vwg7gY/+Vw2eYk//Ghwp2nmrBnP4oTcNVrKEK9Hta1qnQV9f0277QalBX/tBVaASo0G67R52tBQD7cm9RP5nfxUD4S9tPXHp1SQLWQAAAABJRU5ErkJggg==",
      );
      trayImage.setTemplateImage(process.platform === "darwin");
      tray = new Tray(trayImage);
      tray.setTitle(process.platform === "darwin" ? "◈" : "");
      tray.setToolTip("Remote Studio · Local agent running");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Open Remote Studio", click: openWindow },
          { label: "Local agent running", enabled: false },
          {
            label: "Open Activity",
            click: () => {
              openWindow();
              main.webContents.send("studio:activity");
            },
          },
          { type: "separator" },
          {
            label: "Stop all work",
            click: () =>
              void call("jobs.stopAll").catch((error) =>
                dialog.showErrorBox("Could not stop all work", String(error)),
              ),
          },
          {
            label: "Settings",
            click: () => {
              openWindow();
              main.webContents.send("studio:settings");
            },
          },
          { label: "Quit Remote Studio", click: () => void quit() },
        ]),
      );
      tray.on("click", openWindow);
      watchAgent();
    })
    .catch((error) => {
      dialog.showErrorBox("Remote Studio could not start", String(error));
      quitting = true;
      app.quit();
    });
  app.on("activate", () => openWindow());
  app.on("window-all-closed", () => {
    if (!state?.settings.closeToTray) void quit();
  });
  app.on("before-quit", (event) => {
    if (!quitting) {
      event.preventDefault();
      void quit();
    }
  });
}
