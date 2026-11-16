import { describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { timecardEditRequest: { findMany } } }));

import { assertNoPendingEdits } from "./pending-edits";

const waiting = (name: string) => ({ timesheet: { employee: { user: { name }, employeeCode: "1" } } });

// 11/11: a period locked over supervisors' changes waiting for HR would leave
// them never applied, so the lock waits until HR has decided them.
describe("locking while supervisors' changes wait for HR", () => {
  it("lets the lock go ahead when nothing waits", async () => {
    findMany.mockResolvedValueOnce([]);
    await expect(assertNoPendingEdits({ payPeriodId: "p1" })).resolves.toBeUndefined();
  });

  it("refuses it, naming whose changes wait", async () => {
    findMany.mockResolvedValueOnce([waiting("Heliana Salazar"), waiting("Olga Thompson")]);
    await expect(assertNoPendingEdits({ payPeriodId: "p1", except: ["ts9"] })).rejects.toThrow(
      "2 supervisors' changes wait for HR approval (Heliana Salazar, Olga Thompson). Approve or reject them first, then lock.",
    );
    const where = findMany.mock.calls.at(-1)![0].where;
    expect(where.timesheet).toEqual({ payPeriodId: "p1", NOT: { id: { in: ["ts9"] } } });
  });
});
