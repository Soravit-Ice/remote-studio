import { z } from "zod";
import { id, relativePath } from "../../contracts/src/index";

export const hyperframesVersion = "0.8.153";
export const gsapVersion = "3.14.2";
export const videoScope = z.object({ workspaceId: id, path: relativePath });
export const videoSettings = z.object({
  width: z.number().int().min(128).max(3840).default(1920),
  height: z.number().int().min(128).max(3840).default(1080),
  duration: z.number().min(1).max(600).default(6),
  fps: z
    .union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)])
    .default(30),
});
export const videoCreate = videoScope.extend({
  name: z.string().min(1).max(100),
  brief: z.string().min(1).max(20000),
  ...videoSettings.shape,
});
export const videoRender = videoScope.extend({
  quality: z.enum(["draft", "looks", "delivery"]).default("looks"),
  format: z.enum(["mp4", "webm", "mov"]).default("mp4"),
  workers: z.number().int().min(1).max(8).optional(),
});
export const videoSnapshot = videoScope.extend({
  times: z.array(z.number().min(0).max(600)).min(1).max(8),
});
export const videoOutputRead = z.object({
  workspaceId: id,
  jobId: id,
  offset: z
    .number()
    .int()
    .min(0)
    .max(1024 ** 3)
    .default(0),
  length: z
    .number()
    .int()
    .min(1)
    .max(512 * 1024)
    .default(512 * 1024),
});
export type VideoSettings = z.infer<typeof videoSettings>;
export type VideoOperation =
  "lint" | "check" | "timeline" | "snapshot" | "render" | "preview";
export interface VideoRun {
  jobId: string;
  workspaceId: string;
  clientId: string;
  path: string;
  operation: VideoOperation;
  revision: string;
  directory: string;
  output?: string;
  url?: string;
  artifacts?: string[];
  verifiedOutput?: { identity: string; hash: string };
}
export interface VideoReport {
  ok: boolean;
  operation: VideoOperation;
  result?: Record<string, unknown>;
  output?: {
    path: string;
    bytes: number;
    hash: string;
    width: number;
    height: number;
    duration: number;
    fps: number;
    codec: string;
    mimeType: "video/mp4" | "video/webm" | "video/quicktime";
  };
  frames?: string[];
  error?: string;
}
export const videoReportSchema = z.object({
  ok: z.boolean(),
  operation: z.enum([
    "lint",
    "check",
    "timeline",
    "snapshot",
    "render",
    "preview",
  ]),
  result: z.record(z.string(), z.unknown()).optional(),
  output: z
    .object({
      path: z.string().min(1).max(4096),
      bytes: z
        .number()
        .int()
        .positive()
        .max(1024 ** 3),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      duration: z.number().positive(),
      fps: z.number().positive(),
      codec: z.string().max(100),
      mimeType: z.enum(["video/mp4", "video/webm", "video/quicktime"]),
    })
    .optional(),
  frames: z.array(z.string().min(1).max(4096)).max(8).optional(),
  error: z.string().max(20000).optional(),
});
