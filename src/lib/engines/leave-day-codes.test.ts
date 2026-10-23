import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { dropSupersededDayCodes } from "./leave-segment-builder";

type Line = { id: string; segmentDate: Date; durationMinutes: number; leaveRequestId: string | null; payCodeId: string | null; payBucketOverride: string | null };
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const code = (id: string, d: string, payCodeId: string | null, payBucketOverride: string | null = null): Line =>
  ({ id, segmentDate: day(d), durationMinutes: 0, leaveRequestId: null, payCodeId, payBucketOverride });
const leave = (d: string, payCodeId: string, minutes = 480): Line =>
  ({ id: `leave-${d}`, segmentDate: day(d), durationMinutes: minutes, leaveRequestId: "lr", payCodeId, payBucketOverride: null });

/** Just enough of a transaction for the two reads and the delete. */
function fakeTx(lines: Line[]) {
  const deleted: string[] = [];
  const tx = {
    workSegment: {
      findMany: async ({ where }: { where: { durationMinutes: number | { gt: number } } }) =>
        lines.filter((l) =>
          typeof where.durationMinutes === "number"
            ? l.durationMinutes === 0 && !l.leaveRequestId && !l.payBucketOverride && l.payCodeId
            : l.durationMinutes > 0 && l.leaveRequestId && l.payCodeId,
        ),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        deleted.push(...where.id.in);
        return { count: where.id.in.length };
      },
    },
  };
  return { tx: tx as never, deleted };
}

describe("a day's code once the day has leave with hours", () => {
  it("goes when the leave has the same code (Erika Vera de Romero, 10/15 Unpaid time off)", async () => {
    const { tx, deleted } = fakeTx([code("c15", "2026-10-15", "unpaid"), leave("2026-10-15", "unpaid")]);
    await dropSupersededDayCodes("t", tx);
    expect(deleted).toEqual(["c15"]);
  });

  it("stays when the leave has another code (4 hours PTO, the rest marked unpaid)", async () => {
    const { tx, deleted } = fakeTx([code("c15", "2026-10-15", "unpaid"), leave("2026-10-15", "pto", 240)]);
    await dropSupersededDayCodes("t", tx);
    expect(deleted).toEqual([]);
  });

  it("stays on a day with no leave: a 0 hour Unpaid time off day", async () => {
    const { tx, deleted } = fakeTx([code("c15", "2026-10-15", "unpaid"), leave("2026-10-16", "unpaid")]);
    await dropSupersededDayCodes("t", tx);
    expect(deleted).toEqual([]);
  });

  it("stays when it holds a pay bucket choice", async () => {
    const { tx, deleted } = fakeTx([code("c15", "2026-10-15", "unpaid", "UNPAID"), leave("2026-10-15", "unpaid")]);
    await dropSupersededDayCodes("t", tx);
    expect(deleted).toEqual([]);
  });
});
