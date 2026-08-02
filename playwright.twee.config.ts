import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./src/test/visual",
  testMatch: "terminal-image.spec.ts",
  snapshotPathTemplate: "{testDir}/{arg}{ext}",
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    viewport: { width: 320, height: 240 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/src/test/visual/terminal-image.html",
    reuseExistingServer: false,
  },
});
