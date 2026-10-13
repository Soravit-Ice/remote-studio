import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { ProductSdkConfigSchema } from "@t2e/license-sdk/contracts";
const config = ProductSdkConfigSchema.parse(
  JSON.parse(await readFile("product.config.json", "utf8")),
);
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (
  config.productCode !== "RS" ||
  config.appId !== "com.t2etech.remotestudio" ||
  pkg.build.appId !== config.appId ||
  config.trialEnabled ||
  config.runtime !== "electron"
)
  throw new Error(
    "Remote Studio product identity must match its paid Store configuration.",
  );
if (!/^\d+\.\d+\.\d+$/.test(pkg.version))
  throw new Error("Use a numeric Store release version.");
if (
  config.oauthRedirectUri !== config.appId + "://oauth/callback" ||
  !pkg.build.protocols.some((p) => p.schemes.includes(config.appId))
)
  throw new Error(
    "Register the exact Remote Studio OAuth callback and installer protocol.",
  );
execFileSync(
  process.execPath,
  [
    "vendor/verify-package.mjs",
    "vendor/manifest.json",
    "vendor/manifest.sig",
    "vendor/sdk-release-public-key.json",
  ],
  { stdio: "inherit" },
);
const manifest = JSON.parse(await readFile("vendor/manifest.json", "utf8"));
if (
  manifest.version !== config.sdkVersion ||
  pkg.dependencies["@t2e/license-sdk"] !== "file:vendor/" + manifest.fileName
)
  throw new Error(
    "SDK dependency, signed manifest and product configuration must agree.",
  );
if (process.argv.includes("--signed")) {
  const platform =
    process.argv[process.argv.indexOf("--platform") + 1] ?? process.platform;
  if (platform === "darwin" && !config.installerPublishers.macTeamIds.length)
    throw new Error(
      "Signed Mac release requires the actual Apple Team ID in product.config.json.",
    );
  if (
    platform === "win32" &&
    !config.installerPublishers.windowsSpkiSha256.length
  )
    throw new Error(
      "Signed Windows release requires the actual signer SPKI SHA-256 pin in product.config.json.",
    );
  if (!["darwin", "win32"].includes(platform))
    throw new Error("Select darwin or win32.");
}
console.log(
  "Release source checks passed. Installer signing and real account activation need separate evidence.",
);
