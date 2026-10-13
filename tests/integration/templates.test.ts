import { it, expect } from "vitest";
import {
  readFile,
  stat,
  mkdir,
  writeFile,
  cp,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fixture, ui, waitFor } from "../helpers";
it("builds and sees actual Astro/Next/full-stack/Electron templates under native workspace isolation", async () => {
  const f = await fixture(),
    ws = f.folders[0];
  const call = (name: string, args: any = {}) =>
    f.engine.request(
      "tool.call",
      { name, arguments: { workspaceId: ws.id, ...args } },
      ui,
    );
  const finish = async (job: any, timeout = 180000) => {
    const result = await waitFor(
      () => f.engine.store.job(job.id),
      (j) => !!j && !["queued", "running"].includes(j.status),
      timeout,
    );
    if (result?.status !== "completed")
      throw new Error(`${job.label}\n${result?.error}\n${result?.logs}`);
    expect(result.exitCode).toBe(0);
    return result;
  };
  try {
    await f.engine.request(
      "workspace.update",
      { id: ws.id, write: true, execute: true, accessMode: "full" },
      ui,
    );
    const cache = resolve("test-artifacts/test-browser-runtime");
    try {
      await stat(cache);
      await mkdir(join(ws.path, ".remote-studio/runtime/browser-runtime"), {
        recursive: true,
      });
      await cp(cache, join(ws.path, ".remote-studio/runtime/browser-runtime"), {
        recursive: true,
      });
    } catch {
      await finish(await call("browser_prepare"), 180000);
      await cp(join(ws.path, ".remote-studio/runtime/browser-runtime"), cache, {
        recursive: true,
      });
    }
    for (const template of process.env.STUDIO_TEMPLATE_TEST_ONLY?.split(
      ",",
    ) ?? ["astro", "next-fullstack", "electron"]) {
      process.stdout.write("Template verification: " + template + "\n");
      const path = template,
        name = template + "-starter";
      const created = await call("project_create", {
        path,
        name,
        template,
        preset: "premium-saas",
      });
      expect(created.status).toBe("applied");
      await finish(await call("project_install", { path }));
      if (template === "next-fullstack")
        await finish(
          await call("project_run_script", { path, script: "setup" }),
        );
      await finish(
        await call("project_run_script", { path, script: "typecheck" }),
      );
      await finish(await call("project_run_script", { path, script: "test" }));
      await finish(await call("project_run_script", { path, script: "build" }));
      if (template === "electron") {
        let session = await call("desktop_launch", { path });
        if (session.phase === "preparing") {
          await finish(session.job, 600000);
          session = await call("desktop_launch", { path });
        }
        expect(session.phase).toBe("running");
        let snapshot = await call("desktop_snapshot", {
          sessionId: session.sessionId,
        });
        expect(snapshot.content).toContain("Build something worth using");
        snapshot = await call("desktop_action", {
          sessionId: session.sessionId,
          action: "click",
          locator: { by: "role", value: "button", name: "Count: 0" },
        });
        expect(snapshot.content).toContain("Count: 1");
        const shot = await call("desktop_screenshot", {
          sessionId: session.sessionId,
        });
        expect(shot.artifact.bytes).toBeGreaterThan(1000);
        await mkdir(resolve("test-artifacts"), { recursive: true });
        await cp(
          join(f.engine.directory, "artifacts", shot.artifact.id),
          resolve("test-artifacts/electron-window.png"),
        ).catch(() => {});
        await call("desktop_stop", { sessionId: session.sessionId });
        await finish(
          await call("project_run_script", { path, script: "package" }),
        );
        if (process.platform === "darwin") {
          const release = join(ws.path, path, "release", "mac-" + process.arch),
            [bundle] = (await readdir(release)).filter((n) =>
              n.endsWith(".app"),
            );
          expect(bundle).toBeTruthy();
          const packaged = await call("desktop_launch", {
            path,
            packagedPath: path + "/release/mac-" + process.arch + "/" + bundle,
          });
          expect(packaged.phase).toBe("running");
          const smoke = await call("desktop_snapshot", {
            sessionId: packaged.sessionId,
          });
          expect(smoke.content).toContain("Build something worth using");
          await call("desktop_stop", { sessionId: packaged.sessionId });
        }
      } else {
        const preview = await call("preview_start", { path });
        const ready = await waitFor(
          () => call("preview_status", { jobId: preview.job.id }),
          (s) => {
            if (s.job.status === "failed")
              throw new Error(template + ": " + s.job.logs);
            return s.ready;
          },
          60000,
        ).catch(() => {
          const j = f.engine.store.job(preview.job.id);
          throw new Error(
            template +
              " preview not ready at " +
              preview.url +
              "\n" +
              j?.status +
              "\n" +
              j?.logs,
          );
        });
        const session = await call("browser_open", { jobId: ready.job.id });
        let snapshot = await call("browser_snapshot", {
          sessionId: session.sessionId,
        });
        expect(snapshot.content.length).toBeGreaterThan(30);
        if (template === "astro") {
          await call("browser_action", {
            sessionId: session.sessionId,
            action: "navigate",
            value: "/contact",
          });
          snapshot = await call("browser_snapshot", {
            sessionId: session.sessionId,
          });
          expect(snapshot.content).toContain("Start a conversation");
        } else {
          const root = ready.url,
            headers = { "content-type": "application/json", origin: root };
          expect((await fetch(root + "/api/notes")).status).toBe(401);
          const signup = await fetch(root + "/api/auth/sign-up/email", {
            method: "POST",
            headers,
            body: JSON.stringify({
              name: "Local test",
              email: "local@example.test",
              password: "local-test-password-42",
            }),
          });
          const body = await signup.text();
          expect(signup.status, body).toBe(200);
          const cookie = signup.headers
            .getSetCookie()
            .map((c) => c.split(";")[0])
            .join("; ");
          const authHeaders = { ...headers, cookie };
          expect(
            (
              await fetch(root + "/api/notes", {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({ body: "" }),
              })
            ).status,
          ).toBe(400);
          const note = await fetch(root + "/api/notes", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ body: "Real local persistence" }),
          });
          expect(note.status, await note.clone().text()).toBe(201);
          const saved = (await note.json()) as any;
          expect(
            (
              await fetch(root + "/api/notes/" + saved.id, {
                method: "PATCH",
                headers: authHeaders,
                body: JSON.stringify({ body: "" }),
              })
            ).status,
          ).toBe(400);
          const updated = await fetch(root + "/api/notes/" + saved.id, {
            method: "PATCH",
            headers: authHeaders,
            body: JSON.stringify({ body: "Updated local persistence" }),
          });
          expect(updated.status).toBe(200);
          expect(((await updated.json()) as any).body).toBe(
            "Updated local persistence",
          );
          const list = await fetch(root + "/api/notes", {
            headers: authHeaders,
          });
          expect(
            ((await list.json()) as any[]).some((n) => n.id === saved.id),
          ).toBe(true);
          expect(
            (
              await fetch(root + "/api/notes/" + saved.id, {
                method: "DELETE",
                headers: authHeaders,
              })
            ).status,
          ).toBe(204);
          await call("browser_action", {
            sessionId: session.sessionId,
            action: "navigate",
            value: "/account",
          });
        }
        for (const viewport of [
          { width: 1440, height: 900 },
          { width: 768, height: 1024 },
          { width: 390, height: 844 },
        ]) {
          await call("browser_action", {
            sessionId: session.sessionId,
            action: "viewport",
            ...viewport,
          });
          const shot = await call("browser_screenshot", {
            sessionId: session.sessionId,
          });
          expect(shot.artifact.width).toBe(viewport.width);
          expect(shot.artifact.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
          const image = await call("artifact_read", {
            artifactId: shot.artifact.id,
          });
          expect(image.image.data.length).toBeGreaterThan(100);
        }
        const quality = await call("browser_check", {
          sessionId: session.sessionId,
        });
        expect(quality.layout.horizontalOverflow).toBe(false);
        expect(quality.layout.brokenImages).toHaveLength(0);
        await call("browser_close", { sessionId: session.sessionId });
        await call("preview_stop", { jobId: preview.job.id });
        if (template === "astro")
          expect(
            (await stat(join(ws.path, path, "dist/index.html"))).size,
          ).toBeGreaterThan(0);
      }
    }
    if (
      !process.env.STUDIO_TEMPLATE_TEST_ONLY ||
      process.env.STUDIO_TEMPLATE_TEST_ONLY.includes("electron")
    )
      expect(
        (await readFile(join(ws.path, "electron/out/main/index.js"), "utf8"))
          .length,
      ).toBeGreaterThan(0);
  } catch (error) {
    await mkdir(resolve("test-artifacts"), { recursive: true });
    await writeFile(
      resolve("test-artifacts/template-failure.txt"),
      String(error) +
        "\n" +
        JSON.stringify(f.engine.store.jobSummaries(), null, 2),
    );
    throw error;
  } finally {
    await f.cleanup();
  }
}, 600000);
