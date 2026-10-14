import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { rpc } from "../../../packages/shared/src/rpc";
import { catalog } from "../../local-agent/src/tools";
import { z } from "zod";
import { hash } from "../../../packages/security/src/index";

export async function createBridge(
  directory: string,
  token: string,
  name = "remote-studio",
) {
  const available = await rpc<{ name: string }[]>(
    directory,
    token,
    "tool.list",
    {},
    "client",
  );
  const identity = await rpc<{ serverId: string; catalogFingerprint: string }>(
    directory,
    token,
    "server.identity",
    {},
    "client",
  );
  const bridgeCatalog = catalog.filter((tool) =>
    available.some((item) => item.name === tool.name),
  );
  if (
    hash(
      JSON.stringify(
        bridgeCatalog.map((tool) => ({
          name: tool.name,
          input: z.toJSONSchema(tool.input),
          output: z.toJSONSchema(tool.output),
        })),
      ),
    ) !== identity.catalogFingerprint
  )
    throw new Error(
      "MCP bridge metadata differs from the running agent. Reinstall this connection configuration using the current Remote Studio build, then reconnect.",
    );

  const server = new McpServer({
    name,
    version: "0.1.0",
    title: `Remote Studio · ${identity.serverId}`,
  });
  server.registerResource(
    "agent-skill",
    new ResourceTemplate(
      "remote-studio://workspaces/{workspaceId}/skills/{skillId}/{resource}",
      { list: () => rpc(directory, token, "skill.resources", {}, "client") },
    ),
    {
      description:
        "Enabled, integrity-checked Agent Skills and their resources. Grants and scope are checked on every read.",
    },
    async (uri, variables) => {
      const scalar = (name: string) => {
        const value = variables[name];
        if (typeof value !== "string")
          throw new Error("Invalid skill resource URI.");
        return decodeURIComponent(value);
      };
      const data = await rpc<any>(
        directory,
        token,
        "tool.call",
        {
          name: "skill_resource",
          arguments: {
            workspaceId: scalar("workspaceId"),
            skillId: scalar("skillId"),
            resource: scalar("resource"),
          },
        },
        "client",
      );
      return {
        contents: [
          data.encoding === "utf8"
            ? { uri: uri.href, mimeType: "text/plain", text: data.content }
            : {
                uri: uri.href,
                mimeType: "application/octet-stream",
                blob: data.content,
              },
        ],
      };
    },
  );
  for (const tool of bridgeCatalog)
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input as any,
        outputSchema: z.object({ data: tool.output }) as any,
        annotations: {
          readOnlyHint: tool.permission === "read",
          destructiveHint:
            tool.permission !== "read" &&
            ![
              "directory_create",
              "file_copy",
              "job_input",
              "browser_open",
              "browser_action",
              "browser_close",
              "browser_prepare",
            ].includes(tool.name),
          idempotentHint: tool.permission === "read",
          openWorldHint: tool.permission === "execute",
        },
      },
      async (args: any) => {
        try {
          await rpc(
            directory,
            token,
            "client.seen",
            {
              tool: tool.name,
              clientName: server.server.getClientVersion()?.name,
            },
            "client",
          );
          const data: any = tool.output.parse(
            await rpc(
              directory,
              token,
              "tool.call",
              { name: tool.name, arguments: args },
              "client",
            ),
          );
          const content: any[] = [];
          const clean = { ...data };
          if (tool.name === "artifact_read" && clean.image) {
            content.push({ type: "image", ...clean.image });
            delete clean.image;
          }
          const artifact = clean.artifact ?? clean.diff;
          if (
            artifact?.mimeType === "image/png" &&
            tool.name !== "artifact_read"
          ) {
            const read = await rpc<any>(
              directory,
              token,
              "artifact.content",
              { workspaceId: artifact.workspaceId, artifactId: artifact.id },
              "client",
            );
            if (read.image) content.push({ type: "image", ...read.image });
          }
          if (tool.name === "video_status")
            for (const frame of clean.artifacts ?? []) {
              const read = await rpc<any>(
                directory,
                token,
                "artifact.content",
                { workspaceId: frame.workspaceId, artifactId: frame.id },
                "client",
              );
              if (read.image) content.push({ type: "image", ...read.image });
            }
          // Preserve arrays and legacy scalar results; only image-bearing objects need sanitizing.
          const structured = tool.name === "artifact_read" ? clean : data;
          content.unshift({ type: "text", text: JSON.stringify(structured) });
          return {
            _meta: {
              "remote-studio/serverId": identity.serverId,
              "remote-studio/catalogFingerprint": identity.catalogFingerprint,
            },
            content,
            structuredContent: { data: structured },
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              { type: "text" as const, text: (error as Error).message },
            ],
          };
        }
      },
    );
  return server;
}
