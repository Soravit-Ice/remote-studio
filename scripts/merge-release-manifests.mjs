import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const folder = resolve("release");
const names = (await readdir(folder)).filter((n) =>
  /^artifacts-(darwin|win32)-(arm64|x64)\.json$/.test(n),
);
const targets = JSON.parse(process.env.REMOTE_STUDIO_RELEASE_TARGETS || "[]");
if (!Array.isArray(targets) || names.length !== targets.length || !names.length)
  throw new Error("Missing release target manifest.");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const entries = [];
for (const target of targets) {
  const name = `artifacts-${target.platform}-${target.arch}.json`;
  if (!names.includes(name)) throw new Error("Target manifest mismatch.");
  const manifest = JSON.parse(await readFile(resolve(folder, name), "utf8"));
  const expectedPlatform = target.platform === "darwin" ? "MACOS" : "WINDOWS";
  const expectedName = `remote-studio-${version}-${target.platform === "darwin" ? "mac" : "win"}-${target.arch}.${target.platform === "darwin" ? "dmg" : "exe"}`;
  if (
    manifest.length !== 1 ||
    manifest[0].fileName !== expectedName ||
    manifest[0].platform !== expectedPlatform ||
    manifest[0].architecture !== target.arch.toUpperCase()
  )
    throw new Error("Artifact target/version mismatch.");
  entries.push(manifest[0]);
}
if (new Set(entries.map((e) => e.fileName)).size !== entries.length)
  throw new Error("Duplicate release target.");
await writeFile(
  resolve(folder, "artifacts.json"),
  JSON.stringify(entries, null, 2) + "\n",
);
const notes = await readFile(`releases/${version}.md`, "utf8");
// Write bounded release metadata for the separate upload step, never the public config.
await writeFile(
  resolve(folder, "release-metadata.json"),
  JSON.stringify({ version, notes }),
);
await writeFile(
  resolve(folder, "release-manifest.json"),
  JSON.stringify(
    {
      productCode: "RS",
      version,
      channel: "STABLE",
      releaseNotes: notes,
      artifacts: entries,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Prepared ${entries.length} installer(s) for ${version}.`);
