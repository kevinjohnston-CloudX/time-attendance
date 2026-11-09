import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A stated direction (PunchType, the gate phone's batch send): CLOCK_OUT only,
 * never a guess, never before a later punch; and the GET the phone asks first.
 * Time clocks send no PunchType and keep the inferred direction.
 */

const state = vi.hoisted(() => ({
  current: "WORK" as "OUT" | "WORK" | "MEAL" | "BREAK",
  laterPunch: null as null | { punchTime: Date },
  created: [] as { punchType: string; punchTime: Date }[],
  rejected: [] as { punchType: string; rejectionReason: string }[],
}));

vi.mock("@/lib/api/timeclock-auth", () => ({ timeclockKeyValid: () => true }));
vi.mock("@/lib/audit/logger", () => ({ writeAuditLog: async () => undefined }));
vi.mock("@/lib/engines/segment-builder", () => ({ rebuildSegments: async () => undefined }));
vi.mock("@/lib/utils/timesheet", () => ({ findOrCreateTimesheet: async () => ({ id: "ts1", status: "OPEN" }) }));
vi.mock("@/lib/utils/date", () => ({
  computeRoundedTime: (t: Date) => t,
  computeShiftExpiry: () => ({ expiryUtc: new Date(0) }),
}));
vi.mock("@/lib/utils/punch-helpers", () => ({
  getCurrentPunchState: async () => state.current,
  findOpenPayPeriod: async () => ({ id: "pp1" }),
  saveRejectedPunch: async (r: { punchType: string; rejectionReason: string }) => { state.rejected.push(r); },
  mealLockoutRejection: () => "meal",
  mealLockoutWait: () => 0,
  TOO_SOON_REJECTION: "Scanned too soon",
}));
vi.mock("@/lib/services/scan-event.service", () => ({
  recordScanEvent: async () => ({ id: "se1", duplicate: false }),
  resolveScanOutcome: async () => undefined,
}));
vi.mock("@/lib/utils/badge-lookup", () => ({
  findEmployeeByBadge: async () => ({
    id: "e1",
    tenantId: "t1",
    ruleSetId: "rs1",
    wmsId: "9999832",
    isActive: true,
    terminatedAt: null,
    ruleSet: { workdayExpansionEnabled: false, mealLockoutMinutes: 0 },
    shift: null,
  }),
}));
vi.mock("@/lib/utils/tablet-time-zone", () => ({ tabletTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/utils/person-time-zone", () => ({ personTimeZone: () => "America/New_York" }));
vi.mock("@/lib/presence/employment", () => ({
  WMS_TERMINATION_ENDS_EMPLOYMENT: true,
  employmentEnded: () => false,
  madeActiveAt: async () => new Map(),
}));
vi.mock("@/lib/db", () => {
  const punch = {
    // Each caller is told apart by the shape of its punchTime filter.
    findFirst: async ({ where }: { where: { punchTime?: unknown } }) => {
      const t = where.punchTime as { gt?: Date } | Date | undefined;
      if (t && !(t instanceof Date) && "gt" in t) return state.laterPunch;
      return null; // too soon (gte/lte), same scan (exact Date): none
    },
    create: async ({ data }: { data: { punchType: string; punchTime: Date } }) => {
      state.created.push({ punchType: data.punchType, punchTime: data.punchTime });
      return { id: "p1", timesheetId: "ts1" };
    },
  };
  return {
    db: {
      punch,
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: async () => 1, punch }),
    },
  };
});

const { GET, POST } = await import("./route");

function post(body: Record<string, unknown>) {
  return POST(new NextRequest("http://x/api/timeclock/punch", {
    method: "POST",
    body: JSON.stringify({
      EmployeeCode: "9999832",
      ScanDateTime: "2026-11-09T17:02:03.123",
      DeviceName: "NJ3-SEC-07",
      Warehouse: 7,
      ...body,
    }),
  }));
}

beforeEach(() => {
  state.current = "WORK";
  state.laterPunch = null;
  state.created = [];
  state.rejected = [];
});

describe("GET /api/timeclock/punch", () => {
  it("lists CLOCK_OUT, and only CLOCK_OUT", async () => {
    const res = await GET(new NextRequest("http://x/api/timeclock/punch"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, punchTypes: ["CLOCK_OUT"] });
  });
});

describe("POST with a stated direction", () => {
  it("clocks out someone who is working", async () => {
    const res = await post({ PunchType: "CLOCK_OUT" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.punchType).toBe("CLOCK_OUT");
    expect(state.created.map((p) => p.punchType)).toEqual(["CLOCK_OUT"]);
  });

  it("refuses, never clocks in, someone already out", async () => {
    state.current = "OUT";
    const res = await post({ PunchType: "CLOCK_OUT" });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("INVALID_STATE");
    expect(json.error).toBe("Cannot CLOCK_OUT when current state is OUT");
    expect(state.created).toEqual([]);
  });

  it("refuses someone on a meal instead of ending it", async () => {
    state.current = "MEAL";
    const res = await post({ PunchType: "CLOCK_OUT" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Cannot CLOCK_OUT when current state is MEAL");
    expect(state.created).toEqual([]);
  });

  it("refuses a clock out that would land before a later punch", async () => {
    state.laterPunch = { punchTime: new Date("2026-11-09T22:30:00Z") };
    const res = await post({ PunchType: "CLOCK_OUT" });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("LATER_PUNCH");
    expect(state.created).toEqual([]);
    expect(state.rejected.map((r) => r.punchType)).toEqual(["CLOCK_OUT"]);
  });

  it("cannot be asked to clock anyone in", async () => {
    state.current = "OUT";
    const res = await post({ PunchType: "CLOCK_IN" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
    expect(state.created).toEqual([]);
  });
});

describe("POST without a direction (every time clock)", () => {
  it("still infers: OUT becomes CLOCK_IN", async () => {
    state.current = "OUT";
    const res = await post({});
    expect(res.status).toBe(200);
    expect(state.created.map((p) => p.punchType)).toEqual(["CLOCK_IN"]);
  });

  it("still infers: WORK becomes CLOCK_OUT, and a later punch does not matter", async () => {
    state.laterPunch = { punchTime: new Date("2026-11-09T22:30:00Z") };
    const res = await post({});
    expect(res.status).toBe(200);
    expect(state.created.map((p) => p.punchType)).toEqual(["CLOCK_OUT"]);
  });
});
