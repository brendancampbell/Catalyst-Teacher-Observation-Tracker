/**
 * Validates that a returnTo URL is a safe internal relative path.
 * Rejects absolute URLs (http/https/protocol-relative) to prevent open-redirect.
 * Falls back to the provided default (usually the dashboard root).
 */
export function safeReturnTo(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("//") || /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(decoded)) {
      return fallback;
    }
    if (!decoded.startsWith("/")) return fallback;
    return decoded;
  } catch {
    return fallback;
  }
}
