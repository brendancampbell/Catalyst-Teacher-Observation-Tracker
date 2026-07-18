// @vitest-environment jsdom
/**
 * Integration test: verifies that stale instant-analysis keys are purged
 * from localStorage the moment the App module is first loaded (the
 * cleanupStaleLocalStorageKeys() call at App.tsx's module top-level).
 *
 * All heavy UI/routing dependencies are mocked so the import completes
 * cleanly; @/lib/localStorageCleanup is intentionally NOT mocked so the
 * real implementation runs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";

vi.mock("wouter", () => ({
  Switch: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  Route: () => null,
  Router: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useLocation: () => ["/", vi.fn()],
  useParams: () => ({}),
}));

vi.mock("@tanstack/react-query", () => {
  class QueryClient {
    defaultOptions: unknown;
    constructor(opts?: unknown) { this.defaultOptions = opts; }
  }
  return {
    QueryClient,
    QueryClientProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useQuery: vi.fn(),
  };
});

vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock("@/pages/not-found", () => ({ default: () => null }));
vi.mock("@/components/Dashboard", () => ({ default: () => null }));
vi.mock("@/pages/admin", () => ({ default: () => null }));
vi.mock("@/pages/action-center", () => ({ default: () => null }));
vi.mock("@/pages/drafts", () => ({ default: () => null }));
vi.mock("@/pages/login", () => ({ default: () => null }));
vi.mock("@/pages/access-denied", () => ({ default: () => null }));
vi.mock("@/pages/TeacherProfile", () => ({ default: () => null }));
vi.mock("@/context/UserContext", () => ({
  UserProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useUser: () => ({ currentUser: null, isLoading: false }),
}));
vi.mock("@/components/ImpersonationBanner", () => ({ default: () => null }));
vi.mock("@/lib/api", () => ({
  HttpError: class HttpError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

beforeEach(() => {
  localStorage.clear();
});

describe("App module startup — localStorage cleanup", () => {
  it("removes stale instant-analysis keys when App.tsx is first loaded", async () => {
    localStorage.setItem("catalyst-instant-analysis-1234567890", "stale-blob");
    localStorage.setItem("catalyst-instant-analysis-9876543210", "also-stale");
    localStorage.setItem("user-prefs", "dark-mode");
    localStorage.setItem("catalyst-school-id", "school-42");

    await import("./App");

    expect(localStorage.getItem("catalyst-instant-analysis-1234567890")).toBeNull();
    expect(localStorage.getItem("catalyst-instant-analysis-9876543210")).toBeNull();
    expect(localStorage.getItem("user-prefs")).toBe("dark-mode");
    expect(localStorage.getItem("catalyst-school-id")).toBe("school-42");
  });

  it("does not touch unrelated keys when there are no stale keys to remove", async () => {
    localStorage.setItem("user-prefs", "light-mode");
    localStorage.setItem("catalyst-school-id", "school-7");

    await import("./App");

    expect(localStorage.getItem("user-prefs")).toBe("light-mode");
    expect(localStorage.getItem("catalyst-school-id")).toBe("school-7");
  });

  it("does not throw when localStorage is empty on startup", async () => {
    await expect(import("./App")).resolves.toBeDefined();
  });
});
