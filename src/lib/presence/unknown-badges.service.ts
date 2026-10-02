import { shownName } from "@/lib/utils/shown-name";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { snapToLocalTime } from "@/lib/utils/date";
import { addDays, clampDay } from "./days";
import { localDateString } from "./on-site.service";

/**
 * Badges scanned at one building on one day that match nobody in CloudTime.
 *
 * <p>Every scan is stored, matched or not (see recordScanEvent), but the rest
 * of Live Attendance is built from people, so a badge with no person never
 * appeared anywhere. Those are exactly the people loss prevention needs to
 * see: somebody walking the building whom CloudTime cannot pay, because every
 * time clock scan they make is refused.
 *
 * <p><b>Placing a scan.</b> With no person there is no home site to fall back
 * on, so a scan is placed only by the reader's warehouse number (`site`),
 * which is this site's `wmsWarehouseId`. That column is unique across every
 * tenant, so a number names one building in one company. Readers posting a
 * code no site owns ("CAN", "NJ3", a gate id nobody entered) cannot be
 * placed and are left out; a site with no number shows nothing, and says so.
 *
 * <p><b>Tenant.</b> An unmatched scan usually has no tenant stored, because
 * the tenant is copied from the person. Rows are taken when their tenant is
 * this one or empty, and only ever at this tenant's own building number.
 *
 * <p><b>Names.</b> The WMS roster sync stages an Oracle employee CloudTime
 * lacks once their badge is refused at a time clock (RosterCandidate), with
 * their name and department. A badge seen only at the gate has usually never
 * been staged, so it has no name here.
 *
 * <p>Counted in the database: one grouped query over the day, then two
 * lookups for names and for records created since, both by badge.
 */

export interface UnknownBadge {
  badgeCode: string;
  /** From the WMS, when the roster sync has staged this badge. */
  wmsName: string | null;
  wmsDepartment: string | null;
  firstSeen: string;
  lastSeen: string;
  /** Where the latest scan was made, as the reader names itself. */
  lastReader: string | null;
  gateScans: number;
  /** Time clock scans, every one refused for want of a person. */
  refusedPunches: number;
  /**
   * Somebody holds this badge now. They were added after these scans, which
   * stay unmatched and whose punches were never recorded.
   */
  addedAs: {
    id: string;
    name: string;
    /**
     * How the badge became theirs, from the audit log: a new record, or the
     * badge put on a record that already existed. Null when no entry says.
     */
    how: "created" | "badge" | null;
    /** Who did it and when, from the same entry. */
    by: string | null;
    at: string | null;
  } | null;
  /** Where the badge stands in the WMS review queue, or null if never staged. */
  reviewStatus: "NEW" | "IGNORED" | "RESOLVED" | null;
}

export interface UnknownBadgeDay {
  day: string;
  timezone: string;
  /** False when the site has no warehouse number, so nothing can be placed. */
  placeable: boolean;
  badges: UnknownBadge[];
  totals: { badges: number; gateScans: number; refusedPunches: number };
}

/** A generous ceiling: a bad day at the busiest site is a few hundred rows. */
const MAX_ROWS = 5000;

/** The forms a badge is matched in: as scanned, and without leading zeros. */
function forms(code: string): string[] {
  const t = code.trim();
  const s = t.replace(/^0+/, "");
  return s && s !== t ? [t, s] : [t];
}

export async function getUnknownBadges(
  tenantId: string,
  siteId: string,
  rawDay: string | null,
): Promise<UnknownBadgeDay | null> {
  const site = await db.site.findFirst({
    where: { id: siteId, tenantId, isActive: true },
    select: { timezone: true, wmsWarehouseId: true },
  });
  if (!site) return null;

  const timezone = site.timezone || "America/New_York";
  const today = localDateString(new Date(), timezone);
  const day = clampDay(rawDay, today) ?? today;
  const empty = { day, timezone, badges: [], totals: { badges: 0, gateScans: 0, refusedPunches: 0 } };
  if (site.wmsWarehouseId === null) return { ...empty, placeable: false };

  const where: Prisma.ScanEventWhereInput = {
    employeeId: null,
    site: String(site.wmsWarehouseId),
    OR: [{ tenantId }, { tenantId: null }],
    scanTime: {
      gte: snapToLocalTime("00:00", day, timezone),
      lt: snapToLocalTime("00:00", addDays(day, 1), timezone),
    },
  };

  const [groups, latest] = await Promise.all([
    db.scanEvent.groupBy({
      by: ["badgeCode", "stream"],
      where,
      _count: { _all: true },
      _min: { scanTime: true },
      _max: { scanTime: true },
    }),
    db.scanEvent.findMany({
      where,
      orderBy: [{ scanTime: "desc" }, { id: "desc" }],
      take: MAX_ROWS,
      select: { badgeCode: true, deviceName: true },
    }),
  ]);
  if (groups.length === 0) return { ...empty, placeable: true };

  const byBadge = new Map<string, { gate: number; clock: number; first: Date; last: Date }>();
  for (const g of groups) {
    const cur = byBadge.get(g.badgeCode) ?? { gate: 0, clock: 0, first: g._min.scanTime!, last: g._max.scanTime! };
    if (g.stream === "SECURITY") cur.gate += g._count._all;
    else cur.clock += g._count._all;
    if (g._min.scanTime! < cur.first) cur.first = g._min.scanTime!;
    if (g._max.scanTime! > cur.last) cur.last = g._max.scanTime!;
    byBadge.set(g.badgeCode, cur);
  }
  // Newest first, so the first reader seen per badge is its latest.
  const lastReader = new Map<string, string | null>();
  for (const r of latest) if (!lastReader.has(r.badgeCode)) lastReader.set(r.badgeCode, r.deviceName);

  const codes = [...byBadge.keys()];
  const allForms = [...new Set(codes.flatMap(forms))];

  const [candidates, holders] = await Promise.all([
    db.rosterCandidate.findMany({
      where: { tenantId, barcode: { in: allForms } },
      select: { barcode: true, name: true, departmentName: true, status: true, lastSeenAt: true },
      orderBy: { lastSeenAt: "desc" },
    }),
    db.employee.findMany({
      where: {
        tenantId,
        OR: [
          { barcode: { in: allForms } },
          { badges: { some: { barcode: { in: allForms } } } },
          { wmsId: { in: codes.map((c) => c.trim()) } },
        ],
      },
      select: {
        id: true,
        barcode: true,
        wmsId: true,
        employeeCode: true,
        createdAt: true,
        wmsName: true,
        user: { select: { name: true } },
        badges: { select: { barcode: true } },
      },
    }),
  ]);

  // Who gave each holder their badge: the entry that created the record, or,
  // for a record older than the scans, the edit that set its badge.
  const audits = holders.length
    ? await db.auditLog.findMany({
        where: {
          tenantId,
          entityType: "EMPLOYEE",
          entityId: { in: holders.map((h) => h.id) },
          action: { in: ["EMPLOYEE_CREATED", "EMPLOYEE_UPDATED"] },
          createdAt: { gte: snapToLocalTime("00:00", addDays(day, -30), timezone) },
        },
        orderBy: { createdAt: "desc" },
        select: {
          entityId: true,
          action: true,
          changes: true,
          createdAt: true,
          actor: { select: { user: { select: { name: true } } } },
        },
      })
    : [];
  const setsBadge = (changes: unknown) =>
    Array.isArray((changes as { fields?: unknown })?.fields) &&
    (changes as { fields: { field?: string }[] }).fields.some((f) => /badge|barcode/i.test(f.field ?? ""));
  const addedBy = (holderId: string, createdAt: Date, firstScan: Date) => {
    const mine = audits.filter((a) => a.entityId === holderId);
    const entry =
      createdAt >= firstScan
        ? mine.find((a) => a.action === "EMPLOYEE_CREATED")
        : mine.find((a) => a.action === "EMPLOYEE_UPDATED" && a.createdAt >= firstScan && setsBadge(a.changes));
    const how: "created" | "badge" = createdAt >= firstScan ? "created" : "badge";
    return entry
      ? { how, by: entry.actor?.user?.name?.trim() || "The system", at: entry.createdAt.toISOString() }
      : { how: createdAt >= firstScan ? how : null, by: null, at: createdAt >= firstScan ? createdAt.toISOString() : null };
  };

  const candidateFor = (code: string) => {
    const f = forms(code);
    return candidates.find((c) => c.barcode !== null && f.includes(c.barcode)) ?? null;
  };
  // The same rule the time clock matches on (badge-lookup.ts): the badge in
  // either form, any extra card on file, or the WMS id taken literally.
  const holderFor = (code: string) => {
    const f = forms(code);
    return (
      holders.find(
        (e) =>
          (e.barcode !== null && f.includes(e.barcode)) ||
          e.badges.some((b) => f.includes(b.barcode)) ||
          e.wmsId === code.trim(),
      ) ?? null
    );
  };

  const badges: UnknownBadge[] = codes.map((code) => {
    const s = byBadge.get(code)!;
    const c = candidateFor(code);
    const h = holderFor(code);
    return {
      badgeCode: code,
      wmsName: c?.name ?? null,
      wmsDepartment: c?.departmentName ?? null,
      firstSeen: s.first.toISOString(),
      lastSeen: s.last.toISOString(),
      lastReader: lastReader.get(code) ?? null,
      gateScans: s.gate,
      refusedPunches: s.clock,
      addedAs: h
        ? { id: h.id, name: shownName(h), ...addedBy(h.id, h.createdAt, s.first) }
        : null,
      reviewStatus: c?.status ?? null,
    };
  });

  // Whoever is losing pay first, then whoever was seen most recently.
  badges.sort((a, b) => b.refusedPunches - a.refusedPunches || b.lastSeen.localeCompare(a.lastSeen));

  return {
    day,
    timezone,
    placeable: true,
    badges,
    totals: {
      badges: badges.length,
      gateScans: badges.reduce((n, b) => n + b.gateScans, 0),
      refusedPunches: badges.reduce((n, b) => n + b.refusedPunches, 0),
    },
  };
}
