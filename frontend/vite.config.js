import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8"));

export default defineConfig({
  plugins: [
    react(),
    // BUG-10: Inject the current package version into sw.js after build so the
    // SW cache name is automatically updated with every release.
    {
      name: "inject-sw-version",
      closeBundle() {
        const swPath = resolve(__dirname, "../backend/public/sw.js");
        if (!existsSync(swPath)) return;
        const sw = readFileSync(swPath, "utf8");
        writeFileSync(swPath, sw.replace("__APP_VERSION__", pkg.version), "utf8");
      },
    },
  ],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "../backend/public",
    emptyOutDir: true,
  },
});
