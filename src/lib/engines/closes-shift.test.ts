import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { closesShift } from "./segment-builder";
import { endOfDayInTz } from "@/lib/utils/date";

// Abraham Vallejo, 6002 California: clocked in 7:00 AM Pacific on 11/03, no clock out.
const clockIn = new Date("2026-11-03T15:00:00.000Z");
const nightlyClose = endOfDayInTz("2026-11-03", "America/Los_Angeles"); // 11:59:59 PM Pacific

describe("A forgotten clock out gets one automatic clock out", () => {
  it("lands at the end of the employee's own day, as the nightly auto clock out does", () => {
    expect(nightlyClose.toISOString()).toBe("2026-11-04T07:59:59.000Z");
  });

  it("is not added again when the nightly auto clock out already closed the shift", () => {
    expect(closesShift(clockIn, null, [nightlyClose])).toBe(true);
  });

  it("counts a nightly one placed at a night shift's end, after midnight", () => {
    expect(closesShift(clockIn, null, [new Date("2026-11-04T10:30:00.000Z")])).toBe(true);
  });

  it("is added when the only automatic clock out closes another day's shift", () => {
    const earlier = new Date("2026-11-03T07:59:59.000Z"); // 11/02's
    const nextDay = new Date("2026-11-04T15:00:00.000Z"); // 11/04's clock in
    expect(closesShift(clockIn, nextDay, [earlier])).toBe(false);
    expect(closesShift(clockIn, nextDay, [new Date("2026-11-05T07:59:59.000Z")])).toBe(false);
  });
});
