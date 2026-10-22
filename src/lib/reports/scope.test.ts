import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { textFilter } from "./scope";

const rows = [
  { siteId: "s1", problem: "Badge not found", employeeName: "Ana Lopez" },
  { siteId: "s2", problem: "Not recorded", employeeName: "Ben Ortiz" },
  { siteId: null, problem: "Badge not found", employeeName: null },
];

describe("textFilter", () => {
  it("holds rows to the sites a report is limited to, leaving out a row with no site", () => {
    const out = textFilter(rows, [{ field: "siteId", operator: "in", value: ["s1"] }], ["siteId"]);
    expect(out).toEqual([rows[0]]);
  });

  it("matches is, is any of, is not and contains, ignoring case", () => {
    expect(textFilter(rows, [{ field: "problem", operator: "eq", value: "badge not found" }], ["problem"])).toHaveLength(2);
    expect(textFilter(rows, [{ field: "problem", operator: "neq", value: "Badge not found" }], ["problem"])).toEqual([rows[1]]);
    expect(textFilter(rows, [{ field: "employeeName", operator: "contains", value: "ORT" }], ["employeeName"])).toEqual([rows[1]]);
  });

  it("leaves filters on other fields to someone else", () => {
    expect(textFilter(rows, [{ field: "departmentId", operator: "eq", value: "d1" }], ["siteId"])).toHaveLength(3);
  });
});
