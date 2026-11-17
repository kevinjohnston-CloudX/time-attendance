import { db } from "@/lib/db";
import { snapToLocalTime } from "@/lib/utils/date";
import { shownName } from "@/lib/utils/shown-name";
import { CLIENT_BADGE_PREFIX } from "@/lib/utils/client-badge";
import { addDays as addPassDays, passStanding, type PassStanding, type VisitorKind, type VisitorTerm } from "@/lib/visitors/visitor-pass";
import { addDays, clampDay } from "./days";
import { localDateString } from "./on-site.service";
import { photoUrls } from "./photos";
import { scansHereSql, siteScope } from "./site-scope";

/**
 * One building's visitors on one day, for the Visitors panel on the Scan log
 * and the list it opens.
 *
 * <p><b>Who is in it.</b> Everyone allowed in that day (a pass for this
 * building, valid on the day, not ended before it), plus any visitor who
 * scanned the gate here or was refused at it that day, pass or not. A pass
 * holds no visit date, so "allowed in" is the most CloudTime can honestly say
 * about who is expected (Juan, 2026-11-17).
 *
 * <p><b>Inside now</b> is not decided here: the board already knows who is in
 * the building, and the panel reads it from there so the two never disagree.
 * This gives each visitor's gate scans that day, which is what a past day has.
 *
 * <p>Read only. Counted in the database: one grouped query over the day's
 * visitor gate scans, one for the passes, one for the refusals.
 */

/** A pass ending within this many days is "ending this week", as the Visitors window counts it. */
export const VISITOR_ENDING_DAYS = 7;
const MAX_ROWS = 1000;

export interface VisitorDayRow {
  id: string;
  name: string;
  badge: string;
  company: string | null;
  visiting: string | null;
  photoUrl: string | null;
  /** Their pass, wherever it is for; null for a visitor badge with none. */
  pass: {
    kind: VisitorKind;
    term: VisitorTerm;
    validFrom: string;
    validUntil: string;
    /** How the pass stood on the day, at this building. */
    standing: PassStanding;
  } | null;
  /** A pass for this building, good on the day. */
  allowed: boolean;
  /** Allowed, with a last day in the coming week. */
  endingSoon: boolean;
  /** Gate scans here that day, repeat reads left out. */
  scans: number;
  firstIn: string | null;
  lastScan: { direction: "IN" | "OUT"; at: string } | null;
  /** The gate refused their badge here that day. */
  refusal: { reason: string; at: string; attempts: number } | null;
}

export interface VisitorDay {
  day: string;
  today: string;
  timezone: string;
  rows: VisitorDayRow[];
  totals: { allowed: number; cameIn: number; scans: number; refused: number; endingSoon: number };
  capped: boolean;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function getVisitorDay(tenantId: string, siteId: string, askedDay?: string | null): Promise<VisitorDay | null> {
  const [site, scope] = await Promise.all([
    db.site.findFirst({ where: { id: siteId, tenantId, isActive: true }, select: { timezone: true } }),
    siteScope(tenantId, siteId),
  ]);
  if (!site) return null;
  const timezone = site.timezone || "America/New_York";
  const today = localDateString(new Date(), timezone);
  const day = clampDay(askedDay ?? null, today) ?? today;
  const dayStart = snapToLocalTime("00:00", day, timezone);
  const dayEnd = snapToLocalTime("00:00", addDays(day, 1), timezone);
  const dayDate = new Date(`${day}T00:00:00Z`);

  const [passes, scanned, refusals] = await Promise.all([
    // Allowed in that day: ended only counts once it had happened.
    db.visitorPass.findMany({
      where: {
        tenantId,
        siteId,
        validFrom: { lte: dayDate },
        validUntil: { gte: dayDate },
        OR: [{ endedAt: null }, { endedAt: { gte: dayEnd } }],
        employee: { isActive: true },
      },
      take: MAX_ROWS + 1,
      select: { employeeId: true },
    }),
    // Each visitor's gate scans here that day, in one grouped query.
    db.$queryRaw<{ employeeId: string; scans: number; firstIn: Date | null; lastAt: Date; lastDirection: string }[]>`
      SELECT s."employeeId",
             count(*)::int AS scans,
             min(s."scanTime") FILTER (WHERE s.direction = 'IN') AS "firstIn",
             max(s."scanTime") AS "lastAt",
             (array_agg(s.direction::text ORDER BY s."scanTime" DESC))[1] AS "lastDirection"
      FROM scan_events s
      JOIN employees e ON e.id = s."employeeId"
      WHERE s."tenantId" = ${tenantId}
        AND s.stream = 'SECURITY'
        AND s."scanTime" >= ${dayStart} AND s."scanTime" < ${dayEnd}
        AND s.direction IN ('IN', 'OUT')
        AND s."directionSource" IS DISTINCT FROM 'REREAD'
        AND e."tenantId" = ${tenantId}
        AND e."wmsId" LIKE ${CLIENT_BADGE_PREFIX + "%"}
        AND ${scansHereSql(scope)}
      GROUP BY s."employeeId"
      LIMIT ${MAX_ROWS + 1}`,
    db.gateRefusal.findMany({
      where: { tenantId, siteId, workDate: dayDate, reason: { startsWith: "VISITOR_" } },
      take: MAX_ROWS + 1,
      select: { employeeId: true, reason: true, lastAt: true, attempts: true },
    }),
  ]);

  const allowedIds = new Set(passes.map((p) => p.employeeId));
  const scanBy = new Map(scanned.map((s) => [s.employeeId, s]));
  const refusalBy = new Map(refusals.map((r) => [r.employeeId, r]));
  const ids = [...new Set([...allowedIds, ...scanBy.keys(), ...refusalBy.keys()])];
  const capped = passes.length > MAX_ROWS || scanned.length > MAX_ROWS || refusals.length > MAX_ROWS || ids.length > MAX_ROWS;

  const people = ids.length
    ? await db.employee.findMany({
        where: { tenantId, id: { in: ids.slice(0, MAX_ROWS) } },
        select: {
          id: true,
          barcode: true,
          wmsId: true,
          employeeCode: true,
          wmsName: true,
          user: { select: { name: true } },
          visitorPass: {
            select: { siteId: true, kind: true, term: true, company: true, hostName: true, validFrom: true, validUntil: true, endedAt: true, host: { select: { user: { select: { name: true } } } } },
          },
        },
      })
    : [];
  const photos = await photoUrls(tenantId, people);
  const soonUntil = addPassDays(day, VISITOR_ENDING_DAYS - 1);

  const rows = people.map((p): VisitorDayRow => {
    const pass = p.visitorPass;
    const validFrom = pass ? ymd(pass.validFrom) : "";
    const validUntil = pass ? ymd(pass.validUntil) : "";
    const endedBy = pass?.endedAt && pass.endedAt < dayEnd ? pass.endedAt : null;
    const allowed = allowedIds.has(p.id);
    const s = scanBy.get(p.id);
    const r = refusalBy.get(p.id);
    return {
      id: p.id,
      name: shownName(p),
      badge: p.wmsId ?? "",
      company: pass?.company?.trim() || null,
      visiting: pass?.hostName?.trim() || pass?.host?.user?.name?.trim() || null,
      photoUrl: photos.get(p.id) ?? null,
      pass: pass
        ? {
            kind: pass.kind as VisitorKind,
            term: pass.term as VisitorTerm,
            validFrom,
            validUntil,
            standing: passStanding({ siteId: pass.siteId, validFrom, validUntil, endedAt: endedBy }, day, siteId),
          }
        : null,
      allowed,
      endingSoon: allowed && validUntil <= soonUntil,
      scans: s?.scans ?? 0,
      firstIn: s?.firstIn ? new Date(s.firstIn).toISOString() : null,
      lastScan: s ? { direction: s.lastDirection === "OUT" ? "OUT" : "IN", at: new Date(s.lastAt).toISOString() } : null,
      refusal: r ? { reason: r.reason, at: r.lastAt.toISOString(), attempts: r.attempts } : null,
    };
  });
  rows.sort((a, b) => (b.lastScan?.at ?? b.refusal?.at ?? "").localeCompare(a.lastScan?.at ?? a.refusal?.at ?? "") || a.name.localeCompare(b.name));

  return {
    day,
    today,
    timezone,
    rows,
    totals: {
      allowed: rows.filter((r) => r.allowed).length,
      cameIn: rows.filter((r) => r.firstIn).length,
      scans: rows.reduce((n, r) => n + r.scans, 0),
      refused: rows.filter((r) => r.refusal).length,
      endingSoon: rows.filter((r) => r.endingSoon).length,
    },
    capped,
  };
}
