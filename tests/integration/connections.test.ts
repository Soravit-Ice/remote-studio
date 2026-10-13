import { expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installConfig } from "../../packages/connections/src/index";
it("updates an owned bridge entry with the same credential while preserving unrelated configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-config-upgrade-"));
  try {
    const path = join(root, "mcp.json"),
      entry = {
        command: "trusted-runtime",
        args: [
          "/old/services/bridge.mjs",
          "--credential",
          join(root, "client.json"),
        ],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      };
    const original = JSON.stringify(
      {
        theme: "dark",
        mcpServers: { other: { command: "other" }, "remote-studio": entry },
      },
      null,
      2,
    );
    await writeFile(path, original);
    const updated = {
        ...entry,
        args: ["/new/services/bridge.mjs", ...entry.args.slice(1)],
      },
      result = await installConfig(path, updated);
    expect(await readFile(result.backup!, "utf8")).toBe(original);
    const data = JSON.parse(await readFile(path, "utf8"));
    expect(data.theme).toBe("dark");
    expect(data.mcpServers.other.command).toBe("other");
    expect(data.mcpServers["remote-studio"]).toEqual(updated);
    expect((await installConfig(path, updated)).backup).toBeNull();
    await expect(
      installConfig(path, {
        ...updated,
        args: ["/another/bridge.mjs", "--credential", "different-client.json"],
      }),
    ).rejects.toThrow("different runtime or credential");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("preserves existing client configuration and creates a byte-exact backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "rs-config-"));
  try {
    const path = join(root, "mcp.json");
    const old = JSON.stringify(
      { theme: "dark", mcpServers: { existing: { command: "other" } } },
      null,
      2,
    );
    await writeFile(path, old);
    const result = await installConfig(path, {
      command: "bundled-runtime",
      args: ["bridge"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    const next = JSON.parse(await readFile(path, "utf8"));
    expect(next.theme).toBe("dark");
    expect(next.mcpServers.existing.command).toBe("other");
    expect(next.mcpServers["remote-studio"].command).toBe("bundled-runtime");
    expect(await readFile(result.backup!, "utf8")).toBe(old);
    await expect(
      installConfig(path, { command: "different", args: [], env: {} }),
    ).rejects.toThrow("already exists");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
