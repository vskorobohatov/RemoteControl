import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = Number(process.env.RC_PORT ?? 8790);

export default defineConfig({
  root: "web",
  plugins: [react()],
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
