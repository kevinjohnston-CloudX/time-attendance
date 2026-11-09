import { describe, expect, it } from "vitest";
import { ledgerDay, ledgerDayNote, onLedgerDays } from "./leave-ledger-days";

const h = (n: number) => n * 60;

// Christopher Poncio, 11/09/2026: PTO for 11/02 and 11/03 entered on 11/09,
// after the 11/07 accrual.
const asMade = [
  { id: "oct24", date: "2026-10-24", deltaMinutes: h(6.16), runningBalance: h(39.52) },
  { id: "nov7", date: "2026-11-07", deltaMinutes: h(6.16), runningBalance: h(45.68) },
  { id: "pto2", date: "2026-11-02", deltaMinutes: h(-8), runningBalance: h(37.68) },
  { id: "pto3", date: "2026-11-03", deltaMinutes: h(-8), runningBalance: h(29.68) },
];

describe("the accrual history on the day each entry is for", () => {
  it("shows leave on its own day, with the balance as it stood then", () => {
    const rows = onLedgerDays(asMade);
    expect(rows.map((r) => r.id)).toEqual(["oct24", "pto2", "pto3", "nov7"]);
    expect(rows.map((r) => +(r.runningBalance / 60).toFixed(2))).toEqual([39.52, 31.52, 23.52, 29.68]);
  });

  it("keeps the stored balance on rows nothing moved past, even where they do not add up", () => {
    const imported = [
      { id: "a", date: "2026-01-01", deltaMinutes: 0, runningBalance: 1000 },
      { id: "b", date: "2026-02-01", deltaMinutes: 60, runningBalance: 5000 },
    ];
    expect(onLedgerDays(imported).map((r) => r.runningBalance)).toEqual([1000, 5000]);
  });

  it("puts an entry for leave on the leave's first day, and anything else on the day it was made", () => {
    const made = new Date("2026-11-09T16:25:39Z");
    expect(ledgerDay(made, { startDate: new Date("2026-11-02T00:00:00Z") })).toBe("2026-11-02");
    expect(ledgerDay(made, null)).toBe("2026-11-09");
  });

  it("says when a moved entry was entered, and the days of a longer leave", () => {
    const made = new Date("2026-11-09T16:25:39Z");
    const day = (d: string) => new Date(`${d}T00:00:00Z`);
    expect(ledgerDayNote("Timecard entry", made, { startDate: day("2026-11-02"), endDate: day("2026-11-02") })).toBe("Timecard entry · entered 11/9/2026");
    expect(ledgerDayNote(null, made, { startDate: day("2026-11-02"), endDate: day("2026-11-06") })).toBe("11/2/2026 – 11/6/2026 · entered 11/9/2026");
    expect(ledgerDayNote("Usage", made, { startDate: day("2026-11-09"), endDate: day("2026-11-09") })).toBe("Usage");
    expect(ledgerDayNote("Accrual", made, null)).toBe("Accrual");
  });
});
