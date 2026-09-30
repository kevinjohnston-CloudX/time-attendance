/** The ADP codes Run Payroll remembers between runs, in a cookie so the page opens with them filled. */
export type RunCodes = { coCode: string; batchId: string; doubleTimeCode: string; mealPenaltyCode: string };

export const RUN_CODES_COOKIE = "ct-run-payroll-codes";

export const DEFAULT_RUN_CODES: RunCodes = { coCode: "", batchId: "", doubleTimeCode: "", mealPenaltyCode: "MP" };

export function parseRunCodes(raw: string | undefined): RunCodes {
  try {
    const v = JSON.parse(decodeURIComponent(raw ?? ""));
    const pick = (k: keyof RunCodes) => (typeof v?.[k] === "string" && /^[A-Za-z0-9_-]{0,20}$/.test(v[k]) ? v[k] : DEFAULT_RUN_CODES[k]);
    return { coCode: pick("coCode"), batchId: pick("batchId"), doubleTimeCode: pick("doubleTimeCode"), mealPenaltyCode: pick("mealPenaltyCode") };
  } catch {
    return DEFAULT_RUN_CODES;
  }
}

export function saveRunCodes(codes: RunCodes): void {
  try {
    document.cookie = `${RUN_CODES_COOKIE}=${encodeURIComponent(JSON.stringify(codes))}; path=/payroll; max-age=31536000; samesite=lax`;
  } catch {}
}
