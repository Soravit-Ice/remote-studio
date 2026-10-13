import { safeStorage } from "electron";
import { readFile, writeFile, rename, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  environmentEntry,
  validateEnvironmentName,
  type EnvironmentEntry,
} from "../../../../packages/environment/src/index";
export type VaultCodec = Pick<
  typeof safeStorage,
  | "isEncryptionAvailable"
  | "getSelectedStorageBackend"
  | "encryptString"
  | "decryptString"
>;
export class EnvironmentVault {
  private entries: EnvironmentEntry[] = [];
  private loadError: string | undefined;
  constructor(
    readonly directory: string,
    private codec: VaultCodec = safeStorage,
  ) {}
  get locked() {
    return !!this.loadError;
  }
  private secure() {
    if (
      !this.codec.isEncryptionAvailable() ||
      (process.platform === "linux" &&
        this.codec.getSelectedStorageBackend() === "basic_text")
    )
      throw new Error(
        "OS secure storage is unavailable; plaintext storage is refused.",
      );
  }
  async load() {
    try {
      const bytes = await readFile(
        join(this.directory, "workspace-environment.enc"),
      );
      this.secure();
      this.entries = JSON.parse(this.codec.decryptString(bytes)).map(
        (e: unknown) => environmentEntry.parse(e),
      );
      this.loadError = undefined;
    } catch (error) {
      this.entries = [];
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.loadError =
          "Encrypted environment could not be unlocked. Existing data is preserved; unlock OS secure storage and restart to edit it.";
    }
    return this.entries;
  }
  summary(workspaceId: string) {
    if (this.loadError) throw new Error(this.loadError);
    return this.entries
      .filter((e) => e.workspaceId === workspaceId)
      .map(({ value, ...e }) => ({ ...e, hasValue: !!value }));
  }
  async set(input: {
    workspaceId: string;
    name: string;
    value?: string;
    clientIds: string[];
    remove?: boolean;
  }) {
    if (this.loadError) throw new Error(this.loadError);
    validateEnvironmentName(input.name);
    this.secure();
    const old = this.entries.find(
      (e) => e.workspaceId === input.workspaceId && e.name === input.name,
    );
    const next = this.entries.filter((e) => e !== old);
    if (!input.remove) {
      const value = input.value || old?.value;
      if (!value) throw new Error("Enter a value for the new variable.");
      next.push(environmentEntry.parse({ ...input, value }));
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = join(this.directory, "workspace-environment.enc"),
      temp = target + "." + randomUUID();
    try {
      await writeFile(temp, this.codec.encryptString(JSON.stringify(next)), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true });
    }
    this.entries = next;
    return next;
  }
}
