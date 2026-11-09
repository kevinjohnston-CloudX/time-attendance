import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The gate check for visitors with a pass (visitor-pass.ts): only their
 * building, only through their last day, always let out while inside, and a
 * badge from before passes existed unchanged. And former employees turned
 * away at a gate, noted for Live Attendance's information alert.
 */

const state = vi.hoisted(() => ({
  pass: null as null | { siteId: string; validFrom: Date; validUntil: Date; endedAt: Date | null },
  lastScan: null as null | { direction: string; scanTime: Date },
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
        site: { timezone: "America/New_York", gateScanMode: "REPORT" },
      }),
    },
    scheduleDay: { findFirst: async () => null },
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

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
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
  state.pass = null;
  state.lastScan = null;
  state.noted = [];
  state.wmsId = "CL00007";
  state.ended = false;
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
