import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
// Release tooling intentionally runs as standalone Node ESM.
// @ts-expect-error JavaScript release script has no separate declaration file.
import { createReleaseManifest } from "../../scripts/release-manifest.mjs";
describe("unsigned installer release manifest", () => {
  it("hashes only this version's installer and does not claim publisher signing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "remote-studio-manifest-"));
    try {
      await writeFile(
        join(directory, "remote-studio-1.0.0-mac-arm64.dmg"),
        "release fixture",
      );
      await writeFile(
        join(directory, "remote-studio-0.9.0-mac-arm64.dmg"),
        "old fixture",
      );
      await writeFile(
        join(directory, "remote-studio-1.0.0-rc.1-mac-arm64.dmg"),
        "rc fixture",
      );
      const { entries } = await createReleaseManifest(
        directory,
        "1.0.0",
        "darwin",
        "arm64",
      );
      expect(entries).toEqual([
        expect.objectContaining({
          fileName: "remote-studio-1.0.0-mac-arm64.dmg",
          sha256: createHash("sha256").update("release fixture").digest("hex"),
          codeSigned: false,
          notarized: false,
          platform: "MACOS",
          architecture: "ARM64",
        }),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("rejects an unsupported target and symlink installer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "remote-studio-manifest-"));
    try {
      await expect(
        createReleaseManifest(directory, "1.0.0", "win32", "arm64"),
      ).rejects.toThrow();
      await writeFile(join(directory, "source"), "fixture");
      await symlink(
        join(directory, "source"),
        join(directory, "remote-studio-1.0.0-mac-arm64.dmg"),
      );
      await expect(
        createReleaseManifest(directory, "1.0.0", "darwin", "arm64"),
      ).rejects.toThrow("type invalid");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
