/**
 * What an API key may read beyond the original external API. Leave types and
 * time off requests stay open to every active key, as they always were; each
 * scope here is off until a company admin turns it on for that key, so a new
 * endpoint never quietly widens what an existing key can reach.
 */

export const API_SCOPES = ["people:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_LABEL: Record<ApiScope, { title: string; line: string }> = {
  "people:read": {
    title: "Employee directory",
    line: "Names, usernames, both emails, badge IDs, site, department and supervisor. Never pay, address or date of birth.",
  },
};

/** Keeps only scopes this build knows, once each, in a fixed order. */
export function cleanScopes(scopes: readonly string[] | null | undefined): ApiScope[] {
  const set = new Set(scopes ?? []);
  return API_SCOPES.filter((s) => set.has(s));
}
