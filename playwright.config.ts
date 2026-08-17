import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "line",
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
});
