import { safeStorage } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { VaultCodec } from "./environment-vault";
export async function installationLicenseKey(
  directory: string,
  codec: VaultCodec = safeStorage,
) {
  if (
    !codec.isEncryptionAvailable() ||
    (process.platform === "linux" &&
      codec.getSelectedStorageBackend() === "basic_text")
  )
    throw new Error(
      "OS secure storage is unavailable. License storage stays locked.",
    );
  const path = join(directory, "license-installation-key.enc");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const value = codec.decryptString(await readFile(path));
    if (
      !/^[A-Za-z0-9+/]{43}=$/.test(value) ||
      Buffer.from(value, "base64").length !== 32
    )
      throw new Error("Invalid saved installation key.");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(
        "Existing encrypted license key could not be unlocked. It has been preserved.",
      );
    const key = randomBytes(32).toString("base64");
    try {
      await writeFile(path, codec.encryptString(key), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return installationLicenseKey(directory, codec);
    }
    return key;
  }
}
