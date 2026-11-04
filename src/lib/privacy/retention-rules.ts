/**
 * The retention periods and choices, with no database import, so the
 * settings panel and the review window can read them in the browser.
 */

export type RetentionCountry = "DE" | "NL" | "UK";

/**
 * The longest period each country's law asks to keep what CloudTime holds.
 * Germany: payroll records 6 years (EStG §41), working time 2 (ArbZG §16).
 * Netherlands: payroll and tax records 7 years (AWR art. 52), working time 52
 * weeks. UK: minimum wage and holiday pay records 6 years, working time 2.
 */
export const RETENTION_YEARS: Record<RetentionCountry, number> = { DE: 6, NL: 7, UK: 6 };
export const RETENTION_COUNTRY_LABEL: Record<RetentionCountry, string> = { DE: "Germany", NL: "Netherlands", UK: "United Kingdom" };
export const PHOTO_DAY_CHOICES = [30, 60, 90, 180] as const;

/** The period in force, or null when no country or number of years is set. */
export function retentionYears(r: { country: RetentionCountry | null; years: number | null }): number | null {
  return r.years ?? (r.country ? RETENTION_YEARS[r.country] : null);
}

export function isYears(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10;
}
