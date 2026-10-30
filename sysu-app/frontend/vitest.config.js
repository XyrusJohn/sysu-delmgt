import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Bound concurrent jsdom/Vite initialization on developer machines and CI.
    maxWorkers: 2,
    environment: "jsdom",
    env: {
      VITE_RELEASE_TARGET: "local",
      VITE_API_URL: "http://127.0.0.1:3000",
      VITE_SOCKET_URL: "http://127.0.0.1:3000",
      VITE_DRIVER_TRACKING_URL: "http://127.0.0.1:3001",
      VITE_SYSU_GO_API_URL: "http://127.0.0.1:3001",
    },
  },
});
