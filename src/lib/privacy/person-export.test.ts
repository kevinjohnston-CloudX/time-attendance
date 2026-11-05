import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("@/lib/db", () => ({ db: {} }));

import { buildPersonWorkbook, formatDay, formatInstant, humanize, type PersonExport } from "./person-export";

describe("humanize", () => {
  it("reads an enum value as words", () => {
    expect(humanize("PAYROLL_APPROVED")).toBe("Payroll approved");
    expect(humanize("KIOSK")).toBe("Kiosk");
    expect(humanize(null)).toBeNull();
  });
});

describe("formatInstant", () => {
  it("shows the person's own clock, 12 hour with AM or PM", () => {
    const at = new Date("2026-10-14T11:02:00Z");
    expect(formatInstant(at, "America/New_York")).toBe("Oct 14, 2026, 7:02 AM");
    expect(formatInstant(at, "Europe/Amsterdam")).toBe("Oct 14, 2026, 1:02 PM");
  });
});

describe("formatDay", () => {
  it("never moves a calendar date by a day", () => {
    expect(formatDay(new Date("2026-01-01T00:00:00Z"))).toBe("Jan 1, 2026");
  });
});

describe("buildPersonWorkbook", () => {
  const data: PersonExport = {
    name: "Ana Pérez",
    employeeCode: "100200",
    timeZone: "America/New_York",
    photo: null,
    sections: [
      { title: "Profile", description: "Contact details.", columns: ["Field", "Value"], rows: [["Name", "Ana Pérez"], ["Phone", null]] },
      { title: "Punches", description: "Every punch.", columns: ["Time", "Type"], rows: [] },
    ],
  };

  it("has a cover sheet, a sheet per section, and says when one is empty", async () => {
    const buf = await buildPersonWorkbook(data, new Date("2026-11-03T15:00:00Z"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);

    expect(wb.worksheets.map((w) => w.name)).toEqual(["About this file", "Profile", "Punches"]);
    const cover = wb.getWorksheet("About this file")!;
    expect(cover.getCell("B3").value).toBe("Ana Pérez");
    expect(cover.getCell("B5").value).toBe("Nov 3, 2026, 10:00 AM");
    expect(cover.getCell("A9").value).toBe("Profile (2)");

    const profile = wb.getWorksheet("Profile")!;
    expect(profile.getRow(1).values).toEqual([undefined, "Field", "Value"]);
    expect(profile.getCell("B2").value).toBe("Ana Pérez");
    expect(wb.getWorksheet("Punches")!.getCell("A2").value).toBe("No records.");
  });
});
