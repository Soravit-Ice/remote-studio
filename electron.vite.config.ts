import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"],
        input: resolve("apps/desktop/electron/main/index.ts"),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        external: ["electron"],
        input: resolve("apps/desktop/electron/preload/index.ts"),
        output: { format: "cjs" },
      },
    },
  },
  renderer: {
    root: resolve("apps/desktop"),
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "development-csp",
        transformIndexHtml(html, context) {
          return context.server
            ? html
                .replace(
                  "script-src 'self'",
                  "script-src 'self' 'unsafe-inline'",
                )
                .replace(
                  "connect-src 'self'",
                  "connect-src 'self' ws://localhost:* http://localhost:*",
                )
            : html;
        },
      },
    ],
    build: {
      outDir: resolve("out/renderer"),
      rollupOptions: { input: resolve("apps/desktop/index.html") },
    },
  },
});
