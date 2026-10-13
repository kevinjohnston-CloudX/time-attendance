import type { EpiSummary } from "@/lib/payroll/adp-epi";

/** What stops the file being written as ADP needs it, in words for the run screen. */
export function missingAdpCodes(summary: Pick<EpiSummary, "needsDoubleTimeCode" | "needsMealPenaltyCode">): string[] {
  const out: string[] = [];
  const dt = summary.needsDoubleTimeCode;
  if (dt) {
    out.push(
      dt.payCode
        ? `This period has double time. Add its ADP code to pay code ${dt.payCode} under Pay Codes.`
        : "This period has double time, and there is no Double Time pay code. Add one in the double time bucket, with its ADP code, under Pay Codes.",
    );
  }
  const mp = summary.needsMealPenaltyCode;
  if (mp) out.push(`This period has meal premiums. Add the ADP code to pay code ${mp.payCodes.join(", ")} under Pay Codes.`);
  return out;
}
