import { createServer, type Socket } from "node:net";
import { chmod, unlink, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute, basename } from "node:path";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  Licensing,
  type LicenseAuthority,
} from "../../../packages/licensing/src/index";
import pino from "pino";
import { z } from "zod";
import {
  defaultData,
  endpoint,
  adminToken,
  rpc,
} from "../../../packages/shared/src/rpc";
import { recoverSandboxes } from "../../../packages/terminal/src/recovery";
import { Engine } from "./engine";
const dataIndex = process.argv.indexOf("--data");
const directory =
  process.env.STUDIO_DATA_DIR ??
  (dataIndex >= 0 ? process.argv[dataIndex + 1] : undefined) ??
  defaultData();
const token = await adminToken(directory);
try {
  await rpc(directory, token, "snapshot");
  process.exit(0);
} catch {
  /* Start an agent if one is unavailable. */
}
if (process.platform !== "win32")
  await unlink(endpoint(directory)).catch(() => {});
const log = pino(
  { level: "info" },
  pino.destination({ dest: join(directory, "agent.log"), sync: false }),
);
const listeners = new Set<Socket>();
let pending = false;
const changed = () => {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    for (const socket of listeners)
      if (!socket.destroyed) socket.write('{"changed":true}\n');
  }, 100);
};
for (const error of await recoverSandboxes(directory))
  log.error({ error }, "Native sandbox recovery needs attention");
let licensing: LicenseAuthority = new Licensing(directory, changed);
if (process.argv.includes("--test-license")) {
  const scope = relative(realpathSync(tmpdir()), realpathSync(directory));
  if (
    /^Remote Studio(?:\.exe)?$/.test(basename(process.execPath)) ||
    scope === "" ||
    scope.startsWith("..") ||
    isAbsolute(scope)
  )
    throw new Error(
      "Development license fixtures require an unpackaged runtime and isolated temporary data.",
    );
  licensing = {
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
}
const engine = new Engine(directory, token, changed, licensing);
const request = z.object({
  role: z.enum(["ui", "client"]),
  token: z.string().min(1).max(256),
  method: z.string().max(80),
  input: z.unknown(),
});
const server = createServer((socket) => {
  let buffer = "";
  socket.setTimeout(60000, () => socket.destroy());
  socket.on("error", (error) =>
    log.warn({ error: error.message }, "Socket error"),
  );
  socket.on("close", () => listeners.delete(socket));
  socket.on("data", async (bytes) => {
    buffer += bytes.toString();
    if (buffer.length > 16 * 1024 * 1024) {
      socket.destroy();
      return;
    }
    if (!buffer.includes("\n")) return;
    socket.pause();
    try {
      const parsed = request.parse(
        JSON.parse(buffer.slice(0, buffer.indexOf("\n"))),
      );
      const actor = engine.actor(parsed.token, parsed.role);
      if (parsed.method === "subscribe") {
        if (!actor.ui) throw new Error("UI authentication required.");
        socket.setTimeout(0);
        listeners.add(socket);
        socket.write('{"changed":true}\n');
        return;
      }
      const data = await engine.request(parsed.method, parsed.input, actor);
      socket.end(JSON.stringify({ ok: true, data }) + "\n");
    } catch (error) {
      socket.end(
        JSON.stringify({ ok: false, error: (error as Error).message }) + "\n",
      );
    }
  });
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(endpoint(directory), resolve);
});
if (process.platform !== "win32") await chmod(endpoint(directory), 0o600);
await writeFile(join(directory, "agent.pid"), String(process.pid), {
  mode: 0o600,
});
log.info({ pid: process.pid }, "Agent ready");
void engine.jobs.pump();
let checkingLicense = false;
const licenseTimer = setInterval(() => {
  if (
    checkingLicense ||
    !engine.store.jobsWithStatus(["running", "queued"]).length
  )
    return;
  checkingLicense = true;
  void licensing
    .ensure()
    .catch(async () => {
      for (const ws of engine.store.workspaces()) {
        await engine.jobs.revokeWorkspace(ws.id);
        await engine.browsers.revoke(ws.id);
        await engine.desktops.revoke(ws.id);
      }
      log.warn("License no longer authorizes active work; owned work stopped.");
    })
    .catch(() =>
      log.error("Owned work needs attention after license revocation."),
    )
    .finally(() => {
      checkingLicense = false;
    });
}, 60000);
licenseTimer.unref();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(licenseTimer);
  for (const s of listeners) s.destroy();
  server.close();
  await engine.close();
  await unlink(endpoint(directory)).catch(() => {});
  log.flush();
  setTimeout(() => process.exit(0), 100);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
