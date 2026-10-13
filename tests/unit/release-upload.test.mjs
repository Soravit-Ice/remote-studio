import { describe, it, expect, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  uploadRelease,
  releaseUploadFailure,
} from "../../scripts/release-upload.mjs";

describe("release uploader", () => {
  it("logs only bounded diagnostics and never error text containing credentials", () => {
    expect(releaseUploadFailure(new Error("RELEASE_API_403"))).toBe(
      "RELEASE_API_403",
    );
    expect(
      releaseUploadFailure(new Error("RELEASE_API_403_RESPONSE_INVALID")),
    ).toBe("RELEASE_API_403_RESPONSE_INVALID");
    expect(releaseUploadFailure(new Error("ARTIFACT_CHECKSUM_MISMATCH"))).toBe(
      "ARTIFACT_CHECKSUM_MISMATCH",
    );
    expect(
      releaseUploadFailure(
        new Error("fetch https://storage.example/file?token=private-secret"),
      ),
    ).toBe("RELEASE_UPLOAD_UNEXPECTED");
    expect(releaseUploadFailure({ message: "Bearer private-secret" })).toBe(
      "RELEASE_UPLOAD_UNEXPECTED",
    );
  });
  it.each([
    {
      deliveryType: "DESKTOP_INSTALLER",
      platform: "WINDOWS",
      architecture: "X64",
    },
    {
      deliveryType: "DESKTOP_INSTALLER",
      platform: "MACOS",
      architecture: "ARM64",
    },
  ])(
    "uploads $platform unsigned files with OIDC and queues verification without publishing",
    async (target) => {
      const directory = await mkdtemp(join(tmpdir(), "t2e-release-upload-"));
      await writeFile(join(directory, "skill.zip"), "fixture");
      await writeFile(
        join(directory, "artifacts.json"),
        JSON.stringify([
          {
            fileName: "skill.zip",
            ...target,
            mimeType: "application/zip",
            codeSigned: false,
            notarized: false,
          },
        ]),
      );
      const calls = [];
      const fetcher = vi.fn(async (url, options) => {
        const u = new URL(String(url));
        calls.push([u.pathname, options]);
        expect(options.redirect).toBe("error");
        if (u.hostname.includes("actions.githubusercontent.com")) {
          expect(u.searchParams.get("audience")).toBe("t2etech-release-api");
          return Response.json({ value: "fixture-oidc-token" });
        }
        if (u.hostname.endsWith(".r2.cloudflarestorage.com")) {
          expect(options.headers["if-none-match"]).toBe("*");
          let contents = "";
          for await (const chunk of options.body) contents += chunk.toString();
          expect(contents).toBe("fixture");
          return new Response("", { headers: { etag: "fixture-etag" } });
        }
        expect(options.headers.authorization).toBe("Bearer fixture-oidc-token");
        if (u.pathname.endsWith("/start"))
          return Response.json({
            data: { sessionId: "11111111-1111-4111-8111-111111111111" },
          });
        if (u.pathname.endsWith("/authorize")) {
          expect(JSON.parse(options.body).fileSize).toBe(7);
          expect(JSON.parse(options.body)).toMatchObject({
            ...target,
            codeSigned: false,
            notarized: false,
          });
          expect(JSON.parse(options.body).sha256).toMatch(/^[a-f0-9]{64}$/);
          return Response.json({
            data: {
              artifactId: "22222222-2222-4222-8222-222222222222",
              mode: "single",
              url: "https://account.r2.cloudflarestorage.com/object?secret=bearer",
            },
          });
        }
        return Response.json({ data: { status: "VERIFYING" } });
      });
      try {
        const result = await uploadRelease(
          {
            origin: "https://store.example.test",
            productCode: "PC",
            version: "1.0.0",
            tag: "refs/tags/v1.0.0",
            commitSha: "a".repeat(40),
            manifestPath: join(directory, "artifacts.json"),
            environment: {
              ACTIONS_ID_TOKEN_REQUEST_URL:
                "https://pipelines.actions.githubusercontent.com/token",
              ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
            },
          },
          fetcher,
        );
        expect(result.published).toBe(false);
        expect(calls.every(([path]) => !path.includes("publish"))).toBe(true);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it("rejects source paths and checksum mismatches before any API request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "t2e-release-upload-")),
      fetcher = vi.fn();
    const input = {
      origin: "https://store.example.test",
      productCode: "PC",
      version: "1.0.0",
      tag: "refs/tags/v1.0.0",
      commitSha: "a".repeat(40),
      manifestPath: join(directory, "artifacts.json"),
      environment: {
        ACTIONS_ID_TOKEN_REQUEST_URL:
          "https://pipelines.actions.githubusercontent.com/token",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
      },
    };
    try {
      await writeFile(
        join(directory, "artifacts.json"),
        JSON.stringify([
          { fileName: "../secret.pem", deliveryType: "DESKTOP_INSTALLER" },
        ]),
      );
      await expect(uploadRelease(input, fetcher)).rejects.toThrow(
        "ARTIFACT_MANIFEST_INVALID",
      );
      await writeFile(join(directory, "test.exe"), "fixture");
      await writeFile(
        join(directory, "artifacts.json"),
        JSON.stringify([
          {
            fileName: "test.exe",
            deliveryType: "DESKTOP_INSTALLER",
            platform: "WINDOWS",
            architecture: "X64",
            codeSigned: false,
            sha256: "0".repeat(64),
          },
        ]),
      );
      await expect(uploadRelease(input, fetcher)).rejects.toThrow(
        "ARTIFACT_CHECKSUM_MISMATCH",
      );
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("identifies Cloudflare challenges without logging the response body or uploading files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "t2e-release-challenge-"));
    const progress = vi.fn();
    const fetcher = vi.fn(async (url) =>
      String(url).includes("actions.githubusercontent.com")
        ? Response.json({ value: "fixture-oidc-token" })
        : new Response("<html>private response body</html>", {
            status: 403,
            headers: { "cf-mitigated": "challenge", server: "cloudflare" },
          }),
    );
    try {
      await writeFile(join(directory, "test.dmg"), "fixture");
      await writeFile(
        join(directory, "artifacts.json"),
        JSON.stringify([
          { fileName: "test.dmg", deliveryType: "DESKTOP_INSTALLER" },
        ]),
      );
      const error = await uploadRelease(
        {
          origin: "https://store.example.test",
          productCode: "PC",
          version: "1.0.0",
          tag: "refs/tags/v1.0.0",
          commitSha: "a".repeat(40),
          manifestPath: join(directory, "artifacts.json"),
          onProgress: progress,
          environment: {
            ACTIONS_ID_TOKEN_REQUEST_URL:
              "https://pipelines.actions.githubusercontent.com/token",
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
          },
        },
        fetcher,
      ).catch((failure) => failure);
      expect(releaseUploadFailure(error)).toBe(
        "RELEASE_API_CLOUDFLARE_CHALLENGE",
      );
      expect(progress).toHaveBeenCalledWith(
        "store_response_403_cloudflare_challenge",
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
