import { dialog, type BrowserWindow } from "electron";
import { appendFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

export function recordDesktopEvent(
  directory: string,
  event: string,
  reason?: string,
) {
  try {
    const path = join(directory, "desktop.log");
    try {
      if (statSync(path).size > 64 * 1024) renameSync(path, path + ".previous");
    } catch {
      /* First log entry. */
    }
    appendFileSync(
      path,
      JSON.stringify({ time: new Date().toISOString(), event, reason }) + "\n",
      { mode: 0o600 },
    );
  } catch {
    /* Diagnostic failure must not prevent recovery. */
  }
}

export function windowRecovery(
  window: BrowserWindow,
  directory: string,
  url: string,
  quit: () => Promise<void>,
) {
  let recovery: Promise<void> | undefined;
  let crashRetryAt = 0;
  let closed = false;
  window.once("closed", () => {
    closed = true;
  });

  async function attention(message: string) {
    if (closed || recovery) return recovery;
    recovery = (async () => {
      window.show();
      const result = await dialog.showMessageBox(window, {
        type: "error",
        title: "Remote Studio",
        message,
        detail:
          "Your saved work is preserved. Reload the interface to reconnect. If this repeats, close and reopen Remote Studio.",
        buttons: ["Reload interface", "Quit Remote Studio"],
        defaultId: 0,
        cancelId: 0,
      });
      if (closed) return;
      if (result.response === 1) await quit();
      else
        setTimeout(() => {
          if (!closed) void load();
        }, 0);
    })()
      .catch(() => {
        recordDesktopEvent(directory, "recovery-dialog-failed");
      })
      .finally(() => {
        recovery = undefined;
      });
    return recovery;
  }

  async function load() {
    if (closed) return;
    try {
      await window.loadURL(url);
    } catch {
      if (!closed) {
        recordDesktopEvent(directory, "renderer-load-failed");
        // Do not await a dialog from the failed load that its retry replaces.
        void attention("Remote Studio could not load its interface.");
      }
    }
  }

  window.webContents.on("preload-error", () => {
    recordDesktopEvent(directory, "preload-failed");
    void attention("The desktop connection could not load.");
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (closed || details.reason === "clean-exit") return;
    recordDesktopEvent(directory, "renderer-stopped", details.reason);
    const now = Date.now();
    if (now - crashRetryAt > 60000) {
      crashRetryAt = now;
      setTimeout(() => {
        if (!closed) void load();
      }, 250);
    } else void attention("The Remote Studio interface stopped unexpectedly.");
  });
  return load;
}
