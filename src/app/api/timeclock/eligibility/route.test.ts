import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The gate check for visitors with a pass (visitor-pass.ts): only their
 * building, only through their last day, always let out while inside, and a
 * badge from before passes existed unchanged. Monday to Friday only without a
 * schedule. And former employees turned away at a gate, noted for Live
 * Attendance's information alert.
 */

/** Tuesday 2026-11-17, 10:00 in New York: a weekday everywhere the tests look. */
const TUESDAY = new Date("2026-11-17T15:00:00.000Z");

const state = vi.hoisted(() => ({
  pass: null as null | { siteId: string; validFrom: Date; validUntil: Date; endedAt: Date | null },
  lastScan: null as null | { direction: string; scanTime: Date },
  scheduleDay: null as null | { isWorkday: boolean; startTime: string | null; endTime: string | null; source: string },
  zone: "America/New_York",
  sites: { "5903": { id: "nj", timezone: "America/New_York" }, "7575": { id: "ga", timezone: "America/New_York" } } as Record<string, { id: string; timezone: string }>,
  noted: [] as { reason: string }[],
  wmsId: "CL00007",
  ended: false,
  later: [] as (() => Promise<void>)[],
}));

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => Promise<void>) => state.later.push(fn) }));
vi.mock("@/lib/api/timeclock-auth", () => ({ timeclockKeyValid: () => true }));
vi.mock("@/lib/db", () => ({
  db: {
    employee: {
      findFirst: async () => ({
        id: "v1",
        tenantId: "t1",
        wmsId: state.wmsId,
        isActive: true,
        terminatedAt: null,
        hireDate: null,
        adjustedHireDate: null,
        wmsActive: null,
        siteId: "nj",
        wmsName: null,
        user: { name: "Ana Visitor" },
        department: { name: "Account Management" },
        timeZone: null,
        preferredLanguage: null,
        site: { timezone: state.zone, gateScanMode: "REPORT" },
      }),
    },
    scheduleDay: { findFirst: async () => state.scheduleDay },
    scanEvent: { findFirst: async () => state.lastScan },
    visitorPass: { findUnique: async () => state.pass },
  },
}));
vi.mock("@/lib/presence/gate-refusals.service", () => ({
  siteByWarehouse: async (_t: string, code: string | null) => (code ? state.sites[code] ?? null : null),
  recordGateRefusal: async (r: { reason: string }) => void state.noted.push(r),
}));
vi.mock("@/lib/presence/employment", () => ({
  WMS_TERMINATION_ENDS_EMPLOYMENT: false,
  employmentEnded: () => state.ended,
  madeActiveAt: async () => new Map(),
}));
vi.mock("@/lib/presence/gate-alert-log", () => ({ gateLog: () => {}, errorCode: () => "E" }));
vi.mock("@/lib/privacy/data-protection", () => ({ cachedDataProtection: async () => null, photoOffAt: () => false }));
vi.mock("@/lib/timeclock/tablet-languages", () => ({
  tabletLanguages: () => [],
  buildingLanguageCodes: () => [],
  tabletBuilding: async () => null,
}));

import { GET } from "./route";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(TUESDAY);
const day = (offset: number) => {
  const d = new Date(`${today}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

async function check(warehouse?: string, stream = "SECURITY") {
  const qs = new URLSearchParams({ badge: state.wmsId, stream, ...(warehouse ? { warehouse } : {}) });
  const res = await GET(new NextRequest(`http://x/api/timeclock/eligibility?${qs}`));
  for (const fn of state.later.splice(0)) await fn();
  return (await res.json()) as { scheduled: boolean; reason: string; terminated: boolean; department: string };
}

beforeEach(() => {
  // Only Date is faked: the route awaits real promises and after() callbacks.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TUESDAY);
  state.pass = null;
  state.lastScan = null;
  state.scheduleDay = null;
  state.zone = "America/New_York";
  state.noted = [];
  state.wmsId = "CL00007";
  state.ended = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("visitor at the gate", () => {
  it("a badge with no pass is let in as before", async () => {
    const r = await check("7575");
    expect(r).toMatchObject({ scheduled: true, reason: "CLIENT", terminated: false, department: "Visitor" });
    expect(state.noted).toEqual([]);
  });

  it("a valid pass opens its own building, and a tablet that names none", async () => {
    state.pass = { siteId: "nj", validFrom: day(-3), validUntil: day(0), endedAt: null };
    expect(await check("5903")).toMatchObject({ scheduled: true, reason: "CLIENT" });
    expect(await check()).toMatchObject({ scheduled: true, reason: "CLIENT" });
  });

  it("an expired pass is refused and noted for Live Attendance", async () => {
    state.pass = { siteId: "nj", validFrom: day(-10), validUntil: day(-1), endedAt: null };
    expect(await check("5903")).toMatchObject({ scheduled: false, reason: "VISITOR_EXPIRED", terminated: false });
    expect(state.noted.map((n) => n.reason)).toEqual(["VISITOR_EXPIRED"]);
  });

  it("another building is refused", async () => {
    state.pass = { siteId: "nj", validFrom: day(-1), validUntil: day(30), endedAt: null };
    expect(await check("7575")).toMatchObject({ scheduled: false, reason: "VISITOR_OTHER_BUILDING" });
  });

  it("an ended pass is refused even inside its dates", async () => {
    state.pass = { siteId: "nj", validFrom: day(-1), validUntil: day(30), endedAt: new Date() };
    expect(await check("5903")).toMatchObject({ scheduled: false, reason: "VISITOR_ENDED" });
  });

  it("a pass that starts tomorrow is not yet good", async () => {
    state.pass = { siteId: "nj", validFrom: day(1), validUntil: day(7), endedAt: null };
    expect(await check("5903")).toMatchObject({ scheduled: false, reason: "VISITOR_NOT_YET" });
  });

  it("a visitor already inside is always let out", async () => {
    state.pass = { siteId: "nj", validFrom: day(-10), validUntil: day(-1), endedAt: null };
    state.lastScan = { direction: "IN", scanTime: new Date() };
    expect(await check("5903")).toMatchObject({ scheduled: true, reason: "PRESENT" });
    expect(state.noted).toEqual([]);
  });
});

describe("visitor at the gate on a weekend", () => {
  /** Saturday 2026-11-21, 10:00 in New York. */
  const SATURDAY = new Date("2026-11-21T15:00:00.000Z");
  const workday = { isWorkday: true, startTime: "09:00", endTime: "17:00", source: "CLOUDTIME" };

  it("Monday to Friday a visitor still needs no schedule", async () => {
    for (const at of ["2026-11-16T15:00:00Z", "2026-11-18T15:00:00Z", "2026-11-20T15:00:00Z"]) {
      vi.setSystemTime(new Date(at));
      expect(await check("5903")).toMatchObject({ scheduled: true, reason: "CLIENT" });
    }
    expect(state.noted).toEqual([]);
  });

  it("Saturday and Sunday a visitor with no schedule is refused and noted for loss prevention", async () => {
    for (const at of [SATURDAY, new Date("2026-11-22T15:00:00.000Z")]) {
      vi.setSystemTime(at);
      expect(await check("5903")).toMatchObject({ scheduled: false, reason: "NO_SCHEDULE", department: "Visitor" });
    }
    expect(state.noted.map((n) => n.reason)).toEqual(["NO_SCHEDULE", "NO_SCHEDULE"]);
  });

  it("a valid pass does not open the gate on a weekend by itself", async () => {
    vi.setSystemTime(SATURDAY);
    state.pass = { siteId: "nj", validFrom: new Date("2026-11-01T00:00:00Z"), validUntil: new Date("2027-10-31T00:00:00Z"), endedAt: null };
    expect(await check("5903")).toMatchObject({ scheduled: false, reason: "NO_SCHEDULE" });
  });

  it("a visitor put on the day's schedule gets in on a weekend", async () => {
    vi.setSystemTime(SATURDAY);
    state.scheduleDay = workday;
    expect(await check("5903")).toMatchObject({ scheduled: true, reason: "WORKDAY" });
    expect(state.noted).toEqual([]);
  });

  it("scheduled off that day reads as such", async () => {
    vi.setSystemTime(SATURDAY);
    state.scheduleDay = { ...workday, isWorkday: false, startTime: null, endTime: null };
    expect(await check("5903")).toMatchObject({ scheduled: false, reason: "NOT_A_WORKDAY" });
  });

  it("a visitor inside since Friday is let out on Saturday", async () => {
    vi.setSystemTime(SATURDAY);
    state.lastScan = { direction: "IN", scanTime: new Date("2026-11-20T21:00:00.000Z") };
    expect(await check("5903")).toMatchObject({ scheduled: true, reason: "PRESENT" });
    expect(state.noted).toEqual([]);
  });

  it("a pass that does not open this gate still says why, weekend or not", async () => {
    vi.setSystemTime(SATURDAY);
    state.pass = { siteId: "nj", validFrom: new Date("2026-11-01T00:00:00Z"), validUntil: new Date("2026-11-20T00:00:00Z"), endedAt: null };
    state.scheduleDay = workday;
    expect(await check("5903")).toMatchObject({ scheduled: false, reason: "VISITOR_EXPIRED" });
  });

  it("the day is the building's: 11:30 PM Friday is Friday, 12:30 AM Saturday is Saturday", async () => {
    vi.setSystemTime(new Date("2026-11-21T04:30:00.000Z"));
    expect(await check("5903")).toMatchObject({ scheduled: true, reason: "CLIENT" });
    vi.setSystemTime(new Date("2026-11-21T05:30:00.000Z"));
    expect(await check("5903")).toMatchObject({ scheduled: false, reason: "NO_SCHEDULE" });
  });

  it("in California, 10 PM Friday there is still Friday although New York is on Saturday", async () => {
    state.zone = "America/Los_Angeles";
    vi.setSystemTime(new Date("2026-11-21T06:00:00.000Z"));
    expect(await check("6002")).toMatchObject({ scheduled: true, reason: "CLIENT" });
  });

  it("staff are unchanged on a weekend: their schedule decides, as on any day", async () => {
    vi.setSystemTime(SATURDAY);
    state.wmsId = "123456";
    expect(await check("5903")).toMatchObject({ scheduled: false, reason: "NO_SCHEDULE", department: "Account Management" });
    state.scheduleDay = workday;
    expect(await check("5903")).toMatchObject({ scheduled: true, reason: "WORKDAY" });
  });
});

describe("former employee at the gate", () => {
  beforeEach(() => {
    state.wmsId = "123456";
  });

  it("is noted as terminated, and the tablet's answer is unchanged", async () => {
    state.ended = true;
    expect(await check("5903")).toMatchObject({ terminated: true, scheduled: false, reason: "NO_SCHEDULE" });
    expect(state.noted.map((n) => n.reason)).toEqual(["TERMINATED"]);
  });

  it("is noted even while inside, since the gate still turned them away", async () => {
    state.ended = true;
    state.lastScan = { direction: "IN", scanTime: new Date() };
    await check("5903");
    expect(state.noted.map((n) => n.reason)).toEqual(["TERMINATED"]);
  });

  it("is not noted at a time clock", async () => {
    state.ended = true;
    await check("5903", "TIME_CLOCK");
    expect(state.noted).toEqual([]);
  });

  it("someone still employed with no shift is noted as before", async () => {
    expect(await check("5903")).toMatchObject({ terminated: false, scheduled: false, reason: "NO_SCHEDULE" });
    expect(state.noted.map((n) => n.reason)).toEqual(["NO_SCHEDULE"]);
  });

  it("a visitor is never noted as a former employee", async () => {
    state.wmsId = "CL00007";
    state.ended = true;
    await check("7575");
    expect(state.noted).toEqual([]);
  });
});
