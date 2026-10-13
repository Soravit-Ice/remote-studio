import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rename, rm, symlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceRoot } from "../../packages/shared/src/workspace-root";

const reboot = vi.hoisted(() => ({ deviceOffset: 0n }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  const shifted = (s: any) => {
    s.dev += reboot.deviceOffset;
    return s;
  };
  return {
    ...fs,
    lstat: async (...args: any[]) => shifted(await (fs.lstat as any)(...args)),
    open: async (...args: any[]) => {
      const handle = await (fs.open as any)(...args);
      const stat = handle.stat.bind(handle);
      handle.stat = async (...values: any[]) => shifted(await stat(...values));
      return handle;
    },
  };
});
afterEach(() => {
  reboot.deviceOffset = 0n;
});
it.skipIf(process.platform !== "darwin")(
  "keeps the native identity across a simulated mount device change, but rejects a different volume and replaced roots",
  async () => {
    const temp = realpathSync(await mkdtemp(join(tmpdir(), "rs-root-")));
    const path = join(temp, "project");
    await mkdir(path);
    try {
      const original = await workspaceRoot({ path });
      expect(original.identity).toMatch(/^mac-v2:[a-f0-9-]{36}:\d+:\d+:\d+$/);
      reboot.deviceOffset = 1n;
      expect(
        await workspaceRoot({ path, rootIdentity: original.identity }),
      ).toEqual(original);
      await expect(
        workspaceRoot({
          path,
          rootIdentity: original.identity.replace(
            /mac-v2:[^:]+/,
            "mac-v2:00000000-0000-0000-0000-000000000000",
          ),
        }),
      ).rejects.toThrow("root has changed");
      await rename(path, path + "-old");
      await mkdir(path);
      await expect(
        workspaceRoot({ path, rootIdentity: original.identity }),
      ).rejects.toThrow("root has changed");
      await rm(path, { recursive: true });
      await symlink(path + "-old", path);
      await expect(
        workspaceRoot({ path, rootIdentity: original.identity }),
      ).rejects.toThrow("root has changed");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
);
