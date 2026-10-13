import { testLicense } from "../license-fixture";
import { expect, it } from "vitest";
import { lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, secret, ui } from "../helpers";
import { Engine } from "../../services/local-agent/src/engine";
import { workspaceRoot } from "../../packages/shared/src/workspace-root";
import type { Workspace } from "../../packages/contracts/src/index";

it("migrates only matching legacy roots; local recovery retains grants, cancels old work and survives agent restart", async () => {
  const f = await fixture();
  const ws = f.folders[0];
  try {
    await f.engine.request(
      "workspace.update",
      { id: ws.id, write: true, execute: true },
      ui,
    );
    const saved = f.engine.store.get<Workspace>("workspace", ws.id)!;
    const stat = await lstat(ws.path, { bigint: true });
    f.engine.store.put("workspace", ws.id, {
      ...saved,
      rootIdentity: `${stat.dev}:${stat.ino}`,
    });
    const migrated = (
      await f.engine.request("snapshot", {}, ui)
    ).workspaces.find((w: Workspace) => w.id === ws.id);
    expect(migrated.rootIdentity).toBe(
      (await workspaceRoot({ path: ws.path })).identity,
    );
    expect(migrated.rootError).toBeUndefined();
    const connection = await f.engine.request(
      "connection.create",
      { name: "Persisted", workspaceIds: [ws.id], write: true },
      ui,
    );
    const clientBefore = f.engine.store.clients();
    const credential = await f.engine.request(
      "connection.secret",
      connection.clientId,
      ui,
    );
    const actor = f.engine.actor(credential.token, "client");
    const change = await f.engine.files.propose(
      {
        workspaceId: ws.id,
        path: "pending.txt",
        content: "old proposal",
        expectedHash: null,
      },
      ui,
    );
    const job = await f.engine.jobs.create(
      {
        workspaceId: ws.id,
        executable: process.execPath,
        args: ["-e", "console.log('must not run')"],
        cwd: ".",
        timeoutMs: 1000,
      },
      ui,
    );
    f.engine.store.put("workspace", ws.id, {
      ...saved,
      rootIdentity: `${stat.dev + 1n}:${stat.ino}`,
    });
    const blocked = (
      await f.engine.request("snapshot", {}, ui)
    ).workspaces.find((w: Workspace) => w.id === ws.id);
    expect(blocked.rootError).toContain("root has changed");
    await expect(
      f.engine.request("workspace.update", { id: ws.id, write: true }, ui),
    ).rejects.toThrow("root has changed");
    const root = await workspaceRoot({ path: ws.path });
    const input = { id: ws.id, path: ws.path, identity: root.identity };
    await expect(
      f.engine.request(
        "workspace.inspectRoot",
        { id: ws.id, path: ws.path },
        actor,
      ),
    ).rejects.toThrow("trusted local UI");
    expect(
      await f.engine.request(
        "workspace.inspectRoot",
        { id: ws.id, path: ws.path },
        ui,
      ),
    ).toEqual(root);
    await expect(
      f.engine.request("workspace.reauthorize", input, actor),
    ).rejects.toThrow("trusted local UI");
    await expect(
      f.engine.request(
        "workspace.reauthorize",
        { ...input, path: f.folders[1].path },
        ui,
      ),
    ).rejects.toThrow("original workspace");
    await expect(
      f.engine.request(
        "workspace.reauthorize",
        { ...input, identity: "wrong" },
        ui,
      ),
    ).rejects.toThrow("root has changed");
    const restored = await f.engine.request("workspace.reauthorize", input, ui);
    expect(restored).toMatchObject({
      id: saved.id,
      name: saved.name,
      path: saved.path,
      write: true,
      execute: true,
    });
    expect(f.engine.store.clients()).toEqual(clientBefore);
    expect(f.engine.jobs.get(job.id, ui).status).toBe("cancelled");
    expect(
      f.engine.store.changes().find((c) => c.id === change.id)?.status,
    ).toBe("rejected");
    await writeFile(join(ws.path, "visible.txt"), "same folder");
    expect(
      await f.engine.security.read(ws.id, "visible.txt", actor),
    ).toMatchObject({ content: "same folder" });
    await f.engine.close();
    f.engine = new Engine(join(f.root, "data"), secret, () => {}, testLicense);
    const after = (await f.engine.request("snapshot", {}, ui)).workspaces.find(
      (w: Workspace) => w.id === ws.id,
    );
    expect(after.rootError).toBeUndefined();
    expect(after.rootIdentity).toBe(root.identity);
    expect(f.engine.store.clients()).toEqual(clientBefore);
  } finally {
    await f.cleanup();
  }
});

it("requires a new local identity after replacement and rejects a folder swapped after selection", async () => {
  const f = await fixture();
  const ws = f.folders[0];
  try {
    const root = await workspaceRoot(ws);
    await rename(ws.path, ws.path + "-old");
    await mkdir(ws.path);
    const input = { id: ws.id, path: ws.path, identity: root.identity };
    await expect(
      f.engine.request("workspace.reauthorize", input, ui),
    ).rejects.toThrow("root has changed");
    const replacement = await workspaceRoot({ path: ws.path });
    await f.engine.request(
      "workspace.reauthorize",
      { ...input, identity: replacement.identity },
      ui,
    );
    expect(
      await workspaceRoot(f.engine.store.get<Workspace>("workspace", ws.id)!),
    ).toEqual(replacement);
    expect(f.engine.store.get<Workspace>("workspace", ws.id)).toMatchObject({
      write: false,
      execute: false,
    });
  } finally {
    await f.cleanup();
  }
});
