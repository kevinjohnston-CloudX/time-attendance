/**
 * The pay period's "Show" filter on its timesheet table: whether a timesheet
 * is open or locked, or whether it has exceptions. Its own module because the
 * page filters on the server and the pill lists the choices in the browser.
 * The page's summary links to these, so its "See these timesheets" lands on
 * exactly the timesheets it counted.
 */

export const SHOW_OPTIONS = [
  { id: "open", name: "Open" },
  { id: "locked", name: "Locked" },
  { id: "exceptions", name: "Has exceptions" },
] as const;

export type TimesheetShow = (typeof SHOW_OPTIONS)[number]["id"];

export function parseShow(value: string | undefined): TimesheetShow | "" {
  return SHOW_OPTIONS.some((o) => o.id === value) ? (value as TimesheetShow) : "";
}

export function matchesShow(show: TimesheetShow, status: string, exceptions: number): boolean {
  switch (show) {
    case "open":
      return status !== "LOCKED";
    case "locked":
      return status === "LOCKED";
    case "exceptions":
      return exceptions > 0;
  }
}
