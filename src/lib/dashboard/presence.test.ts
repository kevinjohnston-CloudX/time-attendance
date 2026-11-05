import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { sql: string; values: unknown[] }[] = [];
let rows: { employeeId: string; state: string }[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sent.push({ sql: strings.join("?"), values });
      return rows;
    },
    employee: {
      findMany: async () => [
        { id: "night", onLeave: false, department: { name: "Packing" } },
        { id: "meal", onLeave: false, department: { name: "Packing" } },
        { id: "gone", onLeave: false, department: { name: "Picking" } },
        { id: "leave", onLeave: true, department: { name: "Picking" } },
      ],
    },
  },
}));

import { PRESENCE_WINDOW_MS, getPresence } from "./dashboard-data";

const now = new Date("2026-11-05T15:00:00.000Z");

beforeEach(() => {
  sent.length = 0;
  rows = [];
});

describe("Team Presence on the Dashboard", () => {
  it("reads only the last 36 hours of punches, not every punch ever", async () => {
    await getPresence("t", null);
    await getPresence("t", "sup", now);
    for (const q of sent) expect(q.sql).toContain(`p."roundedTime" >= ?`);
    expect(sent[1].values).toContainEqual(new Date(now.getTime() - PRESENCE_WINDOW_MS));
    expect(PRESENCE_WINDOW_MS).toBe(36 * 3_600_000);
  });

  it("counts a night shift clocked in yesterday evening, and someone with no recent punch as not in", async () => {
    // "gone" has no punch in the window, so the query returns nothing for them.
    rows = [
      { employeeId: "night", state: "WORK" },
      { employeeId: "meal", state: "MEAL" },
    ];
    const p = await getPresence("t", null, now);
    expect(p).toMatchObject({ onClock: 1, onMeal: 1, onLeave: 1, notIn: 1 });
    expect(p.byDept.find((d) => d.dept === "Packing")).toMatchObject({ inCount: 1, mealCount: 1, total: 2 });
  });
});
