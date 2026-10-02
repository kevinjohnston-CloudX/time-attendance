/**
 * The name a person is shown by at the door: on the tablets and in Live
 * Attendance.
 *
 * <p>Two names exist for most people. users.name is the legal name, from ADP
 * and HR, and is what payroll, timecards and reports use. employees.wmsName is
 * the one WMS (Oracle) holds, which can be a nickname, a shorter form or a
 * different spelling, and is the one the floor knows them by. The owner's rule
 * (2026-10-01): keep the legal name as the name of record, show the WMS name on
 * the tablets and in Live Attendance.
 *
 * <p>So: the WMS name when the roster sync has one, else the legal name, else
 * the employee code, which every employee has.
 */
export interface NamedEmployee {
  wmsName?: string | null;
  employeeCode: string;
  user?: { name?: string | null } | null;
}

export function shownName(e: NamedEmployee): string {
  return e.wmsName?.trim() || e.user?.name?.trim() || `Employee ${e.employeeCode}`;
}

/** As {@link shownName}, but null rather than the employee-code fallback. */
export function shownNameOrNull(e: { wmsName?: string | null; user?: { name?: string | null } | null }): string | null {
  return e.wmsName?.trim() || e.user?.name?.trim() || null;
}
