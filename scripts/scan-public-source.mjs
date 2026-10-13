import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
// Exact synthetic keys used exclusively by temporary loopback tunnel fixtures.
const fixtureHashes = {
  "tests/e2e/tunnel.spec.ts": [
    "f5df9cad1d473808644ed49c5800e3fc1d36fad78c6a223579717999089deab6",
  ],
  "tests/integration/tunnel-runtime.test.ts": [
    "1d4e9dd4750a84453c483788cde8ca6b3618d841bdce5a7c2bdd261f198d1fce",
  ],
  "tests/integration/tunnel.test.ts": [
    "a9bd76a8bed844b28c06dac375326326aba8092e85c04db8d74b78f052572227",
  ],
};
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const forbidden = [
  /^\.env(?:$|\.)/,
  /(?:^|\/)(?:\.keys|\.ssh|active-code|clients|node_modules|out|dist|release|test-results|test-artifacts)\//,
  /\.(?:sqlite(?:-wal|-shm)?|p12|pfx|pem|key|enc)$/i,
];
const secrets = [
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/,
  /\b(?:sk_live_|sk_test_|sb_secret_)[A-Za-z0-9]{16,}/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/,
  /postgres(?:ql)?:\/\/[^\s:'"/]+:[^\s@'"/]+@(?!localhost|127\.0\.0\.1)/,
];
const issues = [];
for (const file of files) {
  if (forbidden.some((pattern) => pattern.test(file))) {
    issues.push(file + ": forbidden private/runtime file");
    continue;
  }
  if (file === "vendor/t2e-license-sdk-1.0.0-rc.1.tgz") continue;
  const source = await readFile(file);
  const bytes = file.endsWith(".docx")
    ? Buffer.from(
        unzipSync(source, {
          filter: (entry) => entry.name === "word/document.xml",
        })["word/document.xml"],
      )
    : source;
  if (bytes.includes(0)) continue;
  let text = bytes.toString("utf8");
  for (const digest of fixtureHashes[file] ?? []) {
    text = text.replace(/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g, (key) =>
      createHash("sha256").update(key).digest("hex") === digest
        ? "APPROVED_LOOPBACK_FIXTURE"
        : key,
    );
  }
  if (secrets.some((pattern) => pattern.test(text)))
    issues.push(file + ": credential-like content; inspect locally");
}
if (issues.length) {
  console.error(issues.join("\n"));
  process.exit(1);
}
console.log(
  `Public source scan passed (${files.length} files). SDK archive publication is explicitly authorized; no runtime state or credentials are included.`,
);
