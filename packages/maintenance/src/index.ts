import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "../../database/src/index";
import type { Artifact } from "../../contracts/src/index";
import { sandboxStatus } from "../../terminal/src/sandbox";
export class Maintenance {
  constructor(readonly store: Store) {}
  supportBundle() {
    const count = (table: string) =>
      Number(
        (
          this.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
            n: number;
          }
        ).n,
      );
    return {
      format: 1,
      capturedAt: new Date().toISOString(),
      version: "0.1.0",
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      serverId: this.store.get("identity", "server"),
      sandbox: sandboxStatus(),
      backgroundService: this.store.settings().backgroundService,
      totals: {
        jobs: count("jobs"),
        plans: count("plans"),
        artifacts: count("artifacts"),
      },
      workspaces: this.store
        .workspaces()
        .map((w) => ({
          id: w.id,
          enabled: w.enabled,
          accessMode: w.accessMode,
          write: w.write,
          execute: w.execute,
        })),
      connections: this.store
        .clients()
        .map((c) => ({
          id: c.id,
          revoked: c.revoked,
          workspaceCount: c.workspaceIds?.length ?? null,
        })),
      jobs: this.store
        .jobSummaries(100)
        .map((j) => ({
          id: j.id,
          workspaceId: j.workspaceId,
          status: j.status,
          exitCode: j.exitCode,
          originModule: j.originModule,
          createdAt: j.createdAt,
          finishedAt: j.finishedAt,
          hasError: !!j.error,
        })),
    };
  }
  async cleanupArtifacts() {
    const days = this.store.settings().artifactRetentionDays;
    if (!days) return { removed: 0, bytes: 0 };
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const rows = this.store.db
      .prepare(
        "SELECT data FROM artifacts WHERE json_extract(data,'$.createdAt')<? AND id NOT IN (SELECT json_extract(data,'$.artifactId') FROM verifications WHERE json_extract(data,'$.artifactId') IS NOT NULL) ORDER BY rowid ASC LIMIT 500",
      )
      .all(cutoff) as { data: string }[];
    let removed = 0,
      bytes = 0;
    for (const row of rows) {
      const artifact = JSON.parse(row.data) as Artifact;
      if (!/^[a-f0-9-]{36}$/.test(artifact.id))
        throw new Error("Invalid retained artifact identity.");
      await rm(join(this.store.directory, "artifacts", artifact.id), {
        force: true,
      });
      this.store.db
        .prepare("DELETE FROM artifacts WHERE id=?")
        .run(artifact.id);
      removed++;
      bytes += artifact.bytes;
    }
    return { removed, bytes };
  }
}
