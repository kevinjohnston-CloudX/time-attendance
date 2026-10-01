import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getViewableSites } from "@/lib/presence/on-site.service";
import { siteScope, scansHereSql, type SiteScope } from "@/lib/presence/site-scope";

/**
 * Whether anything new happened at a building, asked every couple of seconds
 * by an open Live Attendance page so a scan or a gate refusal shows up within
 * moments rather than at the next 30 second refresh.
 *
 * <p>It answers two times and nothing else: the newest scan recorded at this
 * building (by the same rule every On Site view places scans, see
 * site-scope.ts), and the newest change to today's gate refusals here. The
 * page compares them with the last answer and reloads only what moved, so a
 * quiet building costs one small query per ask.
 *
 * <p>The viewer's site list and the building's warehouse numbers are kept for
 * a minute, because they change rarely and this is asked constantly. So a
 * viewer who loses a building keeps getting these two times for it for up to
 * a minute; everything that shows people still checks on every call.
 */

export interface SitePulse {
  /** ISO time the newest scan here was recorded, or null for none today. */
  scans: string | null;
  /** ISO time today's gate refusals here last changed, or null (also when not asked for, or switched off). */
  refusals: string | null;
}

const KEEP_MS = 60_000;
/** Scans a tablet flushes late still count, as long as they were made in the last day. */
const LOOK_BACK_MS = 24 * 60 * 60 * 1000;

const sitesSeen = new Map<string, { at: number; ids: Set<string> }>();
const scopes = new Map<string, { at: number; scope: SiteScope }>();

/** Whether this viewer may open this building, remembered for a minute. */
export async function canViewSite(
  tenantId: string,
  viewer: { employeeId: string; role: string },
  siteId: string,
): Promise<boolean> {
  const key = `${tenantId}|${viewer.employeeId}|${viewer.role}`;
  const hit = sitesSeen.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.ids.has(siteId);
  const sites = await getViewableSites(tenantId, viewer);
  const ids = new Set(sites.map((s) => s.id));
  sitesSeen.set(key, { at: Date.now(), ids });
  return ids.has(siteId);
}

async function scopeOf(tenantId: string, siteId: string): Promise<SiteScope> {
  const key = `${tenantId}|${siteId}`;
  const hit = scopes.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.scope;
  const scope = await siteScope(tenantId, siteId);
  scopes.set(key, { at: Date.now(), scope });
  return scope;
}

/** The caller has checked the viewer may see this building ({@link canViewSite}). */
export async function getSitePulse(tenantId: string, siteId: string, withRefusals: boolean): Promise<SitePulse> {
  const scope = await scopeOf(tenantId, siteId);
  const since = new Date(Date.now() - LOOK_BACK_MS);
  // Today's refusals by work date, and a building's today is never more than
  // a day behind the server's, so yesterday's date is a safe lower bound.
  const fromDay = new Date(`${since.toISOString().slice(0, 10)}T00:00:00.000Z`);
  // Null while the alert is switched off, so switching it off on one screen
  // clears the card on every other within seconds.
  const refusals = withRefusals
    ? Prisma.sql`(SELECT max(g."updatedAt") FROM "gate_refusals" g
                  JOIN "tenants" t ON t.id = g."tenantId"
                  WHERE g."tenantId" = ${tenantId} AND g."siteId" = ${siteId} AND g."workDate" >= ${fromDay}
                    AND t."gateAlertsOnSince" IS NOT NULL AND g."lastAt" >= t."gateAlertsOnSince")`
    : Prisma.sql`NULL::timestamp`;
  const [row] = await db.$queryRaw<{ scans: Date | null; refusals: Date | null }[]>`
    SELECT
      (SELECT max(s."createdAt")
       FROM   "scan_events" s
       LEFT   JOIN "employees" e ON e.id = s."employeeId"
       WHERE  s."tenantId" = ${tenantId}
         AND  s."stream" IN ('SECURITY', 'TIME_CLOCK')
         AND  s."scanTime" >= ${since}
         AND  ${scansHereSql(scope)}) AS scans,
      ${refusals} AS refusals
  `;
  return {
    scans: row?.scans ? new Date(row.scans).toISOString() : null,
    refusals: row?.refusals ? new Date(row.refusals).toISOString() : null,
  };
}
