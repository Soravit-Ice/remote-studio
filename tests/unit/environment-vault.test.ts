import { it, expect, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
vi.mock("electron", () => ({ safeStorage: {} }));
import {
  EnvironmentVault,
  type VaultCodec,
} from "../../apps/desktop/electron/main/environment-vault";
it("preserves an unavailable encrypted vault and blocks overwrite while keeping startup usable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rs-vault-")),
    bytes = Buffer.from("existing-encrypted-bytes");
  const codec: VaultCodec = {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "unknown",
    encryptString: () => {
      throw new Error("Should not encrypt");
    },
    decryptString: () => {
      throw new Error("Should not decrypt");
    },
  };
  try {
    await writeFile(join(dir, "workspace-environment.enc"), bytes);
    const vault = new EnvironmentVault(dir, codec);
    expect(await vault.load()).toEqual([]);
    expect(vault.locked).toBe(true);
    expect(() => vault.summary(randomUUID())).toThrow("preserved");
    await expect(
      vault.set({
        workspaceId: randomUUID(),
        name: "API_KEY",
        value: "new",
        clientIds: [],
      }),
    ).rejects.toThrow("preserved");
    expect(await readFile(join(dir, "workspace-environment.enc"))).toEqual(
      bytes,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
