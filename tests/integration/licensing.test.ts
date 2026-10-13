import { expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { NodeEncryptedFileStorage } from "@t2e/license-sdk/node";
import productConfig from "../../product.config.json";
import { Licensing } from "../../packages/licensing/src/index";
import { Engine } from "../../services/local-agent/src/engine";
import { ui } from "../helpers";

async function paidFixture(
  features = ["export"],
  productCode = "RS",
  expired = false,
) {
  const root = realpathSync(await mkdtemp(join(tmpdir(), "rs-license-")));
  const data = join(root, "data");
  await mkdir(data);
  const signer = generateKeyPairSync("ed25519"),
    device = generateKeyPairSync("ed25519");
  const key = randomBytes(32);
  const config = {
    ...productConfig,
    licenseJwks: {
      keys: [
        {
          ...signer.publicKey.export({ format: "jwk" }),
          kid: "test",
          alg: "EdDSA",
          use: "sig",
        },
      ],
    },
  };
  const storage = new NodeEncryptedFileStorage(
    join(data, "license-sdk.enc"),
    "RS",
    { current: async () => ({ id: "os-v1", key }), get: async () => key },
    config.appId,
  );
  const now = Date.now(),
    grace = now + (expired ? -120000 : 300000);
  const claims = {
    productCode,
    activationId: "fixture-activation",
    entitlementId: "fixture-entitlement",
    licenseId: "fixture-license",
    entitlementVersion: 1,
    enforcementMode: "DEVICE",
    deviceThumbprint: createHash("sha256")
      .update(device.publicKey.export({ type: "spki", format: "der" }))
      .digest("base64url"),
    refreshAt: new Date(expired ? grace - 60000 : now + 60000).toISOString(),
    offlineGraceExpiresAt: new Date(grace).toISOString(),
    features,
    iss: config.licenseIssuer,
    aud: "t2etech-products",
    sub: "fixture-activation",
    iat: Math.floor(now / 1000),
    exp: Math.floor(grace / 1000),
  };
  const header = Buffer.from(
      JSON.stringify({ alg: "EdDSA", kid: "test" }),
    ).toString("base64url"),
    payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const token =
    header +
    "." +
    payload +
    "." +
    sign(null, Buffer.from(header + "." + payload), signer.privateKey).toString(
      "base64url",
    );
  await storage.save({
    version: 1,
    productCode: "RS",
    pending: [],
    license: {
      deviceId: "fixture-device",
      publicKey: device.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      privateKey: device.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      activationId: "fixture-activation",
      entitlement: token,
    },
  });
  await storage.dispose();
  const authority = new Licensing(data, () => {}, {
    config,
    fetch: async () => {
      throw new Error("offline fixture");
    },
  });
  await authority.initialize(key.toString("base64"));
  return {
    root,
    data,
    key,
    config,
    authority,
    cleanup: async () => {
      await authority.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}
it("verifies signed paid claims and enforces both UI and MCP writes; encrypted license survives restart", async () => {
  const f = await paidFixture();
  const engine = new Engine(f.data, "a".repeat(64), () => {}, f.authority);
  let closed = false;
  try {
    expect(await f.authority.status()).toMatchObject({
      valid: true,
      tier: "PAID",
      activated: true,
    });
    const folder = join(f.root, "project");
    await mkdir(folder);
    const [ws] = await engine.request("workspace.add", { paths: [folder] }, ui);
    await engine.request(
      "workspace.update",
      { id: ws.id, accessMode: "full" },
      ui,
    );
    const result = await engine.request(
      "file.propose",
      {
        workspaceId: ws.id,
        path: "proof.txt",
        content: "authorized",
        expectedHash: null,
      },
      ui,
    );
    expect(result.status).toBe("applied");
    expect(await readFile(join(folder, "proof.txt"), "utf8")).toBe(
      "authorized",
    );
    const encrypted = await readFile(join(f.data, "license-sdk.enc"), "utf8");
    expect(encrypted).not.toContain("fixture-activation");
    expect(encrypted).not.toContain("PRIVATE KEY");
    await engine.close();
    closed = true;
    const next = new Licensing(f.data, () => {}, {
      config: f.config,
      fetch: async () => {
        throw new Error("offline");
      },
    });
    await next.initialize(f.key.toString("base64"));
    expect(await next.status()).toMatchObject({ valid: true, activated: true });
    await next.dispose();
  } finally {
    if (!closed) await engine.close();
    await f.cleanup();
  }
});
it("rejects absent, expired, wrong-product and missing-feature licenses before side effects", async () => {
  for (const [features, product, expired] of [
    [[], "RS", false],
    [["export"], "PC", false],
    [["export"], "RS", true],
  ] as const) {
    const f = await paidFixture([...features], product, expired);
    let called = false;
    try {
      await expect(
        f.authority.run(async () => {
          called = true;
        }),
      ).rejects.toThrow();
      expect(called).toBe(false);
    } finally {
      await f.cleanup();
    }
  }
  const root = realpathSync(await mkdtemp(join(tmpdir(), "rs-unlicensed-")));
  const engine = new Engine(join(root, "data"), "a".repeat(64), () => {});
  try {
    const folder = join(root, "project");
    await mkdir(folder);
    const [ws] = await engine.request("workspace.add", { paths: [folder] }, ui);
    await engine.request(
      "workspace.update",
      { id: ws.id, write: true, execute: true },
      ui,
    );
    await expect(
      engine.request(
        "file.propose",
        {
          workspaceId: ws.id,
          path: "bad.txt",
          content: "bad",
          expectedHash: null,
        },
        ui,
      ),
    ).rejects.toThrow(/licens/i);
    const { clientId } = await engine.request(
      "connection.create",
      { name: "fixture", workspaceIds: [ws.id], write: true },
      ui,
    );
    const credential = await engine.request("connection.secret", clientId, ui),
      actor = engine.actor(credential.token, "client");
    await expect(
      engine.request(
        "license.initialize",
        { key: randomBytes(32).toString("base64") },
        actor,
      ),
    ).rejects.toThrow("trusted local UI");
    await expect(
      engine.request(
        "tool.call",
        {
          name: "command_execute",
          arguments: {
            workspaceId: ws.id,
            executable: process.execPath,
            args: ["-e", "process.exit(0)"],
          },
        },
        actor,
      ),
    ).rejects.toThrow(/licens/i);
    expect(engine.store.jobs()).toHaveLength(0);
    expect(engine.store.changes()).toHaveLength(0);
    expect(
      await engine.request(
        "tool.call",
        { name: "file_list", arguments: { workspaceId: ws.id } },
        actor,
      ),
    ).toMatchObject({ total: 0 });
  } finally {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("preserves corrupt encrypted storage and creates PKCE requests bound to the registered public client", async () => {
  const f = await paidFixture();
  try {
    const request = await f.authority.login();
    const url = new URL(request.url);
    expect(url.origin).toBe(productConfig.supabaseUrl);
    expect(url.searchParams.get("client_id")).toBe(productConfig.oauthClientId);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      productConfig.oauthRedirectUri,
    );
    await expect(
      f.authority.complete(
        productConfig.oauthRedirectUri + "?state=bad&code=bad",
      ),
    ).rejects.toThrow(/OAUTH_CALLBACK_INVALID/);
    await f.authority.dispose();
    const before = await readFile(join(f.data, "license-sdk.enc"));
    const wrong = new Licensing(f.data, () => {}, { config: f.config });
    await expect(
      wrong.initialize(randomBytes(32).toString("base64")),
    ).rejects.toThrow("DEVICE_STORAGE_INVALID");
    await wrong.dispose();
    expect(await readFile(join(f.data, "license-sdk.enc"))).toEqual(before);
  } finally {
    await f.cleanup();
  }
});
