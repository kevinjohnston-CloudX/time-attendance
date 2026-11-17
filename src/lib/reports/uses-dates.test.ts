import { describe, expect, it } from "vitest";
import { reportUsesDates } from "./uses-dates";

describe("reportUsesDates", () => {
  it("every report about days uses its dates", () => {
    expect(reportUsesDates("HOURS_SUMMARY", { columns: ["employeeName"] })).toBe(true);
  });

  it("a list of people with emails does not", () => {
    expect(
      reportUsesDates("EMPLOYEES", {
        columns: ["employeeName", "employeeCode", "workEmail", "personalEmail"],
        filters: [{ field: "siteId", operator: "eq", value: "site" }],
      })
    ).toBe(false);
  });

  it("hours or days worked in these dates bring them back", () => {
    expect(reportUsesDates("EMPLOYEES", { columns: ["employeeName", "hoursInRange"] })).toBe(true);
    expect(reportUsesDates("EMPLOYEES", { columns: ["employeeName"], sortBy: [{ field: "daysWorkedInRange", direction: "desc" }] })).toBe(true);
    expect(reportUsesDates("EMPLOYEES", { filters: [{ field: "daysWorkedInRange", operator: "gte", value: 1 }] })).toBe(true);
  });

  it("hired in the report dates uses them; hired between two picked dates does not", () => {
    expect(reportUsesDates("EMPLOYEES", { filters: [{ field: "hireDate", operator: "inRange", value: "" }] })).toBe(true);
    expect(
      reportUsesDates("EMPLOYEES", { filters: [{ field: "hireDate", operator: "between", value: "2026-01-01", value2: "2026-02-01" }] })
    ).toBe(false);
  });
});
