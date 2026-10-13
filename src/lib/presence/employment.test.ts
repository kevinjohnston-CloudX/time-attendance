import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { employmentEnded, recordsMadeActive } from "./employment";

const d = (iso: string) => new Date(iso);
const TODAY = "2026-10-13";

describe("employmentEnded", () => {
  it("inactive is ended, with or without a date", () => {
    expect(employmentEnded({ isActive: false, terminatedAt: null }, TODAY, null)).toBe(true);
    expect(employmentEnded({ isActive: false, terminatedAt: d("2026-08-28T01:00:00Z") }, TODAY, d("2026-10-12T14:40:00Z"))).toBe(true);
  });

  it("active with no date is employed", () => {
    expect(employmentEnded({ isActive: true, terminatedAt: null }, TODAY, null)).toBe(false);
  });

  it("made Active after the date: employed (Fernando Abreu, On Leave -> Active 10-12)", () => {
    expect(
      employmentEnded(
        { isActive: true, terminatedAt: d("2026-08-28T01:00:00Z"), hireDate: d("2022-06-27T04:00:00Z") },
        TODAY,
        d("2026-10-12T14:40:00Z"),
      ),
    ).toBe(false);
  });

  it("hired again after the date: employed (Manuel Reyes, term 03-11, hired 09-28)", () => {
    expect(
      employmentEnded({ isActive: true, terminatedAt: d("2026-03-11T04:00:00Z"), hireDate: d("2026-09-28T00:00:00Z") }, TODAY, null),
    ).toBe(false);
  });

  it("an adjusted hire date after the date counts as hired again", () => {
    expect(
      employmentEnded(
        { isActive: true, terminatedAt: d("2026-03-11T04:00:00Z"), hireDate: d("2020-01-01T00:00:00Z"), adjustedHireDate: d("2026-09-01T00:00:00Z") },
        TODAY,
        null,
      ),
    ).toBe(false);
  });

  it("a date still ahead is their last day: employed until it has passed (Judith Zambrano, 10-15)", () => {
    const judith = { isActive: true, terminatedAt: d("2026-10-15T04:00:00Z"), hireDate: d("2019-09-01T04:00:00Z") };
    expect(employmentEnded(judith, "2026-10-13", null)).toBe(false);
    expect(employmentEnded(judith, "2026-10-15", null)).toBe(false);
    expect(employmentEnded(judith, "2026-10-16", null)).toBe(true);
  });

  it("a past date with nothing since is still ended (left in 2023, record never set Inactive)", () => {
    expect(
      employmentEnded({ isActive: true, terminatedAt: d("2023-01-04T05:00:00Z"), hireDate: d("2022-05-19T04:00:00Z") }, TODAY, null),
    ).toBe(true);
  });

  it("made Active before the date does not undo a later termination", () => {
    expect(
      employmentEnded({ isActive: true, terminatedAt: d("2026-09-30T04:00:00Z"), hireDate: d("2022-01-01T00:00:00Z") }, TODAY, d("2026-09-01T12:00:00Z")),
    ).toBe(true);
  });

  it("hired before the date (a short stint) is still ended without a reactivation", () => {
    // Daniel Khan's record: hired 08-28, date 09-06. Only the audited 10-02
    // reactivation lets him in.
    const daniel = { isActive: true, terminatedAt: d("2026-09-06T04:00:00Z"), hireDate: d("2026-08-28T04:00:00Z") };
    expect(employmentEnded(daniel, TODAY, null)).toBe(true);
    expect(employmentEnded(daniel, TODAY, d("2026-10-02T16:00:00Z"))).toBe(false);
  });
});

describe("recordsMadeActive", () => {
  it("reads the employee page's status changes", () => {
    expect(recordsMadeActive({ fields: [{ after: "Active", field: "Status", before: "On Leave" }] })).toBe(true);
    expect(recordsMadeActive({ fields: [{ after: "Active", field: "Status", before: "Inactive" }] })).toBe(true);
    expect(recordsMadeActive({ fields: [{ field: "Pay Rate", before: "18", after: "19" }, { field: "Status", before: "Inactive", after: "Active" }] })).toBe(true);
  });

  it("ignores everything else", () => {
    expect(recordsMadeActive({ fields: [{ after: "On Leave", field: "Status", before: "Active" }] })).toBe(false);
    expect(recordsMadeActive({ fields: [{ field: "Termination Date", before: "2026-08-28", after: null }] })).toBe(false);
    expect(recordsMadeActive({ after: { codes: ["ATW101376"] } })).toBe(false);
    expect(recordsMadeActive(null)).toBe(false);
    expect(recordsMadeActive("Active")).toBe(false);
  });
});
