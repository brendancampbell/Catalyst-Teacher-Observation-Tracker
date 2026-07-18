// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanupStaleLocalStorageKeys } from "./localStorageCleanup";

beforeEach(() => {
  localStorage.clear();
});

describe("cleanupStaleLocalStorageKeys", () => {
  describe("removes stale instant-analysis keys", () => {
    it("removes a single stale key matching the numeric pattern", () => {
      localStorage.setItem("catalyst-instant-analysis-1234567890", "some-data");
      cleanupStaleLocalStorageKeys();
      expect(localStorage.getItem("catalyst-instant-analysis-1234567890")).toBeNull();
    });

    it("removes multiple stale keys in one pass", () => {
      localStorage.setItem("catalyst-instant-analysis-111", "a");
      localStorage.setItem("catalyst-instant-analysis-222", "b");
      localStorage.setItem("catalyst-instant-analysis-333", "c");
      cleanupStaleLocalStorageKeys();
      expect(localStorage.getItem("catalyst-instant-analysis-111")).toBeNull();
      expect(localStorage.getItem("catalyst-instant-analysis-222")).toBeNull();
      expect(localStorage.getItem("catalyst-instant-analysis-333")).toBeNull();
    });
  });

  describe("leaves unrelated keys untouched", () => {
    it("does not remove keys with no relation to the pattern", () => {
      localStorage.setItem("user-prefs", "dark-mode");
      localStorage.setItem("catalyst-school-id", "school-42");
      localStorage.setItem("some-other-key", "value");
      cleanupStaleLocalStorageKeys();
      expect(localStorage.getItem("user-prefs")).toBe("dark-mode");
      expect(localStorage.getItem("catalyst-school-id")).toBe("school-42");
      expect(localStorage.getItem("some-other-key")).toBe("value");
    });

    it("removes only stale keys when mixed with unrelated keys", () => {
      localStorage.setItem("catalyst-instant-analysis-9999", "stale");
      localStorage.setItem("user-prefs", "dark-mode");
      localStorage.setItem("catalyst-school-id", "school-42");
      cleanupStaleLocalStorageKeys();
      expect(localStorage.getItem("catalyst-instant-analysis-9999")).toBeNull();
      expect(localStorage.getItem("user-prefs")).toBe("dark-mode");
      expect(localStorage.getItem("catalyst-school-id")).toBe("school-42");
    });
  });

  describe("partial-match keys are NOT removed", () => {
    it("does not remove a key whose suffix is non-numeric (letters)", () => {
      localStorage.setItem("catalyst-instant-analysis-abc", "partial");
      cleanupStaleLocalStorageKeys();
      expect(localStorage.getItem("catalyst-instant-analysis-abc")).toBe("partial");
    });

    it("does not remove a key with an alphanumeric suffix", () => {
      localStorage.setItem("catalyst-instant-analysis-a1b2c3", "partial");
      cleanupStaleLocalStorageKeys();
      expect(localStorage.getItem("catalyst-instant-analysis-a1b2c3")).toBe("partial");
    });

    it("does not remove a key that has the pattern as a prefix with extra trailing text", () => {
      localStorage.setItem("catalyst-instant-analysis-123-extra", "partial");
      cleanupStaleLocalStorageKeys();
      expect(localStorage.getItem("catalyst-instant-analysis-123-extra")).toBe("partial");
    });

    it("does not remove a key that has extra leading text before the pattern", () => {
      localStorage.setItem("x-catalyst-instant-analysis-123", "partial");
      cleanupStaleLocalStorageKeys();
      expect(localStorage.getItem("x-catalyst-instant-analysis-123")).toBe("partial");
    });

    it("does not remove the bare prefix with no numeric suffix", () => {
      localStorage.setItem("catalyst-instant-analysis-", "partial");
      cleanupStaleLocalStorageKeys();
      expect(localStorage.getItem("catalyst-instant-analysis-")).toBe("partial");
    });
  });

  describe("edge cases", () => {
    it("does nothing and does not throw when localStorage is empty", () => {
      expect(() => cleanupStaleLocalStorageKeys()).not.toThrow();
    });

    it("does not throw when localStorage access throws (restricted environment)", () => {
      const originalGetItem = Storage.prototype.getItem;
      const originalKey = Storage.prototype.key;
      const originalRemoveItem = Storage.prototype.removeItem;
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("Access denied", "SecurityError");
        },
      });
      expect(() => cleanupStaleLocalStorageKeys()).not.toThrow();
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          return {
            getItem: originalGetItem.bind(window.sessionStorage),
            key: originalKey.bind(window.sessionStorage),
            removeItem: originalRemoveItem.bind(window.sessionStorage),
            get length() { return 0; },
            clear() {},
            setItem() {},
          };
        },
      });
    });
  });
});
