import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: process.env.APP_URL ?? "http://localhost:3000", trace: "off" },
  webServer: { command: "pnpm start", url: "http://localhost:3000", reuseExistingServer: true },
});
