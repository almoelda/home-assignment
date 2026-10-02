import type { Identity } from "../state/IdentityContext.js";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

/**
 * X-Actor-Role / X-Actor-Id — a soft hint, not auth (see IdentityContext). Every mutating
 * or actor-scoped request sends these; the API trusts them as-is.
 */
export function actorHeaders(identity: Identity | null): Record<string, string> {
  if (!identity) return {};
  return { "X-Actor-Role": identity.role, "X-Actor-Id": String(identity.id) };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // `...init` spreads FIRST: init's own `headers` key must be merged on top, not left to
  // clobber the whole options object (which would also erase Content-Type whenever a caller
  // passes custom headers — exactly the bug this fixes, caught by the Playwright E2E test
  // when every actor-scoped request started failing with a JSON body-parse error).
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? `Request failed with status ${res.status}`,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
