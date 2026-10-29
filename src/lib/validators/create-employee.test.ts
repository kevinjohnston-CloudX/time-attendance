import { describe, expect, it } from "vitest";
import { createEmployeeSchema } from "./admin.schema";

const base = {
  name: "New Hire",
  workEmail: "new.hire@example.com",
  siteId: "site",
  departmentId: "dept",
  ruleSetId: "rules",
  hireDate: "2026-10-29",
  wmsId: "123456",
  shiftId: "shift",
  payCategoryId: "category",
  holidayRuleId: "holiday",
};

const problems = (input: object) => {
  const r = createEmployeeSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("createEmployeeSchema", () => {
  it("takes a new hire with a shift, a pay category and a holiday rule", () => {
    expect(problems(base)).toEqual([]);
  });

  it("refuses a new hire without them, saying what to choose", () => {
    expect(problems({ ...base, shiftId: "", payCategoryId: "", holidayRuleId: "" })).toEqual([
      "Choose a shift",
      "Choose a pay category",
      "Choose a holiday rule",
    ]);
    expect(problems({ ...base, shiftId: null })).toEqual(["Choose a shift"]);
  });

  it("does not ask a client badge for them", () => {
    expect(problems({ ...base, wmsId: "CL", shiftId: "", payCategoryId: "", holidayRuleId: "" })).toEqual([]);
    expect(problems({ ...base, wmsId: "CL00003", shiftId: "", payCategoryId: "", holidayRuleId: "" })).toEqual([]);
  });
});
