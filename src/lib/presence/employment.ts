import { db } from "@/lib/db";

/**
 * Whether somebody's employment has ended, as the gate and Live Attendance
 * see it: the gate's "Employment ended – Do not admit", the refusal of loss
 * prevention's "Add to schedule", and the Inactive mark on a person.
 *
 * <p><b>Why this is more than "has a termination date".</b> Making someone
 * Active again on the employee page never cleared their termination date, and
 * the WMS roster sync does not touch it either. Found 2026-10-13: 33 Active
 * people still carried one, and four of them were working — clocking in every
 * day (the time clock only asks whether someone is Active) while the gate
 * turned them away as former employees. So the status decides, and a date only
 * counts while nothing since says otherwise:
 *
 * <ul>
 *   <li>Inactive: ended.</li>
 *   <li>Active, no termination date: employed.</li>
 *   <li>Active, a termination date not yet past: employed until it has
 *       passed. The date is their last day.</li>
 *   <li>Active, a termination date in the past: ended, unless they were hired
 *       again after it (hire or adjusted hire date later) or made Active again
 *       after it (an audited Status change to Active).</li>
 * </ul>
 *
 * The last case is what still stops the people who left long ago but whose
 * record was never set Inactive: nothing since their date says they came back.
 */

export type EmploymentFacts = {
  isActive: boolean;
  terminatedAt: Date | null;
  hireDate?: Date | null;
  adjustedHireDate?: Date | null;
};

/** The calendar day a stored date stands for. Dates are kept at or near midnight UTC. */
function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * @param today the person's own calendar date, YYYY-MM-DD
 * @param madeActiveAt the latest audited change of this person's status to
 *   Active, or null when there is none
 */
export function employmentEnded(f: EmploymentFacts, today: string, madeActiveAt: Date | null): boolean {
  if (!f.isActive) return true;
  if (!f.terminatedAt) return false;
  const lastDay = dayOf(f.terminatedAt);
  if (lastDay >= today) return false;
  const rehired = [f.hireDate, f.adjustedHireDate].some((d) => d && dayOf(d) > lastDay);
  if (rehired) return false;
  return !(madeActiveAt && madeActiveAt.getTime() > f.terminatedAt.getTime());
}

/** Whether an audit entry's changes record a status change to Active. */
export function recordsMadeActive(changes: unknown): boolean {
  if (!changes || typeof changes !== "object") return false;
  const fields = (changes as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return false;
  return fields.some(
    (f) => f && typeof f === "object" && (f as { field?: unknown }).field === "Status" && (f as { after?: unknown }).after === "Active",
  );
}

/**
 * When each of these people was last made Active, read from the audit log.
 * Only people the answer can matter to are looked up — Active with a
 * termination date — which on 2026-10-13 was 33 people in the company, so
 * this is normally no query at all.
 */
export async function madeActiveAt(
  people: Array<{ id: string; isActive: boolean; terminatedAt: Date | null }>,
): Promise<Map<string, Date>> {
  const ids = people.filter((p) => p.isActive && p.terminatedAt).map((p) => p.id);
  const latest = new Map<string, Date>();
  if (ids.length === 0) return latest;
  const rows = await db.auditLog.findMany({
    where: { entityType: "EMPLOYEE", entityId: { in: ids }, action: "EMPLOYEE_UPDATED" },
    select: { entityId: true, createdAt: true, changes: true },
  });
  for (const r of rows) {
    if (!recordsMadeActive(r.changes)) continue;
    const seen = latest.get(r.entityId);
    if (!seen || r.createdAt > seen) latest.set(r.entityId, r.createdAt);
  }
  return latest;
}

/** The ids among these whose employment has ended, for a list of people. */
export async function endedAmong(
  people: Array<EmploymentFacts & { id: string }>,
  today: string,
): Promise<Set<string>> {
  const active = await madeActiveAt(people);
  return new Set(people.filter((p) => employmentEnded(p, today, active.get(p.id) ?? null)).map((p) => p.id));
}
