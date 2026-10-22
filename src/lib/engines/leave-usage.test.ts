import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { postLeaveUsage } from "./accrual-engine";

type Entry = { leaveRequestId: string; action: string; deltaMinutes: number };

/** A transaction with one request, its balance (if any) and its ledger. */
function fakeTx(opts: { tracked?: boolean; balance?: number | null; ledger?: Entry[] }) {
  const ledger: Entry[] = [...(opts.ledger ?? [])];
  let balance = opts.balance === undefined ? 600 : opts.balance;
  const tx = {
    leaveRequest: {
      findUniqueOrThrow: async () => ({
        id: "r1", employeeId: "e1", leaveTypeId: "lt", durationMinutes: 480,
        startDate: new Date("2026-09-21T00:00:00Z"), leaveType: { accrualTracked: opts.tracked ?? true },
      }),
    },
    leaveAccrualLedger: {
      aggregate: async ({ where }: { where: { leaveRequestId: string; action: { in: string[] } } }) => ({
        _sum: { deltaMinutes: ledger.filter((e) => e.leaveRequestId === where.leaveRequestId && where.action.in.includes(e.action)).reduce((a, e) => a + e.deltaMinutes, 0) || null },
      }),
      create: async ({ data }: { data: Entry }) => { ledger.push(data); },
    },
    leaveBalance: {
      upsert: async () => { if (balance === null) balance = 0; return { id: "b1", balanceMinutes: balance }; },
      update: async ({ data }: { data: { balanceMinutes: number } }) => { balance = data.balanceMinutes; },
    },
  };
  return { tx: tx as never, ledger, balance: () => balance };
}

describe("taking approved leave off the balance", () => {
  it("debits a request once", async () => {
    const t = fakeTx({});
    await postLeaveUsage("r1", t.tx);
    await postLeaveUsage("r1", t.tx); // the pay period locks after HR approved it
    expect(t.balance()).toBe(120);
    expect(t.ledger.filter((e) => e.action === "USAGE")).toHaveLength(1);
  });

  it("debits again after an approval was reversed", async () => {
    const t = fakeTx({ ledger: [
      { leaveRequestId: "r1", action: "USAGE", deltaMinutes: -480 },
      { leaveRequestId: "r1", action: "ADJUSTMENT", deltaMinutes: 480 },
    ] });
    await postLeaveUsage("r1", t.tx);
    expect(t.balance()).toBe(120);
  });

  it("leaves a type with no balance (Bereavement) alone", async () => {
    const t = fakeTx({ tracked: false, balance: null });
    await postLeaveUsage("r1", t.tx);
    expect(t.ledger).toHaveLength(0);
    expect(t.balance()).toBeNull();
  });

  it("starts a balance at zero when there is none yet", async () => {
    const t = fakeTx({ balance: null });
    await postLeaveUsage("r1", t.tx);
    expect(t.balance()).toBe(-480);
  });
});
