// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const updateEmployee = vi.fn(async (_input: unknown) => ({ success: true }));
vi.mock("@/actions/admin.actions", () => ({
  updateEmployee: (input: unknown) => updateEmployee(input),
  updateAdditionalSupervisors: vi.fn(),
  updateHrSiteAccess: vi.fn(),
}));
vi.mock("@/actions/password.actions", () => ({ setTemporaryPassword: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./pay-rates-table", () => ({ PayRatesTable: () => null }));
vi.mock("@/components/presence/face", () => ({ PhotoViewer: () => null, ZoomableFace: () => null }));
vi.mock("@/components/presence/photo-editor", () => ({ PhotoEditor: () => null }));
vi.mock("@/components/presence/remove-photo-dialog", () => ({ RemovePhotoDialog: () => null }));
vi.mock("./person-data-window", () => ({ PersonDataWindow: () => null }));
vi.mock("./anonymise-window", () => ({ AnonymiseWindow: () => null }));

import { EditEmployeeForm } from "./edit-employee-form";

const site = { id: "s1", name: "6002 California", timezone: "America/Los_Angeles" };
const employee = {
  id: "e1",
  tenantId: "t1",
  employeeCode: "123456",
  wmsId: "123456",
  barcode: "B123456",
  role: "EMPLOYEE",
  customRoleId: "emp",
  siteId: "s1",
  site,
  departmentId: "d1",
  department: { id: "d1", name: "Shipping" },
  ruleSetId: "r1",
  ruleSet: { id: "r1", name: "CA Hourly" },
  shiftId: "sh1",
  holidayRuleId: null,
  payCategoryId: null,
  payTypeId: null,
  payType: "HOURLY",
  supervisorId: "boss",
  supervisor: { user: { name: "Boss" }, isActive: true },
  jobTitleId: null,
  agencyId: null,
  isActive: true,
  onLeave: false,
  hireDate: new Date("2026-10-01T00:00:00Z"),
  user: { name: "Guest Person", email: "guest@example.com", workEmail: null },
};

const props = {
  employee: employee as never,
  photo: null,
  canEditPhoto: false,
  sites: [site] as never[],
  departments: [
    { id: "d1", name: "Shipping", sites: [{ site }] },
    { id: "dv", name: "Visitors", sites: [{ site }] },
  ] as never[],
  ruleSets: [
    { id: "r1", name: "CA Hourly" },
    { id: "ru", name: "UNASSIGNED" },
  ] as never[],
  employees: [{ id: "boss", user: { name: "Boss" } }],
  customRoles: [
    { id: "emp", name: "Employee", isSystem: true, rank: 1 },
    { id: "visitor", name: "Visitor", isSystem: false, rank: 0, visitor: true },
  ],
  nextVisitorBadge: "CL00002",
  visitorDepartment: { id: "dv", name: "Visitors" },
  shifts: [{ id: "sh1", name: "Days", startTime: "08:00", endTime: "16:30" }],
  holidayRules: [],
  payCategories: [],
  payTypes: [],
  jobTitles: [],
  agencies: [],
  logs: [],
  hrSiteAccess: [],
  actorRole: "HR_ADMIN",
  payRates: [],
};

const control = (id: string) => document.getElementById(`f-${id}`) as HTMLInputElement | HTMLSelectElement;

describe("Employee record", () => {
  afterEach(cleanup);

  it("made a visitor: fills in Visitors, UNASSIGNED and a visitor badge, and switches off the rest", async () => {
    render(<EditEmployeeForm {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(control("customRoleId"), { target: { value: "visitor" } });

    expect(control("departmentId").value).toBe("dv");
    expect(control("ruleSetId").value).toBe("ru");
    expect(control("wmsId").value).toBe("CL");
    expect(screen.getByText(/The next visitor badge, CL00002, is given at the save/)).toBeTruthy();
    for (const id of ["email", "workEmail", "departmentId", "supervisorId", "ruleSetId", "shiftId", "wmsId", "barcode"]) {
      expect(control(id).disabled, id).toBe(true);
    }
    expect(control("email").value).toBe("");
    expect(control("supervisorId").value).toBe("");
    // Still theirs to change.
    expect(control("siteId").disabled).toBe(false);
    expect(control("name").disabled).toBe(false);

    fireEvent.submit(control("name").form!);
    await vi.waitFor(() => expect(updateEmployee).toHaveBeenCalled());
    expect(updateEmployee.mock.calls[0][0]).toMatchObject({
      customRoleId: "visitor",
      departmentId: "dv",
      ruleSetId: "ru",
      wmsId: "CL",
      email: "",
      supervisorId: null,
      shiftId: null,
    });
  });

  it("moved off Visitor again before saving: puts back what was saved", () => {
    render(<EditEmployeeForm {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(control("customRoleId"), { target: { value: "visitor" } });
    fireEvent.change(control("customRoleId"), { target: { value: "emp" } });

    expect(control("departmentId").value).toBe("d1");
    expect(control("ruleSetId").value).toBe("r1");
    expect(control("wmsId").value).toBe("123456");
    expect(control("email").value).toBe("guest@example.com");
    expect(control("departmentId").disabled).toBe(false);
  });

  it("Set temporary password opens its window, and Escape closes it without saving", async () => {
    const { setTemporaryPassword } = await import("@/actions/password.actions");
    render(<EditEmployeeForm {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Set temporary password" }));
    expect(screen.getByRole("dialog", { name: "Set temporary password" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Set temporary password" })).toBeNull();
    expect(setTemporaryPassword).not.toHaveBeenCalled();
  });
});
