import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { badgeWhere } from "@/lib/utils/badge-lookup";

/**
 * The employee directory behind /api/external/people, for an API key that was
 * given "people:read". It says who a person is and where they sit, so another
 * system can match them: names, sign in names, both emails, the badge IDs, the
 * site, department, title, agency and supervisor of record.
 *
 * <p>What stays out, on purpose: pay and rates, date of birth, home address,
 * phone numbers, emergency contact, gender, marital status, leave and hours.
 * The select below is the whole list of what leaves; add to it deliberately.
 *
 * <p>Every query is scoped to the key's company in the where, never checked
 * after the fact, so an id from another company is simply not found.
 */

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 200;

const text = z.string().trim().min(1).max(200);

export const peopleQuerySchema = z.object({
  q: text.optional(),
  email: text.optional(),
  username: text.optional(),
  badge: text.optional(),
  employeeCode: text.optional(),
  siteId: text.optional(),
  status: z.enum(["active", "inactive", "all"]).default("all"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type PeopleQuery = z.infer<typeof peopleQuerySchema>;

const PERSON_SELECT = {
  id: true,
  employeeCode: true,
  wmsId: true,
  wmsName: true,
  barcode: true,
  isActive: true,
  hireDate: true,
  terminatedAt: true,
  jobTitle: true,
  jobTitleRef: { select: { name: true } },
  agencyRef: { select: { code: true, description: true } },
  site: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  supervisor: { select: { id: true, employeeCode: true, user: { select: { name: true } } } },
  badges: { select: { barcode: true }, orderBy: { createdAt: "asc" } },
  user: { select: { name: true, username: true, email: true, workEmail: true } },
} satisfies Prisma.EmployeeSelect;

type Row = Prisma.EmployeeGetPayload<{ select: typeof PERSON_SELECT }>;

/** A stored calendar day (saved as midnight UTC) as YYYY-MM-DD. */
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function toPerson(e: Row) {
  return {
    id: e.id,
    name: e.user.name,
    wmsName: e.wmsName,
    username: e.user.username,
    workEmail: e.user.workEmail,
    personalEmail: e.user.email,
    employeeCode: e.employeeCode,
    badgeId: e.wmsId,
    barcodes: [...new Set([e.barcode, ...e.badges.map((b) => b.barcode)].filter((b): b is string => !!b))],
    status: e.isActive ? "active" : "inactive",
    hireDate: day(e.hireDate),
    terminatedAt: day(e.terminatedAt),
    jobTitle: e.jobTitleRef?.name ?? e.jobTitle ?? null,
    site: e.site,
    department: e.department,
    agency: e.agencyRef ? { code: e.agencyRef.code, name: e.agencyRef.description } : null,
    supervisor: e.supervisor ? { id: e.supervisor.id, name: e.supervisor.user.name, employeeCode: e.supervisor.employeeCode } : null,
  };
}
export type ExternalPerson = ReturnType<typeof toPerson>;

/**
 * Logins holding this email (either column) or username, ignoring capitals.
 * Plain SQL with lower() on purpose: Prisma's insensitive match runs ILIKE,
 * where a sent % or _ is a wildcard and would match other people.
 */
async function userIdsMatching(field: "email" | "username", value: string): Promise<string[]> {
  const rows = field === "email"
    ? await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE lower(email) = lower(${value}::text) OR lower("workEmail") = lower(${value}::text) LIMIT 20`
    : await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE lower(username) = lower(${value}::text) LIMIT 20`;
  return rows.map((r) => r.id);
}

export async function listPeople(tenantId: string, query: PeopleQuery) {
  const and: Prisma.EmployeeWhereInput[] = [{ tenantId }];
  if (query.status !== "all") and.push({ isActive: query.status === "active" });
  if (query.siteId) and.push({ siteId: query.siteId });
  if (query.employeeCode) and.push({ employeeCode: query.employeeCode });
  if (query.badge) and.push(badgeWhere(query.badge));
  if (query.email) and.push({ userId: { in: await userIdsMatching("email", query.email) } });
  if (query.username) and.push({ userId: { in: await userIdsMatching("username", query.username) } });
  if (query.q) {
    // Within the key's own company, a % in a search only widens the search.
    const has = { contains: query.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { user: { name: has } },
        { user: { username: has } },
        { user: { email: has } },
        { user: { workEmail: has } },
        { wmsName: has },
        { employeeCode: has },
        { wmsId: has },
      ],
    });
  }

  const where: Prisma.EmployeeWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      select: PERSON_SELECT,
      orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { people: rows.map(toPerson), page: query.page, pageSize: query.pageSize, total };
}

export async function getPerson(tenantId: string, id: string) {
  const row = await db.employee.findFirst({ where: { id, tenantId }, select: PERSON_SELECT });
  return row ? toPerson(row) : null;
}
