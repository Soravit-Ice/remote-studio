#!/usr/bin/env node
// Test process only: local health fixture, never contacts OpenAI.
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
if (process.argv.includes("--version")) {
  console.log("tunnel-client version 0.0.12-test-fixture");
  process.exit(0);
}
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const key = process.env.CONTROL_PLANE_API_KEY;
if (
  !key ||
  option("--control-plane.api-key") !== "env:CONTROL_PLANE_API_KEY" ||
  option("--control-plane.base-url") !== "https://api.openai.com" ||
  args.includes(key) ||
  process.env.MCP_SERVER_URL ||
  process.env.CONTROL_PLANE_BASE_URL ||
  process.env.LOG_HTTP_RAW_UNSAFE
) {
  console.error("Fixture rejected unsafe arguments/environment.");
  process.exit(3);
}
const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
writeFileSync(
  "fixture-processes.json",
  JSON.stringify({ runtime: process.pid, worker: worker.pid, args }),
  { mode: 0o600 },
);
const server = createServer((request, response) => {
  if (request.url === "/metrics")
    response.end("commands_poll_last_successful_timestamp_seconds 0\n");
  else if (["/healthz", "/readyz"].includes(request.url)) response.end("ok");
  else {
    response.statusCode = 404;
    response.end();
  }
});
server.listen(0, "127.0.0.1", () => {
  writeFileSync(
    option("--health.url-file"),
    `http://127.0.0.1:${server.address().port}/`,
    { mode: 0o600 },
  );
  // Exercise credentials split across stream chunks. Do not log fixture data in production.
  process.stdout.write("diagnostic key=" + key.slice(0, 8));
  setTimeout(
    () =>
      process.stdout.write(key.slice(8) + "\nfixture local readiness only\n"),
    20,
  );
});
process.on("SIGTERM", () => {
  worker.kill();
  server.close(() => process.exit(0));
});
