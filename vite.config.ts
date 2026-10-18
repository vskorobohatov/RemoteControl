import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = Number(process.env.RC_PORT ?? 8790);

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: "web",
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@app\//, replacement: at("web/src/app/") },
      { find: /^@pages\//, replacement: at("web/src/pages/") },
      { find: /^@features\//, replacement: at("web/src/features/") },
      { find: /^@shared\//, replacement: at("web/src/shared/") },
      { find: /^@server\//, replacement: at("src/") },
    ],
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
