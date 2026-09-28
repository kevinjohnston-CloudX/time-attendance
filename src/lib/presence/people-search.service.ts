import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, DAYS_BACK } from "./days";
import { photoUrls } from "./photos";
import { localDateString } from "./on-site.service";
import { MAX_PICKED } from "./search-limits";
import { scansHere, siteScope } from "./site-scope";
import { snapToLocalTime } from "@/lib/utils/date";
import { badgeWhere } from "@/lib/utils/badge-lookup";
import { NOT_SCREEN_ACCOUNT } from "./screen-accounts";

/**
 * Finding people to pin on Live Attendance, for the search box that holds
 * several people at once.
 *
 * <p>Only people this site's pages could show are found: everyone based at
 * the site, and anyone else who scanned here in the days Movements and the
 * Scan log reach back to. Somebody at another building who never came here is
 * not offered, so the box never pins a person the pages would have nothing on.
 */

export interface PickablePerson {
  id: string;
  name: string;
  employeeCode: string;
  department: string | null;
  inactive: boolean;
  photoUrl: string | null;
  /** The badge number typed, when that is what found them rather than their name or code. */
  badge: string | null;
}

export { MAX_PICKED };
/** The most a suggestion list shows. */
const SUGGESTIONS = 8;

/** The people a site's pages may show: based here, or scanned here in the last week. */
export async function reachable(tenantId: string, siteId: string): Promise<Prisma.EmployeeWhereInput> {
  const [site, scope] = await Promise.all([
    db.site.findFirst({ where: { id: siteId, tenantId }, select: { timezone: true } }),
    siteScope(tenantId, siteId),
  ]);
  const tz = site?.timezone || "America/New_York";
  const today = localDateString(new Date(), tz);
  const from = snapToLocalTime("00:00", addDays(today, -DAYS_BACK), tz);
  return {
    tenantId,
    ...NOT_SCREEN_ACCOUNT,
    OR: [{ siteId }, { scanEvents: { some: { tenantId, scanTime: { gte: from }, AND: [scansHere(scope)] } } }],
  };
}

const SELECT = {
  id: true,
  employeeCode: true,
  barcode: true,
  wmsId: true,
  isActive: true,
  terminatedAt: true,
  user: { select: { name: true } },
  department: { select: { name: true } },
} satisfies Prisma.EmployeeSelect;

type Row = Prisma.EmployeeGetPayload<{ select: typeof SELECT }>;

/**
 * Name, employee code, or a badge number. A badge only ever matches whole,
 * the way the time clock reads it (with or without leading zeros, and older
 * re-issued cards too), so typing part of a number never pulls in whoever
 * happens to share its digits. Text with a space in it is never a badge.
 */
function textWhere(text: string): Prisma.EmployeeWhereInput {
  return {
    OR: [
      { employeeCode: { contains: text, mode: "insensitive" } },
      { user: { name: { contains: text, mode: "insensitive" } } },
      ...(looksLikeBadge(text) ? [badgeWhere(text)] : []),
    ],
  };
}

export function looksLikeBadge(text: string): boolean {
  return /^[A-Za-z0-9-]{4,40}$/.test(text.trim());
}

function nameOrCodeMatches(r: Row, low: string): boolean {
  return r.employeeCode.toLowerCase().includes(low) || (r.user?.name ?? "").toLowerCase().includes(low);
}

async function shape(tenantId: string, rows: Row[], withPhotos: boolean, typed?: string): Promise<PickablePerson[]> {
  const photos = withPhotos ? await photoUrls(tenantId, rows) : new Map<string, string | null>();
  const low = typed?.trim().toLowerCase() ?? "";
  return rows.map((r) => ({
    id: r.id,
    name: r.user?.name ?? r.employeeCode,
    employeeCode: r.employeeCode,
    department: r.department?.name ?? null,
    inactive: !r.isActive || !!r.terminatedAt,
    photoUrl: photos.get(r.id) ?? null,
    badge: low && !nameOrCodeMatches(r, low) ? typed!.trim() : null,
  }));
}

const byName = (a: PickablePerson, b: PickablePerson) => a.name.localeCompare(b.name);

/** Suggestions for what is being typed: name, employee code or badge, best first. */
export async function suggestPeople(tenantId: string, siteId: string, q: string, exclude: string[]): Promise<PickablePerson[]> {
  const text = q.trim();
  if (!text) return [];
  const rows = await db.employee.findMany({
    where: {
      AND: [
        await reachable(tenantId, siteId),
        textWhere(text),
        ...(exclude.length ? [{ id: { notIn: exclude } }] : []),
      ],
    },
    select: SELECT,
    take: 40,
  });
  // Names that start with what was typed come first, then the rest.
  const low = text.toLowerCase();
  const rank = (r: Row) => {
    const name = (r.user?.name ?? "").toLowerCase();
    // A whole badge number is as exact as a match gets.
    if (r.employeeCode.toLowerCase() === low || name === low || !nameOrCodeMatches(r, low)) return 0;
    if (name.startsWith(low) || name.split(/\s+/).some((w) => w.startsWith(low))) return 1;
    return 2;
  };
  const best = rows
    .sort((a, b) => rank(a) - rank(b) || (a.user?.name ?? "").localeCompare(b.user?.name ?? ""))
    .slice(0, SUGGESTIONS);
  return shape(tenantId, best, true, text);
}

/** People by id, for search boxes restored from a link. Unknown ids drop out. */
export async function peopleByIds(tenantId: string, siteId: string, ids: string[]): Promise<PickablePerson[]> {
  if (!ids.length) return [];
  const rows = await db.employee.findMany({
    where: { AND: [await reachable(tenantId, siteId), { id: { in: ids.slice(0, MAX_PICKED) } }] },
    select: SELECT,
  });
  return (await shape(tenantId, rows, false)).sort(byName);
}

export interface ResolvedNames {
  found: PickablePerson[];
  /** Names that matched nobody. */
  missing: string[];
  /** Names that matched several people without one exact match, with how many. */
  unclear: { text: string; count: number }[];
  /** Names that matched several records exactly, all of which were added. */
  several: { text: string; count: number }[];
}

/**
 * A pasted list of names, codes or badge numbers, one person each: an exact
 * name, code or badge wins (every record with that exact name, since one
 * person can hold two);
 * otherwise a single partial match is taken; anything else is reported back
 * rather than guessed.
 */
export async function resolveNames(tenantId: string, siteId: string, names: string[]): Promise<ResolvedNames> {
  const wanted = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2 && n.length <= 80))].slice(0, MAX_PICKED);
  const scope = await reachable(tenantId, siteId);
  const found = new Map<string, Row>();
  const missing: string[] = [];
  const unclear: { text: string; count: number }[] = [];
  const several: { text: string; count: number }[] = [];
  for (const text of wanted) {
    const rows = await db.employee.findMany({
      where: {
        AND: [scope, textWhere(text)],
      },
      select: SELECT,
      take: 20,
    });
    const low = text.toLowerCase();
    const exact = rows.filter(
      (r) => r.employeeCode.toLowerCase() === low || (r.user?.name ?? "").toLowerCase() === low || !nameOrCodeMatches(r, low),
    );
    const take = exact.length ? exact : rows.length === 1 ? rows : [];
    if (exact.length > 1) several.push({ text, count: exact.length });
    if (take.length) take.forEach((r) => found.set(r.id, r));
    else if (rows.length === 0) missing.push(text);
    else unclear.push({ text, count: rows.length });
  }
  return { found: (await shape(tenantId, [...found.values()], false)).sort(byName), missing, unclear, several };
}
