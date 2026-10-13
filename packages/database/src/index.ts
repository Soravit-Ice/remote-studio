import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Audit,
  Change,
  ClientGrant,
  Job,
  Settings,
  Workspace,
} from "../../contracts/src/index";
import { settingsSchema } from "../../contracts/src/index";
export class Store {
  readonly db: DatabaseSync;
  constructor(readonly directory: string) {
    const existing = existsSync(join(directory, "studio.sqlite"));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.db = new DatabaseSync(join(directory, "studio.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,status TEXT NOT NULL,data TEXT NOT NULL);",
    );
    const version = (
      this.db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version > 2)
      throw new Error("Database was created by a newer Remote Studio version.");
    if (version < 1) {
      if (existing) {
        const backup = join(
          directory,
          `studio.pre-v1-${Date.now()}.sqlite`,
        ).replaceAll("'", "''");
        this.db.exec(`VACUUM INTO '${backup}'`);
        chmodSync(backup.replaceAll("''", "'"), 0o600);
      }
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const table of developmentTables) {
          this.db.exec(
            `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, client_id TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS ${table}_scope ON ${table}(workspace_id,client_id)`,
          );
        }
        this.db.exec(
          "CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status); PRAGMA user_version=1; COMMIT",
        );
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    if (version < 2) {
      if (existing && version === 1) {
        const backup = join(directory, `studio.pre-v2-${Date.now()}.sqlite`);
        this.db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
        chmodSync(backup, 0o600);
      }
      this.transaction(() => {
        for (const table of developmentTables)
          this.db.exec(
            `CREATE INDEX IF NOT EXISTS ${table}_plan ON ${table}(json_extract(data,'$.planId'),workspace_id,client_id)`,
          );
        this.db.exec(
          "CREATE INDEX IF NOT EXISTS jobs_idempotency ON jobs(json_extract(data,'$.clientId'),json_extract(data,'$.command.idempotencyKey')); PRAGMA user_version=2",
        );
      });
    }
    this.db.exec(
      "UPDATE tasks SET data=json_set(data,'$.status','interrupted','$.error','Agent restarted; resume explicitly. No work was replayed.') WHERE json_extract(data,'$.status') IN ('running','verifying')",
    );
    this.db
      .prepare(
        "UPDATE task_attempts SET data=json_set(data,'$.status','interrupted','$.finishedAt',?,'$.error','Agent restarted.') WHERE json_extract(data,'$.status')='running'",
      )
      .run(new Date().toISOString());
    chmodSync(join(directory, "studio.sqlite"), 0o600);
    for (const job of this.jobsWithStatus(["running", "queued"], false))
      if (["running", "queued"].includes(job.status))
        this.saveJob({
          ...job,
          status: "interrupted",
          pid: null,
          finishedAt: new Date().toISOString(),
          error:
            "Agent restarted. This operation will not be repeated automatically.",
        });
  }
  all<T>(kind: string): T[] {
    return (
      this.db
        .prepare("SELECT data FROM records WHERE kind=? ORDER BY rowid DESC")
        .all(kind) as { data: string }[]
    ).map((row) => JSON.parse(row.data));
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT data FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  put(kind: string, id: string, data: unknown) {
    this.db
      .prepare(
        "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(kind, id, JSON.stringify(data));
  }
  delete(kind: string, id: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  workspaces() {
    return this.all<Workspace>("workspace");
  }
  changes() {
    return this.all<Change>("change");
  }
  clients() {
    return this.all<ClientGrant & { tokenHash: string }>("client");
  }
  settings(): Settings {
    return settingsSchema.parse(this.get("settings", "main") ?? {});
  }
  modules(): Record<string, boolean> {
    return {
      Files: true,
      Terminal: true,
      Projects: true,
      Git: true,
      Jobs: true,
      System: true,
      Browser: true,
      Planning: true,
      Skills: true,
      Desktop: true,
      ...this.get<Record<string, boolean>>("modules", "main"),
    };
  }
  jobs(): Job[] {
    return (
      this.db
        .prepare("SELECT data FROM jobs ORDER BY rowid DESC LIMIT 500")
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  jobSummaries(limit = 100, offset = 0): Job[] {
    return (
      this.db
        .prepare(
          "SELECT json_set(data,'$.logs','') AS data FROM jobs ORDER BY rowid DESC LIMIT ? OFFSET ?",
        )
        .all(limit, offset) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  jobPage(input: {
    limit: number;
    offset: number;
    clientId?: string;
    workspaceIds?: string[];
    includeLogs?: boolean;
  }): Job[] {
    const clauses: string[] = [],
      args: (string | number)[] = [];
    if (input.clientId) {
      clauses.push("json_extract(data,'$.clientId')=?");
      args.push(input.clientId);
    }
    if (input.workspaceIds) {
      if (!input.workspaceIds.length) return [];
      clauses.push(
        `json_extract(data,'$.workspaceId') IN (${input.workspaceIds.map(() => "?").join(",")})`,
      );
      args.push(...input.workspaceIds);
    }
    args.push(input.limit, input.offset);
    return (
      this.db
        .prepare(
          `SELECT ${input.includeLogs ? "data" : "json_set(data,'$.logs','')"} AS data FROM jobs ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(...args) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  recordPage<T>(kind: string, limit = 100): T[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM records WHERE kind=? ORDER BY rowid DESC LIMIT ?",
        )
        .all(kind, limit) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  changeSummaries(): Change[] {
    return (
      this.db
        .prepare(
          "SELECT json_set(data,'$.before',CASE WHEN json_extract(data,'$.before') IS NULL THEN NULL ELSE '' END,'$.after','') AS data FROM records WHERE kind='change' ORDER BY rowid DESC LIMIT 200",
        )
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  jobsWithStatus(statuses: Job["status"][], summaries = true): Job[] {
    if (!statuses.length) return [];
    return (
      this.db
        .prepare(
          `SELECT ${summaries ? "json_set(data,'$.logs','')" : "data"} AS data FROM jobs WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY rowid ASC`,
        )
        .all(...statuses) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  idempotentJob(clientId: string, key: string): Job | undefined {
    const row = this.db
      .prepare(
        "SELECT data FROM jobs WHERE json_extract(data,'$.clientId')=? AND json_extract(data,'$.command.idempotencyKey')=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(clientId, key) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  developmentForPlan<T>(
    table: DevelopmentTable,
    planId: string,
    workspaceId: string,
    clientId: string,
  ): T[] {
    assertTable(table);
    return (
      this.db
        .prepare(
          `SELECT data FROM ${table} WHERE json_extract(data,'$.planId')=? AND workspace_id=? AND client_id=? ORDER BY rowid DESC`,
        )
        .all(planId, workspaceId, clientId) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  development<T>(
    table: DevelopmentTable,
    workspaceId?: string,
    clientId?: string,
    limit = 1000,
  ): T[] {
    assertTable(table);
    const clauses: string[] = [],
      args: (string | number)[] = [];
    if (workspaceId) {
      clauses.push("workspace_id=?");
      args.push(workspaceId);
    }
    if (clientId) {
      clauses.push("client_id=?");
      args.push(clientId);
    }
    args.push(limit);
    return (
      this.db
        .prepare(
          `SELECT data FROM ${table}${clauses.length ? " WHERE " + clauses.join(" AND ") : ""} ORDER BY rowid DESC LIMIT ?`,
        )
        .all(...args) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  developmentRecord<T>(table: DevelopmentTable, id: string): T | undefined {
    assertTable(table);
    const row = this.db
      .prepare(`SELECT data FROM ${table} WHERE id=?`)
      .get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  saveDevelopment<
    T extends { id: string; workspaceId: string; clientId: string },
  >(table: DevelopmentTable, value: T) {
    assertTable(table);
    this.db
      .prepare(
        `INSERT INTO ${table} VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(value.id, value.workspaceId, value.clientId, JSON.stringify(value));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  job(id: string): Job | undefined {
    const r = this.db.prepare("SELECT data FROM jobs WHERE id=?").get(id) as
      { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  }
  saveJob(job: Job) {
    this.db
      .prepare(
        "INSERT INTO jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data",
      )
      .run(job.id, job.status, JSON.stringify(job));
  }
  claim(job: Job) {
    return (
      this.db
        .prepare(
          "UPDATE jobs SET status='running',data=? WHERE id=? AND status='queued'",
        )
        .run(JSON.stringify(job), job.id).changes === 1
    );
  }
  audit(
    action: string,
    clientId: string,
    workspaceId: string | null,
    detail: string,
    success = true,
  ) {
    const entry: Audit = {
      id: randomUUID(),
      at: new Date().toISOString(),
      action,
      clientId,
      workspaceId,
      detail: detail.slice(0, 2000),
      success,
    };
    this.put("audit", entry.id, entry);
    this.db.exec(
      "DELETE FROM records WHERE kind='audit' AND rowid NOT IN (SELECT rowid FROM records WHERE kind='audit' ORDER BY rowid DESC LIMIT 2000)",
    );
  }
  close() {
    this.db.close();
  }
}
const developmentTables = [
  "plans",
  "tasks",
  "task_attempts",
  "verifications",
  "artifacts",
  "plan_events",
] as const;
type DevelopmentTable = (typeof developmentTables)[number];
function assertTable(table: string) {
  if (!(developmentTables as readonly string[]).includes(table))
    throw new Error("Invalid development table.");
}
