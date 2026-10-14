#!/usr/bin/env node
// Local lifecycle fixture. It never creates a public tunnel or proves Gemini access.
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
if (process.argv.includes("--version")) {
  console.log("cloudflared version 2026.2.0 (local test fixture)");
  process.exit(0);
}
const args = process.argv.slice(2);
writeFileSync("fixture.json", JSON.stringify({
  args, pid: process.pid,
  localOrigin: args[args.indexOf("--url") + 1],
  hasToken: !!process.env.TUNNEL_TOKEN,
  hasOverride: !!process.env.TUNNEL_URL || !!process.env.CONTROL_PLANE_API_KEY,
}));
const keepAlive = createServer();
keepAlive.listen(0, "127.0.0.1", () => {
  if (args.includes("--url")) console.error("https://remote-studio-fixture.trycloudflare.com");
  console.error(JSON.stringify({ message: "Registered tunnel connection" }));
});
process.once("SIGTERM", () => keepAlive.close(() => process.exit(0)));
