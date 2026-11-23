import type { Prisma } from "@prisma/client";

/**
 * The Agency filter on Timecards, Employees and Live Attendance: several
 * agencies at once, in the address as one comma list. Nothing picked is
 * everybody. In practice it is Bergen alone (the company's own people) or
 * everyone but Bergen (the temps), so the list offers Select all and a tick
 * to take off (Tony Deroy, 11/19).
 *
 * <p>People with no agency on their record are a choice of their own, so
 * "everyone but Bergen" does not drop them without saying so.
 */

/** The choice for people with no agency on their record. */
export const NO_AGENCY = "none";
export const NO_AGENCY_NAME = "No agency";

/** The agencies picked, from the address ("a,b,none"); empty for everybody. */
export function parseAgencyIds(param: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(param) ? param.join(",") : param ?? "";
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

/** The picked agencies as the address writes them, or "" for everybody. */
export function agencyParam(ids: readonly string[]): string {
  return ids.join(",");
}

/** Whether someone with this agency (null for none) is among those picked. */
export function inAgencies(ids: readonly string[], agencyId: string | null | undefined): boolean {
  if (ids.length === 0) return true;
  return ids.includes(agencyId ?? NO_AGENCY);
}

/** The employees at the picked agencies, for a query; {} for everybody. */
export function agencyWhere(ids: readonly string[]): Prisma.EmployeeWhereInput {
  if (ids.length === 0) return {};
  const real = ids.filter((id) => id !== NO_AGENCY);
  const none = ids.includes(NO_AGENCY);
  if (none && real.length === 0) return { agencyId: null };
  if (!none) return { agencyId: { in: real } };
  return { OR: [{ agencyId: { in: real } }, { agencyId: null }] };
}

/**
 * What the chip says once some are picked: the names when one or two, "All
 * but Bergen" when one or two are left out, else how many.
 */
export function agencySummary(ids: readonly string[], options: readonly { id: string; name: string }[]): string {
  const picked = options.filter((o) => ids.includes(o.id));
  // Picked from a link, with nobody at them here (another site's agencies).
  if (picked.length === 0) return `${ids.length} selected`;
  if (picked.length <= 2) return picked.map((o) => o.name).join(", ");
  const left = options.filter((o) => !ids.includes(o.id));
  if (left.length >= 1 && left.length <= 2) return `All but ${left.map((o) => o.name).join(", ")}`;
  return `${picked.length} of ${options.length}`;
}
