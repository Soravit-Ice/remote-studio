// This small, CSP-compatible entry point survives a failed renderer bundle.
(() => {
  let timer;
  function failed() {
    const boot = document.getElementById("studio-boot");
    if (!boot) return;
    boot.setAttribute("role", "alert");
    document.getElementById("studio-boot-message").textContent =
      "The interface could not load. Try again, or close and reopen Remote Studio.";
    document.getElementById("studio-boot-reload").hidden = false;
  }
  window.addEventListener("error", failed, true);
  window.addEventListener("unhandledrejection", failed);
  document.addEventListener("DOMContentLoaded", () => {
    document
      .getElementById("studio-boot-reload")
      ?.addEventListener("click", () => window.location.reload());
    if (!document.getElementById("studio-boot")) return;
    const observer = new MutationObserver(() => {
      if (!document.getElementById("studio-boot")) {
        clearTimeout(timer);
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById("root"), { childList: true });
    timer = setTimeout(() => {
      observer.disconnect();
      failed();
    }, 15000);
  });
})();
