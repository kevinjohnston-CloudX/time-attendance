import { describe, expect, it } from "vitest";
import {
  STAND_IN_FROM_HOUR,
  addDays,
  oracleArrived,
  pickStandIns,
  planStandIn,
  siteClock,
  type RecentDay,
} from "./schedule-stand-in";

function day(employeeId: string, workDate: string, startTime: string | null = "07:00"): RecentDay {
  return { employeeId, workDate, shiftId: null, startTime, endTime: "15:30", mealMinutes: 30 };
}

describe("siteClock", () => {
  // 2026-10-09 08:00 UTC: 04:00 in New Jersey, 01:00 in California.
  const now = new Date("2026-10-09T08:00:00.000Z");

  it("reads the building's own date and hour", () => {
    expect(siteClock(now, "America/New_York")).toEqual({ today: "2026-10-09", hour: 4 });
    expect(siteClock(now, "America/Los_Angeles")).toEqual({ today: "2026-10-09", hour: 1 });
  });

  it("is still yesterday out west just after midnight in the east", () => {
    expect(siteClock(new Date("2026-10-09T04:30:00.000Z"), "America/Los_Angeles")).toEqual({
      today: "2026-10-08",
      hour: 21,
    });
  });

  it("reads midnight as hour 0, not 24", () => {
    expect(siteClock(new Date("2026-10-09T04:00:00.000Z"), "America/New_York").hour).toBe(0);
  });
});

describe("addDays", () => {
  it("crosses month ends", () => {
    expect(addDays("2026-10-02", -7)).toBe("2026-09-25");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("is not moved by the clock change", () => {
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-11-08", -7)).toBe("2026-11-01");
  });
});

describe("oracleArrived", () => {
  it("is false with nothing from Oracle", () => {
    expect(oracleArrived(0, 254)).toBe(false);
    expect(oracleArrived(0, 0)).toBe(false);
  });

  it("is false on a partial send (2 NJ rows, 2026-09-25)", () => {
    expect(oracleArrived(2, 285)).toBe(false);
  });

  it("is true on a real arrival, weekends included", () => {
    // NJ299 on 10-09: 222 of Oracle's own rows plus 28 conflicts, against 254 usual.
    expect(oracleArrived(250, 254)).toBe(true);
    // NJ5903 on a Saturday: 171 against a weekday-sized usual list.
    expect(oracleArrived(171, 285)).toBe(true);
  });

  it("is true for any row at a building with no usual people", () => {
    expect(oracleArrived(3, 0)).toBe(true);
  });
});

describe("planStandIn", () => {
  const base = { hour: 6, oracleRows: 0, usualPeople: 254, standInRows: 0, enabled: true };

  it("stands in when Oracle has not sent the day by the hour", () => {
    expect(planStandIn(base)).toBe("STAND_IN");
    expect(planStandIn({ ...base, hour: STAND_IN_FROM_HOUR })).toBe("STAND_IN");
  });

  it("waits before the hour", () => {
    expect(planStandIn({ ...base, hour: STAND_IN_FROM_HOUR - 1 })).toBe("WAIT");
    expect(planStandIn({ ...base, hour: 0 })).toBe("WAIT");
  });

  it("keeps filling gaps after stand-ins exist, while Oracle is still missing", () => {
    expect(planStandIn({ ...base, standInRows: 254 })).toBe("STAND_IN");
  });

  it("removes what Oracle did not confirm once it arrives", () => {
    expect(planStandIn({ ...base, oracleRows: 222, standInRows: 32 })).toBe("REMOVE_EXTRAS");
  });

  it("does nothing once Oracle has arrived and no stand-ins are left", () => {
    expect(planStandIn({ ...base, oracleRows: 250 })).toBe("NONE");
  });

  it("does nothing at a building nobody was scheduled at", () => {
    expect(planStandIn({ ...base, usualPeople: 0 })).toBe("NONE");
  });

  it("switched off: writes nothing, still removes", () => {
    expect(planStandIn({ ...base, enabled: false })).toBe("NONE");
    expect(planStandIn({ ...base, enabled: false, oracleRows: 222, standInRows: 32 })).toBe("REMOVE_EXTRAS");
  });
});

describe("pickStandIns", () => {
  it("gives each usual person one day, with their latest times", () => {
    const picks = pickStandIns(
      [day("a", "2026-10-02", "06:00"), day("a", "2026-10-08", "07:00"), day("a", "2026-10-05", "08:00"), day("b", "2026-10-04")],
      new Set(),
    );
    expect(picks).toHaveLength(2);
    expect(picks.find((p) => p.employeeId === "a")?.startTime).toBe("07:00");
    expect(picks.find((p) => p.employeeId === "b")).toEqual({
      employeeId: "b",
      shiftId: null,
      startTime: "07:00",
      endTime: "15:30",
      mealMinutes: 30,
    });
  });

  it("leaves alone anybody who already has a row today", () => {
    const picks = pickStandIns([day("a", "2026-10-08"), day("b", "2026-10-08")], new Set(["a"]));
    expect(picks.map((p) => p.employeeId)).toEqual(["b"]);
  });

  it("writes nothing when there is nobody", () => {
    expect(pickStandIns([], new Set())).toEqual([]);
  });
});
