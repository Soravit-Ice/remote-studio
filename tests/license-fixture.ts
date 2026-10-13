import type { LicenseAuthority } from "../packages/licensing/src/index";
export const testLicense: LicenseAuthority = {
  status: async () => ({
    configured: true,
    signedIn: false,
    activated: false,
    valid: true,
    tier: "DEVELOPMENT_TEST",
    features: ["export"],
  }),
  ensure: async () => {},
  run: async (operation) => operation(),
  dispose: async () => {},
};
