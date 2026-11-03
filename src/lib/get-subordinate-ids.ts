import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { SIGN_IN_ONLY_ROLE } from "@/lib/sign-in-only";

/**
 * The people who report to a supervisor directly: those whose supervisor of
 * record they are, and those they were added to as an additional supervisor
 * (employee_supervisors). Every screen that lists "my people" one level down
 * uses this, so an additional supervisor sees exactly what the supervisor of
 * record sees; what either may do there comes from their role.
 *
 * <p>Wrapped in AND, so a filter spread over it with its own OR (a name
 * search) adds to it instead of replacing it: a bare OR here was replaced by
 * Team Punch History's search, which then searched the whole company.
 */
export function directReportsOf(supervisorEmployeeId: string): Prisma.EmployeeWhereInput {
  return {
    AND: [
      {
        OR: [
          { supervisorId: supervisorEmployeeId },
          { additionalSupervisors: { some: { supervisorId: supervisorEmployeeId } } },
          // An agency viewer (sign-in-only.ts) sees everyone in its agency.
          { agencyRef: { is: { employees: { some: { id: supervisorEmployeeId, customRole: { is: SIGN_IN_ONLY_ROLE } } } } } },
        ],
      },
      { id: { not: supervisorEmployeeId } },
    ],
  };
}

/**
 * Returns the IDs of all employees in the subtree rooted at actorId,
 * following the supervisor links to any depth: direct and indirect reports,
 * through the supervisor of record or an additional supervisor alike.
 *
 * <p>One recursive query rather than one query per level of the org chart
 * (ten levels deep when measured), and the same answer: UNION rather than
 * UNION ALL drops anyone already reached, which is also what stops a loop in
 * the chart from running forever. A null tenant reads every tenant, as the
 * level by level version did.
 *
 * <p>Asked once per request: several actions on one page each need the team,
 * and React's cache hands the later ones the first answer. Each caller gets
 * its own copy of the list, so one that adds to it changes nobody else's.
 */
const subtree = cache(async (actorId: string, tenantId: string | null): Promise<string[]> => {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE links AS (
      SELECT e.id AS "employeeId", e."supervisorId"
      FROM   "employees" e
      WHERE  e."supervisorId" IS NOT NULL
        AND  (${tenantId}::text IS NULL OR e."tenantId" = ${tenantId})
      UNION
      SELECT es."employeeId", es."supervisorId"
      FROM   "employee_supervisors" es
      JOIN   "employees" e ON e.id = es."employeeId"
      WHERE  (${tenantId}::text IS NULL OR e."tenantId" = ${tenantId})
    ),
    reports AS (
      SELECT l."employeeId" AS id
      FROM   links l
      WHERE  l."supervisorId" = ${actorId}
      UNION
      SELECT l."employeeId"
      FROM   links l
      JOIN   reports r ON l."supervisorId" = r.id
    ),
    -- An agency viewer: everyone in its agency. The same test as
    -- SIGN_IN_ONLY_ROLE in sign-in-only.ts: a role that is not a system one,
    -- has permissions, and cannot punch for itself.
    agency AS (
      SELECT e.id
      FROM   "employees" e
      JOIN   "employees" v ON v.id = ${actorId} AND v."agencyId" IS NOT NULL AND e."agencyId" = v."agencyId"
      JOIN   "custom_roles" cr ON cr.id = v."customRoleId" AND NOT cr."isSystem"
      WHERE  EXISTS (SELECT 1 FROM "role_permissions" p0 WHERE p0."customRoleId" = cr.id)
        AND  NOT EXISTS (
               SELECT 1 FROM "role_permissions" p
               WHERE  p."customRoleId" = cr.id AND p.resource = 'punch' AND p.action = 'write' AND p.scope = 'own'
             )
        AND  (${tenantId}::text IS NULL OR e."tenantId" = ${tenantId})
    )
    SELECT id FROM reports WHERE id <> ${actorId}
    UNION
    SELECT id FROM agency WHERE id <> ${actorId}
  `;
  return rows.map((r) => r.id);
});

export async function getSubordinateIds(
  actorId: string,
  tenantId: string | null
): Promise<string[]> {
  return [...(await subtree(actorId, tenantId))];
}
