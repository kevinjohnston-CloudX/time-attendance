import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, DAYS_BACK } from "./days";
import { photoUrls } from "./photos";
import { localDateString } from "./on-site.service";
import { MAX_PICKED } from "./search-limits";
import { scansHere, siteScope } from "./site-scope";
import { snapToLocalTime } from "@/lib/utils/date";

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
}

export { MAX_PICKED };
/** The most a suggestion list shows. */
const SUGGESTIONS = 8;

async function reachable(tenantId: string, siteId: string): Promise<Prisma.EmployeeWhereInput> {
  const [site, scope] = await Promise.all([
    db.site.findFirst({ where: { id: siteId, tenantId }, select: { timezone: true } }),
    siteScope(tenantId, siteId),
  ]);
  const tz = site?.timezone || "America/New_York";
  const today = localDateString(new Date(), tz);
  const from = snapToLocalTime("00:00", addDays(today, -DAYS_BACK), tz);
  return {
    tenantId,
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

async function shape(tenantId: string, rows: Row[], withPhotos: boolean): Promise<PickablePerson[]> {
  const photos = withPhotos ? await photoUrls(tenantId, rows) : new Map<string, string | null>();
  return rows.map((r) => ({
    id: r.id,
    name: r.user?.name ?? r.employeeCode,
    employeeCode: r.employeeCode,
    department: r.department?.name ?? null,
    inactive: !r.isActive || !!r.terminatedAt,
    photoUrl: photos.get(r.id) ?? null,
  }));
}

const byName = (a: PickablePerson, b: PickablePerson) => a.name.localeCompare(b.name);

/** Suggestions for what is being typed: name or employee code, best first. */
export async function suggestPeople(tenantId: string, siteId: string, q: string, exclude: string[]): Promise<PickablePerson[]> {
  const text = q.trim();
  if (!text) return [];
  const rows = await db.employee.findMany({
    where: {
      AND: [
        await reachable(tenantId, siteId),
        {
          OR: [
            { employeeCode: { contains: text, mode: "insensitive" } },
            { user: { name: { contains: text, mode: "insensitive" } } },
          ],
        },
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
    if (r.employeeCode.toLowerCase() === low || name === low) return 0;
    if (name.startsWith(low) || name.split(/\s+/).some((w) => w.startsWith(low))) return 1;
    return 2;
  };
  const best = rows
    .sort((a, b) => rank(a) - rank(b) || (a.user?.name ?? "").localeCompare(b.user?.name ?? ""))
    .slice(0, SUGGESTIONS);
  return shape(tenantId, best, true);
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
 * A pasted list of names or codes, one person each: an exact name or code
 * wins (every record with that exact name, since one person can hold two);
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
        AND: [
          scope,
          {
            OR: [
              { employeeCode: { contains: text, mode: "insensitive" } },
              { user: { name: { contains: text, mode: "insensitive" } } },
            ],
          },
        ],
      },
      select: SELECT,
      take: 20,
    });
    const low = text.toLowerCase();
    const exact = rows.filter((r) => r.employeeCode.toLowerCase() === low || (r.user?.name ?? "").toLowerCase() === low);
    const take = exact.length ? exact : rows.length === 1 ? rows : [];
    if (exact.length > 1) several.push({ text, count: exact.length });
    if (take.length) take.forEach((r) => found.set(r.id, r));
    else if (rows.length === 0) missing.push(text);
    else unclear.push({ text, count: rows.length });
  }
  return { found: (await shape(tenantId, [...found.values()], false)).sort(byName), missing, unclear, several };
}
