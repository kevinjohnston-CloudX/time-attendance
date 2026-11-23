import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { replaceNovaTimeImports, NOVATIME_IMPORT_NOTE } from "./novatime-import-leave";

type Req = { id: string; status: string; note: string | null; startDate: Date; durationSeconds: number; segments: number };
type Entry = { leaveRequestId: string | null; action: string; deltaSeconds: number; payPeriodEnd?: Date | null };

const day = (d: string) => new Date(`${d}T00:00:00Z`);

/**
 * One person's PTO: requests, ledger and this year's balance. NovaTime's usage
 * is a USAGE row linked to no request, dated by payPeriodEnd, as the load left it.
 */
function fakeClient(requests: Req[], ledger: Entry[], balance = -101_736) {
  let bal = balance;
  const client = {
    leaveRequest: {
      findMany: async ({ where }: { where: { id: { not: string }; startDate: { gte: Date; lte: Date } } }) =>
        requests.filter((r) => r.status === "POSTED" && r.note === NOVATIME_IMPORT_NOTE && r.segments === 0 && r.id !== where.id.not &&
          r.startDate >= where.startDate.gte && r.startDate <= where.startDate.lte),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: { status: string } }) => {
        const r = requests.find((x) => x.id === where.id && x.status === where.status);
        if (!r) return { count: 0 };
        r.status = data.status;
        return { count: 1 };
      },
    },
    leaveAccrualLedger: {
      aggregate: async ({ where }: { where: { action: string; leaveRequestId?: null; payPeriodEnd?: Date; leaveRequest?: { startDate: Date } } }) => {
        const rows = where.action === "USAGE"
          ? ledger.filter((e) => e.action === "USAGE" && e.leaveRequestId === null && e.payPeriodEnd?.getTime() === where.payPeriodEnd!.getTime())
          : ledger.filter((e) => e.action === "ADJUSTMENT" && requests.find((r) => r.id === e.leaveRequestId && r.note === NOVATIME_IMPORT_NOTE && r.startDate.getTime() === where.leaveRequest!.startDate.getTime()));
        return { _sum: { deltaSeconds: rows.length ? rows.reduce((a, e) => a + e.deltaSeconds, 0) : null } };
      },
      create: async ({ data }: { data: Entry }) => { ledger.push(data); },
    },
    leaveBalance: {
      upsert: async () => ({ id: "b1", balanceSeconds: bal }),
      update: async ({ data }: { data: { balanceSeconds: number } }) => { bal = data.balanceSeconds; },
    },
  };
  return { client: client as never, requests, ledger, balance: () => bal };
}

const ours = (over: Partial<{ startDate: Date; endDate: Date; selectedDays: unknown }> = {}) => ({
  id: "ours", employeeId: "e1", leaveTypeId: "lt", startDate: day("2026-10-26"), endDate: day("2026-10-26"), note: null, selectedDays: null, ...over,
}) as never;

describe("leave NovaTime had already booked, entered again here", () => {
  it("cancels the imported day and gives back what NovaTime charged for it (Jailine Brito Lopez, 10/26)", async () => {
    const t = fakeClient(
      [{ id: "imp", status: "POSTED", note: NOVATIME_IMPORT_NOTE, startDate: day("2026-10-26"), durationSeconds: 28800, segments: 0 }],
      [{ leaveRequestId: null, action: "USAGE", deltaSeconds: -28800, payPeriodEnd: day("2026-10-26") }],
    );
    expect(await replaceNovaTimeImports(t.client, ours())).toBe(28800);
    expect(t.requests[0].status).toBe("CANCELLED");
    expect(t.balance()).toBe(-101_736 + 28800);
    expect(t.ledger.at(-1)).toMatchObject({ leaveRequestId: "imp", action: "ADJUSTMENT", deltaSeconds: 28800 });
  });

  it("gives it back once when the day is entered twice", async () => {
    const t = fakeClient(
      [{ id: "imp", status: "POSTED", note: NOVATIME_IMPORT_NOTE, startDate: day("2026-10-26"), durationSeconds: 28800, segments: 0 }],
      [{ leaveRequestId: null, action: "USAGE", deltaSeconds: -28800, payPeriodEnd: day("2026-10-26") }],
    );
    await replaceNovaTimeImports(t.client, ours());
    expect(await replaceNovaTimeImports(t.client, ours())).toBe(0);
    expect(t.balance()).toBe(-101_736 + 28800);
  });

  it("gives back nothing for an import with no NovaTime usage behind it", async () => {
    const t = fakeClient([{ id: "imp", status: "POSTED", note: NOVATIME_IMPORT_NOTE, startDate: day("2026-10-26"), durationSeconds: 28800, segments: 0 }], []);
    expect(await replaceNovaTimeImports(t.client, ours())).toBe(0);
    expect(t.requests[0].status).toBe("CANCELLED");
    expect(t.balance()).toBe(-101_736);
  });

  it("gives back no more than NovaTime charged: 6.93 of an 8 hour import", async () => {
    const t = fakeClient(
      [{ id: "imp", status: "POSTED", note: NOVATIME_IMPORT_NOTE, startDate: day("2026-10-28"), durationSeconds: 28800, segments: 0 }],
      [{ leaveRequestId: null, action: "USAGE", deltaSeconds: -24948, payPeriodEnd: day("2026-10-28") }],
    );
    expect(await replaceNovaTimeImports(t.client, ours({ startDate: day("2026-10-28"), endDate: day("2026-10-28") }))).toBe(24948);
  });

  it("gives back NovaTime's 1.29 for an import rounded to 1.28 (Jenny Blanco, 10/12)", async () => {
    const t = fakeClient(
      [{ id: "imp", status: "POSTED", note: NOVATIME_IMPORT_NOTE, startDate: day("2026-10-12"), durationSeconds: 4620, segments: 0 }],
      [{ leaveRequestId: null, action: "USAGE", deltaSeconds: -4644, payPeriodEnd: day("2026-10-12") }],
    );
    expect(await replaceNovaTimeImports(t.client, ours({ startDate: day("2026-10-12"), endDate: day("2026-10-12") }))).toBe(4644);
  });

  it("two imports of one day give back what NovaTime charged, not twice over", async () => {
    const t = fakeClient(
      [
        { id: "a", status: "POSTED", note: NOVATIME_IMPORT_NOTE, startDate: day("2026-10-26"), durationSeconds: 28800, segments: 0 },
        { id: "b", status: "POSTED", note: NOVATIME_IMPORT_NOTE, startDate: day("2026-10-26"), durationSeconds: 28800, segments: 0 },
      ],
      [{ leaveRequestId: null, action: "USAGE", deltaSeconds: -28800, payPeriodEnd: day("2026-10-26") }],
    );
    expect(await replaceNovaTimeImports(t.client, ours())).toBe(28800);
  });

  it("only the days a request picked, over a range", async () => {
    const t = fakeClient(
      [
        { id: "mon", status: "POSTED", note: NOVATIME_IMPORT_NOTE, startDate: day("2026-12-28"), durationSeconds: 28800, segments: 0 },
        { id: "tue", status: "POSTED", note: NOVATIME_IMPORT_NOTE, startDate: day("2026-12-29"), durationSeconds: 28800, segments: 0 },
      ],
      [
        { leaveRequestId: null, action: "USAGE", deltaSeconds: -28800, payPeriodEnd: day("2026-12-28") },
        { leaveRequestId: null, action: "USAGE", deltaSeconds: -28800, payPeriodEnd: day("2026-12-29") },
      ],
    );
    const req = ours({ startDate: day("2026-12-28"), endDate: day("2026-12-29"), selectedDays: [{ date: "2026-12-29", type: "FULL" }] });
    expect(await replaceNovaTimeImports(t.client, req)).toBe(28800);
    expect(t.requests.map((r) => r.status)).toEqual(["POSTED", "CANCELLED"]);
  });

  it("leaves an import a salary line holds alone: it is on the timecard", async () => {
    const t = fakeClient(
      [{ id: "imp", status: "POSTED", note: NOVATIME_IMPORT_NOTE, startDate: day("2026-10-26"), durationSeconds: 28800, segments: 1 }],
      [{ leaveRequestId: null, action: "USAGE", deltaSeconds: -28800, payPeriodEnd: day("2026-10-26") }],
    );
    expect(await replaceNovaTimeImports(t.client, ours())).toBe(0);
    expect(t.requests[0].status).toBe("POSTED");
  });
});
