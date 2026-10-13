import { useState, useEffect } from "react";
import { Button } from "../../components/ui/button";
import type { Snapshot } from "../../../../../packages/contracts/src/index";
export function EnvironmentPanel({
  data,
  perform,
}: {
  data: Snapshot;
  perform: (fn: () => Promise<any>, message?: string) => Promise<any>;
}) {
  const [workspaceId, setWorkspaceId] = useState(""),
    [rows, setRows] = useState<
      { name: string; hasValue: boolean; clientIds: string[] }[]
    >([]),
    [name, setName] = useState(""),
    [value, setValue] = useState(""),
    [clientIds, setClientIds] = useState<string[]>([]),
    [loadError, setLoadError] = useState("");
  useEffect(() => {
    setLoadError("");
    if (!workspaceId) {
      setRows([]);
      return;
    }
    let active = true;
    window.studio
      .getEnvironment(workspaceId)
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) {
          setRows([]);
          setLoadError(String(e.message ?? e));
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);
  const clients = data.clients.filter(
    (c) =>
      !c.revoked && (!c.workspaceIds || c.workspaceIds.includes(workspaceId)),
  );
  return (
    <details className="development-panel">
      <summary>
        <strong>Project environment</strong>
      </summary>
      <p className="development-empty">
        Values are stored with OS encryption. Select which connections may use
        them in jobs.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform(
            () =>
              window.studio.setEnvironment({
                workspaceId,
                name,
                value: value || undefined,
                clientIds,
              }),
            "Encrypted environment updated.",
          ).then((r) => {
            if (r) {
              setRows(r);
              setValue("");
            }
          });
        }}
      >
        <label>
          Workspace
          <select
            value={workspaceId}
            onChange={(e) => {
              setWorkspaceId(e.target.value);
              setName("");
              setValue("");
              setClientIds([]);
            }}
            required
          >
            <option value="">Choose a workspace</option>
            {data.workspaces
              .filter((w) => w.enabled)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
        </label>
        {loadError && <p role="alert">{loadError}</p>}
        {workspaceId && !loadError && (
          <>
            <div className="development-resource-list">
              {rows.map((row) => (
                <button
                  type="button"
                  key={row.name}
                  onClick={() => {
                    setName(row.name);
                    setValue("");
                    setClientIds(row.clientIds);
                  }}
                >
                  {row.name} · {row.hasValue ? "Configured" : "Missing"}
                </button>
              ))}
            </div>
            <label>
              Variable name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                pattern="[A-Z_][A-Z0-9_]*"
                maxLength={80}
                required
              />
            </label>
            <label>
              Value
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                type="password"
                autoComplete="new-password"
                placeholder={
                  rows.some((r) => r.name === name)
                    ? "Leave blank to keep the current value"
                    : "Enter a value"
                }
                maxLength={16384}
              />
            </label>
            <fieldset>
              <legend>Authorized connections</legend>
              {clients.length ? (
                clients.map((c) => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      checked={clientIds.includes(c.id)}
                      onChange={(e) =>
                        setClientIds((ids) =>
                          e.target.checked
                            ? [...ids, c.id]
                            : ids.filter((id) => id !== c.id),
                        )
                      }
                    />
                    {c.name}
                  </label>
                ))
              ) : (
                <p>
                  No connections for this workspace. Local jobs can use
                  configured variables.
                </p>
              )}
            </fieldset>
            <div className="development-actions">
              <Button type="submit">Save encrypted value</Button>
              {rows.some((r) => r.name === name) && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() =>
                    void perform(() =>
                      window.studio.setEnvironment({
                        workspaceId,
                        name,
                        clientIds: [],
                        remove: true,
                      }),
                    ).then((r) => {
                      if (r) {
                        setRows(r);
                        setName("");
                        setValue("");
                      }
                    })
                  }
                >
                  Remove variable
                </Button>
              )}
            </div>
          </>
        )}
      </form>
    </details>
  );
}
