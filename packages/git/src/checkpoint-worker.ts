import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { rmSync } from "node:fs";
const input = JSON.parse(process.argv[2]),
  index = join(
    process.env.TMPDIR ?? process.env.TEMP ?? process.cwd(),
    "git-checkpoint-" + input.id,
  );
const env = {
  ...process.env,
  GIT_INDEX_FILE: index,
  GIT_AUTHOR_NAME: "Remote Studio",
  GIT_AUTHOR_EMAIL: "checkpoint@remote-studio.local",
  GIT_COMMITTER_NAME: "Remote Studio",
  GIT_COMMITTER_EMAIL: "checkpoint@remote-studio.local",
};
const git = (args: string[], stdin?: string) =>
  execFileSync(
    "git",
    ["-c", "core.hooksPath=", "-c", "core.fsmonitor=false", ...args],
    {
      cwd: process.cwd(),
      env,
      input: stdin,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
try {
  let parent: string | null = null;
  try {
    parent = git(["rev-parse", "--verify", "HEAD"]);
  } catch {
    /* Unborn branch. */
  }
  git(["read-tree", parent ?? "--empty"]);
  git(["add", "--", ...input.paths]);
  const tree = git(["write-tree"]),
    commit = git(
      ["commit-tree", tree, ...(parent ? ["-p", parent] : [])],
      input.message + "\n",
    );
  git(["update-ref", "refs/remote-studio/checkpoints/" + input.id, commit]);
  console.log(
    JSON.stringify({
      checkpointId: input.id,
      commit,
      ref: "refs/remote-studio/checkpoints/" + input.id,
      paths: input.paths,
    }),
  );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  rmSync(index, { force: true });
  rmSync(index + ".lock", { force: true });
}
