import { describe, expect, it } from "vitest";
import { compareText, readOrder, sortRowsInMemory, type FieldMap } from "./query-builder";
import { groupRows } from "./grouping";

const fieldMap: FieldMap = { employeeName: { prismaPath: "employee.user.name", type: "string" } };
const sortBy = (field: string) => [{ field, direction: "asc" as const }];

describe("compareText", () => {
  it("reads numbers by their value and ignores capitals", () => {
    expect(["0299 Rutherford", "136 Scarborough", "7575 Georgia"].sort(compareText)).toEqual(["136 Scarborough", "0299 Rutherford", "7575 Georgia"]);
    expect(["0147256161", "178015", "104125"].sort(compareText)).toEqual(["104125", "178015", "0147256161"]);
    expect(compareText("ana", "Ana")).toBe(0);
  });

  it("is the order groups are laid out in, so a cut and its groups agree", () => {
    const rows = ["0299 Rutherford", "136 Scarborough"].map((site) => ({ site, hours: 1 }));
    const sorted = sortRowsInMemory(rows, sortBy("site"), {});
    const grouped = groupRows(sorted, [{ id: "site", label: "Site", type: "string" }, { id: "hours", label: "Hours", type: "number" }], ["site"], { complete: true });
    const order = grouped!.rows.filter((r) => !("kind" in r)).map((r) => r.site);
    expect(order).toEqual(sorted.map((r) => r.site));
  });
});

describe("readOrder", () => {
  it("lets the database sort and cut when every sort is a column and nothing is grouped", () => {
    const order = readOrder({ sortBy: sortBy("employeeName"), limit: 100 }, fieldMap, { unsorted: [{ startDate: "desc" }] });
    expect(order.take).toBe(100);
    expect(order.orderBy).toEqual([{ employee: { user: { name: "asc" } } }, { id: "asc" }]);
    const rows = [{ employeeName: "B" }, { employeeName: "A" }];
    expect(order.finish(rows)).toEqual({ rows, total: 2 });
  });

  it("ends every order with the id, so ties fall the same way each run", () => {
    const order = readOrder({ sortBy: [], limit: 100 }, fieldMap, { unsorted: [{ startDate: "desc" }] });
    expect(order.orderBy).toEqual([{ startDate: "desc" }, { id: "asc" }]);
  });

  it("reads every line and sorts in the app when a sort is worked out afterwards", () => {
    const order = readOrder({ sortBy: [...sortBy("employeeName"), { field: "hours", direction: "desc" }], limit: 2 }, fieldMap, { unsorted: [{ startDate: "desc" }] });
    expect(order.take).toBeUndefined();
    expect(order.orderBy).toEqual([{ startDate: "desc" }, { id: "asc" }]);
    const rows = [{ employeeName: "B", hours: 1 }, { employeeName: "A", hours: 1 }, { employeeName: "A", hours: 5 }];
    // The name order holds, the hours only break ties within it.
    expect(order.finish(rows)).toEqual({ rows: [{ employeeName: "A", hours: 5 }, { employeeName: "A", hours: 1 }], total: 3 });
  });

  it("reads every line when the report is grouped, so the groups decide which rows a limit keeps", () => {
    const order = readOrder({ sortBy: sortBy("employeeName"), groupBy: ["department"], limit: 100 }, fieldMap, { unsorted: [] });
    expect(order.take).toBeUndefined();
  });

  it("gives a preview that is the first rows of the full report", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ employeeName: `Person ${(i * 7) % 50}`, hours: i % 3 }));
    const cfg = { sortBy: [{ field: "hours", direction: "desc" as const }, ...sortBy("employeeName")] };
    const preview = readOrder({ ...cfg, limit: 10 }, fieldMap, { unsorted: [] }).finish(rows).rows;
    const full = readOrder({ ...cfg, limit: 5000 }, fieldMap, { unsorted: [] }).finish(rows).rows;
    expect(preview).toEqual(full.slice(0, 10));
  });
});
