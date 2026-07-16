const STALE_KEY_PATTERN = /^catalyst-instant-analysis-\d+$/;

export function cleanupStaleLocalStorageKeys(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && STALE_KEY_PATTERN.test(key)) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
  }
}
