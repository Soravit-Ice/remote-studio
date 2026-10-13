import { readFile } from "node:fs/promises";
import { uploadRelease, releaseUploadFailure } from "./release-upload.mjs";
import {
  uploadGithubRelease,
  githubUploadFailure,
} from "./upload-github-release.mjs";
try {
  const { version, notes } = JSON.parse(
    await readFile("release/release-metadata.json", "utf8"),
  );
  if (process.env.GITHUB_REF !== `refs/tags/v${version}`)
    throw new Error("Release tag mismatch.");
  if (
    !process.env.T2E_DOWNLOAD_REPOSITORY ||
    !process.env.T2E_GITHUB_RELEASES_TOKEN
  )
    throw new Error("GITHUB_UPLOAD_REPOSITORY_INVALID");
  let githubTag;
  if (process.env.T2E_DOWNLOAD_REPOSITORY) {
    const release = await uploadGithubRelease({
      repository: process.env.T2E_DOWNLOAD_REPOSITORY,
      token: process.env.T2E_GITHUB_RELEASES_TOKEN,
      sourceRepository: process.env.GITHUB_REPOSITORY,
      sourceRef: process.env.GITHUB_REF,
      manifestPath: "release/release-manifest.json",
      onProgress: (name) => console.log("GitHub asset: " + name),
    });
    githubTag = release.tag;
  }
  console.log(
    JSON.stringify(
      await uploadRelease({
        origin: "https://store.t2etech.com",
        productCode: "RS",
        version,
        tag: process.env.GITHUB_REF,
        commitSha: process.env.GITHUB_SHA,
        manifestPath: "release/artifacts.json",
        releaseNotes: notes,
        githubTag,
        onProgress: (stage) => console.log("Store upload stage: " + stage),
      }),
    ),
  );
} catch (error) {
  const code =
    githubUploadFailure(error).startsWith("GITHUB_UPLOAD_") &&
    githubUploadFailure(error) !== "GITHUB_UPLOAD_UNEXPECTED"
      ? githubUploadFailure(error)
      : releaseUploadFailure(error);
  console.error(
    "Store upload failed: " + code + ". Credentials are not logged.",
  );
  if (code === "RELEASE_API_CLOUDFLARE_CHALLENGE")
    console.error(
      "Cloudflare challenged the Store API before backend authorization. Check Security Events and the release guide; browser challenges cannot be completed by CI.",
    );
  process.exitCode = 1;
}
