import { z } from "zod";
export * from "./development";
export const id = z.string().uuid();
export const relativePath = z.string().max(4096).default(".");
export const accessModeSchema = z.enum(["readOnly", "reviewed", "full"]);
export type AccessMode = z.infer<typeof accessModeSchema>;
export const workspaceGrantSchema = z.object({
  workspaceId: id,
  write: z.boolean(),
  execute: z.boolean(),
  accessMode: accessModeSchema,
});
export const workspaceSchema = z.object({
  id,
  name: z.string().min(1).max(80),
  path: z.string(),
  rootIdentity: z.string().optional(),
  rootError: z.string().optional(),
  group: z.string().max(80).default(""),
  enabled: z.boolean(),
  write: z.boolean(),
  execute: z.boolean(),
  accessMode: accessModeSchema.optional(),
  permissionReason: z.string().optional(),
  createdAt: z.string(),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).default("system"),
  closeToTray: z.boolean().default(true),
  startMinimized: z.boolean().default(false),
  launchAtLogin: z.boolean().default(false),
  backgroundService: z.boolean().default(false),
  artifactRetentionDays: z.number().int().min(0).max(3650).default(0),
  notifications: z.boolean().default(true),
  onboarded: z.boolean().default(false),
  concurrency: z.number().int().min(1).max(4).default(2),
  language: z.enum(["en", "th"]).default("en"),
});
export type Settings = z.infer<typeof settingsSchema>;
export interface LicenseStatus {
  configured: boolean;
  signedIn: boolean;
  activated: boolean;
  valid: boolean;
  tier: string;
  features: string[];
  reason?: string;
}
// Zod 4 applies defaults inside optional fields. Updates must not carry defaults.
export const settingsPatchSchema = z
  .object({
    theme: settingsSchema.shape.theme.unwrap().optional(),
    closeToTray: settingsSchema.shape.closeToTray.unwrap().optional(),
    startMinimized: settingsSchema.shape.startMinimized.unwrap().optional(),
    launchAtLogin: settingsSchema.shape.launchAtLogin.unwrap().optional(),
    backgroundService: settingsSchema.shape.backgroundService
      .unwrap()
      .optional(),
    artifactRetentionDays: settingsSchema.shape.artifactRetentionDays
      .unwrap()
      .optional(),
    notifications: settingsSchema.shape.notifications.unwrap().optional(),
    onboarded: settingsSchema.shape.onboarded.unwrap().optional(),
    concurrency: settingsSchema.shape.concurrency.unwrap().optional(),
    language: settingsSchema.shape.language.unwrap().optional(),
  })
  .strict();
export const commandSchema = z.object({
  workspaceId: id,
  executable: z.string().min(1).max(4096),
  args: z.array(z.string().max(8192)).max(100).default([]),
  cwd: relativePath,
  timeoutMs: z.number().int().min(100).max(3600000).default(120000),
  idempotencyKey: z.string().max(100).optional(),
  persistent: z.boolean().optional(),
  planId: id.optional(),
  taskId: id.optional(),
});
export type Command = z.infer<typeof commandSchema>;
export type JobStatus =
  | "awaiting_approval"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface Job {
  id: string;
  workspaceId: string;
  clientId: string;
  label: string;
  command: Command;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logs: string;
  error: string | null;
  pid: number | null;
  logOffset?: number;
  sandboxed?: boolean;
  authorization?: "reviewed" | "full";
  planId?: string;
  taskId?: string;
  attemptId?: string;
  dependsOn?: string[];
  originModule?: string;
}
export interface Change {
  id: string;
  workspaceId: string;
  path: string;
  before: string | null;
  after: string;
  expectedHash: string | null;
  status: "pending" | "applied" | "rejected" | "undone";
  createdAt: string;
  clientId: string;
  operation?: "write" | "delete" | "mkdir" | "move" | "copy" | "batch";
  destination?: string;
  encoding?: "utf8" | "base64";
}
export interface Audit {
  id: string;
  at: string;
  action: string;
  workspaceId: string | null;
  clientId: string;
  detail: string;
  success: boolean;
}
export interface ClientGrant {
  id: string;
  name: string;
  workspaceIds: string[] | null;
  write: boolean;
  execute?: boolean;
  accessMode?: AccessMode;
  workspaceGrants?: z.infer<typeof workspaceGrantSchema>[];
  lastSeen: string | null;
  lastDiagnosticAt?: string;
  lastTool?: { name: string; at: string; clientName: string; serverId: string };
  revoked: boolean;
}
export interface ToolInfo {
  name: string;
  description: string;
  module: string;
  permission: "read" | "write" | "execute";
  enabled: boolean;
}
export interface Snapshot {
  version: string;
  license?: LicenseStatus;
  agent: {
    status: "running";
    pid: number;
    startedAt: string;
    memoryBytes: number;
    serverId?: string;
    runtimeDirectory?: string;
    buildFingerprint?: string;
  };
  workspaces: Workspace[];
  settings: Settings;
  jobs: Job[];
  changes: Change[];
  audit: Audit[];
  tools: ToolInfo[];
  modules: Record<string, boolean>;
  clients: ClientGrant[];
  sandbox?: { available: boolean; backend: string; reason: string };
  plans?: import("./development").Plan[];
  artifacts?: import("./development").Artifact[];
  skills?: import("../../skills/src/index").Skill[];
}
export interface ConnectionConfig {
  clientId: string;
  json: string;
  toml: string;
  verifiedAt?: string;
  toolCount?: number;
}
export const tunnelSettingsSchema = z
  .object({
    tunnelId: z
      .string()
      .trim()
      .regex(
        /^tunnel_[a-z0-9]{32}$/,
        "Tunnel ID must be tunnel_ followed by 32 lowercase letters or digits.",
      ),
    apiKey: z
      .string()
      .trim()
      .min(12)
      .max(2048)
      .regex(/^\S+$/, "API key cannot contain whitespace.")
      .optional(),
    workspaceIds: z
      .array(id)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Duplicate folder grants.",
      ),
    write: z.boolean(),
    execute: z.boolean().optional(),
    accessMode: accessModeSchema.optional(),
    workspaceGrants: z.array(workspaceGrantSchema).max(100).optional(),
    autoStart: z.boolean(),
  })
  .strict();
export type TunnelSettings = z.infer<typeof tunnelSettingsSchema>;
export interface TunnelStatus {
  configured: boolean;
  tunnelId: string;
  hasKey: boolean;
  secureStorage: boolean;
  workspaceIds: string[];
  write: boolean;
  execute?: boolean;
  accessMode?: AccessMode;
  workspaceGrants?: z.infer<typeof workspaceGrantSchema>[];
  autoStart: boolean;
  clientId: string | null;
  runtime: { path: string; version: string } | null;
  phase:
    "unconfigured" | "stopped" | "starting" | "running" | "ready" | "error";
  bridge: { verifiedAt: string; toolCount: number } | null;
  live: boolean;
  ready: boolean;
  lastPollAt: string | null;
  checkedAt: string | null;
  error: string | null;
  logs: string;
}
export interface StudioAPI {
  licenseStatus(): Promise<LicenseStatus>;
  licenseLogin(): Promise<void>;
  licenseActivate(key?: string): Promise<LicenseStatus>;
  licenseLogout(): Promise<LicenseStatus>;
  licenseDeactivate(): Promise<LicenseStatus>;
  licenseOpenStore(): Promise<void>;
  getEnvironment(
    workspaceId: string,
  ): Promise<{ name: string; hasValue: boolean; clientIds: string[] }[]>;
  setEnvironment(input: {
    workspaceId: string;
    name: string;
    value?: string;
    clientIds: string[];
    remove?: boolean;
  }): Promise<unknown>;
  getPlan(input: {
    workspaceId: string;
    planId: string;
    refresh?: boolean;
  }): Promise<import("./development").PlanDetail>;
  controlPlan(input: {
    workspaceId: string;
    planId: string;
    revision: number;
    action: "resume" | "pause" | "cancel";
  }): Promise<import("./development").PlanDetail>;
  getArtifact(input: { workspaceId: string; artifactId: string }): Promise<{
    artifact: import("./development").Artifact;
    image?: { mimeType: string; data: string };
    content?: string;
  }>;
  importSkills(input: {
    kind: "directory" | "zip" | "github";
    url?: string;
    commit?: string;
    workspaceId?: string;
    replaceSkillId?: string;
  }): Promise<import("../../skills/src/index").Skill[]>;
  configureSkill(input: {
    skillId: string;
    enabled?: boolean;
    authorize?: boolean;
    uninstall?: boolean;
  }): Promise<unknown>;
  inspectSkill(input: {
    skillId: string;
    resource: string;
  }): Promise<{ content: string; encoding: string; hash: string }>;
  tunnelStatus(): Promise<TunnelStatus>;
  saveTunnel(settings: TunnelSettings): Promise<TunnelStatus>;
  startTunnel(): Promise<TunnelStatus>;
  stopTunnel(): Promise<TunnelStatus>;
  testTunnel(): Promise<TunnelStatus>;
  forgetTunnel(): Promise<TunnelStatus>;
  selectTunnelRuntime(): Promise<TunnelStatus>;
  openChatGPT(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  stopAll(): Promise<{ jobs: number }>;
  listJobs(input: { limit: number; offset: number }): Promise<Job[]>;
  exportSupportBundle(): Promise<{ saved: boolean }>;
  cleanArtifacts(): Promise<{ removed: number; bytes: number }>;
  addFolders(): Promise<Workspace[]>;
  reauthorizeWorkspace(id: string): Promise<Workspace | null>;
  updateWorkspace(input: {
    id: string;
    name?: string;
    group?: string;
    enabled?: boolean;
    write?: boolean;
    execute?: boolean;
    accessMode?: AccessMode;
  }): Promise<void>;
  removeWorkspace(id: string): Promise<void>;
  openWorkspace(id: string): Promise<void>;
  setSettings(settings: Partial<Settings>): Promise<void>;
  setModule(input: { name: string; enabled: boolean }): Promise<void>;
  resolveChange(input: {
    id: string;
    decision: "approve" | "reject" | "undo";
  }): Promise<void>;
  getChange(id: string): Promise<Change>;
  getJob(id: string): Promise<Job>;
  resolveJob(input: {
    id: string;
    decision: "approve" | "reject" | "cancel" | "retry";
  }): Promise<void>;
  createConnection(input: {
    name: string;
    workspaceIds: string[] | null;
    write: boolean;
    execute?: boolean;
    accessMode?: AccessMode;
    workspaceGrants?: z.infer<typeof workspaceGrantSchema>[];
  }): Promise<ConnectionConfig>;
  updateConnection(input: {
    id: string;
    workspaceIds: string[];
    write: boolean;
    execute: boolean;
    accessMode: AccessMode;
    workspaceGrants: z.infer<typeof workspaceGrantSchema>[];
  }): Promise<void>;
  testConnection(id: string): Promise<{
    toolCount: number;
    serverId?: string;
    catalogFingerprint?: string;
  }>;
  revokeConnection(id: string): Promise<void>;
  installConnection(input: {
    id: string;
    client: "claude" | "cursor";
  }): Promise<{ path: string; backup: string | null }>;
  runCommand(command: Command): Promise<Job>;
  readFile(input: {
    workspaceId: string;
    path: string;
  }): Promise<{ content: string; hash: string }>;
  proposeFile(input: {
    workspaceId: string;
    path: string;
    content: string;
    expectedHash: string | null;
  }): Promise<Change>;
  openExternal(url: string): Promise<void>;
  onChange(callback: () => void): () => void;
}
