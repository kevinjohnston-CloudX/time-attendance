/**
 * The report options as the classic screens expect them.
 *
 * <p>The shared action returns every pay group's own pay period, which the
 * new design's picker needs to offer one group. The classic picker lists
 * them as they come, so the same dates would repeat once per group. Prod
 * removed those repeats inside the action (the first of each date window,
 * newest first); this does the same, for the classic screens only.
 */
export function classicFilterOptions<T extends { payPeriods: { startDate: Date; endDate: Date }[] }>(options: T): T {
  const seen = new Set<string>();
  return {
    ...options,
    payPeriods: options.payPeriods.filter((p) => {
      const key = `${p.startDate.toISOString()}|${p.endDate.toISOString()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}
