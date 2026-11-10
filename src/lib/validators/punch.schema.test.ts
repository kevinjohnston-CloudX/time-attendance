import { describe, expect, it } from "vitest";
import { changeReasonSchema, correctPunchSchema, deletePunchSchema, kioskScanSchema } from "./punch.schema";

describe("a security scan's stated direction", () => {
  const scan = { EmployeeCode: "107538", ScanDateTime: "2026-11-10T17:20:00", Stream: "SECURITY" };

  it("is optional, and IN or OUT when given", () => {
    expect(kioskScanSchema.parse(scan).Direction).toBeUndefined();
    expect(kioskScanSchema.parse({ ...scan, Direction: "IN" }).Direction).toBe("IN");
    expect(kioskScanSchema.parse({ ...scan, Direction: "OUT" }).Direction).toBe("OUT");
  });

  it("refuses anything else", () => {
    for (const Direction of ["in", "out", "UNKNOWN", "", null, 1]) {
      expect(kioskScanSchema.safeParse({ ...scan, Direction }).success).toBe(false);
    }
  });
});

const base = { originalPunchId: "ckxxxxxxxxxxxxxxxxxxxxxxx", newPunchTime: "2026-11-03T13:00:00.000Z" };

describe("a reason on every punch change", () => {
  it("refuses a correction with no reason, a blank one or spaces only", () => {
    expect(correctPunchSchema.safeParse(base).success).toBe(false);
    expect(correctPunchSchema.safeParse({ ...base, reason: "" }).success).toBe(false);
    expect(correctPunchSchema.safeParse({ ...base, reason: "   " }).success).toBe(false);
  });

  it("keeps the reason, trimmed", () => {
    const parsed = correctPunchSchema.parse({ ...base, reason: "  forgot to clock out " });
    expect(parsed.reason).toBe("forgot to clock out");
  });

  it("refuses a removal with no reason", () => {
    expect(deletePunchSchema.safeParse({ punchId: "p1" }).success).toBe(false);
    expect(deletePunchSchema.safeParse({ punchId: "p1", reason: "badge scanned twice" }).success).toBe(true);
  });

  it("says what to do, in plain words", () => {
    const res = changeReasonSchema.safeParse("");
    expect(res.success).toBe(false);
    expect(res.error?.issues[0].message).toBe("Give a reason for the change.");
    expect(changeReasonSchema.safeParse("x".repeat(501)).success).toBe(false);
  });
});
