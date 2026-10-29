// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/actions/admin.actions", () => ({ createEmployee: vi.fn(), getSupervisorOptions: vi.fn(async () => ({ success: true, data: [] })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { CreateEmployeeForm } from "./create-employee-form";

const site = { id: "s1", name: "6002 California" };
const props = {
  sites: [site] as never[],
  departments: [{ id: "d1", name: "Shipping", sites: [{ site }] }] as never[],
  ruleSets: [{ id: "r1", name: "CA Hourly" }] as never[],
  employees: [],
  customRoles: [
    { id: "visitor", name: "Visitor", visitor: true },
    { id: "agency", name: "Agency (View Only)", signInOnly: true, seesTeam: true },
  ],
  shifts: [],
  holidayRules: [],
  payCategories: [],
  payTypes: [],
  jobTitles: [],
  agencies: [],
  nextVisitorBadge: "CL00002",
  visitorDepartment: { id: "dv", name: "Visitors" },
};

// A required field's label ends in its red star.
const field = (label: string) =>
  screen.getByLabelText(new RegExp(`^${label.replace(/[()]/g, "\\$&")}\\s*\\*?$`)) as HTMLInputElement | HTMLSelectElement;

describe("New Employee", () => {
  afterEach(cleanup);

  it("starts with the site, department and rule set blank, and the site required", () => {
    render(<CreateEmployeeForm {...props} />);
    fireEvent.click(screen.getByText("Add Employee"));
    expect(field("Site").value).toBe("");
    expect(field("Site").required).toBe(true);
    expect(field("Department").value).toBe("");
    expect((document.querySelector('select[name="ruleSetId"]') as HTMLSelectElement).value).toBe("");
  });

  it("for a visitor, fills in the badge and the Visitors department and greys out what does not apply", () => {
    render(<CreateEmployeeForm {...props} />);
    fireEvent.click(screen.getByText("Add Employee"));
    const role = field("Role") as HTMLSelectElement;
    fireEvent.change(role, { target: { value: "custom:visitor" } });
    fireEvent.change(role.form!, {});

    expect(field("Badge ID (WMS)").value).toBe("CL00002");
    expect(field("Badge ID (WMS)").disabled).toBe(true);
    expect(field("Department").disabled).toBe(true);
    expect((field("Department") as HTMLSelectElement).selectedOptions[0].text).toBe("Visitors");
    expect(field("Hire Date").disabled).toBe(true);
    expect(field("Work Email").disabled).toBe(true);
    expect(field("Personal Email").disabled).toBe(true);
    expect(field("Job Title").disabled).toBe(true);
    expect(field("Agency").disabled).toBe(true);
    // Still chosen, and required.
    expect(field("Site").disabled).toBe(false);
    expect(field("Site").required).toBe(true);
    // What the save sends: the request for a visitor badge, and the Visitors department.
    const form = role.form!;
    expect((form.querySelector('input[name="wmsId"]') as HTMLInputElement).value).toBe("CL");
    expect((form.querySelector('input[name="departmentId"]') as HTMLInputElement).value).toBe("dv");
    // The pay and schedule fields are switched off.
    expect((form.querySelector('select[name="ruleSetId"]') as HTMLSelectElement).closest("fieldset")!.disabled).toBe(true);
  });
});
