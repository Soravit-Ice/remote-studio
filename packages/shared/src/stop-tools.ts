// These operations only stop owned work; expired licensing must not prevent cleanup.
export const stoppingTools = new Set([
  "job_cancel",
  "preview_stop",
  "browser_close",
  "desktop_stop",
]);
