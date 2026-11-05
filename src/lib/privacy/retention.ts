import { db } from "@/lib/db";
import { photoUrls } from "@/lib/presence/photos";
import { retentionYears, type DataProtection } from "./data-protection";

/**
 * Who is due under a company's retention settings (DataProtection.retention
 * and leaverPhotos), for the review on Company Settings. Read only: nothing
 * here changes anyone. HR downloads the batch, then confirms it, and the
 * action does the work person by person with every check made again.
 *
 * <p>Only people who have left and have a leaving date are ever listed. A
 * leaver without one is counted so HR can add it, never guessed from their
 * last punch.
 */

/** People handled in one go: small enough for one download and one request. */
export const RETENTION_BATCH = 25;

/**
 * January 1 (UTC) of the oldest year still kept. A leaver who left before it
 * is past the period: left in 2019 with 6 years, kept through the end of 2025,
 * listed from January 1, 2026.
 */
export function retentionCutoff(years: number, now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear() - years, 0, 1));
}

/** A leaver who left before this is due for their photo to be deleted. */
export function photoCutoff(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export interface DueLeaver {
  id: string;
  name: string;
  employeeCode: string;
  /** The leaving date, as yyyy-mm-dd. */
  leftOn: string;
}

export interface RetentionList {
  /** Everyone due, and the oldest {@link RETENTION_BATCH} of them, oldest first. */
  count: number;
  batch: DueLeaver[];
}

const ANONYMISED_PREFIX = "Former employee ";

/** People this admin may open: their company and, when held to some sites, those sites. */
type Reach = { tenantId: string; sites: string[] | null };

function leavers(reach: Reach) {
  return { tenantId: reach.tenantId, isActive: false, ...(reach.sites ? { siteId: { in: reach.sites } } : {}) };
}

const asDue = (e: { id: string; employeeCode: string; terminatedAt: Date | null; user: { name: string | null } }): DueLeaver => ({
  id: e.id,
  name: e.user.name ?? e.employeeCode,
  employeeCode: e.employeeCode,
  leftOn: e.terminatedAt ? e.terminatedAt.toISOString().slice(0, 10) : "",
});

/** Leavers past the retention period and not yet anonymised. Null when retention is off or has no period. */
export async function leaversDue(reach: Reach, settings: DataProtection, now: Date): Promise<RetentionList | null> {
  const years = retentionYears(settings.retention);
  if (!settings.retention.enabled || !years) return null;
  const where = {
    ...leavers(reach),
    terminatedAt: { lt: retentionCutoff(years, now) },
    NOT: { user: { name: { startsWith: ANONYMISED_PREFIX } } },
  };
  const [count, rows] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      orderBy: [{ terminatedAt: "asc" }, { employeeCode: "asc" }],
      take: RETENTION_BATCH,
      select: { id: true, employeeCode: true, terminatedAt: true, user: { select: { name: true } } },
    }),
  ]);
  return { count, batch: rows.map(asDue) };
}

/**
 * Leavers past the photo period whose photo is still there. Null when the
 * switch is off. Looks the photos up for every such leaver, from the photo
 * list already held in memory, so it is only run when HR opens the review.
 */
export async function photosDue(reach: Reach, settings: DataProtection, now: Date): Promise<RetentionList | null> {
  if (!settings.leaverPhotos.enabled) return null;
  const rows = await db.employee.findMany({
    where: { ...leavers(reach), terminatedAt: { lt: photoCutoff(settings.leaverPhotos.days, now) } },
    orderBy: [{ terminatedAt: "asc" }, { employeeCode: "asc" }],
    select: { id: true, employeeCode: true, barcode: true, wmsId: true, terminatedAt: true, user: { select: { name: true } } },
  });
  const urls = await photoUrls(reach.tenantId, rows, { evenWhereOff: true });
  const withPhoto = rows.filter((r) => urls.get(r.id));
  return { count: withPhoto.length, batch: withPhoto.slice(0, RETENTION_BATCH).map(asDue) };
}

/** Leavers with no leaving date: never listed, so HR can see how many to fix. */
export function leaversWithoutDate(reach: Reach): Promise<number> {
  return db.employee.count({ where: { ...leavers(reach), terminatedAt: null } });
}
