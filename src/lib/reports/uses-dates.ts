import type { FilterDef, SortDef } from "@/lib/validators/report.schema";

/**
 * Whether a report's dates change what it shows, so the screens only ask for
 * dates when they do.
 *
 * <p>Every report is about days except a list of people: an Employees report
 * reads its dates only for the "in these dates" columns and filters, and a
 * hire or termination date "in the report dates". Without one of those, a
 * Dates panel there changed nothing, and its pay group menu read as if it
 * picked the people (CXT ticket 77532: "North Bergen" still listed all 1,031).
 */
const DATES_ONLY_FOR: Record<string, { columns: string[]; filters: string[] }> = {
  EMPLOYEES: {
    columns: ["hoursInRange", "daysWorkedInRange"],
    filters: ["hoursInRange", "daysWorkedInRange"],
  },
};

export function reportUsesDates(
  dataSource: string,
  config: { columns?: string[]; filters?: FilterDef[]; sortBy?: SortDef[] }
): boolean {
  const only = DATES_ONLY_FOR[dataSource];
  if (!only) return true;
  return (
    (config.columns ?? []).some((c) => only.columns.includes(c)) ||
    (config.sortBy ?? []).some((s) => only.columns.includes(s.field)) ||
    (config.filters ?? []).some((f) => only.filters.includes(f.field) || f.operator === "inRange")
  );
}
