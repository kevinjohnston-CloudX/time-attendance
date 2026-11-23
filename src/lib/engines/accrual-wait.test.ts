import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { endsWait, waitEnds } from "./accrual-engine";

// Hire dates are kept at local midnight (04:00 EDT, 05:00 EST); postings at UTC midnight.
const hired = (d: string) => new Date(`${d}T04:00:00Z`);
const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe("the end of a new hire's waiting period", () => {
  it("is three months from the hire day (Banchon, hired 8/11: 11/11)", () => {
    expect(waitEnds(hired("2026-08-11"), 3)).toEqual(day("2026-11-11"));
  });

  it("falls on the last day of a shorter month (hired 11/30: 2/28)", () => {
    expect(waitEnds(new Date("2026-11-30T05:00:00Z"), 3)).toEqual(day("2027-02-28"));
  });
});

describe("the posting that releases it", () => {
  it("fortnightly PTO: the first posting on or after the end (Banchon: 11/21, not 11/07)", () => {
    expect(endsWait(hired("2026-08-11"), 3, day("2026-11-07"), "BI_WEEKLY")).toBe(false);
    expect(endsWait(hired("2026-08-11"), 3, day("2026-11-21"), "BI_WEEKLY")).toBe(true);
    expect(endsWait(hired("2026-08-11"), 3, day("2026-12-05"), "BI_WEEKLY")).toBe(false);
  });

  it("a posting on the very day the wait ends releases it", () => {
    expect(endsWait(hired("2026-08-21"), 3, day("2026-11-21"), "BI_WEEKLY")).toBe(true);
  });

  it("only once for someone long past it (Linda Carmona, hired 2022)", () => {
    expect(endsWait(new Date("2022-11-07T05:00:00Z"), 3, day("2026-11-21"), "BI_WEEKLY")).toBe(false);
  });

  it("NJ Sick: on the day itself (Zujeey Gastelu Roldan, hired 8/18: 11/18)", () => {
    expect(endsWait(hired("2026-08-18"), 3, day("2026-11-17"), "ANNUALLY")).toBe(false);
    expect(endsWait(hired("2026-08-18"), 3, day("2026-11-18"), "ANNUALLY")).toBe(true);
    expect(endsWait(hired("2026-08-18"), 3, day("2026-11-19"), "ANNUALLY")).toBe(false);
  });
});
