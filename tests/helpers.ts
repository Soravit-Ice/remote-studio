import { testLicense } from "./license-fixture";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../services/local-agent/src/engine";
import type { Actor } from "../packages/security/src/index";
import type { Workspace } from "../packages/contracts/src/index";
export const ui: Actor = {
  id: "local-ui",
  ui: true,
  workspaceIds: null,
  write: true,
};
export const secret = "a".repeat(64);
export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rs-"));
  const data = join(root, "data");
  const engine = new Engine(data, secret, () => {}, testLicense);
  const folders: Workspace[] = [];
  for (let i = 0; i < 3; i++) {
    const path = join(root, "folder-" + i);
    await mkdir(path);
    folders.push(
      ...(await engine.request("workspace.add", { paths: [path] }, ui)),
    );
  }
  const result = {
    root,
    engine,
    folders,
    cleanup: async () => {
      await result.engine.close();
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    },
  };
  return result;
}
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  predicate: (value: T) => boolean,
  timeout = 10000,
) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await fn();
    if (predicate(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out waiting for the expected real result.");
}
