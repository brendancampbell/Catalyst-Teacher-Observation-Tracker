import { defineConfig, devices } from "@playwright/test";

const MOBILE_PORT = Number(process.env.PORT || 18278);
const MOBILE_BASE_PATH = process.env.BASE_PATH || "/catalyst-mobile/";

const baseURL =
  process.env.PW_BASE_URL ||
  `http://127.0.0.1:${MOBILE_PORT}${MOBILE_BASE_PATH === "/" ? "" : MOBILE_BASE_PATH.replace(/\/$/, "")}`;

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
    command: `PORT=${MOBILE_PORT} BASE_PATH=${MOBILE_BASE_PATH} pnpm vite --config vite.config.ts --host 127.0.0.1 --port ${MOBILE_PORT}`,
    url: `http://127.0.0.1:${MOBILE_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
