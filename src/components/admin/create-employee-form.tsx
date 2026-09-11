"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEmployee } from "@/actions/admin.actions";
import type { Site, Department, RuleSet } from "@prisma/client";

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
}

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const labelCls = "mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

export function CreateEmployeeForm({ sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories, payTypes }: Props) {
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
        employeeCode: fd.get("employeeCode") as string,
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
        jobTitle: fd.get("jobTitle") as string,
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

  const tabs: { id: Tab; label: string }[] = [
    { id: "general",  label: "General" },
    { id: "personal", label: "Personal" },
    { id: "pay",      label: "Pay" },
  ];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        + Add Employee
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">New Employee</h3>
              <button
                type="button"
                onClick={handleClose}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-zinc-200 px-6 dark:border-zinc-700">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
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

            {/* Form — single form, tabs are visual only so all fields submit together */}
            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {error && (
                  <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                  </p>
                )}

                {/* ── General ───────────────────────────────────────────── */}
                <div className={activeTab !== "general" ? "hidden" : ""}>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Full Name</label>
                      <input name="name" required className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>Email (Google login)</label>
                      <input name="email" type="email" required className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>Employee Code</label>
                      <input name="employeeCode" required className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>Hire Date</label>
                      <input name="hireDate" type="date" required className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>Role</label>
                      <select name="role" className={inputCls}>
                        {BUILTIN_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                        {customRoles.map((r) => (
                          <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>
                        ))}
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
                        {sites.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={labelCls}>Department</label>
                      <select name="departmentId" required className={inputCls}>
                        {filteredDepts.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={labelCls}>Supervisor</label>
                      <select name="supervisorId" className={inputCls}>
                        <option value="">— None —</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>{emp.user.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={labelCls}>Job Title</label>
                      <input name="jobTitle" className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>Badge ID (WMS)</label>
                      <input name="wmsId" placeholder="QR code badge ID" className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>ADP Worker ID</label>
                      <input name="adpWorkerId" placeholder="ADP Workforce Now ID" className={inputCls} />
                    </div>
                  </div>
                </div>

                {/* ── Personal ──────────────────────────────────────────── */}
                <div className={activeTab !== "personal" ? "hidden" : ""}>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Gender</label>
                      <input name="gender" className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>Marital Status</label>
                      <select name="maritalStatus" className={inputCls}>
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
                      <input name="phone" type="tel" className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>Phone 2</label>
                      <input name="phone2" type="tel" className={inputCls} />
                    </div>

                    <p className="col-span-full -mb-1 border-b border-zinc-200 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-700">
                      Emergency Contact
                    </p>

                    <div>
                      <label className={labelCls}>Contact Name</label>
                      <input name="emergencyContact" className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>Contact Phone</label>
                      <input name="emergencyPhone" type="tel" className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>Relationship</label>
                      <input name="emergencyRelationship" placeholder="e.g. Spouse" className={inputCls} />
                    </div>

                    <p className="col-span-full -mb-1 border-b border-zinc-200 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-700">
                      Address
                    </p>

                    <div className="col-span-full">
                      <label className={labelCls}>Address Line 1</label>
                      <input name="address1" className={inputCls} />
                    </div>

                    <div className="col-span-full">
                      <label className={labelCls}>Address Line 2</label>
                      <input name="address2" className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>City</label>
                      <input name="city" className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>State / Province</label>
                      <input name="state" className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>Zip Code</label>
                      <input name="zipCode" className={inputCls} />
                    </div>

                    <div>
                      <label className={labelCls}>Country</label>
                      <input name="country" className={inputCls} />
                    </div>
                  </div>
                </div>

                {/* ── Pay ───────────────────────────────────────────────── */}
                <div className={activeTab !== "pay" ? "hidden" : ""}>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Rule Set</label>
                      <select name="ruleSetId" required className={inputCls}>
                        {ruleSets.map((rs) => (
                          <option key={rs.id} value={rs.id}>{rs.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={labelCls}>Shift</label>
                      <select name="shiftId" className={inputCls}>
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
                      <select name="holidayRuleId" className={inputCls}>
                        <option value="">— None —</option>
                        {holidayRules.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={labelCls}>Pay Category</label>
                      <select name="payCategoryId" className={inputCls}>
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
                      <select name="payTypeId" className={inputCls}>
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
                        <option value="">— Not set —</option>
                        <option value="HOURLY">Hourly</option>
                        <option value="SALARY">Salary</option>
                      </select>
                    </div>

                    <div>
                      <label className={labelCls}>
                        Pay Rate{" "}
                        <span className="font-normal text-zinc-400">
                          {payType === "HOURLY" ? "($/hr)" : payType === "SALARY" ? "($/yr)" : ""}
                        </span>
                      </label>
                      <input
                        name="payRate"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        className={inputCls}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex gap-3 border-t border-zinc-200 px-6 py-4 dark:border-zinc-700">
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {isPending ? "Creating…" : "Create Employee"}
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
