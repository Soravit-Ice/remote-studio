import { z } from "zod";
import { createHmac, randomBytes } from "node:crypto";
import { Security, type Actor } from "../../security/src/index";
export const environmentEntry = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().regex(/^[A-Z_][A-Z0-9_]{0,79}$/),
  value: z.string().min(1).max(16384),
  clientIds: z.array(z.string().uuid()).max(100).default([]),
});
export type EnvironmentEntry = z.infer<typeof environmentEntry>;
export function validateEnvironmentName(name: string) {
  if (
    /^(?:HOME|PATH|USERPROFILE|TMPDIR|TEMP|TMP|MAC_CHROMIUM_TMPDIR|COMSPEC|SYSTEMROOT|WINDIR|NODE_.+|ELECTRON_.+|CONTROL_PLANE_.+|STUDIO_.+|GIT_.+|DYLD_.+|LD_.+|XDG_.+|PYTHONPATH|RUSTUP_HOME|CARGO_HOME)$/i.test(
      name,
    )
  )
    throw new Error(
      "This environment name is reserved for the native execution boundary.",
    );
}
export class Environment {
  private entries: EnvironmentEntry[] = [];
  constructor(readonly security: Security) {}
  restore(raw: unknown, actor: Actor) {
    if (!actor.ui)
      throw new Error(
        "Only the local UI can restore encrypted environment bindings.",
      );
    const entries = z.array(environmentEntry).max(500).parse(raw);
    for (const e of entries) validateEnvironmentName(e.name);
    const store = this.security.store,
      key =
        store.get<string>("environment", "revision-key") ??
        randomBytes(32).toString("hex");
    store.put("environment", "revision-key", key);
    const previous =
      store.get<EnvironmentEntry[]>("environment", "metadata") ?? [];
    for (const workspaceId of new Set(
      [...entries, ...previous].map((e) => e.workspaceId),
    )) {
      const relevant = entries
        .filter((e) => e.workspaceId === workspaceId)
        .map((e) => ({ ...e, clientIds: [...e.clientIds].sort() }))
        .sort((a, b) => a.name.localeCompare(b.name));
      store.put(
        "environmentRevision",
        workspaceId,
        createHmac("sha256", key)
          .update(JSON.stringify(relevant))
          .digest("hex"),
      );
    }
    this.entries = entries;
    store.put(
      "environment",
      "metadata",
      entries.map(({ value, ...e }) => ({ ...e, hasValue: !!value })),
    );
    return { restored: entries.length };
  }
  forJob(workspaceId: string, actor: Actor) {
    this.security.workspace(workspaceId, actor, "execute");
    const configured =
      this.security.store.get<EnvironmentEntry[]>("environment", "metadata") ??
      [];
    if (
      configured.some(
        (e) =>
          e.workspaceId === workspaceId &&
          (actor.ui || e.clientIds.includes(actor.id)) &&
          !this.entries.some(
            (loaded) =>
              loaded.workspaceId === workspaceId && loaded.name === e.name,
          ),
      )
    )
      throw new Error(
        "Configured environment is not unlocked. Open Remote Studio and unlock OS secure storage before running this job.",
      );
    return Object.fromEntries(
      this.entries
        .filter(
          (e) =>
            e.workspaceId === workspaceId &&
            (actor.ui || e.clientIds.includes(actor.id)),
        )
        .map((e) => [e.name, e.value]),
    );
  }
  status(workspaceId: string, actor: Actor) {
    this.security.workspace(workspaceId, actor);
    return (this.security.store.get<any[]>("environment", "metadata") ?? [])
      .filter((e) => e.workspaceId === workspaceId)
      .map((e) => ({
        name: e.name,
        hasValue: e.hasValue,
        authorized: actor.ui || e.clientIds.includes(actor.id),
        loaded: this.entries.some(
          (v) => v.workspaceId === workspaceId && v.name === e.name,
        ),
      }));
  }
}
export class StreamingRedactor {
  private tail = "";
  constructor(private secrets: string[]) {}
  push(chunk: string, final = false) {
    const text = this.tail + chunk;
    let keep = 0;
    for (const secret of this.secrets.filter(Boolean)) {
      for (
        let at = text.lastIndexOf(secret[0]);
        at >= Math.max(0, text.length - secret.length + 1) && at >= 0;
        at = text.lastIndexOf(secret[0], at - 1)
      ) {
        const suffix = text.slice(at);
        if (secret.startsWith(suffix) && suffix.length < secret.length)
          keep = Math.max(keep, suffix.length);
        if (at === 0) break;
      }
    }
    this.tail = final ? "" : text.slice(text.length - keep);
    let safe = text.slice(0, text.length - keep);
    for (const secret of this.secrets
      .filter(Boolean)
      .sort((a, b) => b.length - a.length))
      safe = safe.split(secret).join("[REDACTED]");
    safe = safe
      .replace(
        /((?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi,
        "$1[redacted]",
      )
      .replace(/\x1b\[[0-9;]*m/g, "");
    return safe + (final && keep ? "[REDACTED]" : "");
  }
  flush() {
    return this.push("", true);
  }
}
