import { describe, expect, it } from "vitest";
import { codePaidUnder, overtimeCodesOf } from "./overtime-pay-code";

const codes = overtimeCodesOf([
  { code: 0, label: "REGULAR HOURS", payBucket: "REG" },
  { code: 16, label: "OT RETRO", payBucket: "OT" },
  { code: 157, label: "OVERTIME", payBucket: "OT" },
  { code: 15, label: "DOUBLE TIME RETRO", payBucket: "DT" },
  { code: 2, label: "DOUBLE TIME", payBucket: "DT" },
  { code: 9, label: "OLD OT", payBucket: "OT", isActive: false },
]);
const regular = { code: 0, label: "REGULAR HOURS", payBucket: "REG" };

describe("the pay code a worked line is paid under", () => {
  it("picks the company's active overtime and double time codes, never a retro one", () => {
    expect(codes.get("OT")).toEqual({ code: 157, label: "OVERTIME" });
    expect(codes.get("DT")).toEqual({ code: 2, label: "DOUBLE TIME" });
  });

  it("names regular time that fell into overtime or double time by that code", () => {
    expect(codePaidUnder({ segmentType: "WORK", bucket: "OT", payCode: regular }, codes).code).toBe(157);
    expect(codePaidUnder({ segmentType: "WORK", bucket: "DT", payCode: regular }, codes).code).toBe(2);
    expect(codePaidUnder({ segmentType: "WORK", bucket: "REG", payCode: regular }, codes).code).toBe(0);
  });

  it("keeps a code that is not regular time, and time that is not worked", () => {
    const penalty = { code: 14, label: "MEAL PENALTY", payBucket: "UNPAID" };
    expect(codePaidUnder({ segmentType: "WORK", bucket: "OT", payCode: penalty }, codes).code).toBe(14);
    const pto = { code: 5, label: "PTO", payBucket: "PTO" };
    expect(codePaidUnder({ segmentType: "LEAVE", bucket: "OT", payCode: pto }, codes).code).toBe(5);
  });

  it("keeps the stored code when the company has no overtime code", () => {
    expect(codePaidUnder({ segmentType: "WORK", bucket: "OT", payCode: regular }, new Map()).code).toBe(0);
  });
});
