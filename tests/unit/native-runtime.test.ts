import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  cp,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { frozenServices } from "../../packages/shared/src/native-runtime";

it("retains immutable code for a running process and reuses equal revisions across entry points", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-runtime-")),
    source = join(root, "source"),
    second = join(root, "second"),
    data = join(root, "data");
  try {
    await mkdir(source);
    await writeFile(join(source, "worker.mjs"), "export const value = 1;");
    await cp(source, second, { recursive: true });
    const frozen = frozenServices(source, data),
      same = frozenServices(second, data);
    expect(same).toBe(frozen);
    await writeFile(join(source, "worker.mjs"), "export const value = 2;");
    expect(frozenServices(source, data)).toBe(frozen);
    expect(await readFile(join(frozen, "worker.mjs"), "utf8")).toBe(
      "export const value = 1;",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects a corrupted retained runtime and symbolic source files", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-runtime-")),
    source = join(root, "source"),
    second = join(root, "second"),
    data = join(root, "data");
  try {
    await mkdir(source);
    await writeFile(join(source, "worker.mjs"), "export const value = 1;");
    await cp(source, second, { recursive: true });
    const frozen = frozenServices(source, data);
    await writeFile(join(frozen, "worker.mjs"), "changed cached code");
    expect(() => frozenServices(second, data)).toThrow("integrity");
    const linked = join(root, "linked");
    await mkdir(linked);
    await symlink(join(source, "worker.mjs"), join(linked, "worker.mjs"));
    expect(() => frozenServices(linked, data)).toThrow("symlink");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
