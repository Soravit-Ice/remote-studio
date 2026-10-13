import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  uploadGithubRelease,
  githubUploadFailure,
} from "../../scripts/upload-github-release.mjs";
import { uploadRelease } from "../../scripts/release-upload.mjs";

const digest = (b) => createHash("sha256").update(b).digest("hex");
let dir, manifest, input, assets, release, fetcher;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "github-uploader-"));
  await writeFile(join(dir, "app.dmg"), "fixture");
  manifest = {
    productCode: "PC",
    version: "1.0.0",
    channel: "STABLE",
    releaseNotes: "Verified installer",
    artifacts: [
      {
        fileName: "app.dmg",
        fileSize: 7,
        sha256: digest("fixture"),
        mimeType: "application/x-apple-diskimage",
        deliveryType: "DESKTOP_INSTALLER",
        platform: "MACOS",
        architecture: "ARM64",
        codeSigned: false,
        notarized: false,
      },
    ],
  };
  input = {
    repository: "owner/downloads",
    sourceRepository: "owner/source",
    sourceRef: "refs/tags/v1.0.0",
    token: "fixture-secret",
    manifestPath: join(dir, "release-manifest.json"),
  };
  assets = [];
  release = null;
  fetcher = vi.fn(async (url, options) => {
    const u = new URL(url);
    expect(["api.github.com", "uploads.github.com"]).toContain(u.hostname);
    expect(options.redirect).toBe("error");
    expect(options.headers.authorization).toBe("Bearer fixture-secret");
    if (u.hostname === "uploads.github.com") {
      expect(release.draft).toBe(true);
      const chunks = [];
      for await (const b of options.body)
        chunks.push(typeof b === "number" ? Buffer.from([b]) : Buffer.from(b));
      const bytes = Buffer.concat(chunks);
      const a = {
        id: assets.length + 1,
        name: u.searchParams.get("name"),
        size: bytes.length,
        state: "uploaded",
        digest: "sha256:" + digest(bytes),
      };
      assets.push(a);
      return Response.json(a);
    }
    if (u.pathname.endsWith("/immutable-releases"))
      return Response.json({ enabled: true });
    if (u.pathname.endsWith("/releases/tags/v1.0.0"))
      return release && !release.draft
        ? Response.json(release)
        : Response.json({}, { status: 404 });
    if (u.pathname.endsWith("/releases") && options.method === "GET")
      return Response.json(release ? [release] : []);
    if (u.pathname.endsWith("/releases") && options.method === "POST") {
      release = { ...JSON.parse(options.body), id: 42, immutable: false };
      return Response.json(release, { status: 201 });
    }
    if (u.pathname.endsWith("/assets")) return Response.json(assets);
    if (options.method === "PATCH") {
      release = { ...release, draft: false, immutable: true };
      return Response.json(release);
    }
    return Response.json({ id: 123, private: false, visibility: "public" });
  });
  await writeFile(input.manifestPath, JSON.stringify(manifest));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
describe("immutable GitHub uploader", () => {
  it("uploads exact bytes, manifest and checksums before locking the release; reruns reuse every asset", async () => {
    const first = await uploadGithubRelease(input, fetcher);
    expect(first).toMatchObject({ tag: "v1.0.0", releaseId: "42" });
    expect(assets.map((a) => a.name)).toEqual([
      "app.dmg",
      "release-manifest.json",
      "SHA256SUMS",
    ]);
    const writes = fetcher.mock.calls.filter(([, o]) =>
      ["POST", "PATCH"].includes(o.method),
    ).length;
    await uploadGithubRelease(input, fetcher);
    expect(
      fetcher.mock.calls.filter(([, o]) =>
        ["POST", "PATCH"].includes(o.method),
      ),
    ).toHaveLength(writes);
  });
  it("resumes an existing draft without creating another release", async () => {
    release = {
      id: 42,
      tag_name: "v1.0.0",
      draft: true,
      prerelease: false,
      immutable: false,
    };
    await uploadGithubRelease(input, fetcher);
    expect(
      fetcher.mock.calls.some(
        ([u, o]) =>
          new URL(u).pathname.endsWith("/releases") && o.method === "POST",
      ),
    ).toBe(false);
  });
  it("refuses a private repository and a repository shared with the source", async () => {
    await expect(
      uploadGithubRelease({ ...input, repository: "owner/source" }, fetcher),
    ).rejects.toThrow("GITHUB_UPLOAD_REPOSITORY_INVALID");
    await expect(
      uploadGithubRelease(input, async () =>
        Response.json({ id: 123, private: true, visibility: "private" }),
      ),
    ).rejects.toThrow("GITHUB_UPLOAD_REPOSITORY_PRIVATE");
  });
  it("checks local bytes before making any external writes", async () => {
    await writeFile(join(dir, "app.dmg"), "wrong!!");
    await expect(uploadGithubRelease(input, fetcher)).rejects.toThrow(
      "GITHUB_UPLOAD_CHECKSUM_MISMATCH",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never replaces an existing asset with the same name but different bytes", async () => {
    release = {
      id: 42,
      tag_name: "v1.0.0",
      draft: true,
      prerelease: false,
      immutable: false,
    };
    assets = [
      {
        name: "app.dmg",
        size: 7,
        state: "uploaded",
        digest: "sha256:" + digest("wrong!!"),
      },
    ];
    await expect(uploadGithubRelease(input, fetcher)).rejects.toThrow(
      "GITHUB_UPLOAD_EXISTING_ASSET_MISMATCH",
    );
    expect(
      fetcher.mock.calls.some(
        ([, o]) => o.method === "PATCH" || o.method === "DELETE",
      ),
    ).toBe(false);
  });
  it("refuses unexpected files in a draft and sanitizes credential-bearing failures", async () => {
    release = {
      id: 42,
      tag_name: "v1.0.0",
      draft: true,
      prerelease: false,
      immutable: false,
    };
    assets = [{ name: "private-source.zip" }];
    await expect(uploadGithubRelease(input, fetcher)).rejects.toThrow(
      "GITHUB_UPLOAD_UNEXPECTED_ASSET",
    );
    expect(githubUploadFailure(new Error("fetch Bearer fixture-secret"))).toBe(
      "GITHUB_UPLOAD_UNEXPECTED",
    );
  });
  it("registers GitHub assets with fresh source OIDC tokens and never requests R2 upload authorization", async () => {
    const artifactPath = join(dir, "artifacts.json");
    await writeFile(artifactPath, JSON.stringify(manifest.artifacts));
    const calls = [];
    const f = vi.fn(async (url, options) => {
      const u = new URL(url);
      calls.push(u.pathname);
      if (u.hostname.endsWith(".actions.githubusercontent.com"))
        return Response.json({ value: "oidc-fixture" });
      expect(options.headers.authorization).toBe("Bearer oidc-fixture");
      if (u.pathname.endsWith("/start"))
        return Response.json({
          data: { sessionId: "11111111-1111-4111-8111-111111111111" },
        });
      if (u.pathname.endsWith("/github"))
        expect(JSON.parse(options.body)).toMatchObject({
          tag: "v1.0.0",
          manifest: {
            productCode: "PC",
            artifacts: [
              expect.objectContaining({ sha256: manifest.artifacts[0].sha256 }),
            ],
          },
        });
      return Response.json({ data: { status: "VERIFYING" } });
    });
    const result = await uploadRelease(
      {
        origin: "https://store.example.test",
        productCode: "PC",
        version: "1.0.0",
        tag: "refs/tags/v1.0.0",
        commitSha: "a".repeat(40),
        manifestPath: artifactPath,
        githubTag: "v1.0.0",
        environment: {
          ACTIONS_ID_TOKEN_REQUEST_URL:
            "https://token.actions.githubusercontent.com/token",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fixture",
        },
      },
      f,
    );
    expect(result).toMatchObject({
      storageProvider: "GITHUB_RELEASES",
      published: false,
    });
    expect(calls.some((p) => p.endsWith("/authorize"))).toBe(false);
  });
});
