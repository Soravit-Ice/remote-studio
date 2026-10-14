import { z } from "zod";
import { id } from "../../../packages/contracts/src/index";
import {
  videoScope,
  videoCreate,
  videoRender,
  videoSnapshot,
  videoOutputRead,
} from "../../../packages/video/src/contracts";
const record = z.record(z.string(), z.unknown());
const tool = (
  name: string,
  permission: "read" | "write" | "execute",
  description: string,
  input: z.ZodType,
) => ({
  name,
  module: "Video",
  permission,
  description,
  input,
  output: record,
});
export const videoCatalog = [
  tool(
    "video_guide",
    "read",
    "Read the complete brief → HTML/GSAP → check → frames → video workflow and composition contract. Start here for motion graphics. Remote Studio executes; the assistant authors. No runtime is installed by this read.",
    z.object({}),
  ),
  tool(
    "video_project_create",
    "write",
    "Create a pinned HyperFrames/GSAP starter and save the actual brief in a new folder or empty workspace root. Full Access applies a checkpoint; Reviewed awaits approval. Author scenes with file tools, then project_install on demand.",
    videoCreate,
  ),
  tool(
    "video_inspect",
    "read",
    "Read static composition dimensions, duration, fps and current source/asset revision. Reports unsupported roots or runtime versions explicitly.",
    videoScope,
  ),
  tool(
    "video_validate",
    "execute",
    "Start an owned HyperFrames lint (fast), timeline (actual tracks), or check (full browser/runtime/layout/motion/contrast) job. Wait with job_wait, then video_status for JSON findings. A successful current check gates video_render.",
    videoScope.extend({
      mode: z.enum(["lint", "check", "timeline"]).default("check"),
    }),
  ),
  tool(
    "video_snapshot",
    "execute",
    "Capture 1–8 exact timestamps as PNG frames in an owned job. After job_wait, video_status returns immutable image artifacts visible to ChatGPT. Times must be unique and before duration.",
    videoSnapshot,
  ),
  tool(
    "video_preview",
    "execute",
    "Start or reuse an owned loopback HyperFrames Studio preview. video_status reports actual HTTP readiness. URL opens on the user's computer; it is not a public browser URL. Stop with job_cancel.",
    videoScope,
  ),
  tool(
    "video_render",
    "execute",
    "Render a unique MP4, WebM or MOV after a successful check of the current source. Uses pinned project runtime, auto workers by default, native sandbox, durable logs/cancellation and FFprobe verification. Wait and read video_status; job creation is not render completion.",
    videoRender,
  ),
  tool(
    "video_status",
    "read",
    "Inspect an owned video job, actual findings, source freshness, PNG artifacts and encoded file metadata/integrity. verified=true requires actual successful execution. Returns real local output paths without inventing public download links.",
    z.object({ workspaceId: id, jobId: id }),
  ),
  tool(
    "video_output_read",
    "read",
    "Transfer a completed owned video's bytes in bounded base64 chunks (max 512 KiB) for a capable client. Continue at nextOffset, compare assembled SHA-256 with expectedHash. Avoid transferring video through chat text; no public hosting is implied.",
    videoOutputRead,
  ),
];
