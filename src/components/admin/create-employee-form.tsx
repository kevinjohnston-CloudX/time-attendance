"use client";

import { useRef, useState, useTransition, type ReactNode, type SelectHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { createEmployee } from "@/actions/admin.actions";
import type { Site, Department, RuleSet } from "@prisma/client";
import { Banner, Button, Input, SegmentedControl, Select } from "@/components/ui";
import { Plus, X } from "lucide-react";

/**
 * "Add Employee" — the design's primary action on the employee list.
 *
 * <p>The design opens the empty doc screen for this; here it stays a modal,
 * because the record cannot exist until it has a site, a department and a rule
 * set, and a half-filled employee page with no id to save against would need a
 * draft state the server has no concept of.
 *
 * <p>The tabs are visual only — every field stays mounted, so one submit sends
 * the whole record. Hiding a tab must not drop the fields on it; a new hire
 * created without a pay category is a timecard that will not export.
 */

type EmployeeOption = { id: string; user: { name: string | null } };

const BUILTIN_ROLES = [
  { value: "EMPLOYEE",      label: "Employee" },
  { value: "SUPERVISOR",    label: "Supervisor" },
  { value: "PAYROLL_ADMIN", label: "Payroll Admin" },
  { value: "HR_ADMIN",      label: "HR Admin" },
  { value: "SYSTEM_ADMIN",  label: "System Admin" },
] as const;

type BuiltinRole = (typeof BUILTIN_ROLES)[number]["value"];

type Tab = "general" | "personal" | "pay";

interface Props {
  sites: Site[];
  departments: (Department & { sites: { site: Site }[] })[];
  ruleSets: RuleSet[];
  employees: EmployeeOption[];
  customRoles: { id: string; name: string }[];
  shifts: { id: string; name: string; startTime: string; endTime: string }[];
  holidayRules: { id: string; name: string }[];
  payCategories: { id: string; number: number; description: string | null }[];
  payTypes: { id: string; number: number; description: string | null }[];
  jobTitles: { id: string; name: string; externalId: string | null }[];
  agencies: { id: string; code: number; description: string; inactiveOn: Date | string | null }[];
}

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * A labelled select, matching the kit's `Input` stack.
 *
 * <p>Deliberately a local copy rather than an addition to `@/components/ui`:
 * the kit is shared across every screen in the product and this is the shape
 * two forms need, not a component the design system asked for.
 */
function SelectField({
  label,
  required,
  children,
  id,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const fieldId = id ?? `c-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={fieldId} style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: "var(--text-error)", marginLeft: 3 }}>
            *
          </span>
        )}
      </label>
      <Select id={fieldId} required={required} {...rest}>
        {children}
      </Select>
    </div>
  );
}

/** A full-width rule inside the field grid. */
function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <p
      className="wms-overline"
      style={{
        gridColumn: "1 / -1",
        margin: 0,
        paddingBottom: 4,
        borderBottom: "1px solid var(--stroke-divider)",
      }}
    >
      {children}
    </p>
  );
}

/** Two across in the modal's width, one when it has none to give. */
const FIELD_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, max(200px, 48%)), 1fr))",
  gap: 12,
};

export function CreateEmployeeForm({ sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories, payTypes, jobTitles, agencies }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [payType, setPayType] = useState("HOURLY");

  const [selectedSiteId, setSelectedSiteId] = useState(
    () => sites.find((s) => departments.some((d) => d.sites.some((ds) => ds.site.id === s.id)))?.id ?? sites[0]?.id ?? ""
  );
  const filteredDepts = departments.filter((d) => d.sites.some((ds) => ds.site.id === selectedSiteId));
  const activeAgencies = agencies.filter((a) => !a.inactiveOn || new Date(a.inactiveOn) > new Date());

  function handleClose() {
    setOpen(false);
    setActiveTab("general");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      const rawRole = (fd.get("role") as string) || "EMPLOYEE";
      const isCustom = rawRole.startsWith("custom:");
      const role: BuiltinRole = isCustom ? "EMPLOYEE" : (rawRole as BuiltinRole);
      const customRoleId = isCustom ? rawRole.slice(7) : undefined;

      const payRateRaw = fd.get("payRate") as string;

      const result = await createEmployee({
        name: fd.get("name") as string,
        email: fd.get("email") as string,
        employeeCode: (fd.get("employeeCode") as string) || "",
        role,
        customRoleId,
        siteId: fd.get("siteId") as string,
        departmentId: fd.get("departmentId") as string,
        ruleSetId: fd.get("ruleSetId") as string,
        hireDate: fd.get("hireDate") as string,
        supervisorId: fd.get("supervisorId") as string,
        wmsId: fd.get("wmsId") as string,
        payType: (fd.get("payType") as "HOURLY" | "SALARY" | null) || null,
        payTypeId: (fd.get("payTypeId") as string) || null,
        payRate: payRateRaw ? Number(payRateRaw) : null,
        jobTitle: null, // legacy free-text title; the form now picks a job title by id
        jobTitleId: (fd.get("jobTitleId") as string) || null,
        agencyId: (fd.get("agencyId") as string) || null,
        adpWorkerId: fd.get("adpWorkerId") as string,
        shiftId: fd.get("shiftId") as string,
        holidayRuleId: fd.get("holidayRuleId") as string,
        payCategoryId: fd.get("payCategoryId") as string,
        gender: fd.get("gender") as string,
        maritalStatus: fd.get("maritalStatus") as string,
        phone: fd.get("phone") as string,
        phone2: fd.get("phone2") as string,
        emergencyContact: fd.get("emergencyContact") as string,
        emergencyPhone: fd.get("emergencyPhone") as string,
        emergencyRelationship: fd.get("emergencyRelationship") as string,
        address1: fd.get("address1") as string,
        address2: fd.get("address2") as string,
        city: fd.get("city") as string,
        state: fd.get("state") as string,
        country: fd.get("country") as string,
        zipCode: fd.get("zipCode") as string,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      handleClose();
      router.refresh();
    });
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: "general",  label: "General" },
    { value: "personal", label: "Personal" },
    { value: "pay",      label: "Pay" },
  ];

  /**
   * A tab's panel.
   *
   * <p>The inactive tabs are switched off in the same inline style that carries
   * the grid, not with a `hidden` class — an inline `display: grid` beats any
   * utility class, and the three panels would all be on screen at once. They
   * stay in the DOM either way: `display: none` fields are still submitted, and
   * dropping them would create employees with no pay category.
   */
  const invalidShown = useRef(false);
  const panelStyle = (tab: Tab): React.CSSProperties => ({
    ...FIELD_GRID,
    display: activeTab === tab ? "grid" : "none",
  });

  return (
    <>
      <Button onClick={() => setOpen(true)} leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}>
        Add Employee
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div className="ta-modal flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl">
            <div
              className="flex items-center justify-between gap-3 px-6 py-4"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <h3 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>
                  New Employee
                </h3>
                <p style={{ margin: 0, font: "var(--type-subtitle)", color: "var(--text-secondary)" }}>
                  All three tabs are submitted together
                </p>
              </div>
              <Button
                hierarchy="tertiary"
                size="sm"
                iconOnly
                onClick={handleClose}
                aria-label="Close"
                leadingIcon={<X className="h-4 w-4" />}
              />
            </div>

            {/* Single form — the tabs only hide fields, they never unmount them */}
            <form
              onSubmit={handleSubmit}
              // Saved with a required field empty on a tab that is not open,
              // the browser refuses without showing why. Open that tab, then
              // let the browser point at the field.
              onInvalidCapture={(e) => {
                const field = e.target as HTMLInputElement;
                if (invalidShown.current) return;
                invalidShown.current = true;
                const tab = field.closest<HTMLElement>("[data-tab]")?.dataset.tab as Tab | undefined;
                if (tab) setActiveTab(tab);
                requestAnimationFrame(() => {
                  invalidShown.current = false;
                  field.reportValidity();
                });
              }}
              className="flex min-h-0 flex-col"
            >
              <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
                <SegmentedControl
                  ariaLabel="Employee details"
                  items={tabs}
                  value={activeTab}
                  onChange={(v) => setActiveTab(v as Tab)}
                />

                {error && <Banner tone="error" body={error} />}

                {/* ── General ───────────────────────────────────────────── */}
                <div data-tab="general" style={panelStyle("general")}>
                  <Input label="Full Name" name="name" required />
                  <Input label="Email (Google login)" name="email" type="email" required />
                  <Input label="Employee Code" name="employeeCode" hint="Optional. Left blank, the Badge ID is used." />
                  <Input label="Hire Date" name="hireDate" type="date" required />

                  <SelectField label="Role" name="role">
                    {BUILTIN_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                    {customRoles.map((r) => (
                      <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>
                    ))}
                  </SelectField>

                  <SelectField
                    label="Site"
                    name="siteId"
                    value={selectedSiteId}
                    onChange={(e) => setSelectedSiteId(e.target.value)}
                  >
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </SelectField>

                  <SelectField label="Department" name="departmentId" required>
                    {filteredDepts.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </SelectField>

                  <SelectField label="Supervisor" name="supervisorId">
                    <option value="">None</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.user.name}</option>
                    ))}
                  </SelectField>

                  <SelectField label="Job Title" name="jobTitleId">
                    <option value="">None</option>
                    {jobTitles.map((jt) => (
                      <option key={jt.id} value={jt.id}>
                        {jt.name}{jt.externalId ? ` (${jt.externalId})` : ""}
                      </option>
                    ))}
                  </SelectField>
                  {/* Agencies past their inactive date stay on file for the
                      people already in them, but are not offered for new hires. */}
                  <SelectField label="Agency" name="agencyId">
                    <option value="">None</option>
                    {activeAgencies.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} ({a.description})
                      </option>
                    ))}
                  </SelectField>
                  <Input label="Badge ID (WMS)" name="wmsId" placeholder="QR code badge ID" required />
                  <Input label="ADP Worker ID" name="adpWorkerId" placeholder="ADP Workforce Now ID" />
                </div>

                {/* ── Personal ──────────────────────────────────────────── */}
                <div data-tab="personal" style={panelStyle("personal")}>
                  <Input label="Gender" name="gender" />

                  <SelectField label="Marital Status" name="maritalStatus">
                    <option value="">Not specified</option>
                    <option value="Single">Single</option>
                    <option value="Married">Married</option>
                    <option value="Divorced">Divorced</option>
                    <option value="Widowed">Widowed</option>
                    <option value="Other">Other</option>
                  </SelectField>

                  <Input label="Phone 1" name="phone" type="tel" />
                  <Input label="Phone 2" name="phone2" type="tel" />

                  <GroupHeading>Emergency Contact</GroupHeading>

                  <Input label="Contact Name" name="emergencyContact" />
                  <Input label="Contact Phone" name="emergencyPhone" type="tel" />
                  <Input label="Relationship" name="emergencyRelationship" placeholder="e.g. Spouse" />

                  <GroupHeading>Address</GroupHeading>

                  <div style={{ gridColumn: "1 / -1" }}>
                    <Input label="Address Line 1" name="address1" />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <Input label="Address Line 2" name="address2" />
                  </div>

                  <Input label="City" name="city" />
                  <Input label="State / Province" name="state" />
                  <Input label="Zip Code" name="zipCode" />
                  <Input label="Country" name="country" />
                </div>

                {/* ── Pay ───────────────────────────────────────────────── */}
                <div data-tab="pay" style={panelStyle("pay")}>
                  <SelectField label="Rule Set" name="ruleSetId" required>
                    {ruleSets.map((rs) => (
                      <option key={rs.id} value={rs.id}>{rs.name}</option>
                    ))}
                  </SelectField>

                  <SelectField label="Shift" name="shiftId">
                    <option value="">None</option>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({fmtTime(s.startTime)} – {fmtTime(s.endTime)})
                      </option>
                    ))}
                  </SelectField>

                  <SelectField label="Holiday Rule" name="holidayRuleId">
                    <option value="">None</option>
                    {holidayRules.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </SelectField>

                  <SelectField label="Pay Category" name="payCategoryId">
                    <option value="">None</option>
                    {payCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.number}{c.description ? ` (${c.description})` : ""}
                      </option>
                    ))}
                  </SelectField>

                  <SelectField label="Pay Type" name="payTypeId">
                    <option value="">None</option>
                    {payTypes.map((pt) => (
                      <option key={pt.id} value={pt.id}>
                        {pt.number}{pt.description ? ` (${pt.description})` : ""}
                      </option>
                    ))}
                  </SelectField>

                  <SelectField
                    label="Pay Method"
                    name="payType"
                    value={payType}
                    onChange={(e) => setPayType(e.target.value)}
                  >
                    <option value="">Not set</option>
                    <option value="HOURLY">Hourly</option>
                    <option value="SALARY">Salary</option>
                  </SelectField>

                  <Input
                    label={
                      payType === "HOURLY"
                        ? "Pay Rate ($/hr)"
                        : payType === "SALARY"
                          ? "Pay Rate ($/yr)"
                          : "Pay Rate"
                    }
                    name="payRate"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div
                className="flex items-center gap-2 px-6 py-4"
                style={{ borderTop: "1px solid var(--stroke-divider)" }}
              >
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Creating…" : "Create Employee"}
                </Button>
                <Button type="button" hierarchy="secondary" onClick={handleClose}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
