import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/browser",
  workers: 1,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:43172", browserName: "chromium", screenshot: "only-on-failure" },
  webServer: { command: "node test/fixtures/browser-server.mjs", url: "http://127.0.0.1:43172/memory", reuseExistingServer: false },
});
