"use client";

import { useTransition, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { updateEmployee, updateHrSiteAccess } from "@/actions/admin.actions";
import { setTemporaryPassword } from "@/actions/password.actions";
import type { Site, Department, RuleSet, Employee } from "@prisma/client";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  SegmentedControl,
  Select,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from "@/components/ui";
import { History } from "lucide-react";

/**
 * The employee record, on the design's doc template: one column of sections
 * instead of the five tabs this used to be.
 *
 * <p>The tabs went because they were hiding, not organising. Three of them —
 * General, Personal and Pay — each posted their own `updateEmployee` call with
 * their own fields, so "Save Changes" meant something different depending on
 * which tab happened to be open, and there was no way to see that from the
 * button. As sections, each save sits under the fields it writes and says so.
 *
 * <p>The three calls are still three calls. Merging them into one form would
 * mean a single save writing pay rate, address and site assignment together,
 * and on a record two people edit in the same afternoon that turns a
 * one-field correction into an overwrite of everything else.
 */

/**
 * The user fields this form draws. Deliberately not Prisma's `User`, which
 * also carries the password hash: typing it that way is what let the whole
 * row be selected and serialised into the page.
 */
type UserSummary = { id: string; name: string | null; email: string | null };

type EmployeeWithRelations = Omit<Employee, "payRate"> & {
  payRate: number | null;
  user: UserSummary;
  site: Site;
  department: Department;
  ruleSet: RuleSet;
  supervisor: (Omit<Employee, "payRate"> & { payRate: number | null; user: UserSummary }) | null;
};

interface Props {
  employee: EmployeeWithRelations;
  sites: Site[];
  departments: (Department & { sites: { site: Site }[] })[];
  ruleSets: RuleSet[];
  employees: { id: string; user: { name: string | null } }[];
  customRoles: { id: string; name: string; isSystem: boolean; rank: number }[];
  shifts: { id: string; name: string; startTime: string; endTime: string }[];
  holidayRules: { id: string; name: string }[];
  payCategories: { id: string; number: number; description: string | null }[];
  payTypes: { id: string; number: number; description: string | null }[];
  logs: Array<{
    id: string;
    createdAt: string;
    actorName: string;
    fields: Array<{ field: string; before: string; after: string }>;
  }>;
  hrSiteAccess: string[];
  actorRole: string;
}

/** Which section a save belongs to, so its result lands on the right card. */
type Section = "general" | "personal" | "pay" | "site-access";

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * The doc template's field grid: columns that drop out rather than squeeze.
 *
 * <p>`auto-fit` with a `min(100%, max(200px, …))` floor is what keeps a
 * three-across form readable in the 440px the sidebar leaves on a laptop — the
 * columns collapse to one instead of producing three 130px selects whose
 * options are all elided.
 */
function fieldGrid(cols: number): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(200px, ${Math.floor(96 / cols)}%)), 1fr))`,
    gap: 12,
  };
}

/**
 * A labelled select.
 *
 * <p>The kit ships `Input` with its own label/hint stack but `Select` as a bare
 * control, and the kit is shared and not ours to change. This wraps `Select` in
 * the same 6px stack so a select and a text input side by side in the grid sit
 * on the same baseline instead of one riding 18px high.
 */
function SelectField({
  label,
  children,
  id,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const fieldId = id ?? `s-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={fieldId} style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>
        {label}
      </label>
      <Select id={fieldId} {...rest}>
        {children}
      </Select>
    </div>
  );
}

/** One label-over-value pair in a read-only card, as the design draws them. */
function Kv({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="wms-overline">{label}</span>
      <span
        className="tabular"
        style={{
          font: "var(--weight-semibold) 16px/22px var(--font-sans)",
          color: "var(--text-primary)",
          overflowWrap: "anywhere",
        }}
      >
        {children}
      </span>
    </div>
  );
}

/** A full-width rule inside a field grid, for the groups within one form. */
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

export function EditEmployeeForm({ employee, sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories, payTypes, logs, hrSiteAccess, actorRole }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ section: Section; tone: "error" | "success"; text: string } | null>(null);
  /** Which section's save is in flight — the three share one transition. */
  const [savingSection, setSavingSection] = useState<Section | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState(employee.siteId);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [tempPassword, setTempPasswordValue] = useState("");
  const [tempStatus, setTempStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [tempMessage, setTempMessage] = useState("");
  const [status, setStatus] = useState<"active" | "on-leave" | "inactive">(
    !employee.isActive ? "inactive" : employee.onLeave ? "on-leave" : "active"
  );
  const [payType, setPayType] = useState<string>(employee.payType ?? "HOURLY");
  const [logField, setLogField] = useState("");
  const [logDays, setLogDays] = useState(0);
  const [selectedSiteAccess, setSelectedSiteAccess] = useState<Set<string>>(new Set(hrSiteAccess));
  const [siteAccessSaving, setSiteAccessSaving] = useState(false);

  // Site access section is only shown when the employee being edited is HR_ADMIN or SYSTEM_ADMIN
  const employeeIsHrOrSysAdmin = ["HR_ADMIN", "SYSTEM_ADMIN"].includes(employee.role);
  // Only HR_ADMIN / SYSTEM_ADMIN actors can manage site access
  const canManageSiteAccess = ["HR_ADMIN", "SYSTEM_ADMIN"].includes(actorRole);

  const filteredDepts = departments.filter((d) => d.sites.some((ds) => ds.site.id === selectedSiteId));

  function save(section: Section, fields: Record<string, unknown>) {
    setFeedback(null);
    setSavingSection(section);
    startTransition(async () => {
      const result = await updateEmployee({ employeeId: employee.id, ...fields } as Parameters<typeof updateEmployee>[0]);
      if (!result.success) {
        setFeedback({ section, tone: "error", text: result.error });
      } else {
        setFeedback({ section, tone: "success", text: "Saved." });
        router.refresh();
      }
    });
  }

  function handleGeneral(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    save("general", {
      name: fd.get("name") as string,
      email: fd.get("email") as string,
      customRoleId: (fd.get("customRoleId") as string) || null,
      siteId: fd.get("siteId") as string,
      departmentId: fd.get("departmentId") as string,
      supervisorId: (fd.get("supervisorId") as string) || null,
      isActive: fd.get("status") !== "inactive",
      onLeave: fd.get("status") === "on-leave",
      wmsId: fd.get("wmsId") as string,
      // Editing the barcode by hand marks it as an override, so the nightly
      // Oracle sync leaves it alone instead of undoing the correction.
      barcode: fd.get("barcode") as string,
      adpWorkerId: fd.get("adpWorkerId") as string,
      jobTitle: fd.get("jobTitle") as string,
      terminationReason: fd.get("terminationReason") as string,
    });
  }

  function handlePersonal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    save("personal", {
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
  }

  function handlePay(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const rateStr = fd.get("payRate") as string;
    save("pay", {
      ruleSetId: fd.get("ruleSetId") as string,
      shiftId: (fd.get("shiftId") as string) || null,
      holidayRuleId: (fd.get("holidayRuleId") as string) || null,
      payCategoryId: (fd.get("payCategoryId") as string) || null,
      payTypeId: (fd.get("payTypeId") as string) || null,
      payType: fd.get("payType") as string,
      payRate: rateStr ? parseFloat(rateStr) : null,
    });
  }

  const allLogFieldNames = [...new Set(logs.flatMap((e) => e.fields.map((f) => f.field)))].sort();
  const logCutoff = logDays > 0 ? new Date(Date.now() - logDays * 24 * 60 * 60 * 1000) : null;
  const filteredLogs = logs
    .filter((e) => !logCutoff || new Date(e.createdAt) >= logCutoff)
    .map((e) => ({ ...e, fields: logField ? e.fields.filter((f) => f.field === logField) : e.fields }))
    .filter((e) => e.fields.length > 0);

  /** The result of the last save, when it belongs to this section. */
  const feedbackFor = (section: Section) =>
    feedback?.section === section ? (
      <Banner tone={feedback.tone} body={feedback.text} />
    ) : null;

  /**
   * All three saves share one transition, so every button is disabled while any
   * of them is in flight — two concurrent `updateEmployee` calls on one record
   * is exactly the overwrite the sections exist to avoid. Only the button that
   * was actually pressed says "Saving…", though; three buttons announcing a save
   * nobody asked them for is how a supervisor concludes the page saved
   * everything at once.
   */
  const saveLabel = (section: Section) =>
    isPending && savingSection === section ? "Saving…" : "Save Changes";

  return (
    <>
      <div className="flex flex-col gap-4" style={{ maxWidth: 1080 }}>
        {/* ── Identity ─────────────────────────────────────────────────────
            Everything here is either assigned once or derived; the editable
            copies of the same facts live in the sections below. */}
        <Card title="Identity" subtitle="Assigned on creation and used for seniority">
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))]">
            <Kv label="Employee Code">{employee.employeeCode}</Kv>
            <Kv label="Hire Date">{format(employee.hireDate, "MMM d, yyyy")}</Kv>
            {/* The date leave tiers are actually measured from: the override
                when one is set, the hire date otherwise. Showing only the hire
                date is how somebody rehired in 2024 gets credited with a year
                they did not serve. */}
            <Kv label="Seniority Date">
              {format(employee.adjustedHireDate ?? employee.hireDate, "MMM d, yyyy")}
              {employee.adjustedHireDate && (
                <span
                  className="ml-1.5"
                  style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}
                >
                  adjusted
                </span>
              )}
            </Kv>
            <Kv label="Last Change">
              {logs.length > 0 ? (
                <>
                  {format(new Date(logs[0].createdAt), "MMM d, yyyy")}
                  <span
                    className="ml-1.5"
                    style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}
                  >
                    by {logs[0].actorName}
                  </span>
                </>
              ) : (
                <span style={{ color: "var(--text-tertiary)" }}>—</span>
              )}
            </Kv>
          </div>
        </Card>

        {/* ── Profile & assignment ────────────────────────────────────────── */}
        <form onSubmit={handleGeneral}>
          <Card
            title="Profile & Assignment"
            subtitle="Site, department and supervisor decide whose queue this person's timesheets land in"
          >
            <div className="flex flex-col gap-4">
              {feedbackFor("general")}

              <div style={fieldGrid(3)}>
                <Input label="Full Name" name="name" defaultValue={employee.user.name ?? ""} required />
                <Input label="Email (Google login)" name="email" type="email" defaultValue={employee.user.email ?? ""} />
                <Input label="Job Title" name="jobTitle" defaultValue={employee.jobTitle ?? ""} />

                <SelectField
                  label="Role"
                  name="customRoleId"
                  defaultValue={
                    employee.customRoleId ??
                    customRoles.find((r) => r.isSystem && r.name === { EMPLOYEE: "Employee", SUPERVISOR: "Supervisor", PAYROLL_ADMIN: "Payroll Admin", HR_ADMIN: "HR Admin", SYSTEM_ADMIN: "System Admin", SUPER_ADMIN: "Super Admin" }[employee.role])?.id ??
                    customRoles[0]?.id ??
                    ""
                  }
                >
                  {customRoles.filter((r) => r.isSystem).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                  {customRoles.some((r) => !r.isSystem) && (
                    <optgroup label="────────────────">
                      {customRoles.filter((r) => !r.isSystem).map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </optgroup>
                  )}
                </SelectField>

                <SelectField
                  label="Site"
                  name="siteId"
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                >
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </SelectField>

                <SelectField label="Department" name="departmentId" defaultValue={employee.departmentId}>
                  {filteredDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </SelectField>

                <SelectField label="Supervisor" name="supervisorId" defaultValue={employee.supervisorId ?? ""}>
                  <option value="">— None —</option>
                  {employees
                    .filter((e) => e.id !== employee.id)
                    .map((e) => <option key={e.id} value={e.id}>{e.user.name}</option>)}
                </SelectField>

                <SelectField
                  label="Status"
                  name="status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "active" | "on-leave" | "inactive")}
                >
                  <option value="active">Active</option>
                  <option value="on-leave">On Leave</option>
                  <option value="inactive">Inactive</option>
                </SelectField>

                {status === "inactive" && (
                  <Input
                    label="Termination Reason"
                    name="terminationReason"
                    defaultValue={employee.terminationReason ?? ""}
                  />
                )}

                <Input
                  label="Adjusted Hire Date"
                  name="adjustedHireDate"
                  type="date"
                  defaultValue={employee.adjustedHireDate ? format(employee.adjustedHireDate, "yyyy-MM-dd") : ""}
                  hint="Seniority override — used for leave tiers when the policy's service basis is Adjusted Hire Date."
                />

                <GroupHeading>Badges & External IDs</GroupHeading>

                <Input
                  label="Badge ID (WMS)"
                  name="wmsId"
                  defaultValue={employee.wmsId ?? ""}
                  placeholder="QR code badge ID"
                />

                <Input
                  label="Badge barcode"
                  name="barcode"
                  defaultValue={employee.barcode ?? ""}
                  placeholder="10-digit code on the badge"
                  hint={
                    (employee.barcodeOverride
                      ? "Set by hand — the Oracle sync will not overwrite this."
                      : employee.barcodeSyncedAt
                        ? `Synced from Oracle ${format(employee.barcodeSyncedAt, "MMM d, h:mm a")}.`
                        : "Not yet synced. Only needed when the badge encodes a different number than the Badge ID.") +
                    " Kiosks accept either value."
                  }
                />

                <Input
                  label="ADP Worker ID"
                  name="adpWorkerId"
                  defaultValue={employee.adpWorkerId ?? ""}
                  placeholder="ADP Workforce Now ID"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={isPending}>
                  {saveLabel("general")}
                </Button>
                <Button
                  type="button"
                  hierarchy="secondary"
                  onClick={() => {
                    setShowPasswordModal(true);
                    setTempStatus("idle");
                    setTempMessage("");
                    setTempPasswordValue("");
                  }}
                >
                  Set Temporary Password
                </Button>
              </div>
            </div>
          </Card>
        </form>

        {/* ── Personal & contact ──────────────────────────────────────────── */}
        <form onSubmit={handlePersonal}>
          <Card
            title="Personal & Contact"
            subtitle="Held encrypted and only read back on this screen"
          >
            <div className="flex flex-col gap-4">
              {feedbackFor("personal")}

              <div style={fieldGrid(3)}>
                <Input label="Gender" name="gender" defaultValue={employee.gender ?? ""} />

                <SelectField label="Marital Status" name="maritalStatus" defaultValue={employee.maritalStatus ?? ""}>
                  <option value="">— Select —</option>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Divorced">Divorced</option>
                  <option value="Widowed">Widowed</option>
                  <option value="Other">Other</option>
                </SelectField>

                <Input label="Phone 1" name="phone" type="tel" defaultValue={employee.phone ?? ""} />
                <Input label="Phone 2" name="phone2" type="tel" defaultValue={employee.phone2 ?? ""} />

                <GroupHeading>Emergency Contact</GroupHeading>

                <Input label="Contact Name" name="emergencyContact" defaultValue={employee.emergencyContact ?? ""} />
                <Input label="Contact Phone" name="emergencyPhone" type="tel" defaultValue={employee.emergencyPhone ?? ""} />
                <Input
                  label="Relationship"
                  name="emergencyRelationship"
                  defaultValue={employee.emergencyRelationship ?? ""}
                  placeholder="e.g. Spouse"
                />

                <GroupHeading>Address</GroupHeading>

                <div style={{ gridColumn: "1 / -1" }}>
                  <Input label="Address Line 1" name="address1" defaultValue={employee.address1 ?? ""} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Input label="Address Line 2" name="address2" defaultValue={employee.address2 ?? ""} />
                </div>

                <Input label="City" name="city" defaultValue={employee.city ?? ""} />
                <Input label="State / Province" name="state" defaultValue={employee.state ?? ""} />
                <Input label="Zip Code" name="zipCode" defaultValue={employee.zipCode ?? ""} />
                <Input label="Country" name="country" defaultValue={employee.country ?? ""} />
              </div>

              <div>
                <Button type="submit" disabled={isPending}>
                  {saveLabel("personal")}
                </Button>
              </div>
            </div>
          </Card>
        </form>

        {/* ── Pay & rules ─────────────────────────────────────────────────── */}
        <form onSubmit={handlePay}>
          <Card
            title="Pay & Rules"
            subtitle="The rule set computes the hours; the pay method decides whether punches drive pay at all"
          >
            <div className="flex flex-col gap-4">
              {feedbackFor("pay")}

              <div style={fieldGrid(3)}>
                <SelectField label="Rule Set" name="ruleSetId" defaultValue={employee.ruleSetId}>
                  {ruleSets.map((rs) => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                </SelectField>

                <SelectField label="Shift" name="shiftId" defaultValue={employee.shiftId ?? ""}>
                  <option value="">— None —</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({fmtTime(s.startTime)} – {fmtTime(s.endTime)})
                    </option>
                  ))}
                </SelectField>

                <SelectField label="Holiday Rule" name="holidayRuleId" defaultValue={employee.holidayRuleId ?? ""}>
                  <option value="">— None —</option>
                  {holidayRules.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </SelectField>

                <SelectField label="Pay Category" name="payCategoryId" defaultValue={employee.payCategoryId ?? ""}>
                  <option value="">— None —</option>
                  {payCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.number}{c.description ? ` — ${c.description}` : ""}
                    </option>
                  ))}
                </SelectField>

                <SelectField label="Pay Type" name="payTypeId" defaultValue={employee.payTypeId ?? ""}>
                  <option value="">— None —</option>
                  {payTypes.map((pt) => (
                    <option key={pt.id} value={pt.id}>
                      {pt.number}{pt.description ? ` — ${pt.description}` : ""}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label="Pay Method"
                  name="payType"
                  value={payType}
                  onChange={(e) => setPayType(e.target.value)}
                >
                  <option value="HOURLY">Hourly</option>
                  <option value="SALARY">Salary</option>
                </SelectField>

                <Input
                  label={payType === "HOURLY" ? "Pay Rate ($/hr)" : "Pay Rate ($/yr)"}
                  name="payRate"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={employee.payRate != null ? Number(employee.payRate) : ""}
                  placeholder="0.00"
                />
              </div>

              <div>
                <Button type="submit" disabled={isPending}>
                  {saveLabel("pay")}
                </Button>
              </div>
            </div>
          </Card>
        </form>

        {/* ── Site access ─────────────────────────────────────────────────── */}
        {employeeIsHrOrSysAdmin && (
          <Card
            title="Site Access"
            subtitle="Which sites this HR user can see employees from"
          >
            <div className="flex flex-col gap-4">
              {feedbackFor("site-access")}

              <Banner
                tone="info"
                body={
                  selectedSiteAccess.size === 0
                    ? "No sites selected — this user can see employees at every site."
                    : "Only the checked sites are visible to this user. Uncheck them all to grant every site."
                }
              />

              <div className="grid gap-2 gap-x-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,30%)),1fr))]">
                {sites.map((s) => (
                  <div key={s.id} className="flex items-center py-1.5">
                    <Checkbox
                      id={`site-access-${s.id}`}
                      label={s.name}
                      disabled={!canManageSiteAccess}
                      checked={selectedSiteAccess.has(s.id)}
                      onChange={(next) => {
                        const updated = new Set(selectedSiteAccess);
                        if (next) updated.add(s.id);
                        else updated.delete(s.id);
                        setSelectedSiteAccess(updated);
                        // Only this section's own result is stale now. Clearing
                        // unconditionally would wipe the "Saved." a pay or
                        // profile save just put on a card further up the page.
                        setFeedback((f) => (f?.section === "site-access" ? null : f));
                      }}
                    />
                  </div>
                ))}
              </div>

              {canManageSiteAccess ? (
                <div>
                  <Button
                    type="button"
                    disabled={siteAccessSaving}
                    onClick={async () => {
                      setSiteAccessSaving(true);
                      setFeedback(null);
                      const result = await updateHrSiteAccess({
                        employeeId: employee.id,
                        siteIds: Array.from(selectedSiteAccess),
                      });
                      setSiteAccessSaving(false);
                      if (result.success) {
                        setFeedback({ section: "site-access", tone: "success", text: "Site access saved." });
                        router.refresh();
                      } else {
                        setFeedback({
                          section: "site-access",
                          tone: "error",
                          text: result.error ?? "Failed to save.",
                        });
                      }
                    }}
                  >
                    {siteAccessSaving ? "Saving…" : "Save Site Access"}
                  </Button>
                </div>
              ) : (
                <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                  Only HR Admin or System Admin users can edit site access.
                </p>
              )}
            </div>
          </Card>
        )}

        {/* ── Change history ──────────────────────────────────────────────── */}
        <Card
          title="Change History"
          subtitle="Every field this record has had edited, newest first"
          padding={0}
        >
          {/* The filters sit in a row of their own rather than in the card
              header: the header does not wrap, and a select plus a three-way
              switch next to the title is clipped the moment the sidebar is
              open on a laptop. */}
          {logs.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2.5 px-4 py-3"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              <Select
                aria-label="Field"
                value={logField}
                onChange={(e) => setLogField(e.target.value)}
              >
                <option value="">All fields</option>
                {allLogFieldNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </Select>
              {/* Local, not a URL parameter: the whole history is already on
                  the client and nobody links to "this record, last 7 days". */}
              <SegmentedControl
                ariaLabel="Date range"
                size="sm"
                items={[
                  { value: "0", label: "All time" },
                  { value: "30", label: "30 days" },
                  { value: "7", label: "7 days" },
                ]}
                value={String(logDays)}
                onChange={(v) => setLogDays(Number(v))}
              />
              <span
                className="tabular ml-auto"
                style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
              >
                {filteredLogs.length} {filteredLogs.length === 1 ? "change" : "changes"}
              </span>
            </div>
          )}

          {filteredLogs.length === 0 ? (
            <EmptyState
              icon={<History className="h-8 w-8" />}
              title={logs.length === 0 ? "No changes recorded yet" : "No changes in this range"}
              body={
                logs.length === 0
                  ? "Edits made from this screen are written to the audit log and will appear here."
                  : "Widen the date range, or switch back to all fields."
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Changed By</TH>
                  <TH>Change</TH>
                </TR>
              </THead>
              <TBody>
                {filteredLogs.map((entry) => (
                  <TR key={entry.id}>
                    {/* One row per save, not per field: the fields that moved
                        together moved for one reason, and splitting them makes
                        a site transfer look like four unrelated edits. */}
                    <TD
                      numeric
                      align="left"
                      style={{ height: "auto", padding: "10px 14px", verticalAlign: "top", whiteSpace: "nowrap", color: "var(--text-secondary)" }}
                    >
                      {format(new Date(entry.createdAt), "MMM d, yyyy HH:mm")}
                    </TD>
                    <TD style={{ height: "auto", padding: "10px 14px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                      {entry.actorName}
                    </TD>
                    <TD style={{ height: "auto", padding: "10px 14px", verticalAlign: "top" }}>
                      <span className="flex flex-col gap-1">
                        {entry.fields.map((f, i) => (
                          <span key={i} className="flex flex-wrap items-baseline gap-x-2">
                            <span
                              style={{
                                font: "var(--type-body2)",
                                fontWeight: "var(--weight-medium)",
                                color: "var(--text-secondary)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {f.field}
                            </span>
                            <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                              <span style={{ textDecoration: "line-through" }}>{f.before}</span>
                              {" → "}
                              <span style={{ color: "var(--text-primary)" }}>{f.after}</span>
                            </span>
                          </span>
                        ))}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      {/* ── Temp password modal ───────────────────────────────────────────── */}
      {showPasswordModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowPasswordModal(false); }}
        >
          <div className="ta-modal w-full max-w-sm rounded-xl p-6">
            <h2 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>
              Set Temporary Password
            </h2>
            <p className="mt-1" style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>
              The employee will be required to change this on first login.
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setTempStatus("loading");
                setTempMessage("");
                const result = await setTemporaryPassword(employee.id, tempPassword);
                setTempStatus(result.success ? "done" : "error");
                setTempMessage(result.message);
                if (result.success) setTempPasswordValue("");
              }}
              className="mt-4 flex flex-col gap-3"
            >
              {/* Shown as text, not dots: whoever sets this has to read it back
                  to the employee, and a masked field they cannot check is how a
                  typo becomes a locked-out badge on a Monday morning. */}
              <Input
                label="Temporary password"
                type="text"
                value={tempPassword}
                onChange={(e) => setTempPasswordValue(e.target.value)}
                placeholder="Enter temporary password"
                minLength={8}
                required
                hint="8+ characters, with an uppercase letter, a number and a special character."
              />

              {tempMessage && (
                <Banner tone={tempStatus === "error" ? "error" : "success"} body={tempMessage} />
              )}

              <div className="mt-1 flex justify-end gap-2">
                <Button type="button" hierarchy="secondary" onClick={() => setShowPasswordModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={tempStatus === "loading"}>
                  {tempStatus === "loading" ? "Saving…" : "Set Password"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
