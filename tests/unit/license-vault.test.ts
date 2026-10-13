import { expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
vi.mock("electron", () => ({ safeStorage: {} }));
import { installationLicenseKey } from "../../apps/desktop/electron/main/license-vault";
it("retains one installation key across concurrent callers and refuses plaintext/corrupt storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-key-vault-"));
  const codec: any = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "keychain_access",
    encryptString: (value: string) => Buffer.from("protected:" + value),
    decryptString: (value: Buffer) => {
      if (!value.toString().startsWith("protected:"))
        throw new Error("cannot decrypt");
      return value.toString().slice(10);
    },
  };
  try {
    const keys = await Promise.all([
      installationLicenseKey(root, codec),
      installationLicenseKey(root, codec),
    ]);
    expect(keys[0]).toBe(keys[1]);
    expect(await installationLicenseKey(root, codec)).toBe(keys[0]);
    await expect(
      installationLicenseKey(root, {
        ...codec,
        isEncryptionAvailable: () => false,
      }),
    ).rejects.toThrow("OS secure storage");
    const path = join(root, "license-installation-key.enc");
    await writeFile(path, "broken protected state");
    await expect(installationLicenseKey(root, codec)).rejects.toThrow(
      "preserved",
    );
    expect(await readFile(path, "utf8")).toBe("broken protected state");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
