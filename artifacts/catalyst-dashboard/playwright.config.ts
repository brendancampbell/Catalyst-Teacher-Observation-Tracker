import { defineConfig, devices } from "@playwright/test";

const DASHBOARD_PORT = Number(process.env.PORT || 18277);
const DASHBOARD_BASE_PATH = process.env.BASE_PATH || "/";

const baseURL =
  process.env.PW_BASE_URL ||
  `http://127.0.0.1:${DASHBOARD_PORT}${DASHBOARD_BASE_PATH === "/" ? "" : DASHBOARD_BASE_PATH}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  /*
   * Auto-start the Vite dev server when PW_BASE_URL is not explicitly set.
   * reuseExistingServer:true means a server already running on the port is
   * reused as-is, so normal `pnpm dev` usage is not disrupted.
   */
  webServer: {
    command: `PORT=${DASHBOARD_PORT} BASE_PATH=${DASHBOARD_BASE_PATH} pnpm vite --config vite.config.ts --host 127.0.0.1 --port ${DASHBOARD_PORT}`,
    url: `http://127.0.0.1:${DASHBOARD_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
