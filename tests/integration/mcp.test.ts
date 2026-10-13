import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { adminToken, rpc } from "../../packages/shared/src/rpc";
import { waitFor } from "../helpers";
import { hash } from "../../packages/security/src/index";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PNG } from "pngjs";
it("MCP v2 handshake, schema validation, file patch/undo, and job survives client disconnection", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-mcp-"));
  const directory = join(root, "data");
  await mkdir(join(root, "workspace"));
  const agent = spawn(
    process.execPath,
    [resolve("dist/services/agent.mjs"), "--test-license", "--data", directory],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, STUDIO_DATA_DIR: directory },
    },
  );
  let stderr = "";
  agent.stderr.on("data", (b) => (stderr += b.toString()));
  const token = await adminToken(directory);
  let client: Client | undefined;
  try {
    await waitFor(
      async () => {
        try {
          return await rpc(directory, token, "snapshot");
        } catch {
          return null;
        }
      },
      (v) => !!v,
      10000,
    ).catch(() => {
      throw new Error("Agent did not start: " + stderr);
    });
    const [w] = await rpc(directory, token, "workspace.add", {
      paths: [join(root, "workspace")],
    });
    await rpc(directory, token, "workspace.update", {
      id: w.id,
      write: true,
      execute: true,
    });
    const { clientId } = await rpc(directory, token, "connection.create", {
      name: "Integration MCP client",
      workspaceIds: [w.id],
      write: true,
    });
    const credential = join(directory, "clients", clientId + ".json");
    const connect = async () => {
      const c = new Client({ name: "remote-studio-test", version: "0.1.0" });
      await c.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [
            resolve("dist/services/bridge.mjs"),
            "--credential",
            credential,
          ],
          stderr: "pipe",
        }),
      );
      return c;
    };
    client = await connect();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "file_write",
        "directory_create",
        "project_install",
        "preview_start",
        "job_input",
      ]),
    );
    expect(
      tools.tools.find((t) => t.name === "file_patch")?.inputSchema,
    ).toHaveProperty("properties");
    expect(
      tools.tools.find((t) => t.name === "file_write")?.outputSchema,
    ).toBeDefined();
    const folders = await client.callTool({
      name: "workspace_list",
      arguments: {},
    });
    expect(folders.isError).not.toBe(true);
    const identity = await rpc<any>(directory, token, "server.identity");
    expect(client.getServerVersion()?.title).toBe(
      `Remote Studio · ${identity.serverId}`,
    );
    expect(folders._meta?.["remote-studio/serverId"]).toBe(identity.serverId);
    // Actual SDK serialization of a fixture PNG; real browser capture is
    // exercised separately by the native template workflow.
    const image = new PNG({ width: 24, height: 24 });
    image.data.fill(255);
    const bytes = PNG.sync.write(image),
      artifactId = randomUUID();
    await mkdir(join(directory, "artifacts"), { recursive: true });
    await writeFile(join(directory, "artifacts", artifactId), bytes);
    const database = new DatabaseSync(join(directory, "studio.sqlite"));
    try {
      database.prepare("INSERT INTO artifacts VALUES(?,?,?,?)").run(
        artifactId,
        w.id,
        clientId,
        JSON.stringify({
          id: artifactId,
          workspaceId: w.id,
          clientId,
          mimeType: "image/png",
          name: "transport-fixture.png",
          bytes: bytes.length,
          hash: hash(bytes),
          width: 24,
          height: 24,
          createdAt: new Date().toISOString(),
          sourceRevision: "transport-fixture",
          sourcePath: ".",
          role: "screenshot",
        }),
      );
    } finally {
      database.close();
    }
    const picture = await client.callTool({
      name: "artifact_read",
      arguments: { workspaceId: w.id, artifactId },
    });
    expect(picture.isError).not.toBe(true);
    const imageBlock = picture.content?.find(
      (block: any) => block.type === "image",
    ) as any;
    expect(imageBlock.mimeType).toBe("image/png");
    expect(Buffer.from(imageBlock.data, "base64")).toEqual(bytes);
    expect((picture.structuredContent as any).data.image).toBeUndefined();
    expect((picture.structuredContent as any).data.artifact.hash).toBe(
      hash(bytes),
    );
    const skillFolder = join(root, "bridge-skill");
    await mkdir(join(skillFolder, "references"), { recursive: true });
    await writeFile(
      join(skillFolder, "SKILL.md"),
      "---\nname: bridge-skill\ndescription: MCP resource fixture.\n---\nRead references/guide 100%.md.",
    );
    await writeFile(
      join(skillFolder, "references/guide 100%.md"),
      "Actual nested resource bytes.",
    );
    const [skill] = await rpc<any>(directory, token, "skills.import", {
      kind: "directory",
      path: skillFolder,
      workspaceId: w.id,
    });
    await rpc(directory, token, "skills.configure", {
      skillId: skill.id,
      enabled: true,
    });
    const resources = await client.listResources(),
      resource = resources.resources.find((r) => r.name.includes("guide 100%"));
    expect(resource).toBeDefined();
    const contents = await client.readResource({ uri: resource!.uri });
    expect((contents.contents[0] as any).text).toBe(
      "Actual nested resource bytes.",
    );
    await rpc(directory, token, "skills.configure", {
      skillId: skill.id,
      enabled: false,
    });
    await expect(client.readResource({ uri: resource!.uri })).rejects.toThrow(
      "disabled",
    );
    await writeFile(join(w.path, "code.ts"), "const answer = 1;");
    const read = await client.callTool({
      name: "file_read",
      arguments: { workspaceId: w.id, path: "code.ts" },
    });
    expect((read.structuredContent as any)?.data).toEqual({
      content: "const answer = 1;",
      hash: hash("const answer = 1;"),
    });
    const denied = await client.callTool({
      name: "file_read",
      arguments: { workspaceId: w.id, path: "../outside" },
    });
    expect(denied.isError).toBe(true);
    const invalid = await client.callTool({
      name: "file_read",
      arguments: { workspaceId: "not-uuid", path: "x" },
    });
    expect(invalid.isError).toBe(true);
    const proposed = await client.callTool({
      name: "file_patch",
      arguments: {
        workspaceId: w.id,
        path: "code.ts",
        find: "1",
        replace: "42",
        expectedHash: hash("const answer = 1;"),
      },
    });
    const change = (proposed.structuredContent as any).data as any;
    expect(change.status).toBe("pending");
    await rpc(directory, token, "change.resolve", {
      id: change.id,
      decision: "approve",
    });
    expect(await readFile(join(w.path, "code.ts"), "utf8")).toBe(
      "const answer = 42;",
    );
    await rpc(directory, token, "change.resolve", {
      id: change.id,
      decision: "undo",
    });
    expect(await readFile(join(w.path, "code.ts"), "utf8")).toBe(
      "const answer = 1;",
    );
    const requested = await client.callTool({
      name: "command_execute",
      arguments: {
        workspaceId: w.id,
        executable: process.execPath,
        args: ["-e", "setTimeout(()=>console.log('durable result'),800)"],
        timeoutMs: 5000,
      },
    });
    expect(requested.isError).not.toBe(true);
    const job = (requested.structuredContent as any).data as any;
    await rpc(directory, token, "job.resolve", {
      id: job.id,
      decision: "approve",
    });
    await client.close();
    client = undefined;
    const result = await waitFor(
      () => rpc<any>(directory, token, "job.get", job.id),
      (j) => j.status === "completed",
    );
    expect(result.logs).toContain("durable result");
    client = await connect();
    const reconnected = await client.callTool({
      name: "job_status",
      arguments: { jobId: job.id },
    });
    expect(((reconnected.structuredContent as any).data as any).exitCode).toBe(
      0,
    );
  } finally {
    await client?.close();
    agent.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (agent.exitCode !== null) resolve();
      else {
        agent.once("exit", () => resolve());
        setTimeout(() => {
          agent.kill("SIGKILL");
          resolve();
        }, 2000).unref();
      }
    });
    await rm(root, { recursive: true, force: true });
  }
});
