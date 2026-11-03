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
 *
 * <p><b>And WMS's word, at security only.</b> A person is turned away at the
 * gate when either system has ended their employment: CloudTime by the rules
 * above, or WMS by the roster sync's employees.wmsActive (false = terminated
 * there, null = not seen, which counts as employed). WMS terminations often
 * never reach CloudTime, and HR confirmed on 2026-10-30 that most of the
 * people in that state should indeed be stopped. The same day the time clock
 * was made to refuse their punches too (punch route, Cristian's decision), so
 * a WMS record that is wrong now stops a person clocking in until WMS is
 * corrected. Timecards and payroll still go by isActive.
 */

/**
 * Whether a WMS termination ends employment: at the gate, on loss prevention's
 * screens, and for a time clock punch.
 * On since 2026-10-30, once the ten Active people HR said to keep had been
 * corrected in WMS and the bridge read a returning person's current record
 * rather than their oldest one. Turning it off puts the gate back on
 * CloudTime's answer alone; nothing is stored differently either way.
 */
export const WMS_TERMINATION_ENDS_EMPLOYMENT = true;

export type EmploymentFacts = {
  isActive: boolean;
  terminatedAt: Date | null;
  hireDate?: Date | null;
  adjustedHireDate?: Date | null;
  /** employees.wmsActive. Read only when honourWms is true. */
  wmsActive?: boolean | null;
};

/** The calendar day a stored date stands for. Dates are kept at or near midnight UTC. */
function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * @param today the person's own calendar date, YYYY-MM-DD
 * @param madeActiveAt the latest audited change of this person's status to
 *   Active, or null when there is none
 * @param honourWms whether a WMS termination ends employment too: true for
 *   the gate and loss prevention, false for anything else
 */
export function employmentEnded(
  f: EmploymentFacts,
  today: string,
  madeActiveAt: Date | null,
  honourWms = WMS_TERMINATION_ENDS_EMPLOYMENT,
): boolean {
  if (!f.isActive) return true;
  if (honourWms && f.wmsActive === false) return true;
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
  honourWms = WMS_TERMINATION_ENDS_EMPLOYMENT,
): Promise<Set<string>> {
  const active = await madeActiveAt(people);
  return new Set(
    people.filter((p) => employmentEnded(p, today, active.get(p.id) ?? null, honourWms)).map((p) => p.id),
  );
}
