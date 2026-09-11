import { db } from "@/lib/db";
import { LEGACY_MAP, type PermissionTuple } from "./legacy-map";

// Reverse map: (resource|action|scope) → legacy permission key
const REVERSE_MAP = new Map<string, string>(
  Object.entries(LEGACY_MAP).map(([key, t]) => [`${t.resource}|${t.action}|${t.scope}`, key])
);

type CacheEntry = {
  permissions: { resource: string; action: string; scope: string }[];
  expiresAt: number;
};

const CACHE_TTL_MS = 60_000; // 60 seconds
const cache = new Map<string, CacheEntry>();

/**
 * Scope hierarchy: "all" subsumes "team" subsumes "own".
 */
const SCOPE_RANK: Record<string, number> = { own: 0, team: 1, all: 2 };

/**
 * Fetches permissions for a customRoleId from DB, with in-memory cache.
 */
async function getPermissions(
  customRoleId: string
): Promise<{ resource: string; action: string; scope: string }[]> {
  const now = Date.now();
  const cached = cache.get(customRoleId);
  if (cached && cached.expiresAt > now) {
    return cached.permissions;
  }

  const rows = await db.rolePermission.findMany({
    where: { customRoleId },
    select: { resource: true, action: true, scope: true },
  });

  cache.set(customRoleId, { permissions: rows, expiresAt: now + CACHE_TTL_MS });
  return rows;
}

/**
 * Check if a customRoleId has a specific permission.
 * Scope subsumption: having "all" scope grants "team" and "own" too.
 */
export async function hasPermissionAsync(
  customRoleId: string | null | undefined,
  resource: string,
  action: string,
  scope: string
): Promise<boolean> {
  if (!customRoleId) return false;

  const permissions = await getPermissions(customRoleId);
  const requiredRank = SCOPE_RANK[scope] ?? 0;

  return permissions.some(
    (p) =>
      p.resource === resource &&
      p.action === action &&
      (SCOPE_RANK[p.scope] ?? 0) >= requiredRank
  );
}

/**
 * Check a legacy permission string against a customRoleId.
 */
export async function hasPermissionByLegacy(
  customRoleId: string | null | undefined,
  legacyPermission: string
): Promise<boolean> {
  const tuple = LEGACY_MAP[legacyPermission];
  if (!tuple) return false;
  return hasPermissionAsync(customRoleId, tuple.resource, tuple.action, tuple.scope);
}

/**
 * Get all permission tuples for a customRoleId (for sidebar filtering, etc.)
 */
export async function getAllPermissions(
  customRoleId: string | null | undefined
): Promise<PermissionTuple[]> {
  if (!customRoleId) return [];
  const rows = await getPermissions(customRoleId);
  return rows as PermissionTuple[];
}

/**
 * Returns all legacy permission strings granted by a customRoleId.
 * Used by the portal layout to build the sidebar's permission list from the DB.
 * Scope subsumption: having "all" scope also grants "team" and "own" for the same resource+action.
 */
export async function getLegacyPermissions(customRoleId: string | null | undefined): Promise<string[]> {
  if (!customRoleId) return [];
  const rows = await getPermissions(customRoleId);
  const granted = new Set<string>();

  for (const [key, tuple] of Object.entries(LEGACY_MAP)) {
    const requiredRank = SCOPE_RANK[tuple.scope] ?? 0;
    const has = rows.some(
      (p) =>
        p.resource === tuple.resource &&
        p.action === tuple.action &&
        (SCOPE_RANK[p.scope] ?? 0) >= requiredRank
    );
    if (has) granted.add(key);
  }

  return Array.from(granted);
}

/**
 * Invalidate the cache for a specific role (call after permission updates).
 */
export function invalidateRoleCache(customRoleId: string): void {
  cache.delete(customRoleId);
}

/**
 * Invalidate all cached roles (call sparingly).
 */
export function invalidateAllRoleCache(): void {
  cache.clear();
}
