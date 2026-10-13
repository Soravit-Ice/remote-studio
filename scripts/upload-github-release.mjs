import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpsRequest } from "node:https";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (code) => {
  throw new Error(code);
};
const validRepo = /^[A-Za-z0-9-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
async function streamAsset(url, options) {
  // Use an HTTP/1.1 stream for large files. This avoids buffering installers
  // and fetch implementations that stall a duplex body during release upload.
  return new Promise((resolveResponse, reject) => {
    const req = httpsRequest(
      url,
      { method: "POST", headers: options.headers, signal: options.signal },
      (res) => {
        const chunks = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1024 ** 2) {
            req.destroy();
            reject(new Error("GITHUB_UPLOAD_RESPONSE_TOO_LARGE"));
          } else chunks.push(chunk);
        });
        res.on("error", () => reject(new Error("GITHUB_UPLOAD_NETWORK")));
        res.on("end", () =>
          resolveResponse(
            new Response(Buffer.concat(chunks), { status: res.statusCode }),
          ),
        );
      },
    );
    req.on("error", () => reject(new Error("GITHUB_UPLOAD_NETWORK")));
    options.body.on("error", () =>
      req.destroy(new Error("GITHUB_UPLOAD_NETWORK")),
    );
    options.body.pipe(req);
  });
}
export function githubUploadFailure(error) {
  const code = error instanceof Error ? error.message : "";
  return /^GITHUB_UPLOAD_[A-Z0-9_]+$/.test(code)
    ? code
    : "GITHUB_UPLOAD_UNEXPECTED";
}

// Node-only tooling. Credentials are restricted to the two fixed GitHub hosts
// and never included in errors, release metadata, or application bundles.
export async function uploadGithubRelease(input, fetcher = globalThis.fetch) {
  if (
    !validRepo.test(input.repository ?? "") ||
    !input.token ||
    input.repository.toLowerCase() === input.sourceRepository?.toLowerCase()
  )
    fail("GITHUB_UPLOAD_REPOSITORY_INVALID");
  const manifestPath = resolve(input.manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    !/^[A-Z0-9]{2,20}$/.test(manifest.productCode) ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
      manifest.version,
    ) ||
    !["STABLE", "BETA", "NIGHTLY"].includes(manifest.channel) ||
    typeof manifest.releaseNotes !== "string" ||
    manifest.releaseNotes.length > 50_000 ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length < 1 ||
    manifest.artifacts.length > 3
  )
    fail("GITHUB_UPLOAD_MANIFEST_INVALID");
  if (input.sourceRef && input.sourceRef !== `refs/tags/v${manifest.version}`)
    fail("GITHUB_UPLOAD_TAG_MISMATCH");
  const files = [],
    targets = new Set(),
    names = new Set();
  for (const a of manifest.artifacts) {
    const target = `${a.platform}/${a.architecture}`;
    const mac =
      a.platform === "MACOS" &&
      ["ARM64", "X64"].includes(a.architecture) &&
      a.fileName?.endsWith(".dmg") &&
      a.mimeType === "application/x-apple-diskimage";
    const win =
      a.platform === "WINDOWS" &&
      a.architecture === "X64" &&
      ((a.fileName?.endsWith(".exe") &&
        [
          "application/vnd.microsoft.portable-executable",
          "application/octet-stream",
        ].includes(a.mimeType)) ||
        (a.fileName?.endsWith(".msi") &&
          ["application/x-msi", "application/octet-stream"].includes(
            a.mimeType,
          )));
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(a.fileName) ||
      !/^[a-f0-9]{64}$/.test(a.sha256) ||
      a.deliveryType !== "DESKTOP_INSTALLER" ||
      (!mac && !win) ||
      targets.has(target) ||
      names.has(a.fileName) ||
      typeof a.codeSigned !== "boolean" ||
      typeof a.notarized !== "boolean"
    )
      fail("GITHUB_UPLOAD_MANIFEST_INVALID");
    targets.add(target);
    names.add(a.fileName);
    const path = resolve(dirname(manifestPath), a.fileName),
      details = await lstat(path);
    if (
      basename(path) !== a.fileName ||
      !details.isFile() ||
      details.size < 1 ||
      details.size >= 2 * 1024 ** 3 ||
      details.size !== a.fileSize
    )
      fail("GITHUB_UPLOAD_SIZE_INVALID");
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    if (hash.digest("hex") !== a.sha256)
      fail("GITHUB_UPLOAD_CHECKSUM_MISMATCH");
    files.push({
      name: a.fileName,
      size: a.fileSize,
      digest: a.sha256,
      type: a.mimeType,
      path,
    });
  }
  const publicManifest = {
    productCode: manifest.productCode,
    version: manifest.version,
    channel: manifest.channel,
    releaseNotes: manifest.releaseNotes,
    artifacts: manifest.artifacts.map(
      ({
        fileName,
        deliveryType,
        platform,
        architecture,
        mimeType,
        fileSize,
        sha256,
        codeSigned,
        notarized,
      }) => ({
        fileName,
        deliveryType,
        platform,
        architecture,
        mimeType,
        fileSize,
        sha256,
        codeSigned,
        notarized,
      }),
    ),
  };
  for (const [name, value, type] of [
    [
      "release-manifest.json",
      JSON.stringify(publicManifest, null, 2) + "\n",
      "application/json",
    ],
    [
      "SHA256SUMS",
      files.map((f) => `${f.digest}  ${f.name}\n`).join(""),
      "text/plain",
    ],
  ]) {
    const body = Buffer.from(value);
    files.push({ name, size: body.length, digest: sha(body), type, body });
  }
  const headers = {
    authorization: `Bearer ${input.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2026-03-10",
  };
  const api = async (path, method = "GET", body, optional = false) => {
    const response = await fetcher(
      `https://api.github.com/repos/${input.repository}${path}`,
      {
        method,
        headers: {
          ...headers,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (optional && response.status === 404) return null;
    if (!response.ok) fail(`GITHUB_UPLOAD_API_${response.status}`);
    return response.status === 204 ? undefined : response.json();
  };
  const repo = await api("");
  if (
    repo.private ||
    repo.visibility !== "public" ||
    !Number.isSafeInteger(repo.id)
  )
    fail("GITHUB_UPLOAD_REPOSITORY_PRIVATE");
  const immutable = await api("/immutable-releases");
  if (immutable?.enabled !== true) fail("GITHUB_UPLOAD_IMMUTABILITY_REQUIRED");
  const tag = `v${manifest.version}`;
  let release = await api(
    `/releases/tags/${encodeURIComponent(tag)}`,
    "GET",
    undefined,
    true,
  );
  if (!release)
    release = (await api("/releases?per_page=100")).find(
      (r) => r.tag_name === tag,
    );
  if (!release)
    release = await api("/releases", "POST", {
      tag_name: tag,
      name: `${manifest.productCode} ${manifest.version}`,
      body: manifest.releaseNotes,
      draft: true,
      prerelease: manifest.channel !== "STABLE",
    });
  if (
    !Number.isSafeInteger(release.id) ||
    release.tag_name !== tag ||
    release.prerelease !== (manifest.channel !== "STABLE")
  )
    fail("GITHUB_UPLOAD_RELEASE_CONFLICT");
  if (!release.draft && !release.immutable)
    fail("GITHUB_UPLOAD_IMMUTABILITY_REQUIRED");
  // Published releases are immutable: reruns verify and reuse, never replace.
  const assets = await api(`/releases/${release.id}/assets?per_page=100`);
  if (!Array.isArray(assets)) fail("GITHUB_UPLOAD_ASSETS_INVALID");
  if (assets.some((a) => !files.some((f) => f.name === a.name)))
    fail("GITHUB_UPLOAD_UNEXPECTED_ASSET");
  for (const file of files) {
    input.onProgress?.(file.name);
    let asset = assets.find((a) => a.name === file.name);
    if (!asset) {
      if (!release.draft) fail("GITHUB_UPLOAD_PUBLISHED_ASSET_MISSING");
      const uploadUrl = `https://uploads.github.com/repos/${input.repository}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`;
      const options = {
        method: "POST",
        headers: {
          ...headers,
          "content-type": file.type,
          "content-length": String(file.size),
        },
        body: file.body ?? createReadStream(file.path),
        duplex: "half",
        redirect: "error",
        signal: AbortSignal.timeout(600_000),
      };
      const response =
        file.path && fetcher === globalThis.fetch
          ? await streamAsset(uploadUrl, options)
          : await fetcher(uploadUrl, options);
      if (!response.ok) fail(`GITHUB_UPLOAD_ASSET_${response.status}`);
      asset = await response.json();
    }
    if (
      asset.state !== "uploaded" ||
      asset.size !== file.size ||
      asset.digest !== `sha256:${file.digest}`
    )
      fail("GITHUB_UPLOAD_EXISTING_ASSET_MISMATCH");
  }
  if (release.draft)
    release = await api(`/releases/${release.id}`, "PATCH", { draft: false });
  if (release.draft || !release.immutable)
    fail("GITHUB_UPLOAD_IMMUTABILITY_REQUIRED");
  return {
    repository: input.repository,
    repositoryId: String(repo.id),
    releaseId: String(release.id),
    tag,
    manifest: publicManifest,
    url: `https://github.com/${input.repository}/releases/tag/${encodeURIComponent(tag)}`,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await uploadGithubRelease({
      repository: process.env.T2E_DOWNLOAD_REPOSITORY,
      token: process.env.T2E_GITHUB_RELEASES_TOKEN,
      sourceRepository: process.env.GITHUB_REPOSITORY,
      sourceRef: process.env.GITHUB_REF,
      manifestPath: process.argv[2],
      onProgress: (name) => console.log("Verifying/uploading " + name),
    });
    console.log(
      JSON.stringify({
        repository: result.repository,
        tag: result.tag,
        url: result.url,
      }),
    );
  } catch (error) {
    console.error(githubUploadFailure(error));
    process.exitCode = 1;
  }
}
