import { createConnection, type Socket } from "node:net";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
export const defaultData = () =>
  process.env.STUDIO_DATA_DIR ??
  (process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "Remote Studio")
    : process.platform === "win32"
      ? join(process.env.APPDATA ?? homedir(), "Remote Studio")
      : join(homedir(), ".local", "share", "remote-studio"));
export const endpoint = (directory: string) =>
  process.platform === "win32"
    ? "\\\\.\\pipe\\remotestudio-" +
      createHash("sha256").update(directory).digest("hex").slice(0, 20)
    : join(directory, "agent.sock");
export async function adminToken(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "admin.token");
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const token = randomBytes(32).toString("hex");
    try {
      await writeFile(path, token, { flag: "wx", mode: 0o600 });
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return (await readFile(path, "utf8")).trim();
    }
  }
}
export function rpc<T = any>(
  directory: string,
  token: string,
  method: string,
  input: unknown = {},
  role: "ui" | "client" = "ui",
  timeoutMs = 60000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint(directory));
    let buffer = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Agent request timed out."));
    }, timeoutMs);
    socket.once("error", reject);
    socket.once("connect", () =>
      socket.write(JSON.stringify({ token, method, input, role }) + "\n"),
    );
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 8 * 1024 * 1024) {
        socket.destroy();
        reject(new Error("Agent response too large."));
        return;
      }
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, end));
        if (response.ok) resolve(response.data);
        else reject(new Error(response.error));
      } catch (error) {
        reject(error);
      }
      socket.end();
    });
    socket.once("close", () => {
      clearTimeout(timeout);
      if (!buffer.includes("\n"))
        reject(
          Object.assign(
            new Error("Agent disconnected before returning a result."),
            { code: "ECONNRESET" },
          ),
        );
    });
  });
}
export function subscribe(
  directory: string,
  token: string,
  callback: () => void,
): Socket {
  const socket = createConnection(endpoint(directory));
  socket.once("connect", () =>
    socket.write(
      JSON.stringify({ role: "ui", token, method: "subscribe", input: {} }) +
        "\n",
    ),
  );
  socket.on("data", callback);
  socket.on("error", () => {});
  return socket;
}
