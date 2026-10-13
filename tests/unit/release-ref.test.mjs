import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkReleaseRef } from "../../scripts/check-release-ref.mjs";

async function fixture(version, notes = "Release notes") {
  const root = await mkdtemp(join(tmpdir(), "precut-release-ref-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ version }));
  await mkdir(join(root, "releases"));
  if (notes !== undefined)
    await writeFile(join(root, "releases", `${version}.md`), notes);
  return root;
}
describe("release preflight", () => {
  it.each(["2.0.0", "2.1.0", "2.5.0"])(
    "accepts matching %s tags and local release preparation",
    async (version) => {
      const root = await fixture(version);
      try {
        await expect(
          checkReleaseRef(root, {
            GITHUB_ACTIONS: "true",
            GITHUB_REF: `refs/tags/v${version}`,
          }),
        ).resolves.toEqual({ version, tag: `v${version}` });
        await expect(checkReleaseRef(root, {})).resolves.toEqual({
          version,
          tag: `v${version}`,
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it.each([
    ["1.0.1", "2.0.0"],
    ["2.0.1", "2.1.0"],
    ["2.1.0", "2.5.0"],
  ])(
    "rejects package %s with stale release tag %s before native builds",
    async (version, tagVersion) => {
      const root = await fixture(version);
      try {
        await expect(
          checkReleaseRef(root, { GITHUB_REF: `refs/tags/v${tagVersion}` }),
        ).rejects.toThrow(`does not match package.json (${version})`);
        await expect(
          checkReleaseRef(root, { GITHUB_REF: "refs/heads/main" }),
        ).rejects.toThrow(`Run this workflow on v${version}`);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it("requires release notes and a tag in Actions", async () => {
    const root = await fixture("2.0.0", "");
    try {
      await expect(
        checkReleaseRef(root, { GITHUB_ACTIONS: "true" }),
      ).rejects.toThrow("release tag is required");
      await expect(checkReleaseRef(root, {})).rejects.toThrow("empty");
      await rm(join(root, "releases", "2.0.0.md"));
      await expect(checkReleaseRef(root, {})).rejects.toThrow(
        "Add releases/2.0.0.md",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rejects prereleases and malformed stable versions", async () => {
    for (const version of ["2.0.0-rc.1", "02.0.0", "v2.0.0"]) {
      const root = await fixture(version);
      try {
        await expect(checkReleaseRef(root, {})).rejects.toThrow(
          "stable version",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });
});
