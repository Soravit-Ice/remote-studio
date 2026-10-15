import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
export function LicensePanel() {
  const cache = useQueryClient();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const status = useQuery({
    queryKey: ["license"],
    queryFn: () => window.studio.licenseStatus(),
    refetchInterval: 30000,
  });
  const action = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setMessage(success);
      setKey("");
    } catch (error) {
      setMessage(
        (error as Error).message.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["license"] }),
        cache.invalidateQueries({ queryKey: ["studio"] }),
      ]);
      setBusy(false);
    }
  };
  const data = status.data;
  return (
    <section className="settings-section" aria-label="Remote Studio license">
      <h2>License</h2>
      <p className="muted">
        Sign in with the account that purchased Remote Studio, or activate a
        license key.
      </p>
      <div className="panel settings-panel">
        <div className="setting-row">
          <div>
            <strong>
              {data?.valid ? "Remote Studio activated" : "Activation required"}
            </strong>
            <p>
              {data?.valid
                ? "File changes and commands are enabled within your workspace permissions."
                : "Local workspace browsing, setup, recovery and stopping work remain available. Activate your purchase or license key before connecting assistants, sharing files through MCP, making changes or running commands."}
            </p>
            <p>
              {data?.signedIn ? "Account connected" : "Not signed in"} ·{" "}
              {data?.tier ?? "Checking…"}
            </p>
            {(data?.reason || status.error) && (
              <p role="status">
                {data?.reason ?? "License status could not be checked."}
              </p>
            )}
          </div>
        </div>
        <div className="setting-row">
          <div className="button-group">
            <Button
              disabled={busy || !data?.configured}
              onClick={() =>
                void action(
                  () => window.studio.licenseLogin(),
                  "Complete sign-in in your browser; Remote Studio will receive the return link.",
                )
              }
            >
              Sign in
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !data?.configured}
              onClick={() =>
                void action(
                  () => window.studio.licenseActivate(),
                  "Purchase activated on this device.",
                )
              }
            >
              Activate purchase
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void action(
                  () => window.studio.licenseOpenStore(),
                  "Store opened.",
                )
              }
            >
              Open Store
            </Button>
          </div>
        </div>
        <label className="field-label">
          License key
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="T2E-RS-…"
          />
        </label>
        <div className="setting-row">
          <div className="button-group">
            <Button
              variant="secondary"
              disabled={busy || !key.trim() || !data?.configured}
              onClick={() =>
                void action(
                  () => window.studio.licenseActivate(key.trim()),
                  "License key activated.",
                )
              }
            >
              Activate key
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !data?.signedIn}
              onClick={() =>
                void action(
                  () => window.studio.licenseLogout(),
                  "Signed out; active work stopped.",
                )
              }
            >
              Sign out
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !data?.activated}
              onClick={() =>
                void action(
                  () => window.studio.licenseDeactivate(),
                  "Activation status refreshed.",
                )
              }
            >
              Deactivate device
            </Button>
          </div>
        </div>
        {message && (
          <p role="status" className="inline-note">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
