import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile, readFile, symlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { fixture, ui } from "../helpers";
import { hash } from "../../packages/security/src/index";
let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  await f.cleanup();
});
describe("workspace security and recoverable edits", () => {
  it("serializes permission updates and revocation without restoring a revoked connection", async () => {
    const ws = f.folders[0];
    await writeFile(join(ws.path, "visible.txt"), "actual");
    const { clientId } = await f.engine.request(
      "connection.create",
      { name: "Race fixture", workspaceIds: [ws.id], write: true },
      ui,
    );
    const credential = await f.engine.request(
        "connection.secret",
        clientId,
        ui,
      ),
      actor = f.engine.actor(credential.token, "client");
    const update = {
      id: clientId,
      workspaceIds: [ws.id],
      write: true,
      execute: true,
      accessMode: "full",
      workspaceGrants: [
        { workspaceId: ws.id, accessMode: "full", write: true, execute: true },
      ],
    };
    await Promise.all([
      f.engine.request("connection.update", update, ui),
      f.engine.request("connection.revoke", clientId, ui),
    ]);
    expect(
      f.engine.store.clients().find((c) => c.id === clientId)?.revoked,
    ).toBe(true);
    await expect(
      f.engine.security.read(ws.id, "visible.txt", actor),
    ).rejects.toThrow();
    await expect(
      f.engine.request("connection.update", update, ui),
    ).rejects.toThrow("not found");
  });
  it("updates only requested settings and never resets onboarding or other preferences", async () => {
    await f.engine.request(
      "settings.set",
      { onboarded: true, concurrency: 4 },
      ui,
    );
    await f.engine.request("settings.set", { theme: "dark" }, ui);
    expect(f.engine.store.settings()).toMatchObject({
      onboarded: true,
      concurrency: 4,
      theme: "dark",
      closeToTray: true,
    });
    await f.engine.request("settings.set", { notifications: false }, ui);
    expect(f.engine.store.settings()).toMatchObject({
      onboarded: true,
      concurrency: 4,
      theme: "dark",
      notifications: false,
    });
  });
  it("authorizes three real folders independently, persists grants, and rejects path escapes", async () => {
    expect(f.engine.store.workspaces()).toHaveLength(3);
    for (const w of f.folders) expect(w.write).toBe(false);
    await f.engine.request(
      "workspace.update",
      { id: f.folders[1].id, write: true },
      ui,
    );
    expect(f.engine.store.workspaces().filter((w) => w.write)).toHaveLength(1);
    await expect(
      f.engine.security.path(f.folders[0].id, "../folder-1", ui),
    ).rejects.toThrow("escapes");
    await expect(
      f.engine.security.path(f.folders[0].id, "/etc/passwd", ui),
    ).rejects.toThrow("relative");
    await expect(
      f.engine.files.propose(
        {
          workspaceId: f.folders[0].id,
          path: "x.txt",
          content: "x",
          expectedHash: null,
        },
        ui,
      ),
    ).rejects.toThrow("read only");
  });
  it("rejects internal and external symbolic links, binary text, and protected files", async () => {
    const w = f.folders[0];
    await writeFile(join(w.path, "valid.txt"), "valid");
    await symlink(join(w.path, "valid.txt"), join(w.path, "internal"));
    await symlink(f.folders[1].path, join(w.path, "external"), "dir");
    await writeFile(join(w.path, "binary"), Buffer.from([0, 1, 2]));
    await expect(f.engine.security.read(w.id, "internal", ui)).rejects.toThrow(
      "Symbolic",
    );
    await expect(
      f.engine.security.path(w.id, "external/anything", ui, "read", true),
    ).rejects.toThrow("Symbolic");
    await expect(f.engine.security.read(w.id, "binary", ui)).rejects.toThrow(
      "Binary",
    );
    await expect(
      f.engine.security.path(w.id, ".env", ui, "read", true),
    ).rejects.toThrow("Protected");
  });
  it("requires local review, applies an exact patch, audits it, and restores actual content", async () => {
    const w = f.folders[0];
    await f.engine.request("workspace.update", { id: w.id, write: true }, ui);
    await writeFile(join(w.path, "code.ts"), "const n = 1;\n");
    const change = await f.engine.request(
      "tool.call",
      {
        name: "file_patch",
        arguments: {
          workspaceId: w.id,
          path: "code.ts",
          find: "1",
          replace: "2",
          expectedHash: hash("const n = 1;\n"),
        },
      },
      ui,
    );
    expect(await readFile(join(w.path, "code.ts"), "utf8")).toBe(
      "const n = 1;\n",
    );
    await f.engine.request(
      "change.resolve",
      { id: change.id, decision: "approve" },
      ui,
    );
    expect(await readFile(join(w.path, "code.ts"), "utf8")).toBe(
      "const n = 2;\n",
    );
    await f.engine.request(
      "change.resolve",
      { id: change.id, decision: "undo" },
      ui,
    );
    expect(await readFile(join(w.path, "code.ts"), "utf8")).toBe(
      "const n = 1;\n",
    );
    expect(
      f.engine.snapshot().audit.some((a) => a.action === "file.undo"),
    ).toBe(true);
  });
  it("blocks stale proposals and undo that would overwrite a newer external edit", async () => {
    const w = f.folders[0];
    await f.engine.request("workspace.update", { id: w.id, write: true }, ui);
    await writeFile(join(w.path, "a.txt"), "a");
    await expect(
      f.engine.files.propose(
        {
          workspaceId: w.id,
          path: "a.txt",
          content: "b",
          expectedHash: hash("wrong"),
        },
        ui,
      ),
    ).rejects.toThrow("conflict");
    const change = await f.engine.files.propose(
      {
        workspaceId: w.id,
        path: "a.txt",
        content: "b",
        expectedHash: hash("a"),
      },
      ui,
    );
    await f.engine.files.resolve(change.id, "approve", ui);
    await writeFile(join(w.path, "a.txt"), "user edit");
    await expect(f.engine.files.resolve(change.id, "undo", ui)).rejects.toThrow(
      "newer",
    );
    expect(await readFile(join(w.path, "a.txt"), "utf8")).toBe("user edit");
  });
  it("enforces client scope and revocation; clients cannot approve or grant themselves permissions", async () => {
    const w = f.folders[0];
    await f.engine.request("workspace.update", { id: w.id, write: true }, ui);
    const { clientId } = await f.engine.request(
      "connection.create",
      { name: "Test client", workspaceIds: [w.id], write: false },
      ui,
    );
    const credential = await f.engine.request(
      "connection.secret",
      clientId,
      ui,
    );
    const actor = f.engine.actor(credential.token, "client");
    await expect(
      f.engine.request("workspace.update", { id: w.id, write: true }, actor),
    ).rejects.toThrow("trusted local");
    await expect(
      f.engine.request(
        "tool.call",
        { name: "workspace_info", arguments: { workspaceId: f.folders[1].id } },
        actor,
      ),
    ).rejects.toThrow("not authorized");
    expect(
      await f.engine.request(
        "tool.call",
        { name: "workspace_list", arguments: {} },
        actor,
      ),
    ).toHaveLength(1);
    expect(
      (await f.engine.request("tool.list", {}, actor)).some(
        (t: any) => t.name === "file_write",
      ),
    ).toBe(false);
    await f.engine.request("connection.revoke", clientId, ui);
    expect(() => f.engine.actor(credential.token, "client")).toThrow(
      "Unauthorized",
    );
  });
  it("revoking write access rejects pending edits and disabled modules refuse execution", async () => {
    const w = f.folders[0];
    await f.engine.request("workspace.update", { id: w.id, write: true }, ui);
    const change = await f.engine.files.propose(
      {
        workspaceId: w.id,
        path: "new.txt",
        content: "new",
        expectedHash: null,
      },
      ui,
    );
    await f.engine.request("workspace.update", { id: w.id, write: false }, ui);
    await expect(
      f.engine.files.resolve(change.id, "approve", ui),
    ).rejects.toThrow("already");
    await f.engine.request("module.set", { name: "Files", enabled: false }, ui);
    await expect(
      f.engine.request(
        "tool.call",
        { name: "file_list", arguments: { workspaceId: w.id } },
        ui,
      ),
    ).rejects.toThrow("disabled");
  });
  it("blocks ambiguous patches and cannot follow a swapped workspace root", async () => {
    const w = f.folders[0];
    await f.engine.request("workspace.update", { id: w.id, write: true }, ui);
    await writeFile(join(w.path, "a.txt"), "same same");
    await expect(
      f.engine.request(
        "tool.call",
        {
          name: "file_patch",
          arguments: {
            workspaceId: w.id,
            path: "a.txt",
            find: "same",
            replace: "new",
            expectedHash: hash("same same"),
          },
        },
        ui,
      ),
    ).rejects.toThrow("exactly once");
    await rename(w.path, w.path + "-original");
    await symlink(f.folders[1].path, w.path, "dir");
    await expect(f.engine.security.path(w.id, "a.txt", ui)).rejects.toThrow(
      "root has changed",
    );
  });
  it("protects the app credential directory even when its parent is authorized", async () => {
    const [parent] = await f.engine.request(
      "workspace.add",
      { paths: [f.root] },
      ui,
    );
    await expect(
      f.engine.security.read(parent.id, "data/studio.sqlite", ui),
    ).rejects.toThrow("protected");
    const result = await f.engine.files.search(
      {
        workspaceId: parent.id,
        path: ".",
        query: "studio.sqlite",
        limit: 20,
        content: false,
      },
      ui,
    );
    expect(result.matches).toHaveLength(0);
  });
});
