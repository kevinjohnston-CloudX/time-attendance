import { describe, expect, it } from "vitest";
import { safeNext } from "./design-switch";

describe("where the design switch sends someone next", () => {
  it("keeps a page on this site, with its query", () => {
    expect(safeNext("/payroll/timecards")).toBe("/payroll/timecards");
    expect(safeNext("/payroll/timecards?employeeId=abc&periodId=p1")).toBe("/payroll/timecards?employeeId=abc&periodId=p1");
  });

  it("sends the hidden Classic folder to its plain address", () => {
    expect(safeNext("/classic/accruals")).toBe("/accruals");
    expect(safeNext("/classic")).toBe("/dashboard");
  });

  it("never leaves the site, however the address is dressed up", () => {
    for (const evil of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "/\t/evil.test",
      "/\n/evil.test",
      "/\r\n/evil.test",
      "\\/evil.test",
      "/%09/evil.test".replace("%09", "\t"),
      "javascript:alert(1)",
      "",
    ]) {
      expect(safeNext(evil)).toBe("/dashboard");
    }
    expect(safeNext(null)).toBe("/dashboard");
  });
});
