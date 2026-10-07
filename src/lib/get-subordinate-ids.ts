import { cache } from "react";
import { db } from "@/lib/db";

/**
 * Returns the IDs of all employees in the subtree rooted at actorId,
 * following the supervisorId chain to any depth: direct and indirect reports.
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
    WITH RECURSIVE reports AS (
      SELECT e.id
      FROM   "employees" e
      WHERE  e."supervisorId" = ${actorId}
        AND  (${tenantId}::text IS NULL OR e."tenantId" = ${tenantId})
      UNION
      SELECT e.id
      FROM   "employees" e
      JOIN   reports r ON e."supervisorId" = r.id
      WHERE  (${tenantId}::text IS NULL OR e."tenantId" = ${tenantId})
    )
    SELECT id FROM reports
  `;
  return rows.map((r) => r.id);
});

export async function getSubordinateIds(
  actorId: string,
  tenantId: string | null
): Promise<string[]> {
  return [...(await subtree(actorId, tenantId))];
}
