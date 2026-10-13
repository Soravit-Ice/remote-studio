import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This check has no installed dependencies so CI can reject an invalid release
// before starting the three native build jobs.
export async function checkReleaseRef(
  directory = process.cwd(),
  environment = process.env,
) {
  const { version } = JSON.parse(
    await readFile(resolve(directory, "package.json"), "utf8"),
  );
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Use a stable version such as 0.1.0 for Store releases.");
  const tag = `v${version}`,
    expectedRef = `refs/tags/${tag}`;
  if (environment.GITHUB_REF && environment.GITHUB_REF !== expectedRef)
    throw new Error(
      `Release ref ${environment.GITHUB_REF} does not match package.json (${version}). Run this workflow on ${tag}, created from the commit with package version ${version}.`,
    );
  if (environment.GITHUB_ACTIONS === "true" && !environment.GITHUB_REF)
    throw new Error("A GitHub release tag is required in Actions.");
  let notes;
  try {
    notes = await readFile(
      resolve(directory, "releases", `${version}.md`),
      "utf8",
    );
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error(`Add releases/${version}.md before creating ${tag}.`);
    throw error;
  }
  if (!notes.trim()) throw new Error(`Release notes for ${tag} are empty.`);
  return { version, tag };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(JSON.stringify(await checkReleaseRef()));
