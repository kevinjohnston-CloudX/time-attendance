/**
 * The charge rate a markup gives on an hourly rate: rate × (1 + markup), to
 * the cent ($15.92 at 32% is $21.01). Null without a markup. Kept apart from
 * pay-rates.ts, which reads the database, so the pay rate table can show it
 * while it is being typed.
 */
export function chargeFor(rate1: number, markupPct: number | null | undefined): number | null {
  if (markupPct == null || !Number.isFinite(markupPct)) return null;
  return Math.round(rate1 * (1 + markupPct / 100) * 100) / 100;
}
