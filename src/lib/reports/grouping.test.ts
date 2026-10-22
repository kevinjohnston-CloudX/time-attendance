import { describe, expect, it } from "vitest";
import { describePrint, groupRows, type ReportLine } from "./grouping";

const columns = [
  { id: "employeeName", label: "Employee", type: "string" },
  { id: "site", label: "Site", type: "string" },
  { id: "department", label: "Department", type: "string" },
  { id: "regMinutes", label: "Regular", type: "number" },
  { id: "payRate", label: "Pay rate", type: "number" },
  { id: "daysWorkedInRange", label: "Days worked", type: "number", total: true },
];

const rows = [
  { employeeName: "Ana", site: "5903 Nj", department: "Packing", regMinutes: 480, payRate: 18, daysWorkedInRange: 1 },
  { employeeName: "Ben", site: "0299 Rutherford", department: "Returns", regMinutes: 600, payRate: 20, daysWorkedInRange: 2 },
  { employeeName: "Cid", site: "5903 Nj", department: "Vas", regMinutes: 120, payRate: 19, daysWorkedInRange: 1 },
  { employeeName: "Dee", site: "5903 Nj", department: "Packing", regMinutes: 60, payRate: 17, daysWorkedInRange: 3 },
  { employeeName: "Eve", site: null, department: "Packing", regMinutes: 30, payRate: 16, daysWorkedInRange: 0 },
];

const kinds = (lines: ReportLine[]) =>
  lines.map((l) =>
    l.kind === "row"
      ? `row:${l.index}`
      : l.kind === "group"
        ? `${l.newPage ? "page:" : ""}group${l.level}:${l.label}`
        : l.kind === "subtotal"
          ? `sub${l.level}:${l.label}`
          : l.kind === "signature"
            ? "sign"
            : "total"
  );

describe("groupRows", () => {
  it("groups by one field, blanks last, with a total under each group and a grand total", () => {
    const out = groupRows(rows, columns, ["site"], { complete: true })!;
    expect(out.rows.map((r) => r.employeeName)).toEqual(["Ben", "Ana", "Cid", "Dee", "Eve"]);
    expect(kinds(out.groups.lines)).toEqual([
      "group0:0299 Rutherford", "row:0", "sub0:0299 Rutherford",
      "group0:5903 Nj", "row:1", "row:2", "row:3", "sub0:5903 Nj",
      "group0:No site", "row:4", "sub0:No site",
      "total",
    ]);
    const nj = out.groups.lines.find((l) => l.kind === "subtotal" && l.label === "5903 Nj");
    expect(nj).toMatchObject({ values: { regMinutes: 660, daysWorkedInRange: 5 } });
    expect(out.groups.lines.at(-1)).toEqual({ kind: "total", values: { regMinutes: 1290, daysWorkedInRange: 7 } });
  });

  it("adds hours as they are shown, so the total matches the column above it", () => {
    // 66.77 and 65.87 on screen (4006.4 and 3952.4 minutes): exact minutes
    // would total 132.65, the column as shown adds to 132.64.
    const r = [
      { employeeName: "A", regMinutes: 4006.4 },
      { employeeName: "B", regMinutes: 3952.4 },
    ];
    const out = groupRows(r, columns, [], { complete: true })!;
    const total = out.groups.lines.at(-1) as { values: Record<string, number> };
    expect(total.values.regMinutes / 60).toBeCloseTo(132.64, 10);
  });

  it("never adds up a rate", () => {
    const out = groupRows(rows, columns, [], { complete: true })!;
    expect(out.groups.totalColumns).toEqual(["regMinutes", "daysWorkedInRange"]);
  });

  it("nests groups and closes the inner one before the outer one", () => {
    const out = groupRows(rows.slice(0, 4), columns, ["site", "department"], { complete: true })!;
    expect(kinds(out.groups.lines)).toEqual([
      "group0:0299 Rutherford", "group1:Returns", "row:0", "sub1:Returns", "sub0:0299 Rutherford",
      "group0:5903 Nj", "group1:Packing", "row:1", "row:2", "sub1:Packing", "group1:Vas", "row:3", "sub1:Vas", "sub0:5903 Nj",
      "total",
    ]);
  });

  it("keeps the report's own order inside a group", () => {
    const out = groupRows(rows, columns, ["department"], { complete: true })!;
    expect(out.rows.filter((r) => r.department === "Packing").map((r) => r.employeeName)).toEqual(["Ana", "Dee", "Eve"]);
  });

  it("draws no totals when the report was cut at its row limit", () => {
    const out = groupRows(rows, columns, ["site"], { complete: false })!;
    expect(out.groups.totalsShown).toBe(false);
    expect(out.groups.lines.some((l) => l.kind === "subtotal" || l.kind === "total")).toBe(false);
    expect(out.groups.lines.filter((l) => l.kind === "group")).toHaveLength(3);
  });

  it("leaves a cut report with no groups untouched", () => {
    expect(groupRows(rows, columns, [], { complete: false })).toBeNull();
  });

  it("leaves a report with nothing to add up and no groups untouched", () => {
    expect(groupRows(rows, columns.slice(0, 3), [], { complete: true })).toBeNull();
  });

  it("keeps two people with one name apart, by their badge", () => {
    const r = [
      { employeeName: "Juan Rosas", employeeCode: "104139", regMinutes: 60 },
      { employeeName: "Juan Rosas", employeeCode: "106382", regMinutes: 120 },
    ];
    const out = groupRows(r, columns, ["employeeName"], { complete: true })!;
    expect(out.groups.lines.filter((l) => l.kind === "group").map((l) => (l as { label: string }).label)).toEqual([
      "Juan Rosas (104139)",
      "Juan Rosas (106382)",
    ]);
  });

  it("orders weeks by their first day, not by their name", () => {
    const r = [
      { employeeName: "A", week: "Week of Oct 4, 2026", weekStart: "2026-10-04", regMinutes: 1 },
      { employeeName: "A", week: "Week of Sep 27, 2026", weekStart: "2026-09-27", regMinutes: 1 },
    ];
    const out = groupRows(r, [...columns, { id: "week", label: "Week", type: "string" }], ["week"], {
      complete: true,
      groupOrder: { week: "weekStart" },
    })!;
    expect(out.rows.map((x) => x.week)).toEqual(["Week of Sep 27, 2026", "Week of Oct 4, 2026"]);
  });

  it("starts a page for each group and signs each one under its total", () => {
    const signature = { text: "I certify.", employee: true, supervisor: true };
    const out = groupRows(rows.slice(0, 4), columns, ["site", "department"], {
      complete: true,
      layout: { pageBreak: "department", signature },
    })!;
    expect(kinds(out.groups.lines)).toEqual([
      "group0:0299 Rutherford", "group1:Returns", "row:0", "sub1:Returns", "sign", "sub0:0299 Rutherford",
      "page:group0:5903 Nj", "group1:Packing", "row:1", "row:2", "sub1:Packing", "sign",
      "page:group1:Vas", "row:3", "sub1:Vas", "sign", "sub0:5903 Nj",
      "total",
    ]);
  });

  it("signs once at the end with no new pages, even with nothing to group or total", () => {
    const signature = { text: "", employee: false, supervisor: true };
    const out = groupRows(rows.slice(0, 2), columns.slice(0, 3), [], { complete: true, layout: { signature } })!;
    expect(kinds(out.groups.lines)).toEqual(["row:0", "row:1", "sign"]);
  });

  it("ignores a new page for a field the rows are not grouped by", () => {
    const out = groupRows(rows.slice(0, 4), columns, ["site"], { complete: true, layout: { pageBreak: "department" } })!;
    expect(out.groups.lines.some((l) => l.kind === "group" && l.newPage)).toBe(false);
  });

  it("says how it prints in a sentence", () => {
    const label = (id: string) => ({ employeeName: "Employee" })[id] ?? id;
    expect(describePrint({ pageBreak: "employeeName", signature: { text: "x", employee: true, supervisor: true } }, label)).toBe(
      "A page for each employee, with signature lines for the employee and supervisor to sign."
    );
    expect(describePrint({ signature: { text: "x", employee: false, supervisor: true } }, label)).toBe(
      "Signature lines for the supervisor to sign."
    );
    expect(describePrint(undefined, label)).toBeNull();
  });
});
