/**
 * Which pay code a worked line is paid under, for the reports that list a
 * day's pay codes.
 *
 * Worked minutes keep the person's regular code on the timecard, and only
 * their bucket says overtime or double time. Listed as stored, a day with
 * overtime read REGULAR HOURS alone. So a regular code's overtime and double
 * time are named by the company's own code for that bucket.
 */

type Code = { code: number; label: string };

/** The company's code for each of overtime and double time: active, not a retro one, lowest number first. */
export function overtimeCodesOf(codes: Array<Code & { payBucket: string | null; isActive?: boolean }>): Map<string, Code> {
  const byBucket = new Map<string, Code>();
  for (const c of [...codes].sort((a, b) => a.code - b.code)) {
    if (c.isActive === false || !c.payBucket || !["OT", "DT"].includes(c.payBucket)) continue;
    if (/retro/i.test(c.label) || byBucket.has(c.payBucket)) continue;
    byBucket.set(c.payBucket, { code: c.code, label: c.label });
  }
  return byBucket;
}

/** The code a line is paid under: its own, unless it is regular time that fell into overtime or double time. */
export function codePaidUnder(
  line: { segmentType: string; bucket: string | null; payCode: Code & { payBucket: string | null } },
  overtimeCodes: Map<string, Code>,
): Code {
  const { segmentType, bucket, payCode } = line;
  if (segmentType !== "WORK" || (bucket !== "OT" && bucket !== "DT")) return payCode;
  if ((payCode.payBucket ?? "REG") !== "REG") return payCode;
  return overtimeCodes.get(bucket) ?? payCode;
}
