/** The ADP codes Run Payroll remembers between runs, in a cookie so the page opens with them filled. */
export type RunCodes = { coCode: string; batchId: string };

export const RUN_CODES_COOKIE = "ct-run-payroll-codes";

export const DEFAULT_RUN_CODES: RunCodes = { coCode: "", batchId: "BATCH1" };

/**
 * The batch ID as the file writes it: a bare number gets the word BATCH in
 * front, as NovaTime's files have it ("1" is written BATCH1).
 */
export function batchLabel(batchId: string): string {
  const v = batchId.trim().toUpperCase();
  return /^\d+$/.test(v) ? `BATCH${v}` : v;
}

export function parseRunCodes(raw: string | undefined): RunCodes {
  try {
    const v = JSON.parse(decodeURIComponent(raw ?? ""));
    const pick = (k: keyof RunCodes) => (typeof v?.[k] === "string" && /^[A-Za-z0-9_-]{0,20}$/.test(v[k]) ? v[k] : DEFAULT_RUN_CODES[k]);
    return { coCode: pick("coCode"), batchId: pick("batchId") };
  } catch {
    return DEFAULT_RUN_CODES;
  }
}

export function saveRunCodes(codes: RunCodes): void {
  try {
    document.cookie = `${RUN_CODES_COOKIE}=${encodeURIComponent(JSON.stringify(codes))}; path=/payroll; max-age=31536000; samesite=lax`;
  } catch {}
}
