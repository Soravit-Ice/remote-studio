import { randomUUID } from "node:crypto";
import { geminiOAuthStateSchema } from "../../../packages/gemini/src/oauth";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { id, publicOriginSchema } from "../../../packages/contracts/src/index";
import { startHttpBridge } from "./http";

delete process.env.CONTROL_PLANE_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.TUNNEL_TOKEN;
if (!process.send)
  throw new Error("The HTTP adapter must be supervised by Remote Studio.");
const argument = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const credentials = z
  .object({ directory: z.string(), token: z.string().min(32) })
  .parse(JSON.parse(await readFile(argument("--credential"), "utf8")));
let persistent = false;
const saves = new Map<string, (ok: boolean) => void>();
const adapter = await startHttpBridge(
  credentials,
  z.coerce.number().int().min(0).max(65535).parse(argument("--port")),
  (event) => process.send?.(event),
  async (state) => {
    if (!persistent) return;
    const requestId = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        saves.delete(requestId);
        reject(new Error("Encrypted OAuth storage did not respond."));
      }, 7000);
      saves.set(requestId, (ok) => {
        clearTimeout(timer);
        saves.delete(requestId);
        if (ok) resolve();
        else reject(new Error("Encrypted OAuth storage is unavailable."));
      });
      process.send?.({ type: "state", requestId, state });
    });
  },
);
process.send({ type: "ready", localOrigin: adapter.localOrigin });
process.on("message", (raw) => {
  try {
    const message = z
      .discriminatedUnion("type", [
        z.object({
          type: z.literal("origin"),
          value: publicOriginSchema,
          persistent: z.boolean().default(false),
          state: geminiOAuthStateSchema.optional(),
        }),
        z.object({
          type: z.literal("stateSaved"),
          requestId: id,
          ok: z.boolean(),
        }),
        z.object({
          type: z.literal("approve"),
          id,
          allow: z.boolean(),
          requestId: id,
        }),
      ])
      .parse(raw);
    if (message.type === "origin") {
      persistent = message.persistent;
      adapter.setOrigin(message.value, message.state);
    } else if (message.type === "stateSaved")
      saves.get(message.requestId)?.(message.ok);
    else {
      adapter.approve(message.id, message.allow);
      process.send?.({ type: "approved", requestId: message.requestId });
    }
  } catch {
    process.send?.({
      type: "error",
      error: "The adapter rejected an invalid or expired control request.",
    });
  }
});
const timer = setInterval(
  () => process.send?.({ type: "pending", pending: adapter.pending() }),
  5000,
);
timer.unref();
let closing = false;
const stop = async () => {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  await adapter.close();
  process.exit(0);
};
process.once("disconnect", () => void stop());
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
