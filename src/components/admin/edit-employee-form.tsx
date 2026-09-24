"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { updateEmployee, updateHrSiteAccess } from "@/actions/admin.actions";
import { setTemporaryPassword } from "@/actions/password.actions";
import type { Site, Department, RuleSet, Employee, User } from "@prisma/client";

type EmployeeWithRelations = Omit<Employee, "payRate"> & {
  payRate: number | null;
  user: User;
  site: Site;
  department: Department;
  ruleSet: RuleSet;
  supervisor: (Omit<Employee, "payRate"> & { payRate: number | null; user: User }) | null;
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
  jobTitles: { id: string; name: string; externalId: string | null }[];
  agencies: { id: string; code: number; description: string; inactiveOn: Date | string | null }[];
  logs: Array<{
    id: string;
    createdAt: string;
    actorName: string;
    action?: string;
    fields: Array<{ field: string; before: string; after: string }>;
  }>;
  hrSiteAccess: string[];
  actorRole: string;
}

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const labelCls = "mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

type Tab = "general" | "personal" | "pay" | "logs" | "site-access";

export function EditEmployeeForm({ employee, sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories, payTypes, jobTitles, agencies, logs, hrSiteAccess, actorRole }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("general");
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
  const [siteAccessMsg, setSiteAccessMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Site access tab is only shown when the employee being edited is HR_ADMIN or SYSTEM_ADMIN
  const employeeIsHrOrSysAdmin = ["HR_ADMIN", "SYSTEM_ADMIN"].includes(employee.role);
  // Only HR_ADMIN / SYSTEM_ADMIN actors can manage site access
  const canManageSiteAccess = ["HR_ADMIN", "SYSTEM_ADMIN"].includes(actorRole);

  const filteredDepts = departments.filter((d) => d.sites.some((ds) => ds.site.id === selectedSiteId));

  function save(fields: Record<string, unknown>) {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await updateEmployee({ employeeId: employee.id, ...fields } as Parameters<typeof updateEmployee>[0]);
      if (!result.success) {
        setError(result.error);
      } else {
        setSuccess(true);
        router.refresh();
      }
    });
  }

  function handleGeneral(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    save({
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
      jobTitleId: (fd.get("jobTitleId") as string) || null,
      agencyId: (fd.get("agencyId") as string) || null,
      terminationReason: fd.get("terminationReason") as string,
    });
  }

  function handlePersonal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    save({
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
    save({
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

  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "personal", label: "Personal" },
    { id: "pay", label: "Pay" },
    { id: "logs", label: "Logs" },
    ...(employeeIsHrOrSysAdmin ? [{ id: "site-access" as Tab, label: "Site Access" }] : []),
  ];

  return (
    <>
    <div className="mt-6">
      {/* Tab header */}
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setActiveTab(t.id); setError(null); setSuccess(false); }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === t.id
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-white dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Feedback */}
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}
      {success && (
        <p className="mt-3 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          Saved successfully.
        </p>
      )}

      {/* ── General tab ─────────────────────────────────────────────────── */}
      {activeTab === "general" && (
        <form onSubmit={handleGeneral} className="mt-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Full Name</label>
              <input name="name" defaultValue={employee.user.name ?? ""} required className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Email (Google login)</label>
              <input name="email" type="email" defaultValue={employee.user.email ?? ""} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Role</label>
              <select
                name="customRoleId"
                defaultValue={
                  employee.customRoleId ??
                  customRoles.find((r) => r.isSystem && r.name === { EMPLOYEE: "Employee", SUPERVISOR: "Supervisor", PAYROLL_ADMIN: "Payroll Admin", HR_ADMIN: "HR Admin", SYSTEM_ADMIN: "System Admin", SUPER_ADMIN: "Super Admin" }[employee.role])?.id ??
                  customRoles[0]?.id ??
                  ""
                }
                className={inputCls}
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
              </select>
            </div>

            <div>
              <label className={labelCls}>Site</label>
              <select
                name="siteId"
                value={selectedSiteId}
                onChange={(e) => setSelectedSiteId(e.target.value)}
                className={inputCls}
              >
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Department</label>
              <select name="departmentId" defaultValue={employee.departmentId} className={inputCls}>
                {filteredDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Supervisor</label>
              <select name="supervisorId" defaultValue={employee.supervisorId ?? ""} className={inputCls}>
                <option value="">— None —</option>
                {employees
                  .filter((e) => e.id !== employee.id)
                  .map((e) => <option key={e.id} value={e.id}>{e.user.name}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Job Title</label>
              <select
                name="jobTitleId"
                defaultValue={(employee as any).jobTitleId ?? ""}
                className={inputCls}
              >
                <option value="">— None —</option>
                {jobTitles.map((jt) => (
                  <option key={jt.id} value={jt.id}>
                    {jt.name}{jt.externalId ? ` (${jt.externalId})` : ""}
                  </option>
                ))}
              </select>
              {!(employee as any).jobTitleId && employee.jobTitle && (
                <p className="mt-1 text-xs text-zinc-400">
                  Legacy value: &ldquo;{employee.jobTitle}&rdquo;
                </p>
              )}
            </div>

            <div>
              <label className={labelCls}>Agency</label>
              <select
                name="agencyId"
                defaultValue={(employee as any).agencyId ?? ""}
                className={inputCls}
              >
                <option value="">— None —</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} – {a.description}
                    {a.inactiveOn && new Date(a.inactiveOn) <= new Date() ? " (inactive)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Hire Date</label>
              <input
                value={format(employee.hireDate, "MMM d, yyyy")}
                readOnly
                className={`${inputCls} cursor-default bg-zinc-50 dark:bg-zinc-900`}
              />
            </div>

            <div>
              <label className={labelCls}>Adjusted Hire Date</label>
              <input
                type="date"
                name="adjustedHireDate"
                defaultValue={employee.adjustedHireDate ? format(employee.adjustedHireDate, "yyyy-MM-dd") : ""}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Seniority date override — used for leave tier calculations when the policy&apos;s service basis is &ldquo;Adjusted Hire Date&rdquo;.
              </p>
            </div>

            <div>
              <label className={labelCls}>Badge ID (WMS)</label>
              <input name="wmsId" defaultValue={employee.wmsId ?? ""} placeholder="QR code badge ID" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Badge barcode</label>
              <input
                name="barcode"
                defaultValue={employee.barcode ?? ""}
                placeholder="10-digit code on the badge"
                className={inputCls}
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {employee.barcodeOverride
                  ? "Set by hand — the Oracle sync will not overwrite this."
                  : employee.barcodeSyncedAt
                    ? `Synced from Oracle ${format(employee.barcodeSyncedAt, "MMM d, h:mm a")}.`
                    : "Not yet synced. Only needed when the badge encodes a different number than the Badge ID."}
                {" "}Kiosks accept either value.
              </p>
            </div>

            <div>
              <label className={labelCls}>ADP Worker ID</label>
              <input name="adpWorkerId" defaultValue={employee.adpWorkerId ?? ""} placeholder="ADP Workforce Now ID" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Status</label>
              <select
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as "active" | "on-leave" | "inactive")}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="on-leave">On Leave</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            {status === "inactive" && (
              <div>
                <label className={labelCls}>Termination Reason</label>
                <input name="terminationReason" defaultValue={employee.terminationReason ?? ""} className={inputCls} />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={isPending} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
              {isPending ? "Saving…" : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={() => { setShowPasswordModal(true); setTempStatus("idle"); setTempMessage(""); setTempPasswordValue(""); }}
              className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              Set Temporary Password
            </button>
          </div>
        </form>
      )}

      {/* ── Personal tab ────────────────────────────────────────────────── */}
      {activeTab === "personal" && (
        <form onSubmit={handlePersonal} className="mt-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Gender</label>
              <input name="gender" defaultValue={employee.gender ?? ""} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Marital Status</label>
              <select name="maritalStatus" defaultValue={employee.maritalStatus ?? ""} className={inputCls}>
                <option value="">— Select —</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Divorced">Divorced</option>
                <option value="Widowed">Widowed</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className={labelCls}>Phone 1</label>
              <input name="phone" type="tel" defaultValue={employee.phone ?? ""} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Phone 2</label>
              <input name="phone2" type="tel" defaultValue={employee.phone2 ?? ""} className={inputCls} />
            </div>

            <p className="col-span-full -mb-1 border-b border-zinc-200 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-700">
              Emergency Contact
            </p>

            <div>
              <label className={labelCls}>Contact Name</label>
              <input name="emergencyContact" defaultValue={employee.emergencyContact ?? ""} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Contact Phone</label>
              <input name="emergencyPhone" type="tel" defaultValue={employee.emergencyPhone ?? ""} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Relationship</label>
              <input name="emergencyRelationship" defaultValue={employee.emergencyRelationship ?? ""} placeholder="e.g. Spouse" className={inputCls} />
            </div>

            <p className="col-span-full -mb-1 border-b border-zinc-200 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-700">
              Address
            </p>

            <div className="col-span-full">
              <label className={labelCls}>Address Line 1</label>
              <input name="address1" defaultValue={employee.address1 ?? ""} className={inputCls} />
            </div>

            <div className="col-span-full">
              <label className={labelCls}>Address Line 2</label>
              <input name="address2" defaultValue={employee.address2 ?? ""} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>City</label>
              <input name="city" defaultValue={employee.city ?? ""} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>State / Province</label>
              <input name="state" defaultValue={employee.state ?? ""} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Zip Code</label>
              <input name="zipCode" defaultValue={employee.zipCode ?? ""} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Country</label>
              <input name="country" defaultValue={employee.country ?? ""} className={inputCls} />
            </div>
          </div>

          <div>
            <button type="submit" disabled={isPending} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
              {isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      )}

      {/* ── Pay tab ─────────────────────────────────────────────────────── */}
      {activeTab === "pay" && (
        <>
        <form onSubmit={handlePay} className="mt-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Rule Set</label>
              <select name="ruleSetId" defaultValue={employee.ruleSetId} className={inputCls}>
                {ruleSets.map((rs) => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Shift</label>
              <select name="shiftId" defaultValue={employee.shiftId ?? ""} className={inputCls}>
                <option value="">— None —</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({fmtTime(s.startTime)} – {fmtTime(s.endTime)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Holiday Rule</label>
              <select name="holidayRuleId" defaultValue={employee.holidayRuleId ?? ""} className={inputCls}>
                <option value="">— None —</option>
                {holidayRules.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Pay Category</label>
              <select name="payCategoryId" defaultValue={(employee as any).payCategoryId ?? ""} className={inputCls}>
                <option value="">— None —</option>
                {payCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.number}{c.description ? ` — ${c.description}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Pay Type</label>
              <select name="payTypeId" defaultValue={(employee as any).payTypeId ?? ""} className={inputCls}>
                <option value="">— None —</option>
                {payTypes.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.number}{pt.description ? ` — ${pt.description}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Pay Method</label>
              <select
                name="payType"
                value={payType}
                onChange={(e) => setPayType(e.target.value)}
                className={inputCls}
              >
                <option value="HOURLY">Hourly</option>
                <option value="SALARY">Salary</option>
              </select>
            </div>

            <div>
              <label className={labelCls}>
                Pay Rate{" "}
                <span className="font-normal text-zinc-400">
                  {payType === "HOURLY" ? "($/hr)" : "($/yr)"}
                </span>
              </label>
              <input
                name="payRate"
                type="number"
                min="0"
                step="0.01"
                defaultValue={employee.payRate != null ? Number(employee.payRate) : ""}
                placeholder="0.00"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <button type="submit" disabled={isPending} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
              {isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>

        </>
      )}

      {/* ── Logs tab ────────────────────────────────────────────────────── */}
      {activeTab === "logs" && (
        <div className="mt-5">
          {logs.length === 0 ? (
            <p className="text-sm text-zinc-400">No changes recorded yet.</p>
          ) : (
            <>
              {/* Filters */}
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <select
                  value={logField}
                  onChange={(e) => setLogField(e.target.value)}
                  className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="">All fields</option>
                  {allLogFieldNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>

                <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-sm dark:border-zinc-600">
                  {([{ label: "All time", days: 0 }, { label: "30 days", days: 30 }, { label: "7 days", days: 7 }] as const).map(({ label, days }) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setLogDays(days)}
                      className={`px-3 py-1.5 transition-colors ${
                        logDays === days
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredLogs.length === 0 ? (
                <p className="text-sm text-zinc-400">No entries match the current filters.</p>
              ) : (
                <ol className="relative border-l border-zinc-200 dark:border-zinc-700">
                  {filteredLogs.map((entry) => (
                    <li key={entry.id} className="mb-6 ml-4">
                      <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-zinc-400 dark:border-zinc-900 dark:bg-zinc-500" />
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <time className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          {new Date(entry.createdAt).toLocaleString("en-US", {
                            month: "short", day: "numeric", year: "numeric",
                            hour: "numeric", minute: "2-digit", hour12: true,
                          })}
                        </time>
                        <span className="text-xs text-zinc-400">by {entry.actorName}</span>
                        {entry.action === "EMPLOYEE_CREATED" && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                            Created
                          </span>
                        )}
                      </div>
                      <ul className="mt-2 space-y-1">
                        {entry.fields.map((f, i) => (
                          <li key={i} className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                            <span className="font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{f.field}</span>
                            <span className="text-zinc-500 dark:text-zinc-400">
                              <span className="line-through text-zinc-400 dark:text-zinc-500">{f.before}</span>
                              {" → "}
                              <span className="text-zinc-800 dark:text-zinc-200">{f.after}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Site Access tab ─────────────────────────────────────────────── */}
      {activeTab === "site-access" && (
        <div className="mt-5">
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
            Control which sites this HR user can see employees from.
            Leave all unchecked to grant access to <strong>all sites</strong>.
          </p>
          <div className="flex flex-col gap-2">
            {sites.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50">
                <input
                  type="checkbox"
                  disabled={!canManageSiteAccess}
                  checked={selectedSiteAccess.has(s.id)}
                  onChange={(e) => {
                    const next = new Set(selectedSiteAccess);
                    if (e.target.checked) next.add(s.id);
                    else next.delete(s.id);
                    setSelectedSiteAccess(next);
                    setSiteAccessMsg(null);
                  }}
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-900"
                />
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{s.name}</span>
              </label>
            ))}
          </div>
          {selectedSiteAccess.size === 0 && (
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              No sites selected — this user has access to all sites.
            </p>
          )}
          {canManageSiteAccess && (
            <div className="mt-5 flex items-center gap-4">
              <button
                type="button"
                disabled={siteAccessSaving}
                onClick={async () => {
                  setSiteAccessSaving(true);
                  setSiteAccessMsg(null);
                  const result = await updateHrSiteAccess({
                    employeeId: employee.id,
                    siteIds: Array.from(selectedSiteAccess),
                  });
                  setSiteAccessSaving(false);
                  if (result.success) {
                    setSiteAccessMsg({ ok: true, text: "Site access saved." });
                    router.refresh();
                  } else {
                    setSiteAccessMsg({ ok: false, text: result.error ?? "Failed to save." });
                  }
                }}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {siteAccessSaving ? "Saving…" : "Save Site Access"}
              </button>
              {siteAccessMsg && (
                <p className={`text-sm ${siteAccessMsg.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {siteAccessMsg.text}
                </p>
              )}
            </div>
          )}
          {!canManageSiteAccess && (
            <p className="mt-4 text-xs text-zinc-400">Only HR Admin or System Admin users can edit site access.</p>
          )}
        </div>
      )}
    </div>

      {/* ── Temp password modal ─────────────────────────────────────────── */}
      {showPasswordModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowPasswordModal(false); }}
        >
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-zinc-800 p-6 shadow-xl">
            <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-white">Set Temporary Password</h2>
            <p className="mb-1 text-sm text-zinc-500 dark:text-zinc-400">
              The employee will be required to change this on first login.
            </p>
            <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">
              Requirements: 8+ characters, uppercase letter, number, special character.
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
              className="flex flex-col gap-3"
            >
              <input
                type="text"
                value={tempPassword}
                onChange={(e) => setTempPasswordValue(e.target.value)}
                placeholder="Enter temporary password"
                minLength={8}
                required
                className={inputCls}
              />
              {tempMessage && (
                <p className={`text-sm ${tempStatus === "error" ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
                  {tempMessage}
                </p>
              )}
              <div className="flex justify-end gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={tempStatus === "loading"}
                  className="rounded-lg bg-zinc-900 dark:bg-white px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-50"
                >
                  {tempStatus === "loading" ? "Saving…" : "Set Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
