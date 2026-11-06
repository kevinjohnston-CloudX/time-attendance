import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * scan_events direction after a refused time clock punch, through the real
 * recordScanEvent / resolveScanOutcome against an in-memory scan_events table.
 * The case that found it, NJ3-DOCK-A-CRTEST on 2026-11-06: CLOCK_IN 15:46:51,
 * "scanned again too quickly" 15:49:44, CLOCK_OUT 15:53:00 stored as IN.
 */

// A stand-in for Prisma's rows and where clauses: loose on purpose, test only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const { store } = vi.hoisted(() => ({ store: { rows: [] as Row[], seq: 0 } }));

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond) return cond.in.includes(value);
      if ("not" in cond) return value !== cond.not;
      const t = value instanceof Date ? value.getTime() : value;
      if ("lt" in cond && !(t < cond.lt.getTime())) return false;
      if ("gt" in cond && !(t > cond.gt.getTime())) return false;
      if ("gte" in cond && !(t >= cond.gte.getTime())) return false;
      return true;
    }
    return value instanceof Date ? value.getTime() === (cond as Date).getTime() : value === cond;
  });
}
const sorted = (rows: Row[], orderBy?: Row) =>
  orderBy?.scanTime === "desc"
    ? [...rows].sort((a, b) => b.scanTime - a.scanTime)
    : [...rows].sort((a, b) => a.scanTime - b.scanTime);
const EMPLOYEE = { id: "emp1", tenantId: "t1", timeZone: null, site: { timezone: "America/New_York" } };

vi.mock("@/lib/db", () => {
  const scanEvent = {
    findUnique: vi.fn(async ({ where }: Row) => {
      if (where.id) {
        const row = store.rows.find(r => r.id === where.id);
        return row ? { ...row, employee: row.employeeId ? EMPLOYEE : null } : null;
      }
      const k = where.badgeCode_stream_scanTime_sourceSlot;
      return store.rows.find(r => r.badgeCode === k.badgeCode && r.stream === k.stream
        && r.scanTime.getTime() === k.scanTime.getTime() && r.sourceSlot === k.sourceSlot) ?? null;
    }),
    findFirst: vi.fn(async ({ where, orderBy }: Row) => sorted(store.rows.filter(r => matches(r, where)), orderBy)[0] ?? null),
    findMany: vi.fn(async ({ where, orderBy }: Row) => sorted(store.rows.filter(r => matches(r, where)), orderBy)),
    create: vi.fn(async ({ data }: Row) => {
      const row = { id: `s${++store.seq}`, directionSource: "ALTERNATION", outcome: "PENDING", ...data };
      store.rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: Row) => {
      const row = store.rows.find(r => r.id === where.id);
      Object.assign(row!, data);
      return row;
    }),
  };
  const db: Row = { scanEvent };
  db.$transaction = vi.fn(async (fn: (tx: Row) => unknown) => fn(db));
  return { db };
});
vi.mock("@/lib/utils/badge-lookup", () => ({ findEmployeeIdentityByBadge: vi.fn(async () => EMPLOYEE) }));
vi.mock("@/lib/utils/shown-name", () => ({ shownNameOrNull: () => "Bench Person" }));

import { recordScanEvent, resolveScanOutcome } from "./scan-event.service";

// 2026-11-06 Eastern (UTC-5): these are the instants of the test tablet's scans.
const at = (hhmmss: string) => new Date(`2026-11-06T${hhmmss}-05:00`);
const scan = (hhmmss: string) => recordScanEvent({ badgeCode: "0388037305", stream: "TIME_CLOCK", scanTime: at(hhmmss) } as never);
const recorded = (id: string, punchType: string) =>
  resolveScanOutcome(id, { outcome: "PUNCH_RECORDED", punchId: `p-${id}`, punchType, stateAfter: punchType === "CLOCK_IN" ? "WORK" : "OUT" });
const refused = (id: string, rejectionReason: string) => resolveScanOutcome(id, { outcome: "PUNCH_REJECTED", rejectionReason });
const directionOf = (id: string) => store.rows.find(r => r.id === id)!.direction;

beforeEach(() => {
  store.rows = [];
  store.seq = 0;
});

describe("a refused time clock punch is not a crossing", () => {
  it("does not invert the next real punch (the 2026-11-06 case)", async () => {
    const a = await scan("15:46:51");
    await recorded(a.id, "CLOCK_IN");
    const b = await scan("15:49:44");
    await refused(b.id, "Scanned again too quickly, please wait to prevent duplicates");
    const c = await scan("15:53:00");
    await recorded(c.id, "CLOCK_OUT");

    expect(directionOf(a.id)).toBe("IN");
    expect(directionOf(b.id)).toBe("UNKNOWN");
    expect(store.rows.find(r => r.id === b.id)!.note).toMatch(/^Refused \(Scanned again too quickly.*\): not counted/);
    expect(c.direction).toBe("OUT");
  });

  it.each([
    "Employee is inactive",
    "Visitors scan at security only, not at the time clock",
    "No active pay period",
    "Timesheet is locked for this pay period",
    "Please wait 12 minutes before clocking in again.",
    "Invalid state transition",
  ])("holds for every refusal: %s", async (reason) => {
    const a = await scan("07:00:00");
    await recorded(a.id, "CLOCK_IN");
    const b = await scan("11:30:00");
    await refused(b.id, reason);
    const c = await scan("15:30:00");
    expect(c.direction).toBe("OUT");
  });

  it("makes a refused first scan of the day leave the next one as the day's IN", async () => {
    const a = await scan("06:55:00");
    await refused(a.id, "No active pay period");
    const b = await scan("07:01:00");
    expect(b.direction).toBe("IN");
  });

  it("repairs scans that arrived before a late refused one", async () => {
    // Offline queue flushing out of order: the 08:00 IN and 16:00 OUT are in,
    // then a 12:00 scan arrives late (and inverts 16:00), and is refused.
    const a = await scan("08:00:00");
    await recorded(a.id, "CLOCK_IN");
    const c = await scan("16:00:00");
    await recorded(c.id, "CLOCK_OUT");
    expect(directionOf(c.id)).toBe("OUT");
    const late = await scan("12:00:00");
    expect(directionOf(c.id)).toBe("IN"); // the late insert re-resolved it, as before
    await refused(late.id, "Scanned again too quickly, please wait to prevent duplicates");
    expect(directionOf(late.id)).toBe("UNKNOWN");
    expect(directionOf(c.id)).toBe("OUT");
    expect(store.rows.find(r => r.id === c.id)!.note).toMatch(/refused scan was set aside/);
  });

  it("leaves a recorded punch, and the gate, alone", async () => {
    const a = await scan("07:00:00");
    await recorded(a.id, "CLOCK_IN");
    expect(directionOf(a.id)).toBe("IN");

    const gate = await recordScanEvent({ badgeCode: "0388037305", stream: "SECURITY", scanTime: at("06:55:00") } as never);
    await resolveScanOutcome(gate.id, { outcome: "PUNCH_REJECTED", rejectionReason: "not a gate path, but must not touch the gate" });
    expect(directionOf(gate.id)).toBe("IN");
  });
});
