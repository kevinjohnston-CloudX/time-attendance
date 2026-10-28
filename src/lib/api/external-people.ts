import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { badgeWhere } from "@/lib/utils/badge-lookup";
import { decryptPii } from "@/lib/crypto/pii";

/**
 * The employee directory behind /api/external/people, for an API key that was
 * given "people:read". It says who a person is and where they sit, so another
 * system can match them: names, sign in names, both emails, the company, the
 * two phone numbers, the badge IDs, the site, department, title, agency and
 * supervisor of record, and when the record last changed.
 *
 * <p>What stays out, on purpose: pay and rates, date of birth, home address,
 * emergency contact, gender, marital status, leave and hours. The select below
 * is the whole list of what leaves; add to it deliberately.
 *
 * <p>Every query is scoped to the key's company in the where, never checked
 * after the fact, so an id from another company is simply not found.
 */

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 1000;

const text = z.string().trim().min(1).max(200);

export const peopleQuerySchema = z.object({
  q: text.optional(),
  email: text.optional(),
  username: text.optional(),
  badge: text.optional(),
  employeeCode: text.optional(),
  siteId: text.optional(),
  status: z.enum(["active", "on_leave", "inactive", "all"]).default("all"),
  modifiedSince: z.iso.datetime({ offset: true }).transform((s) => new Date(s)).optional(),
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
  onLeave: true,
  hireDate: true,
  terminatedAt: true,
  jobTitle: true,
  phone: true,
  phone2: true,
  updatedAt: true,
  jobTitleRef: { select: { name: true } },
  agencyRef: { select: { code: true, description: true } },
  site: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  supervisor: { select: { id: true, employeeCode: true, user: { select: { name: true } } } },
  badges: { select: { barcode: true, createdAt: true }, orderBy: { createdAt: "asc" } },
  user: { select: { name: true, username: true, email: true, workEmail: true, updatedAt: true } },
} satisfies Prisma.EmployeeSelect;

type Row = Prisma.EmployeeGetPayload<{ select: typeof PERSON_SELECT }>;

/** A stored calendar day (saved as midnight UTC) as YYYY-MM-DD. */
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Stand in addresses made for people with no email; they reach nobody. */
const PLACEHOLDER_DOMAINS = new Set(["noreply.local", "noreply.com"]);
/** The company each work email domain belongs to. */
const COMPANY_BY_DOMAIN: Record<string, string> = { "bergenlogistics.com": "Bergen", "cloudxsystems.net": "CloudX" };

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();
const realEmail = (email: string | null) => (email && !PLACEHOLDER_DOMAINS.has(domainOf(email)) ? email : null);

/**
 * The work and personal email as another system should read them. Many
 * company addresses still sit in the personal column, so one on a company
 * domain counts as the work email when the work column is empty, and is then
 * not repeated as the personal one. The company comes from the work email.
 */
function emailsOf(user: { email: string | null; workEmail: string | null }) {
  const personal = realEmail(user.email);
  let work = realEmail(user.workEmail);
  let other = personal;
  if (!work && personal && COMPANY_BY_DOMAIN[domainOf(personal)]) [work, other] = [personal, null];
  return { workEmail: work, personalEmail: other, company: work ? (COMPANY_BY_DOMAIN[domainOf(work)] ?? null) : null };
}

/**
 * A phone as typed. Ones saved from the employee form are encrypted
 * (iv:tag:ciphertext), imported ones are plain; decryptPii alone would
 * return null for every plain one.
 */
const ENCRYPTED = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;
const phoneOf = (v: string | null) => (v && ENCRYPTED.test(v) ? decryptPii(v) : v?.trim() || null);

/** First and last name split at the first space, as the time clocks do. */
function nameParts(name: string | null) {
  const n = (name ?? "").trim();
  const space = n.indexOf(" ");
  return { firstName: space > 0 ? n.slice(0, space) : n || null, lastName: space > 0 ? n.slice(space + 1).trim() : null };
}

export function toPerson(e: Row) {
  const changed = [e.updatedAt, e.user.updatedAt, ...e.badges.map((b) => b.createdAt)];
  return {
    id: e.id,
    name: e.user.name,
    ...nameParts(e.user.name),
    wmsName: e.wmsName,
    username: e.user.username,
    ...emailsOf(e.user),
    phone: phoneOf(e.phone),
    phone2: phoneOf(e.phone2),
    employeeCode: e.employeeCode,
    badgeId: e.wmsId,
    barcodes: [...new Set([e.barcode, ...e.badges.map((b) => b.barcode)].filter((b): b is string => !!b))],
    status: !e.isActive ? "inactive" : e.onLeave ? "on_leave" : "active",
    hireDate: day(e.hireDate),
    terminatedAt: day(e.terminatedAt),
    jobTitle: e.jobTitleRef?.name ?? e.jobTitle ?? null,
    site: e.site,
    department: e.department,
    agency: e.agencyRef ? { code: e.agencyRef.code, name: e.agencyRef.description } : null,
    supervisor: e.supervisor ? { id: e.supervisor.id, name: e.supervisor.user.name, employeeCode: e.supervisor.employeeCode } : null,
    lastModified: new Date(Math.max(...changed.map((d) => d.getTime()))).toISOString(),
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
  // "active" includes people on leave: they are still employed.
  if (query.status === "active") and.push({ isActive: true });
  if (query.status === "on_leave") and.push({ isActive: true, onLeave: true });
  if (query.status === "inactive") and.push({ isActive: false });
  if (query.modifiedSince) {
    const since = { gte: query.modifiedSince };
    and.push({ OR: [{ updatedAt: since }, { user: { updatedAt: since } }, { badges: { some: { createdAt: since } } }] });
  }
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
