import { describe, expect, it, vi } from "vitest";

const payCodes = [
  { id: "reg", code: 0, label: "REGULAR HOURS", expressCode: "WKHR", adpCode: null, payBucket: "REG", isActive: true, isPaid: true },
  { id: "fmla", code: 11, label: "FMLA", expressCode: "FMLA", adpCode: "FML", payBucket: "FMLA", isActive: true, isPaid: false },
  { id: "pto", code: 5, label: "PTO", expressCode: "PTO", adpCode: "PTI", payBucket: "PTO", isActive: true, isPaid: true },
];
const seg = (payCodeId: string, hours: number, segmentType = "WORK", payBucket = "REG") => ({
  durationSeconds: hours * 3600, payBucket, payBucketOverride: null, segmentType, payCodeId,
});

vi.mock("@/lib/db", () => ({
  db: {
    payCode: { findMany: async () => payCodes },
    timesheet: {
      findMany: async () => [{
        id: "t1", employeeId: "e1", payPeriodId: "p1", status: "LOCKED", payPeriod: { status: "LOCKED" },
        employee: { wmsId: "1234", user: { name: "Pat Doe" } },
        exceptions: [],
        segments: [seg("reg", 32), seg("fmla", 8, "LEAVE", "FMLA"), seg("pto", 4, "LEAVE", "PTO")],
      }],
    },
  },
}));

import { buildAdpEpi, employeeWhere } from "./adp-epi";

describe("pay codes set to Not paid", () => {
  it("leave their hours out of the ADP file and list them for the preview (FMLA)", async () => {
    const { csv, summary } = await buildAdpEpi({
      tenantId: "t", payPeriodIds: ["p1"], filters: {}, codes: { coCode: "ABC", batchId: "B1" }, mode: "final",
    });
    expect(csv).not.toContain("FML");
    expect(csv).toContain("PTI");
    expect(summary.regMinutes).toBe(32 * 60);
    expect(summary.byCode).toEqual([{ code: "PTI", minutes: 240 }]);
    expect(summary.notPaid).toEqual([{ label: "11 FMLA", minutes: 480, people: 1 }]);
    expect(summary.leftOut).toEqual([]);
  });
});

describe("the Status filter", () => {
  it("takes active people only, inactive only, or both", () => {
    expect(employeeWhere("t", { status: "ACTIVE" })).toMatchObject({ isActive: true });
    expect(employeeWhere("t", { status: "INACTIVE" })).toMatchObject({ isActive: false });
    expect(employeeWhere("t", {})).not.toHaveProperty("isActive");
  });
});
