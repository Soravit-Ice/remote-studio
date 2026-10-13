import { z } from "zod";

const uuid = z.string().uuid();
export const taskStatus = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "blocked",
  "verifying",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export const criterionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file_exists"),
    path: z.string().min(1),
    hash: z.string().optional(),
  }),
  z.object({
    kind: z.literal("file_contains"),
    path: z.string().min(1),
    text: z.string().min(1).max(8192),
  }),
  z.object({
    kind: z.literal("script"),
    path: z.string().default("."),
    script: z.string().min(1).max(100),
  }),
  z.object({
    kind: z.literal("screenshot"),
    path: z.string().default("."),
    artifactId: uuid.optional(),
  }),
  z.object({
    kind: z.literal("browser_check"),
    path: z.string().default("."),
    sessionId: uuid,
  }),
]);
export type Criterion = z.infer<typeof criterionSchema>;
export const taskDefinition = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  title: z.string().min(1).max(240),
  description: z.string().max(12000).default(""),
  dependsOn: z.array(z.string()).max(100).default([]),
  criteria: z.array(criterionSchema).min(1).max(20),
});
export interface Plan {
  id: string;
  workspaceId: string;
  clientId: string;
  title: string;
  mode: "quick" | "auto" | "full";
  status: "active" | "paused" | "completed" | "cancelled";
  revision: number;
  createdAt: string;
  updatedAt: string;
  designBrief: string;
}
export interface Task extends z.infer<typeof taskDefinition> {
  id: string;
  planId: string;
  workspaceId: string;
  clientId: string;
  status: z.infer<typeof taskStatus>;
  error: string | null;
  assessment: string;
}
export interface TaskAttempt {
  id: string;
  planId: string;
  taskId: string;
  workspaceId: string;
  clientId: string;
  tool: string;
  status: "running" | "completed" | "failed" | "interrupted";
  startedAt: string;
  finishedAt: string | null;
  jobIds: string[];
  changeIds: string[];
  artifactIds: string[];
  error: string | null;
}
export interface Verification {
  id: string;
  planId: string;
  taskId: string;
  workspaceId: string;
  clientId: string;
  criterion: Criterion;
  status: "running" | "passed" | "failed" | "stale";
  at: string;
  sourceRevision: string | null;
  fileHash: string | null;
  jobId: string | null;
  artifactId: string | null;
  detail: string;
}
export interface CaptureMetadata {
  kind: "browser" | "desktop";
  sessionId: string;
  capturedAt: string;
  viewport?: { width: number; height: number };
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
  selector?: string;
  window?: number;
  sourceUrl?: string;
}
export interface Artifact {
  id: string;
  workspaceId: string;
  clientId: string;
  planId?: string;
  taskId?: string;
  mimeType: "image/png" | "application/json";
  name: string;
  bytes: number;
  hash: string;
  createdAt: string;
  width?: number;
  height?: number;
  sourceRevision: string;
  sourcePath: string;
  role: "screenshot" | "diff" | "report";
  capture?: CaptureMetadata;
}
export interface PlanEvent {
  id: string;
  planId: string;
  workspaceId: string;
  clientId: string;
  at: string;
  action: string;
  detail: string;
}
export interface PlanDetail {
  plan: Plan;
  tasks: Task[];
  attempts: TaskAttempt[];
  verifications: Verification[];
  artifacts: Artifact[];
  events: PlanEvent[];
  nextTasks: string[];
  progress: { completed: number; total: number };
}
export const planCreateSchema = z.object({
  workspaceId: uuid,
  title: z.string().min(1).max(240),
  mode: z.enum(["quick", "auto", "full"]).default("auto"),
  designBrief: z.string().max(12000).default(""),
  tasks: z.array(taskDefinition).min(1).max(100),
});
export const planScopeSchema = z.object({ workspaceId: uuid, planId: uuid });
export const locatorSchema = z.object({
  by: z.enum(["role", "text", "testId", "css"]),
  value: z.string().min(1).max(1000),
  name: z.string().max(1000).optional(),
  exact: z.boolean().default(true),
});
export const browserActionSchema = z.object({
  workspaceId: uuid,
  sessionId: uuid,
  action: z.enum([
    "click",
    "fill",
    "press",
    "reload",
    "navigate",
    "viewport",
    "hover",
    "scroll",
    "wait",
  ]),
  selector: z.string().max(1000).optional(),
  locator: locatorSchema.optional(),
  value: z.string().max(8192).optional(),
  width: z.number().int().min(320).max(1920).optional(),
  height: z.number().int().min(320).max(1440).optional(),
});
