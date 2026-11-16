import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  punchType: string;
  punchTime: Date;
  note: string | null;
  source: string;
  isApproved: boolean;
  isRejected: boolean;
  employee: { userId: string | null; timeZone?: string | null; site?: { timezone: string | null } | null; user: { name: string | null } | null; supervisor: { userId: string | null; isActive: boolean } | null };
};
let row: Row | null = null;
const sent: { to: string[]; title: string; body: string; href?: string }[] = [];
const mailed: { to: string[]; subject: string; details?: [string, string][] }[] = [];

vi.mock("@/lib/db", () => ({ db: { punch: { findUnique: async () => row } } }));
vi.mock("./send", () => ({
  pushToUsers: async (to: string[], m: { title: string; body: string; href?: string }) => {
    sent.push({ to, ...m });
  },
}));

vi.mock("@/lib/notify/approval-email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notify/approval-email")>()),
  emailUsers: async (to: string[], m: { subject: string; details?: [string, string][] }) => {
    mailed.push({ to, subject: m.subject, details: m.details });
  },
}));

import { alertMissedPunchDecided, alertMissedPunchRequested } from "./punch-alerts";

const reported = (over: Partial<Row> = {}): Row => ({
  punchType: "CLOCK_OUT",
  // 5:02 PM Eastern on Fri, Nov 13 2026.
  punchTime: new Date("2026-11-13T22:02:00Z"),
  note: "Forgot at the end of my shift",
  source: "MANUAL",
  isApproved: false,
  isRejected: false,
  employee: { userId: "u-maria", site: { timezone: "America/New_York" }, user: { name: "Maria Lopez" }, supervisor: { userId: "u-sup", isActive: true } },
  ...over,
});

describe("missed punch phone alerts", () => {
  beforeEach(() => {
    row = null;
    sent.length = 0;
    mailed.length = 0;
  });

  it("tells the supervisor when a missed punch is reported", async () => {
    row = reported();
    await alertMissedPunchRequested("p1");
    expect(sent).toEqual([
      { to: ["u-sup"], title: "Missed punch request", body: "Maria reported a missed clock out. Tap to review it.", href: "/supervisor/exceptions" },
    ]);
    // The email carries what the lock screen leaves out, on the employee's clock.
    expect(mailed).toEqual([
      {
        to: ["u-sup"],
        subject: "Missed punch request from Maria Lopez",
        details: [
          ["Employee", "Maria Lopez"],
          ["Punch", "Clock Out"],
          ["Time", "Fri, Nov 13, 5:02 PM"],
          ["Note", "Forgot at the end of my shift"],
        ],
      },
    ]);
  });

  it("sends nothing when there is no active supervisor, or the request was already handled", async () => {
    row = reported({ employee: { userId: "u-maria", user: { name: "Maria" }, supervisor: { userId: "u-sup", isActive: false } } });
    await alertMissedPunchRequested("p1");
    row = reported({ employee: { userId: "u-maria", user: { name: "Maria" }, supervisor: null } });
    await alertMissedPunchRequested("p1");
    row = reported({ isApproved: true });
    await alertMissedPunchRequested("p1");
    row = null;
    await alertMissedPunchRequested("p1");
    expect(sent).toEqual([]);
    expect(mailed).toEqual([]);
  });

  it("tells the employee the decision", async () => {
    row = reported({ isApproved: true, punchType: "CLOCK_IN" });
    await alertMissedPunchDecided("p1");
    row = reported({ isRejected: true });
    await alertMissedPunchDecided("p1");
    expect(sent.map((s) => [s.to, s.title, s.body])).toEqual([
      [["u-maria"], "Missed punch approved", "Your missed clock in was approved and added to your timecard."],
      [["u-maria"], "Missed punch not approved", "Your missed clock out request was not approved. Talk to your supervisor about it."],
    ]);
    expect(mailed.map((m) => [m.to, m.subject])).toEqual([
      [["u-maria"], "Your missed clock in was approved"],
      [["u-maria"], "Your missed clock out request was not approved"],
    ]);
  });

  it("says nothing to the employee while the request is still waiting", async () => {
    row = reported();
    await alertMissedPunchDecided("p1");
    expect(sent).toEqual([]);
  });
});
