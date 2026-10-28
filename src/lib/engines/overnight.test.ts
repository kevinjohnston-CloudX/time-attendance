// The engine reads calendar days in the process time zone; production runs in UTC.
process.env.TZ = "UTC";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { computeSegments } from "./segment-builder";
import { startOfDayInTz } from "@/lib/utils/date";

const TZ = "America/New_York";
// Monday 10/12 7:00 PM to Tuesday 10/13 12:30 AM, Eastern.
const IN = new Date("2026-10-12T19:00:00-04:00");
const OUT = new Date("2026-10-13T00:30:00-04:00");
const monday = startOfDayInTz(IN, TZ).toISOString();

type Opts = { source?: string; approvedById?: string | null; stateBefore?: string };
const punch = (punchType: string, t: Date, o: Opts = {}) => ({
  id: punchType,
  punchType,
  punchTime: t,
  roundedTime: t,
  source: o.source ?? "MANUAL",
  approvedById: o.approvedById === undefined ? "hr" : o.approvedById,
  stateBefore: o.stateBefore ?? (punchType === "CLOCK_IN" ? "OUT" : "WORK"),
  stateAfter: punchType === "CLOCK_IN" ? "WORK" : "OUT",
});
const segments = (inOpts: Opts, outOpts: Opts) =>
  computeSegments("t", [punch("CLOCK_IN", IN, inOpts), punch("CLOCK_OUT", OUT, outOpts)] as never, TZ)
    .map((s) => ({ minutes: s.durationMinutes, day: s.segmentDate.toISOString() }));

describe("A shift past midnight", () => {
  it("keeps a hand-entered 7:00 PM to 12:30 AM whole on the day it starts", () => {
    expect(segments({}, {})).toEqual([{ minutes: 330, day: monday }]);
  });
  it("keeps it when the clock out was added on its own on the timecard", () => {
    // A manual clock out from the timecard is stored as stateBefore OUT.
    expect(segments({}, { stateBefore: "OUT" })).toEqual([{ minutes: 330, day: monday }]);
  });
  it("still splits a time clock shift at midnight", () => {
    const s = segments({ source: "KIOSK", approvedById: null }, { source: "KIOSK", approvedById: null });
    expect(s.map((x) => x.minutes)).toEqual([300, 30]);
    expect(s[0].day).toBe(monday);
    expect(s[1].day).not.toBe(monday);
  });
  it("still splits punches an import brought in, which no one approved", () => {
    expect(segments({ approvedById: null }, { approvedById: null }).map((x) => x.minutes)).toEqual([300, 30]);
  });
  it("still splits a time clock clock in with a hand-entered clock out", () => {
    expect(segments({ source: "KIOSK", approvedById: null }, {}).map((x) => x.minutes)).toEqual([300, 30]);
  });
});
