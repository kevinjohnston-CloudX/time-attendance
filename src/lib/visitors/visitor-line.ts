/**
 * The line Live Attendance shows under a visitor's name where an employee
 * shows their job or department: "Beta Carriers · visiting Dana Ruiz".
 * Read from the visitor's pass; null for anyone without one.
 */

/** What to select from an employee's `visitorPass` to write the line. */
export const VISITOR_LINE_SELECT = {
  select: { company: true, hostName: true, host: { select: { user: { select: { name: true } } } } },
} as const;

type PassLine = {
  company: string | null;
  hostName: string | null;
  host: { user: { name: string | null } | null } | null;
} | null | undefined;

export function visitorFrom(pass: PassLine): string | null {
  if (!pass) return null;
  const host = pass.hostName?.trim() || pass.host?.user?.name?.trim() || null;
  return [pass.company?.trim() || null, host ? `visiting ${host}` : null].filter(Boolean).join(" · ") || null;
}
