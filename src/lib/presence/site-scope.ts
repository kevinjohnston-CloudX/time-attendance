import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Which scans happened at a building, for every On Site view.
 *
 * <p>A scan belongs to the building it was made at, not to the building on the
 * scanning person's record. Both readers post the warehouse number they sit in
 * (the `site` column), and a building's warehouse number is its
 * `wmsWarehouseId`, so a scan with that number is at that building whoever
 * made it. That is what brings a visitor from another site, a manager from the
 * corporate office, or somebody whose record names the wrong site onto the
 * board of the building they actually walked into.
 *
 * <p>A scan whose number belongs to no site (no number at all, the tablets'
 * old text codes such as "NJ3", an unknown gate) cannot be placed from the
 * scan alone, so it stays with the person's own site, which is how every scan
 * was placed before.
 *
 * <p>A badge that matches nobody has no person, and stays out of On Site as it
 * always has.
 */

export interface SiteScope {
  siteId: string;
  /** This building's warehouse number as the readers post it, or null when it has none. */
  code: string | null;
  /** Every warehouse number some site in the tenant owns. */
  placed: string[];
  /** Each site's name by its warehouse number, and by its id, to say which building another scan was at. */
  names: Record<string, string>;
  namesById: Record<string, string>;
}

export async function siteScope(tenantId: string, siteId: string): Promise<SiteScope> {
  const all = await db.site.findMany({
    where: { tenantId },
    select: { id: true, name: true, wmsWarehouseId: true },
  });
  const sites = all.filter((s) => s.wmsWarehouseId !== null);
  return {
    siteId,
    code: sites.find((s) => s.id === siteId)?.wmsWarehouseId?.toString() ?? null,
    placed: sites.map((s) => String(s.wmsWarehouseId)),
    names: Object.fromEntries(sites.map((s) => [String(s.wmsWarehouseId), s.name])),
    namesById: Object.fromEntries(all.map((s) => [s.id, s.name])),
  };
}

/**
 * The building a scan made somewhere else was at: the site that owns its
 * warehouse number, or else the person's own site, which is where a scan
 * with no number is placed (see above).
 */
export function siteOf(scope: SiteScope, code: string | null | undefined, homeSiteId: string | null | undefined): string {
  return (code && scope.names[code]) || (homeSiteId && scope.namesById[homeSiteId]) || "Another building";
}

/** Whether one scan was made at this building, by the same rule as {@link scansHere}. */
export function isHere(scope: SiteScope, code: string | null | undefined, homeSiteId: string | null | undefined): boolean {
  if (code && scope.placed.includes(code)) return code === scope.code;
  return homeSiteId === scope.siteId;
}

/**
 * The scans made anywhere but this building, for a Prisma where: another
 * site's warehouse number, or no number and somebody else's site on the
 * person's record. Written out rather than as NOT of the rule above, which a
 * null `site` would drop.
 */
export function scansElsewhere(scope: SiteScope): Prisma.ScanEventWhereInput {
  const unplaced: Prisma.ScanEventWhereInput[] = [{ site: null }];
  if (scope.placed.length) unplaced.push({ site: { notIn: scope.placed } });
  else unplaced.push({ site: { not: null } });
  return {
    OR: [
      { site: { in: scope.placed.filter((c) => c !== scope.code) } },
      { OR: unplaced, employee: { siteId: { not: scope.siteId } } },
    ],
  };
}

/** The scans made at this building, for a Prisma where. */
export function scansHere(scope: SiteScope): Prisma.ScanEventWhereInput {
  const unplaced: Prisma.ScanEventWhereInput[] = [{ site: null }];
  if (scope.placed.length) unplaced.push({ site: { notIn: scope.placed } });
  else unplaced.push({ site: { not: null } });
  return {
    OR: [
      ...(scope.code ? [{ site: scope.code, employeeId: { not: null } }] : []),
      { employee: { siteId: scope.siteId }, OR: unplaced },
    ],
  };
}

/**
 * The same rule for raw SQL, over a scan aliased `s` joined to its employee
 * aliased `e`.
 */
export function scansHereSql(scope: SiteScope): Prisma.Sql {
  return Prisma.sql`(
    (${scope.code}::text IS NOT NULL AND s."site" = ${scope.code}::text)
    OR (e."siteId" = ${scope.siteId} AND (s."site" IS NULL OR s."site" <> ALL(${scope.placed}::text[])))
  )`;
}
