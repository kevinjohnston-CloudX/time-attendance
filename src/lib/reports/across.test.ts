import { describe, expect, it } from "vitest";
import { spreadAcross } from "./across";

const def = [
  { id: "employeeName", label: "Employee", type: "string" },
  { id: "week", label: "Week", type: "string" },
  { id: "weekday", label: "Day of the week", type: "string", groupOrder: "weekdayOrder" },
  { id: "payCodeLabel", label: "Pay code", type: "string" },
  { id: "date", label: "Date", type: "date" },
  { id: "totalMinutes", label: "Total", type: "number" },
  { id: "regMinutes", label: "Regular", type: "number" },
  { id: "payRate", label: "Pay rate", type: "number" },
];
const cols = (ids: string[]) => ids.map((id) => def.find((c) => c.id === id)!);

describe("spreadAcross", () => {
  it("puts each day of the week in a column, in the company's order, with a total", () => {
    const rows = [
      { employeeName: "Ana", employeeCode: "1", week: "W1", weekday: "Mon", weekdayOrder: 1, totalMinutes: 480, regMinutes: 480 },
      { employeeName: "Ana", employeeCode: "1", week: "W1", weekday: "Sun", weekdayOrder: 0, totalMinutes: 60, regMinutes: 60 },
      { employeeName: "Ana", employeeCode: "1", week: "W1", weekday: "Mon", weekdayOrder: 1, totalMinutes: 30, regMinutes: 0 },
      { employeeName: "Ben", employeeCode: "2", week: "W1", weekday: "Mon", weekdayOrder: 1, totalMinutes: 120, regMinutes: 120 },
    ];
    const out = spreadAcross({ columns: cols(["employeeName", "week", "totalMinutes", "regMinutes"]), rows }, def, { field: "weekday", value: "totalMinutes" })!;
    expect(out.columns.map((c) => c.label)).toEqual(["Employee", "Week", "Sun", "Mon", "Total", "Regular"]);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({ a0_totalMinutes: 60, a1_totalMinutes: 510, total_totalMinutes: 570, regMinutes: 540 });
    expect(out.rows[1]).toMatchObject({ a0_totalMinutes: 0, a1_totalMinutes: 120, total_totalMinutes: 120 });
  });

  it("keeps two people with one name apart, and leaves out lines with nothing to add", () => {
    const rows = [
      { employeeName: "Juan", employeeCode: "1", payCodeLabel: "REG", totalMinutes: 60 },
      { employeeName: "Juan", employeeCode: "2", payCodeLabel: "REG", totalMinutes: 60 },
      { employeeName: "Juan", employeeCode: "2", payCodeLabel: null, totalMinutes: null },
    ];
    const out = spreadAcross({ columns: cols(["employeeName", "totalMinutes"]), rows }, def, { field: "payCodeLabel", value: "totalMinutes" })!;
    expect(out.rows).toHaveLength(2);
    expect(out.columns.map((c) => c.label)).toEqual(["Employee", "REG", "Total"]);
  });

  it("names dates as days, in date order, and a blank as none", () => {
    const rows = [
      { employeeName: "A", date: "2026-10-10", totalMinutes: 1 },
      { employeeName: "A", date: "2026-09-30", totalMinutes: 1 },
      { employeeName: "A", payCodeLabel: "", date: "", totalMinutes: 1 },
    ];
    const out = spreadAcross({ columns: cols(["employeeName", "totalMinutes"]), rows }, def, { field: "date", value: "totalMinutes" })!;
    expect(out.columns.map((c) => c.label)).toEqual([
      "Employee", "Sep 30", "Oct 1", "Oct 2", "Oct 3", "Oct 4", "Oct 5", "Oct 6", "Oct 7", "Oct 8", "Oct 9", "Oct 10", "No date", "Total",
    ]);
  });

  it("does nothing for a field or value the report does not have", () => {
    expect(spreadAcross({ columns: [], rows: [] }, def, { field: "nope", value: "totalMinutes" })).toBeNull();
    expect(spreadAcross({ columns: [], rows: [] }, def, { field: "date", value: "employeeName" })).toBeNull();
  });
});
