import { describe, expect, it } from "vitest";
import { cellText, cellValue, isMoneyColumn } from "./cell";

describe("money columns", () => {
  it("shows rates, costs and charges as dollars, and hours as hours", () => {
    expect(isMoneyColumn({ id: "chargeCost", type: "number" })).toBe(true);
    expect(isMoneyColumn({ id: "payRate", type: "number" })).toBe(true);
    expect(isMoneyColumn({ id: "regCharge", type: "number" })).toBe(true);
    expect(isMoneyColumn({ id: "regMinutes", type: "number" })).toBe(false);
    expect(cellText(840.4, { id: "chargeCost", type: "number" })).toBe("$840.40");
    expect(cellText(11333.63, { id: "chargeCost", type: "number" })).toBe("$11,333.63");
    expect(cellText(0, { id: "otCharge", type: "number" })).toBe("$0.00");
    expect(cellText(483, { id: "regMinutes", type: "number" })).toBe("8.05");
  });

  it("keeps the spreadsheet value a plain number, for Excel to add up", () => {
    expect(cellValue(840.4, { id: "chargeCost", type: "number" })).toBe(840.4);
  });
});
