import { beforeEach, describe, expect, it, vi } from "vitest";

let asked: { startDate?: Date } = {};
let requests: unknown[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    leaveRequest: {
      findMany: async ({ where }: { where: { startDate?: Date } }) => {
        asked = where;
        return requests;
      },
    },
  },
}));
vi.mock("./approvers", () => ({
  hrApprovers: async () => [
    { employeeId: "e-hr", userId: "u-hr" },
    { employeeId: "e-maria", userId: "u-maria" },
  ],
}));
const pushed: string[][] = [];
const mailed: string[][] = [];
vi.mock("@/lib/push/send", () => ({ pushToUsers: async (ids: string[]) => void pushed.push(ids) }));
vi.mock("./approval-email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./approval-email")>()),
  emailUsers: async (ids: string[]) => void mailed.push(ids),
}));

import { remindTimeOffStartingSoon } from "./approval-reminders";

const request = (status: string, supervisor: { userId: string; isActive: boolean } | null = { userId: "u-sup", isActive: true }) => ({
  status,
  startDate: new Date("2026-11-18T00:00:00Z"),
  endDate: new Date("2026-11-19T00:00:00Z"),
  durationSeconds: 16 * 3600,
  leaveType: { name: "Vacation" },
  employee: { id: "e-maria", tenantId: "t1", user: { name: "Maria Lopez" }, supervisor },
});

describe("time off about to start", () => {
  beforeEach(() => {
    requests = [];
    pushed.length = 0;
    mailed.length = 0;
  });

  it("looks for requests starting two days from today in Eastern time", async () => {
    // 11:30 PM Eastern on Sunday Nov 15 is already Monday in UTC.
    await remindTimeOffStartingSoon(new Date("2026-11-16T04:30:00Z"), { send: false });
    expect(asked.startDate?.toISOString()).toBe("2026-11-17T00:00:00.000Z");
  });

  it("reminds the supervisor while pending, and HR (never the requester) once with HR", async () => {
    requests = [request("PENDING"), request("PENDING_HR")];
    const plan = await remindTimeOffStartingSoon(new Date("2026-11-16T13:00:00Z"), { send: true });
    expect(plan.map((p) => p.userIds)).toEqual([["u-sup"], ["u-hr"]]);
    expect(plan[0].email.line).toBe("Maria Lopez's time off starts in 2 days and is still waiting for your approval.");
    expect(plan[1].push?.body).toBe("Maria's time off starts in 2 days and still needs HR approval.");
    expect(pushed).toEqual([["u-sup"], ["u-hr"]]);
    expect(mailed).toEqual([["u-sup"], ["u-hr"]]);
  });

  it("skips a pending request with no active supervisor, and sends nothing on a dry run", async () => {
    requests = [request("PENDING", null), request("PENDING", { userId: "u-sup", isActive: false }), request("PENDING")];
    const plan = await remindTimeOffStartingSoon(new Date("2026-11-16T13:00:00Z"), { send: false });
    expect(plan).toHaveLength(1);
    expect(pushed).toEqual([]);
    expect(mailed).toEqual([]);
  });
});
