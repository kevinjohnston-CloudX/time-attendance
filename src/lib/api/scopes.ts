/**
 * What an API key may do. Each scope is off until a company admin turns it on
 * for that key, so a new endpoint never quietly widens what an existing key
 * can reach. Time off was open to every key until the security audit
 * (2026-11, M5): a key made only to read the directory could file time off
 * for anyone in the company.
 */

export const API_SCOPES = ["time-off:write", "people:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_LABEL: Record<ApiScope, { title: string; line: string }> = {
  "time-off:write": {
    title: "Time off requests",
    line: "Reads leave types and sends time off requests for anyone in the company.",
  },
  "people:read": {
    title: "Employee directory",
    line: "Names, usernames, both emails, phone numbers, badge IDs, site, department and supervisor. Never pay, address or date of birth.",
  },
};

/** Keeps only scopes this build knows, once each, in a fixed order. */
export function cleanScopes(scopes: readonly string[] | null | undefined): ApiScope[] {
  const set = new Set(scopes ?? []);
  return API_SCOPES.filter((s) => set.has(s));
}
