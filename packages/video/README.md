# Video module

Implemented HyperFrames execution adapter. The assistant writes the story and motion; Remote Studio provides checkpointed scaffolding, source/asset revision guards, native job execution, browser checks, PNG evidence, managed Studio previews and FFprobe-verified MP4/WebM/MOV output.

The optional CLI/GSAP runtime is pinned in each generated project and installed only on request through `project_install`. Browser installation happens on requested check/snapshot/render jobs and stays in the workspace sandbox cache. The worker uses the existing narrow browser sandbox capabilities; there is no unrestricted execution fallback.

`video_status` returns encoded-file metadata and actual paths. Completed output can be read with bounded `video_output_read` chunks; previews and local paths are not public download URLs. See [the Thai workflow guide](../../docs/MOTION-GRAPHICS-TH.md) for setup, delivery limits and real runtime tests.
