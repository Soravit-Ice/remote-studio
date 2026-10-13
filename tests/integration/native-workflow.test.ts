import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  cp,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { adminToken, rpc } from "../../packages/shared/src/rpc";
import { waitFor } from "../helpers";
import { hash } from "../../packages/security/src/index";
it("native Full Access develops and inspects a real website through MCP, without repeated approvals", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-native-")),
    directory = join(root, "data");
  const workspace = join(root, "workspace"),
    outside = join(root, "outside.txt");
  await mkdir(workspace);
  await writeFile(outside, "private sibling");
  const bridgeExecutable = process.env.STUDIO_NATIVE_NODE ?? process.execPath;
  const services = resolve(
    process.env.STUDIO_NATIVE_SERVICES ?? "dist/services",
  );
  const runtimeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  // Explicit test authority runs in a host-Node agent with the selected bundled
  // services. The packaged executable runs the bridge; command tests use that
  // agent's actual Node runtime. Production GUI enforcement is tested separately.
  const agent = spawn(
    process.execPath,
    [join(services, "agent.mjs"), "--test-license", "--data", directory],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...runtimeEnv,
        STUDIO_DATA_DIR: directory,
        CONTROL_PLANE_API_KEY: "dummy-secret-must-not-inherit",
      },
    },
  );
  let client: Client | undefined,
    stderr = "";
  agent.stderr.on("data", (b) => (stderr += b.toString()));
  const token = await adminToken(directory);
  const admin = <T = any>(method: string, input?: unknown) =>
    rpc<T>(directory, token, method, input);
  try {
    await waitFor(
      () => admin("snapshot").catch(() => null),
      (v) => !!v,
      10000,
    ).catch(() => {
      throw new Error(stderr);
    });
    const [w] = await admin("workspace.add", { paths: [workspace] });
    await mkdir(join(root, "other-workspace"));
    const [other] = await admin("workspace.add", {
      paths: [join(root, "other-workspace")],
    });
    await admin("workspace.update", { id: w.id, accessMode: "full" });
    const readGrant = await admin("connection.create", {
      name: "Read only with writable folder",
      workspaceIds: [w.id],
      write: false,
    });
    const readSecret = await admin("connection.secret", readGrant.clientId);
    const readTools = await rpc<any[]>(
      directory,
      readSecret.token,
      "tool.list",
      {},
      "client",
    );
    expect(
      readTools.some((t) =>
        [
          "file_write",
          "directory_create",
          "command_execute",
          "project_create",
        ].includes(t.name),
      ),
    ).toBe(false);
    const effective = await rpc<any>(
      directory,
      readSecret.token,
      "tool.call",
      { name: "workspace_info", arguments: { workspaceId: w.id } },
      "client",
    );
    expect(effective).toMatchObject({
      write: false,
      execute: false,
      accessMode: "readOnly",
    });
    expect(effective.permissionReason).toContain("Connection");
    const { clientId } = await admin("connection.create", {
      name: "Full MCP workflow",
      workspaceIds: [w.id, other.id],
      write: true,
      execute: true,
      accessMode: "full",
      workspaceGrants: [
        { workspaceId: w.id, accessMode: "full", write: true, execute: true },
        {
          workspaceId: other.id,
          accessMode: "readOnly",
          write: false,
          execute: false,
        },
      ],
    });
    const connect = async () => {
      const c = new Client({ name: "native-workflow", version: "1" });
      await c.connect(
        new StdioClientTransport({
          command: bridgeExecutable,
          args: [
            join(services, "bridge.mjs"),
            "--credential",
            join(directory, "clients", clientId + ".json"),
          ],
          stderr: "pipe",
          env: runtimeEnv as Record<string, string>,
        }),
      );
      return c;
    };
    client = await connect();
    const call = async (name: string, input: Record<string, unknown> = {}) => {
      const result = await client!.callTool({
        name,
        arguments: { workspaceId: w.id, ...input },
      });
      if (result.isError)
        throw new Error(name + ": " + JSON.stringify(result.content));
      if (name === "browser_screenshot") {
        const image = result.content?.find(
          (block: any) => block.type === "image",
        ) as any;
        expect(image?.mimeType).toBe("image/png");
        expect(
          Buffer.from(image.data, "base64").subarray(1, 4).toString(),
        ).toBe("PNG");
      }
      return (result.structuredContent as any).data;
    };
    const done = async (job: any, timeout = 180000) => {
      const result = await waitFor(
        () => call("job_status", { jobId: job.id }),
        (j) => !["queued", "running"].includes(j.status),
        timeout,
      );
      if (result.status !== "completed")
        throw new Error(result.error + "\n" + result.logs);
      expect(result.exitCode).toBe(0);
      return result;
    };
    expect(
      (await call("directory_create", { path: "nested/deeper" })).status,
    ).toBe("applied");
    expect(
      (await call("project_create", { path: "website", name: "native-site" }))
        .status,
    ).toBe("applied");
    const before = await call("file_read", { path: "website/src/main.tsx" });
    const style = await call("file_read", {
      path: "website/src/styles/globals.css",
    });
    expect(
      (
        await call("file_patch_many", {
          patches: [
            {
              path: "website/src/main.tsx",
              find: "Build something worth using.",
              replace: "Native workspace verified",
              expectedHash: before.hash,
            },
            {
              path: "website/src/styles/globals.css",
              find: "#fafafa",
              replace: "#f5f7fa",
              expectedHash: style.hash,
            },
          ],
        })
      ).status,
    ).toBe("applied");
    const current = await call("file_read", { path: "website/src/main.tsx" });
    await call("file_patch", {
      path: "website/src/main.tsx",
      find: "</div></section></main>",
      replace:
        '</div><input aria-label="Your name"/><button onClick={event => {event.currentTarget.textContent = "Clicked"}}>Click to verify</button></section></main>',
      expectedHash: current.hash,
    });
    const batch = await call("file_batch", {
      files: [
        { path: "nested/a.txt", content: "a", expectedHash: null },
        { path: "nested/b.txt", content: "b", expectedHash: null },
      ],
    });
    expect(batch.status).toBe("applied");
    const moved = await call("file_move", {
      path: "nested/a.txt",
      destination: "nested/moved.txt",
    });
    await call("file_restore", { changeId: moved.id });
    expect(await readFile(join(workspace, "nested/a.txt"), "utf8")).toBe("a");
    await call("file_write_binary", {
      path: "asset.bin",
      base64: Buffer.from([0, 1, 2, 255]).toString("base64"),
      expectedHash: null,
    });
    expect(await readFile(join(workspace, "asset.bin"))).toEqual(
      Buffer.from([0, 1, 2, 255]),
    );
    const conflict = await client.callTool({
      name: "file_write",
      arguments: {
        workspaceId: w.id,
        path: "nested/a.txt",
        content: "wrong",
        expectedHash: hash("stale"),
      },
    });
    expect(conflict.isError).toBe(true);
    const isolateCode = `const fs=require('fs');for(const p of [${JSON.stringify(outside)},${JSON.stringify(join(directory, "studio.sqlite"))}]){try{fs.readFileSync(p);process.exit(9)}catch(e){console.log('denied-read',e.code)}try{fs.writeFileSync(p,'bad');process.exit(9)}catch(e){console.log('denied-write',e.code)}}if(process.env.CONTROL_PLANE_API_KEY)process.exit(9);console.log('isolated')`;
    const isolated = await done(
      await call("command_execute", {
        executable: process.execPath,
        args: ["-e", isolateCode],
      }),
    );
    expect(isolated.logs).toContain("isolated");
    const mismatchedJob = await client.callTool({
      name: "job_status",
      arguments: { workspaceId: other.id, jobId: isolated.id },
    });
    expect(mismatchedJob.isError).toBe(true);
    expect(JSON.stringify(mismatchedJob.content)).toContain(
      "another workspace",
    );
    await symlink(
      join(root),
      join(workspace, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const denied = await client.callTool({
      name: "file_read",
      arguments: { workspaceId: w.id, path: "escape/outside.txt" },
    });
    expect(denied.isError).toBe(true);
    await done(
      await call("command_execute", {
        executable: process.execPath,
        args: [
          "-e",
          "try{require('fs').readFileSync('escape/outside.txt');process.exit(9)}catch(e){console.log('symlink-denied')}",
        ],
      }),
    );
    expect(await readFile(outside, "utf8")).toBe("private sibling");
    const stdin = await call("command_execute", {
      executable: process.execPath,
      args: [
        "-e",
        "process.stdin.on('data',b=>{console.log(b.toString());process.exit(0)})",
      ],
    });
    await waitFor(
      () => call("job_status", { jobId: stdin.id }),
      (j) => j.status === "running",
    );
    await call("job_input", {
      jobId: stdin.id,
      input: "stdin verified\n",
      eof: true,
    });
    expect((await done(stdin)).logs).toContain("stdin verified");
    await done(await call("project_install", { path: "website" }));
    await done(
      await call("project_run_script", { path: "website", script: "build" }),
    );
    expect(
      await readFile(join(workspace, "website/dist/index.html"), "utf8"),
    ).toContain("/assets/");
    const preview = await call("preview_start", { path: "website" });
    expect(preview.ready).toBe(true);
    expect(preview.job.status).toBe("running");
    await client.close();
    client = await connect();
    expect(
      (await call("preview_status", { jobId: preview.job.id })).ready,
    ).toBe(true);
    if (process.env.STUDIO_NATIVE_BROWSER_CACHE)
      await cp(
        process.env.STUDIO_NATIVE_BROWSER_CACHE,
        join(workspace, ".remote-studio/runtime/browser-runtime"),
        { recursive: true },
      );
    await done(await call("browser_prepare"), 600000);
    const browser = await call("browser_open", { jobId: preview.job.id });
    const mismatchedBrowser = await client.callTool({
      name: "browser_snapshot",
      arguments: { workspaceId: other.id, sessionId: browser.sessionId },
    });
    expect(mismatchedBrowser.isError).toBe(true);
    expect(JSON.stringify(mismatchedBrowser.content)).toContain(
      "another workspace",
    );
    const page = await call("browser_snapshot", {
      sessionId: browser.sessionId,
    });
    expect(page.content).toContain("Native workspace verified");
    await call("browser_action", {
      sessionId: browser.sessionId,
      action: "fill",
      selector: "input",
      value: "Remote Studio",
    });
    const clicked = await call("browser_action", {
      sessionId: browser.sessionId,
      action: "click",
      locator: {
        by: "role",
        value: "button",
        name: "Click to verify",
        exact: true,
      },
    });
    expect(clicked.content).toContain("Clicked");
    const screenshot = await call("browser_screenshot", {
      sessionId: browser.sessionId,
      path: "preview.png",
    });
    expect(screenshot.bytes).toBeGreaterThan(1000);
    expect(
      (await readFile(join(workspace, "preview.png")))
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");
    await mkdir(resolve("test-artifacts"), { recursive: true });
    await cp(
      join(workspace, "preview.png"),
      resolve("test-artifacts/native-preview.png"),
    );
    await admin("workspace.update", { id: w.id, write: false });
    expect((await admin("job.get", preview.job.id)).status).toBe("cancelled");
    const stopped = await client.callTool({
      name: "browser_snapshot",
      arguments: { sessionId: browser.sessionId },
    });
    expect(stopped.isError).toBe(true);
    const snapshot = await admin("snapshot");
    expect(
      snapshot.jobs.some((j: any) => j.status === "awaiting_approval"),
    ).toBe(false);
  } finally {
    await client?.close();
    agent.kill("SIGTERM");
    await new Promise<void>((res) => {
      if (agent.exitCode !== null) res();
      else {
        agent.once("exit", () => res());
        setTimeout(() => {
          agent.kill("SIGKILL");
          res();
        }, 3000).unref();
      }
    });
    if (!process.env.STUDIO_KEEP_NATIVE_FIXTURE)
      await rm(root, { recursive: true, force: true });
    else console.log("Native diagnostic fixture:", root);
  }
}, 900000);
