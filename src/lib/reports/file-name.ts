import type { ReportResult } from "./data-sources";

/**
 * What a downloaded or emailed report file is called.
 *
 * <p>A report that counts its own days names them: "CloudTime Security Scan
 * Report 2026-09-27", or "... 2026-09-01 to 2026-09-30" for a stretch, so two
 * files from different days never overwrite each other in a downloads folder.
 * A brand puts the product in front of it, so the people who used to receive
 * the old report can tell at a glance which system sent this one.
 */
export function reportFileStem(name: string, result: Pick<ReportResult, "period">, brand?: string | null): string {
  const base = name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "report";
  const branded = brand && !base.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand}-${base}` : base;
  const p = result.period;
  if (!p) return branded;
  return `${branded}-${p.start === p.end ? p.start : `${p.start}-to-${p.end}`}`;
}
