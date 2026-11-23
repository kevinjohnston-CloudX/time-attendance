import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { actionsMatching } from "@/lib/audit/labels";

/** Audit entries about one person, found through that record's employee. */
const PERSON_ENTITIES = ["EMPLOYEE", "USER", "TIMESHEET", "PUNCH", "LEAVE_REQUEST", "PAY_PERIOD"];

/**
 * One page of the audit log for a viewer held to some sites: entries about
 * people at those sites (their profile, sign-ins, timecards, punches and
 * leave), pay periods with their people on them, and every entry that is not
 * about a person (rule sets, roles, reports, policies). An entry whose record
 * is gone has no site left to check and is not shown. The same filters as
 * the Prisma `where` the screen uses for everyone else, as SQL.
 */
export async function auditPageInReach(
  sites: string[],
  f: { tenantId: string; entityType?: string; actor: string; since?: Date; q: string },
  take: number,
  skip: number,
): Promise<{ ids: string[]; total: number }> {
  const inSites = Prisma.sql`(${Prisma.join(sites.length ? sites : ["-"])})`;
  const conds: Prisma.Sql[] = [Prisma.sql`a."tenantId" = ${f.tenantId}`];
  if (f.entityType) conds.push(Prisma.sql`a."entityType"::text = ${f.entityType}`);
  if (f.actor === "system") conds.push(Prisma.sql`a."actorId" IS NULL`);
  else if (f.actor) conds.push(Prisma.sql`a."actorId" = ${f.actor}`);
  if (f.since) conds.push(Prisma.sql`a."createdAt" >= ${f.since}`);
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const acts = actionsMatching(f.q);
    conds.push(
      Prisma.sql`(a.action ILIKE ${like} OR a."entityId" ILIKE ${like}${acts.length ? Prisma.sql` OR a.action IN (${Prisma.join(acts)})` : Prisma.empty})`,
    );
  }
  conds.push(Prisma.sql`(
    a."entityType"::text NOT IN (${Prisma.join(PERSON_ENTITIES)})
    OR (a."entityType"::text = 'EMPLOYEE' AND EXISTS (SELECT 1 FROM employees e WHERE e.id = a."entityId" AND e."siteId" IN ${inSites}))
    OR (a."entityType"::text = 'USER' AND EXISTS (SELECT 1 FROM employees e WHERE e."userId" = a."entityId" AND e."siteId" IN ${inSites}))
    OR (a."entityType"::text = 'TIMESHEET' AND EXISTS (SELECT 1 FROM timesheets t JOIN employees e ON e.id = t."employeeId" WHERE t.id = a."entityId" AND e."siteId" IN ${inSites}))
    OR (a."entityType"::text = 'PUNCH' AND EXISTS (SELECT 1 FROM punches p JOIN employees e ON e.id = p."employeeId" WHERE p.id = a."entityId" AND e."siteId" IN ${inSites}))
    OR (a."entityType"::text = 'LEAVE_REQUEST' AND EXISTS (SELECT 1 FROM leave_requests l JOIN employees e ON e.id = l."employeeId" WHERE l.id = a."entityId" AND e."siteId" IN ${inSites}))
    OR (a."entityType"::text = 'PAY_PERIOD' AND (
      EXISTS (SELECT 1 FROM timesheets t JOIN employees e ON e.id = t."employeeId" WHERE t."payPeriodId" = a."entityId" AND e."siteId" IN ${inSites})
      OR EXISTS (SELECT 1 FROM pay_periods pp JOIN employees e ON e."ruleSetId" = pp."ruleSetId" WHERE pp.id = a."entityId" AND e."isActive" AND e."siteId" IN ${inSites})
    ))
  )`);
  const whereSql = Prisma.join(conds, " AND ");
  const [page, count] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`SELECT a.id FROM audit_logs a WHERE ${whereSql} ORDER BY a."createdAt" DESC LIMIT ${take} OFFSET ${skip}`,
    db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM audit_logs a WHERE ${whereSql}`,
  ]);
  return { ids: page.map((r) => r.id), total: count[0]?.n ?? 0 };
}
