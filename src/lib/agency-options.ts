import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { NO_AGENCY, NO_AGENCY_NAME } from "@/lib/agency-filter";

/**
 * The choices for the Agency filter: the company's agencies that have someone
 * among these people, by name, then "No agency" when anyone has none. Of the
 * company's 40 agencies most have nobody on file, and a list of them all was
 * mostly ones that find nobody.
 */
export async function agencyOptions(
  tenantId: string,
  people: Prisma.EmployeeWhereInput = {},
): Promise<{ id: string; name: string }[]> {
  const [agencies, unassigned] = await Promise.all([
    db.agency.findMany({
      where: { tenantId, employees: { some: { tenantId, ...people } } },
      orderBy: { description: "asc" },
      select: { id: true, description: true },
    }),
    db.employee.count({ where: { tenantId, ...people, agencyId: null } }),
  ]);
  return [
    ...agencies.map((a) => ({ id: a.id, name: a.description })),
    ...(unassigned > 0 ? [{ id: NO_AGENCY, name: NO_AGENCY_NAME }] : []),
  ];
}
