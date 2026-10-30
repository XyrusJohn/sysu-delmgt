import { defineConfig, loadEnv } from "vite";
import {assertProductionBuildTarget, resolveReleaseConfig} from "./src/api/releaseConfig.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(({mode,command}) => {
  const env = {...loadEnv(mode, __dirname, "VITE_"), DEV: command === 'serve'};
  assertProductionBuildTarget(command, mode, env);
  const endpoints = resolveReleaseConfig(env);
  return {
  // Only non-HTML assets are copied. Legacy public HTML is excluded from releases.
  publicDir: 'static',
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
        qrGenerator: resolve(__dirname, "qr-generator.html"),
        scanResult: resolve(__dirname, "scan-result.html"),
        logout: resolve(__dirname, "logout.html"),
      },
    },
  },
  optimizeDeps: {
    include: ["socket.io-client"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: endpoints.BASE_URL,
        changeOrigin: true,
        secure: true,
      },
      "/socket.io": {
        target: endpoints.SOCKET_URL,
        changeOrigin: true,
        secure: true,
        ws: true,
      },
    },
  },
  };
});
