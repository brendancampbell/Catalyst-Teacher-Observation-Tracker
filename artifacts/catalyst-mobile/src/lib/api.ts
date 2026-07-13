import type {
  User,
  School,
  RubricSet,
  RubricDomain,
  RubricCategory,
  TeacherRow,
  Score,
  DraftObservation,
  CreateObservationPayload,
  UpdateObservationPayload,
} from "@workspace/api-types";

export type {
  User,
  School,
  RubricSet,
  RubricDomain,
  RubricCategory,
  Score,
  DraftObservation,
};

export type { TeacherRow };

export type { CreateObservationPayload, UpdateObservationPayload };

/** Backward-compatible alias: mobile callers import `Teacher` from this module. */
export type Teacher = TeacherRow;

const BASE = "";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/* ── Centralized 401 handler ───────────────────────────────────────────────
   Registered by AuthProvider on mount; torn down on unmount.
   Called synchronously before throwing, so the redirect fires before any
   React Query retry or component error state can render.                   */
let _unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  _unauthorizedHandler = fn;
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message: string;
    try { message = (JSON.parse(text) as { error?: string }).error ?? res.statusText; }
    catch { message = text || res.statusText; }
    const err = new HttpError(res.status, message);
    if (res.status === 401 && _unauthorizedHandler) {
      _unauthorizedHandler();
    }
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function createObservation(payload: CreateObservationPayload): Promise<{ id: string }> {
  return apiFetch<{ id: string }>("/api/observations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateObservation(id: string, payload: UpdateObservationPayload): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/observations/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function fetchMyDrafts(): Promise<DraftObservation[]> {
  return apiFetch<DraftObservation[]>("/api/observations/drafts");
}

export async function deleteObservation(id: string): Promise<void> {
  await apiFetch<void>(`/api/observations/${id}`, { method: "DELETE" });
}
