import { describe, expect, it } from "vitest";
import { splitNote, useFirstPieces } from "./leave-use-first";

const H = 3600;

/** A transaction holding one person on PTO120 (PTO Carry Over, then PTO) and their balances. */
function fakeTx(o: { payCategoryId?: string | null; useFirst?: string[] | null; balances?: Record<string, number> }) {
  return {
    employee: { findUniqueOrThrow: async () => ({ payCategoryId: o.payCategoryId === undefined ? "pto-120" : o.payCategoryId }) },
    payCategoryPtoPolicy: {
      findFirst: async () => (o.useFirst ? { ptoPolicy: { name: "PTO120", useFirstLeaveTypeIds: o.useFirst } } : null),
    },
    leaveBalance: {
      findMany: async ({ where }: { where: { leaveTypeId: { in: string[] } } }) =>
        Object.entries(o.balances ?? {})
          .filter(([t]) => where.leaveTypeId.in.includes(t))
          .map(([leaveTypeId, balanceSeconds]) => ({ leaveTypeId, balanceSeconds })),
    },
  } as never;
}
const day = new Date("2026-10-29T00:00:00.000Z");

describe("leave taken from other balances first", () => {
  it("takes the 1.5 hours left in carry over, then 3.5 from PTO", async () => {
    const { pieces, policyName } = await useFirstPieces(fakeTx({ useFirst: ["ptoc"], balances: { ptoc: 1.5 * H } }), "e1", "pto", day, 5 * H);
    expect(pieces).toEqual([{ leaveTypeId: "ptoc", seconds: 1.5 * H }, { leaveTypeId: "pto", seconds: 3.5 * H }]);
    expect(policyName).toBe("PTO120");
  });

  it("takes it all from carry over when there is enough", async () => {
    const { pieces } = await useFirstPieces(fakeTx({ useFirst: ["ptoc"], balances: { ptoc: 10 * H } }), "e1", "pto", day, 5 * H);
    expect(pieces).toEqual([{ leaveTypeId: "ptoc", seconds: 5 * H }]);
  });

  it("takes it all from PTO when carry over is empty or below 0", async () => {
    for (const ptoc of [0, -2 * H]) {
      const { pieces } = await useFirstPieces(fakeTx({ useFirst: ["ptoc"], balances: { ptoc } }), "e1", "pto", day, 5 * H);
      expect(pieces).toEqual([{ leaveTypeId: "pto", seconds: 5 * H }]);
    }
  });

  it("takes whole hundredths of an hour from a balance kept to the second", async () => {
    // 1.987 h left: 1.98 from carry over, the rest of 8 from PTO (6.02).
    const { pieces } = await useFirstPieces(fakeTx({ useFirst: ["ptoc"], balances: { ptoc: 7153 } }), "e1", "pto", day, 8 * H);
    expect(pieces).toEqual([{ leaveTypeId: "ptoc", seconds: 7128 }, { leaveTypeId: "pto", seconds: 8 * H - 7128 }]);
  });

  it("goes down the list in order", async () => {
    const { pieces } = await useFirstPieces(fakeTx({ useFirst: ["ptoc", "comp"], balances: { ptoc: 1 * H, comp: 2 * H } }), "e1", "pto", day, 5 * H);
    expect(pieces).toEqual([
      { leaveTypeId: "ptoc", seconds: 1 * H },
      { leaveTypeId: "comp", seconds: 2 * H },
      { leaveTypeId: "pto", seconds: 2 * H },
    ]);
  });

  it("keeps the leave whole with no such policy, or no pay category", async () => {
    for (const tx of [fakeTx({ useFirst: null }), fakeTx({ payCategoryId: null, useFirst: ["ptoc"] })]) {
      const { pieces, policyName } = await useFirstPieces(tx, "e1", "pto", day, 5 * H);
      expect(pieces).toEqual([{ leaveTypeId: "pto", seconds: 5 * H }]);
      expect(policyName).toBeNull();
    }
  });

  it("says on the line why it was split, after any note HR wrote", () => {
    const pieces = [{ leaveTypeId: "ptoc", seconds: 1.5 * H }, { leaveTypeId: "pto", seconds: 3.5 * H }];
    const names = new Map([["ptoc", "PTO Carry Over"], ["pto", "PTO"]]);
    expect(splitNote(null, pieces, names, "PTO120")).toBe("5.00 h split by PTO120: 1.50 PTO Carry Over + 3.50 PTO");
    expect(splitNote("Dr appt", pieces, names, "PTO120")).toBe("Dr appt (5.00 h split by PTO120: 1.50 PTO Carry Over + 3.50 PTO)");
    expect(splitNote("Dr appt", [pieces[1]], names, "PTO120")).toBe("Dr appt");
  });
});
