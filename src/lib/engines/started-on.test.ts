import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { startedOn } from "./segment-builder";

// Hire dates are stored at midnight Eastern (04:00 or 05:00 UTC); the UTC date is the day.
const d = (day: string) => new Date(`${day}T04:00:00.000Z`);

describe("The day someone started", () => {
  it("is the hire date when there is no adjusted hire date", () => {
    expect(startedOn({ hireDate: d("2026-10-08"), adjustedHireDate: null })).toBe("2026-10-08");
  });
  it("is a rehire's adjusted hire date, the day they came back", () => {
    expect(startedOn({ hireDate: d("2019-03-11"), adjustedHireDate: d("2026-10-07") })).toBe("2026-10-07");
  });
  it("stays the hire date when the adjusted one is set earlier for seniority", () => {
    expect(startedOn({ hireDate: d("2026-10-07"), adjustedHireDate: d("2018-05-01") })).toBe("2026-10-07");
  });
});
