import { readFile } from "node:fs/promises";
import { createHash, createPublicKey, verify } from "node:crypto";
import { resolve, dirname, basename } from "node:path";
const [manifestPath, signaturePath, trustedPublicKeyPath] =
  process.argv.slice(2);
if (!trustedPublicKeyPath)
  throw new Error(
    "Usage: node verify-package.mjs manifest.json manifest.sig TRUSTED-public-key.json",
  );
const payload = await readFile(manifestPath),
  manifest = JSON.parse(payload);
if (
  manifest.schemaVersion !== 1 ||
  manifest.packageName !== "@t2e/license-sdk" ||
  !manifest.signed ||
  typeof manifest.fileName !== "string" ||
  basename(manifest.fileName) !== manifest.fileName ||
  !/^t2e-license-sdk-[0-9A-Za-z.-]+\.tgz$/.test(manifest.fileName)
)
  throw new Error("Invalid signed package manifest");
const jwk = JSON.parse(await readFile(trustedPublicKeyPath, "utf8"));
if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || jwk.d)
  throw new Error("Expected a separately trusted public key");
const key = createPublicKey({ key: jwk, format: "jwk" });
if (
  !verify(
    null,
    payload,
    key,
    Buffer.from((await readFile(signaturePath, "utf8")).trim(), "base64"),
  )
)
  throw new Error("Manifest signature invalid");
const bytes = await readFile(resolve(dirname(manifestPath), manifest.fileName));
if (
  bytes.length !== manifest.size ||
  createHash("sha256").update(bytes).digest("hex") !== manifest.sha256
)
  throw new Error("Package checksum mismatch");
console.log("Verified " + manifest.fileName);
