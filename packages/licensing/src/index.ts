import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  createLicenseSDKFromConfig,
  LicenseClientError,
  type LicenseSdk,
} from "@t2e/license-sdk";
import { ProductSdkConfigSchema } from "@t2e/license-sdk/contracts";
import { NodeEncryptedFileStorage } from "@t2e/license-sdk/node";
import productConfig from "../../../product.config.json";
import type { LicenseStatus } from "../../contracts/src/index";

export interface LicenseAuthority {
  status(refresh?: boolean): Promise<LicenseStatus>;
  ensure(): Promise<void>;
  run<T>(operation: () => Promise<T>): Promise<T>;
  dispose(): Promise<void>;
}
export class Licensing implements LicenseAuthority {
  readonly config: ReturnType<typeof ProductSdkConfigSchema.parse>;
  private sdk?: LicenseSdk;
  private keyHash?: string;
  private opening?: string;
  private tail: Promise<unknown> = Promise.resolve();
  private cached: LicenseStatus = {
    configured: false,
    signedIn: false,
    activated: false,
    valid: false,
    tier: "NONE",
    features: [],
    reason: "Unlock OS secure storage to initialize licensing.",
  };
  constructor(
    readonly directory: string,
    readonly changed: () => void,
    private readonly options: { config?: unknown; fetch?: typeof fetch } = {},
  ) {
    this.config = ProductSdkConfigSchema.parse(options.config ?? productConfig);
    if (
      this.config.productCode !== "RS" ||
      this.config.appId !== "com.t2etech.remotestudio" ||
      this.config.trialEnabled
    )
      throw new Error("Remote Studio requires its paid product configuration.");
  }
  private exclusive<T>(fn: () => Promise<T>) {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => {});
    return result;
  }
  initialize(encoded: string) {
    return this.exclusive(async () => {
      const key = Buffer.from(encoded, "base64");
      if (key.length !== 32 || key.toString("base64") !== encoded)
        throw new Error("Invalid installation key.");
      const digest = createHash("sha256").update(key).digest("hex");
      if (this.sdk) {
        if (digest !== this.keyHash)
          throw new Error(
            "Installation storage key changed. Restart to unlock the original key.",
          );
        return this.cached;
      }
      const storage = new NodeEncryptedFileStorage(
        join(this.directory, "license-sdk.enc"),
        "RS",
        {
          current: async () => ({ id: "os-v1", key }),
          get: async (id) => (id === "os-v1" ? key : null),
        },
        this.config.appId,
      );
      const sdk = createLicenseSDKFromConfig(this.config, {
        fetch: this.options.fetch,
        storage,
        platform: process.platform === "darwin" ? "MACOS" : "WINDOWS",
        architecture: process.arch === "arm64" ? "ARM64" : "X64",
        timeoutMs: 10000,
        openExternal: async (url) => {
          const target = new URL(url);
          if (
            target.origin !== this.config.supabaseUrl ||
            target.pathname !== "/auth/v1/oauth/authorize"
          )
            throw new Error("Unexpected OAuth authorization origin.");
          this.opening = url;
        },
        recoverOperation: async () => "UNKNOWN",
      });
      try {
        await sdk.initialize();
      } catch (error) {
        await sdk.dispose();
        this.cached = { ...this.cached, reason: this.code(error) };
        throw new Error(this.cached.reason);
      }
      this.sdk = sdk;
      this.keyHash = digest;
      this.cached = {
        ...this.cached,
        configured: true,
        reason:
          "Sign in and activate your purchase, or activate a license key, to connect assistants and run protected work.",
      };
      await this.status();
      this.changed();
      return this.cached;
    });
  }
  private ready() {
    if (!this.sdk)
      throw new Error(
        "Remote Studio licensing is locked. Open the desktop app and unlock OS secure storage.",
      );
    return this.sdk;
  }
  private code(error: unknown) {
    return error instanceof LicenseClientError
      ? error.code
      : "LICENSE_CHECK_FAILED";
  }
  async status(refresh = true): Promise<LicenseStatus> {
    if (!this.sdk || !refresh) return this.cached;
    try {
      const access = await this.sdk.getAccess();
      this.cached = {
        configured: true,
        signedIn: access.signedIn,
        activated: access.activated,
        valid:
          access.valid &&
          access.activated &&
          ["PAID", "LIFETIME"].includes(access.tier) &&
          access.features.includes("export"),
        tier: access.tier,
        features: access.features,
        reason:
          access.reason === "TRIAL_DISABLED"
            ? "Sign in and activate your Remote Studio purchase."
            : access.reason,
      };
    } catch (error) {
      this.cached = { ...this.cached, valid: false, reason: this.code(error) };
    }
    return this.cached;
  }
  async ensure() {
    const sdk = this.ready();
    try {
      if (!(await sdk.license.status()).activated)
        throw new Error(
          "Activate your Remote Studio purchase in Settings → License.",
        );
      const claims = await sdk.license.ensureValidLicense();
      if (
        !Array.isArray(claims.features) ||
        !claims.features.includes("export")
      )
        throw new Error(
          "This license does not include Remote Studio development access.",
        );
    } catch (error) {
      this.cached = {
        ...this.cached,
        valid: false,
        reason:
          error instanceof LicenseClientError
            ? error.code
            : "ACTIVATION_REQUIRED",
      };
      this.changed();
      throw new Error(
        error instanceof LicenseClientError
          ? "Remote Studio license check failed: " + error.code
          : (error as Error).message,
      );
    }
  }
  async run<T>(operation: () => Promise<T>) {
    await this.ensure();
    return this.ready().runWithAccess(
      { feature: "export", operationId: randomUUID() },
      async () => {
        // Recheck paid claims: SDK rc.1 may fall back to trials after an expired lease.
        await this.ensure();
        return operation();
      },
    );
  }
  login() {
    return this.exclusive(async () => {
      this.opening = undefined;
      await this.ready().login();
      if (!this.opening)
        throw new Error("OAuth authorization URL was not created.");
      return { url: this.opening };
    });
  }
  complete(url: string) {
    return this.exclusive(async () => {
      const target = new URL(url);
      if (
        target.protocol !== "com.t2etech.remotestudio:" ||
        target.hostname !== "oauth" ||
        target.pathname !== "/callback" ||
        target.username ||
        target.password ||
        target.hash
      )
        throw new Error("Invalid Remote Studio sign-in callback.");
      try {
        await this.ready().completeLogin(url);
      } catch (error) {
        // A successful token exchange can be followed by NO_ACCOUNT_LICENSE.
        this.cached = { ...(await this.status()), reason: this.code(error) };
        this.changed();
        throw new Error("Sign-in/activation result: " + this.code(error));
      }
      this.changed();
      return this.status();
    });
  }
  activate(key?: string) {
    return this.exclusive(async () => {
      await this.ready().activate(key);
      this.changed();
      return this.status();
    });
  }
  logout() {
    return this.exclusive(async () => {
      await this.ready().logout();
      this.cached = { ...this.cached, valid: false, signedIn: false };
      this.changed();
      return this.status();
    });
  }
  deactivate() {
    return this.exclusive(async () => {
      await this.ready().deactivate();
      this.cached = { ...this.cached, valid: false, activated: false };
      this.changed();
      return this.status();
    });
  }
  async dispose() {
    await this.tail;
    await this.sdk?.dispose();
  }
}
