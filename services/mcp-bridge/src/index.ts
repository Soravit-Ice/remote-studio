import { readFile } from "node:fs/promises";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createBridge } from "./server";
// Scoped bridges never retain a tunnel provider's credentials.
delete process.env.CONTROL_PLANE_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.TUNNEL_TOKEN;
const position = process.argv.indexOf("--credential");
if (position < 0 || !process.argv[position + 1])
  throw new Error(
    "Pass --credential with a client credential file created by Remote Studio.",
  );
const { token, directory } = JSON.parse(
  await readFile(process.argv[position + 1], "utf8"),
);
serveStdio(() => createBridge(directory, token));
