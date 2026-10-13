import { createReadStream } from "node:fs";
import { open, readFile, lstat } from "node:fs/promises";
import { resolve, dirname, basename, relative } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Only our own bounded error codes may appear in CI logs. Fetch/SDK errors can
// contain bearer tokens or presigned URLs and must never be printed verbatim.
export function releaseUploadFailure(error) {
  const message = error instanceof Error ? error.message : "";
  const codes = new Set([
    "RELEASE_API_ORIGIN_INVALID",
    "RELEASE_IDENTITY_INVALID",
    "GITHUB_OIDC_RUNTIME_REQUIRED",
    "GITHUB_OIDC_UNAVAILABLE",
    "GITHUB_OIDC_INVALID",
    "RELEASE_API_CLOUDFLARE_CHALLENGE",
    "RELEASE_API_VERCEL_CHALLENGE",
    "ARTIFACT_MANIFEST_INVALID",
    "ARTIFACT_PATH_INVALID",
    "ARTIFACT_SIZE_INVALID",
    "ARTIFACT_CHECKSUM_MISMATCH",
    "RELEASE_SESSION_INVALID",
    "R2_UPLOAD_ORIGIN_INVALID",
    "ARTIFACT_ID_INVALID",
    "MULTIPART_MANIFEST_INVALID",
    "ARTIFACT_READ_INCOMPLETE",
    "MULTIPART_ETAG_MISSING",
    "UPLOAD_MODE_INVALID",
  ]);
  return codes.has(message) ||
    /^(RELEASE_API|R2_UPLOAD)_\d{3}(?:_RESPONSE_INVALID)?$/.test(message)
    ? message
    : "RELEASE_UPLOAD_UNEXPECTED";
}

export async function uploadRelease(input, fetcher = globalThis.fetch) {
  const origin = new URL(input.origin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("RELEASE_API_ORIGIN_INVALID");
  if (
    !/^[A-Z0-9]{2,20}$/.test(input.productCode) ||
    !/^\d+\.\d+\.\d+$/.test(input.version) ||
    !/^refs\/tags\//.test(input.tag) ||
    !/^[a-f0-9]{40}$/.test(input.commitSha)
  )
    throw new Error("RELEASE_IDENTITY_INVALID");
  const environment = input.environment ?? process.env;
  const oidcUrl = new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (
    oidcUrl.protocol !== "https:" ||
    !oidcUrl.hostname.endsWith(".actions.githubusercontent.com") ||
    !environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  )
    throw new Error("GITHUB_OIDC_RUNTIME_REQUIRED");
  oidcUrl.searchParams.set("audience", "t2etech-release-api");
  const token = async () => {
    const response = await fetcher(oidcUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: "Bearer " + environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
      },
    });
    if (!response.ok) throw new Error("GITHUB_OIDC_UNAVAILABLE");
    const value = await response.json();
    if (typeof value.value !== "string") throw new Error("GITHUB_OIDC_INVALID");
    return value.value;
  };
  const api = async (path, body = {}) => {
    input.onProgress?.("store_request");
    const response = await fetcher(new URL(path, origin), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + (await token()),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const source =
        response.headers.get("cf-mitigated") === "challenge"
          ? "cloudflare_challenge"
          : response.headers.get("x-vercel-mitigated") === "challenge"
            ? "vercel_challenge"
            : response.headers.get("server") === "cloudflare"
              ? "cloudflare"
              : "origin";
      input.onProgress?.("store_response_" + response.status + "_" + source);
      if (source === "cloudflare_challenge")
        throw new Error("RELEASE_API_CLOUDFLARE_CHALLENGE");
      if (source === "vercel_challenge")
        throw new Error("RELEASE_API_VERCEL_CHALLENGE");
    }
    let value;
    try {
      value = await response.json();
    } catch {
      throw new Error("RELEASE_API_" + response.status + "_RESPONSE_INVALID");
    }
    if (!response.ok || !value.data)
      throw new Error("RELEASE_API_" + response.status);
    return value.data;
  };
  const manifestPath = resolve(input.manifestPath),
    directory = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 20)
    throw new Error("ARTIFACT_MANIFEST_INVALID");
  const files = [];
  input.onProgress?.("checking_manifest");
  for (const item of manifest) {
    if (
      !item ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(item.fileName) ||
      !["DESKTOP_INSTALLER", "SKILL_BUNDLE"].includes(item.deliveryType)
    )
      throw new Error("ARTIFACT_MANIFEST_INVALID");
    const path = resolve(directory, item.fileName);
    if (
      relative(directory, path).startsWith("..") ||
      basename(path) !== item.fileName
    )
      throw new Error("ARTIFACT_PATH_INVALID");
    const details = await lstat(path);
    if (!details.isFile() || details.size < 1 || details.size > 8 * 1024 ** 3)
      throw new Error("ARTIFACT_SIZE_INVALID");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    if (item.sha256 && item.sha256 !== sha256)
      throw new Error("ARTIFACT_CHECKSUM_MISMATCH");
    files.push({ path, metadata: { ...item, sha256, fileSize: details.size } });
  }
  input.onProgress?.("manifest_checked");
  const session = await api("/internal/v1/releases/start", {
    productCode: input.productCode,
    version: input.version,
    channel: input.channel ?? "STABLE",
    tag: input.tag,
    commitSha: input.commitSha,
    releaseNotes: input.releaseNotes ?? "",
  });
  if (!/^[a-f0-9-]{36}$/.test(session.sessionId))
    throw new Error("RELEASE_SESSION_INVALID");
  if (input.githubTag) {
    await api("/internal/v1/releases/" + session.sessionId + "/github", {
      tag: input.githubTag,
      manifest: {
        productCode: input.productCode,
        version: input.version,
        channel: input.channel ?? "STABLE",
        releaseNotes: input.releaseNotes ?? "",
        artifacts: files.map((file) => file.metadata),
      },
    });
    await api("/internal/v1/releases/" + session.sessionId + "/complete");
    return {
      sessionId: session.sessionId,
      submittedForVerification: true,
      published: false,
      storageProvider: "GITHUB_RELEASES",
    };
  }
  const put = async (url, body, headers) => {
    const location = new URL(url);
    if (
      location.protocol !== "https:" ||
      !location.hostname.endsWith(".r2.cloudflarestorage.com")
    )
      throw new Error("R2_UPLOAD_ORIGIN_INVALID");
    const response = await fetcher(location, {
      method: "PUT",
      body,
      headers,
      duplex: "half",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error("R2_UPLOAD_" + response.status);
    return response.headers.get("etag");
  };
  for (const file of files) {
    const upload = await api(
      "/internal/v1/releases/" + session.sessionId + "/artifacts/authorize",
      file.metadata,
    );
    if (!/^[a-f0-9-]{36}$/.test(upload.artifactId))
      throw new Error("ARTIFACT_ID_INVALID");
    let complete = {};
    if (upload.mode === "single") {
      await put(upload.url, createReadStream(file.path), {
        "content-type": file.metadata.mimeType,
        "content-length": String(file.metadata.fileSize),
        "if-none-match": "*",
      });
    } else if (
      upload.mode === "multipart" &&
      upload.partSize === 64 * 1024 ** 2 &&
      upload.parts?.length ===
        Math.ceil(file.metadata.fileSize / upload.partSize)
    ) {
      const handle = await open(file.path, "r"),
        parts = [];
      try {
        for (let index = 0; index < upload.parts.length; index++) {
          const part = upload.parts[index];
          if (part.partNumber !== index + 1)
            throw new Error("MULTIPART_MANIFEST_INVALID");
          const length = Math.min(
            upload.partSize,
            file.metadata.fileSize - index * upload.partSize,
          );
          const bytes = Buffer.alloc(length),
            result = await handle.read(
              bytes,
              0,
              length,
              index * upload.partSize,
            );
          if (result.bytesRead !== length)
            throw new Error("ARTIFACT_READ_INCOMPLETE");
          const etag = await put(part.url, bytes, {
            "content-length": String(length),
          });
          if (!etag) throw new Error("MULTIPART_ETAG_MISSING");
          parts.push({ partNumber: part.partNumber, etag });
        }
      } finally {
        await handle.close();
      }
      complete = { multipartUploadId: upload.uploadId, parts };
    } else throw new Error("UPLOAD_MODE_INVALID");
    await api(
      "/internal/v1/releases/" +
        session.sessionId +
        "/artifacts/" +
        upload.artifactId +
        "/complete",
      complete,
    );
  }
  await api("/internal/v1/releases/" + session.sessionId + "/complete");
  return {
    sessionId: session.sessionId,
    submittedForVerification: true,
    published: false,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await uploadRelease({
      origin: process.env.T2E_RELEASE_API_ORIGIN,
      productCode: process.env.T2E_PRODUCT_CODE,
      version: process.env.T2E_RELEASE_VERSION,
      tag: process.env.GITHUB_REF,
      commitSha: process.env.GITHUB_SHA,
      manifestPath: process.argv[2],
      releaseNotes: process.env.T2E_RELEASE_NOTES ?? "",
    });
    console.log(JSON.stringify(result)); // IDs/status only; never OIDC tokens or presigned URLs.
  } catch (error) {
    console.error(
      "Release upload failed: " +
        releaseUploadFailure(error) +
        ". Credentials and signed URLs are not logged.",
    );
    process.exitCode = 1;
  }
}
