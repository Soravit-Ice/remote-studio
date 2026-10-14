import {
  gsapVersion,
  hyperframesVersion,
  type VideoSettings,
} from "./contracts";

export const videoGuide = `Remote Studio executes locally; the assistant authors the story and HTML/GSAP motion.
1. video_project_create saves a brief and a renderable starter. Choose 1920x1080 landscape, 1080x1920 portrait, or 1080x1080 square; 30 fps is a useful default.
2. project_install installs the project's pinned HyperFrames/GSAP runtime on demand. Wait with job_wait; Reviewed changes/jobs need local Activity approval. Never assume queued means completed.
3. Read BRIEF.md and index.html. Write the real scenes with file_batch/file_patch_many and conflict hashes. Keep assets and fonts local, use one sub-composition per scene when useful, and label tracks. Use project_run_script script=catalog with English query args before inventing a named effect.
4. video_validate mode=lint gives fast feedback; mode=timeline gives the actual timeline. mode=check audits runtime/layout/motion/contrast. Wait using job_wait, then video_status to get the JSON findings. Fix failures before rendering.
5. video_snapshot times=[...] captures exact seconds. Wait, then video_status returns immutable PNG artifact IDs and image content in ChatGPT. Inspect every scene midpoint and transitions; use artifact_read to revisit a frame.
6. video_preview starts an owned loopback Studio server. video_status checks HTTP readiness. Its URL opens on the user's computer; it is not a public ChatGPT browser URL. Stop via job_cancel. A disconnect does not replay or stop owned jobs.
7. After the user's requested review (or direct instruction to produce a video), video_render starts a checked render. A current successful check is required. Use draft during iteration, looks for normal output, delivery for final quality; workers is optional, auto by default. Edit the source rather than encoding repeatedly.
8. Wait and call video_status. Only report success when job.status=completed and report.ok=true and verified=true. Metadata comes from the actual encoded file (SHA-256, bytes, duration, dimensions, fps, codec). Outputs get unique paths and never overwrite previous renders.
9. Return the real local output path. video_output_read transfers bounded base64 chunks to capable clients (offset/nextOffset); never paste base64 in chat or pretend a local path is a public download URL. Web-hosted video delivery requires a separately authorized storage/publishing integration.

Composition contract: a standalone root div with static quoted data-composition-id, data-width, data-height, data-duration and data-fps; do not wrap the standalone root in template. Timed clips use data-start/data-duration and class=clip. Register a paused GSAP timeline in window.__timelines[the exact root ID]. HyperFrames owns media seeking and clip visibility. Animate inner wrappers with transforms/opacity; avoid unseeded randomness, Date.now(), timers, tl.play(), infinite repeats and CSS animation clocks. Root duration determines output length. Keep scripts/assets local for reproducible offline renders. MP4 is opaque; WebM/MOV can carry alpha when the HTML background is unpainted. No model, stock-media provider, voice generator or account is bundled. Browser/runtime downloads happen only on requested jobs. macOS evidence does not certify Windows.`;

export function videoTemplate(
  name: string,
  brief: string,
  settings: VideoSettings,
) {
  const escaped = name.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
  const fontSize = Math.round(Math.min(settings.width, settings.height) * 0.08);
  return {
    "package.json":
      JSON.stringify(
        {
          name: "remote-studio-motion",
          version: "1.0.0",
          private: true,
          type: "module",
          scripts: {
            lint: "hyperframes lint --json",
            check: "hyperframes check --json",
            timeline: "hyperframes timeline --json",
            catalog: "hyperframes catalog --json",
            preview: "hyperframes preview --foreground --no-open",
            render: "hyperframes render",
            doctor: "hyperframes doctor --json",
          },
          dependencies: { hyperframes: hyperframesVersion, gsap: gsapVersion },
        },
        null,
        2,
      ) + "\n",
    "BRIEF.md": `# ${name}\n\n${brief}\n\n## Output\n${settings.width} × ${settings.height}, ${settings.duration}s, ${settings.fps} fps.\n\nThe starter is a technical starting point. Author the story and scenes from this brief before delivery.\n`,
    "MOTION-GUIDE.md": videoGuide + "\n",
    ".gitignore": "node_modules/\nrenders/\n.hyperframes/\n.DS_Store\n",
    "index.html": `<!doctype html>
<html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=${settings.width}, height=${settings.height}">
<title>${escaped}</title><script src="node_modules/gsap/dist/gsap.min.js"></script>
<style>
html,body{margin:0;width:100%;height:100%;background:#0b0f14;color:#f4f7fb;font-family:system-ui,sans-serif}
#root{position:relative;width:${settings.width}px;height:${settings.height}px;overflow:hidden}
.clip{position:absolute;inset:0;display:grid;place-items:center}
#title{margin:0;max-width:80%;font-size:${fontSize}px;line-height:1.2;text-align:center}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-width="${settings.width}" data-height="${settings.height}" data-duration="${settings.duration}" data-fps="${settings.fps}">
<section id="title-card" class="clip" data-start="0" data-duration="${settings.duration}" data-track-index="0"><h1 id="title">${escaped}</h1></section>
</div><script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({paused:true});
tl.fromTo('#title',{y:36,opacity:0},{y:0,opacity:1,duration:0.7,ease:'power3.out'},0.15);
window.__timelines['main'] = tl;
</script></body></html>\n`,
  };
}
