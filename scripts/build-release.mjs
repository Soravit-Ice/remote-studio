import { execFileSync, spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash, X509Certificate } from "node:crypto";
import { join, resolve } from "node:path";
const platform = process.env.RELEASE_PLATFORM ?? process.platform;
const arch = process.env.RELEASE_ARCH ?? process.arch;
if (
  platform !== process.platform ||
  !["darwin", "win32"].includes(platform) ||
  !["arm64", "x64"].includes(arch) ||
  (platform === "win32" && arch !== "x64")
)
  throw new Error("Use a native Windows x64 or Mac arm64/x64 release runner.");
const signed = process.env.SIGNED_RELEASE === "true";
execFileSync(
  process.execPath,
  [
    "scripts/check-release.mjs",
    ...(signed ? ["--signed", "--platform", platform] : []),
  ],
  { stdio: "inherit" },
);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
if (
  signed &&
  (!process.env.CSC_LINK ||
    !process.env.CSC_KEY_PASSWORD ||
    (platform === "darwin" &&
      (!process.env.APPLE_ID ||
        !process.env.APPLE_APP_SPECIFIC_PASSWORD ||
        !process.env.APPLE_TEAM_ID)))
)
  throw new Error(
    "Signing credentials are incomplete. No unsigned fallback is allowed for a signed release.",
  );
const args = [
  "exec",
  "electron-builder",
  platform === "darwin" ? "--mac" : "--win",
  platform === "darwin" ? "dmg" : "nsis",
  "--" + arch,
  "--publish",
  "never",
];
if (!signed)
  args.push(
    ...(platform === "darwin"
      ? ["-c.mac.identity=null", "-c.mac.notarize=false"]
      : ["-c.win.signAndEditExecutable=false"]),
  );
else if (platform === "darwin") args.push("-c.dmg.sign=true");
// Windows resolves pnpm.cmd using cmd.exe; all arguments are fixed/validated above.
execFileSync(pnpm, args, {
  stdio: "inherit",
  shell: platform === "win32",
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: signed ? "true" : "false",
  },
});
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const ext = platform === "darwin" ? ".dmg" : ".exe";
const expected = `remote-studio-${pkg.version}-${platform === "darwin" ? "mac" : "win"}-${arch}${ext}`;
const files = (await readdir("release")).filter((file) => file === expected);
if (files.length !== 1)
  throw new Error("The expected native installer was not produced.");
if (signed) {
  const config = JSON.parse(await readFile("product.config.json", "utf8"));
  const path = resolve("release", expected);
  try {
    if (platform === "darwin") {
      if (
        !config.installerPublishers.macTeamIds.includes(
          process.env.APPLE_TEAM_ID,
        )
      )
        throw new Error("Publisher pin mismatch");
      const bundle =
        "release/" +
        (arch === "arm64" ? "mac-arm64" : "mac") +
        "/Remote Studio.app";
      const identity = spawnSync(
        "/usr/bin/codesign",
        ["-dv", "--verbose=4", bundle],
        { encoding: "utf8", timeout: 30000 },
      );
      const team = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(
        identity.stderr ?? "",
      )?.[1];
      if (
        identity.status !== 0 ||
        !team ||
        !config.installerPublishers.macTeamIds.includes(team)
      )
        throw new Error("Unexpected app signer");
      execFileSync(
        "/usr/bin/codesign",
        ["--verify", "--deep", "--strict", bundle],
        { timeout: 30000, stdio: ["ignore", "pipe", "pipe"] },
      );
      execFileSync(
        "/usr/bin/xcrun",
        [
          "notarytool",
          "submit",
          path,
          "--apple-id",
          process.env.APPLE_ID,
          "--password",
          process.env.APPLE_APP_SPECIFIC_PASSWORD,
          "--team-id",
          process.env.APPLE_TEAM_ID,
          "--wait",
        ],
        { timeout: 1200000, stdio: ["ignore", "pipe", "pipe"] },
      );
      execFileSync("/usr/bin/xcrun", ["stapler", "staple", path], {
        timeout: 120000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      execFileSync("/usr/bin/xcrun", ["stapler", "validate", path], {
        timeout: 30000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      execFileSync(
        "/usr/sbin/spctl",
        [
          "--assess",
          "--type",
          "open",
          "--context",
          "context:primary-signature",
          path,
        ],
        { timeout: 30000, stdio: ["ignore", "pipe", "pipe"] },
      );
    } else {
      const identity = JSON.parse(
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$s = Get-AuthenticodeSignature -LiteralPath $env:T2E_INSTALLER_PATH; @{ status=$s.Status.ToString(); certificate=[Convert]::ToBase64String($s.SignerCertificate.RawData) } | ConvertTo-Json -Compress",
          ],
          {
            encoding: "utf8",
            timeout: 30000,
            env: { ...process.env, T2E_INSTALLER_PATH: path },
          },
        ),
      );
      const cert = new X509Certificate(
        Buffer.from(identity.certificate, "base64"),
      );
      const pin = createHash("sha256")
        .update(cert.publicKey.export({ type: "spki", format: "der" }))
        .digest("hex");
      if (
        identity.status !== "Valid" ||
        !config.installerPublishers.windowsSpkiSha256.includes(pin)
      )
        throw new Error("Unexpected installer signer");
    }
  } catch {
    throw new Error(
      "Native installer signer/notarization verification failed. No checksum or release draft was produced.",
    );
  }
}
const digest = createHash("sha256")
  .update(await readFile(join("release", expected)))
  .digest("hex");
await writeFile(
  join("release", `checksums-${platform}-${arch}.sha256`),
  `${digest}  ${expected}\n`,
);
console.log(
  `Built ${expected}; signed=${signed}. Draft release requires review before publication.`,
);
