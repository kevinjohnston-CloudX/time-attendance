import { db } from "@/lib/db";

/**
 * Returns the IDs of all employees in the subtree rooted at actorId,
 * traversing the supervisorId chain iteratively (BFS).
 * Includes indirect reports at any depth — not just direct reports.
 */
export async function getSubordinateIds(
  actorId: string,
  tenantId: string | null
): Promise<string[]> {
  const ids = new Set<string>();
  let frontier = [actorId];

  while (frontier.length > 0) {
    const reports = await db.employee.findMany({
      where: { supervisorId: { in: frontier }, tenantId: tenantId ?? undefined },
      select: { id: true },
    });
    frontier = [];
    for (const emp of reports) {
      if (!ids.has(emp.id)) {
        ids.add(emp.id);
        frontier.push(emp.id);
      }
    }
  }

  return Array.from(ids);
}
