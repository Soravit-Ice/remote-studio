import { createReadStream } from "node:fs";
import { readFile, readdir, lstat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function createReleaseManifest(
  directory,
  version,
  platform,
  architecture,
  signing = { codeSigned: false, notarized: false },
) {
  if (
    !/^\d+\.\d+\.\d+$/.test(version) ||
    !["darwin", "win32"].includes(platform) ||
    !["arm64", "x64"].includes(architecture) ||
    (platform === "win32" && architecture !== "x64")
  )
    throw new Error("Unsupported release target/version.");
  const extension = platform === "darwin" ? ".dmg" : ".exe";
  const expectedName = `remote-studio-${version}-${platform === "darwin" ? "mac" : "win"}-${architecture}${extension}`;
  const files = (await readdir(directory)).filter(
    (name) => name === expectedName,
  );
  if (files.length !== 1)
    throw new Error("Expected exactly one installer for this version/target.");
  const fileName = files[0],
    path = join(directory, fileName),
    details = await lstat(path);
  if (!details.isFile() || details.size < 1 || details.size > 8 * 1024 ** 3)
    throw new Error("Installer size/type invalid.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const entries = [
    {
      fileName,
      fileSize: details.size,
      sha256: hash.digest("hex"),
      deliveryType: "DESKTOP_INSTALLER",
      platform: platform === "darwin" ? "MACOS" : "WINDOWS",
      architecture: architecture.toUpperCase(),
      mimeType:
        platform === "darwin"
          ? "application/x-apple-diskimage"
          : "application/vnd.microsoft.portable-executable",
      codeSigned: signing.codeSigned === true,
      notarized: platform === "darwin" && signing.notarized === true,
    },
  ];
  const manifestPath = join(
    directory,
    `artifacts-${platform}-${architecture}.json`,
  );
  await writeFile(manifestPath, JSON.stringify(entries, null, 2) + "\n");
  return { manifestPath, entries };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const result = await createReleaseManifest(
    resolve("release"),
    pkg.version,
    process.platform,
    process.arch,
  );
  console.log(JSON.stringify(result));
}
