"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { updateEmployee } from "@/actions/admin.actions";
import type { Site, Department, RuleSet, Employee, User } from "@prisma/client";

type EmployeeWithRelations = Employee & {
  user: User;
  site: Site;
  department: Department;
  ruleSet: RuleSet;
  supervisor: (Employee & { user: User }) | null;
};

interface Props {
  employee: EmployeeWithRelations;
  sites: Site[];
  departments: (Department & { site: Site })[];
  ruleSets: RuleSet[];
  employees: (Employee & { user: User })[];
}

const ROLES = [
  { value: "EMPLOYEE", label: "Employee" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "PAYROLL_ADMIN", label: "Payroll Admin" },
  { value: "HR_ADMIN", label: "HR Admin" },
  { value: "SYSTEM_ADMIN", label: "System Admin" },
];

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const labelCls = "mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

type Tab = "general" | "personal" | "pay";

export function EditEmployeeForm({ employee, sites, departments, ruleSets, employees }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [selectedSiteId, setSelectedSiteId] = useState(employee.siteId);
  const [isActive, setIsActive] = useState(employee.isActive);
  const [payType, setPayType] = useState<string>(employee.payType ?? "HOURLY");

  const filteredDepts = departments.filter((d) => d.siteId === selectedSiteId);

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
      role: fd.get("role") as string,
      siteId: fd.get("siteId") as string,
      departmentId: fd.get("departmentId") as string,
      ruleSetId: fd.get("ruleSetId") as string,
      supervisorId: (fd.get("supervisorId") as string) || null,
      isActive: fd.get("isActive") === "true",
      wmsId: fd.get("wmsId") as string,
      adpWorkerId: fd.get("adpWorkerId") as string,
      jobTitle: fd.get("jobTitle") as string,
      terminationReason: fd.get("terminationReason") as string,
    });
  }

  function handlePersonal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    save({
      ssn: fd.get("ssn") as string,
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
      payType: fd.get("payType") as string,
      payRate: rateStr ? parseFloat(rateStr) : null,
    });
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "personal", label: "Personal" },
    { id: "pay", label: "Pay" },
  ];

  return (
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
              <label className={labelCls}>Role</label>
              <select name="role" defaultValue={employee.role} className={inputCls}>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
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
              <label className={labelCls}>Rule Set</label>
              <select name="ruleSetId" defaultValue={employee.ruleSetId} className={inputCls}>
                {ruleSets.map((rs) => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
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
              <input name="jobTitle" defaultValue={employee.jobTitle ?? ""} className={inputCls} />
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
              <label className={labelCls}>Badge ID (WMS)</label>
              <input name="wmsId" defaultValue={employee.wmsId ?? ""} placeholder="QR code badge ID" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>ADP Worker ID</label>
              <input name="adpWorkerId" defaultValue={employee.adpWorkerId ?? ""} placeholder="ADP Workforce Now ID" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Status</label>
              <select
                name="isActive"
                value={isActive ? "true" : "false"}
                onChange={(e) => setIsActive(e.target.value === "true")}
                className={inputCls}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>

            {!isActive && (
              <div>
                <label className={labelCls}>Termination Reason</label>
                <input name="terminationReason" defaultValue={employee.terminationReason ?? ""} className={inputCls} />
              </div>
            )}
          </div>

          <div>
            <button type="submit" disabled={isPending} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
              {isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      )}

      {/* ── Personal tab ────────────────────────────────────────────────── */}
      {activeTab === "personal" && (
        <form onSubmit={handlePersonal} className="mt-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Social Security Number</label>
              <input name="ssn" type="password" defaultValue={employee.ssn ?? ""} placeholder="XXX-XX-XXXX" autoComplete="off" className={inputCls} />
            </div>

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
        <form onSubmit={handlePay} className="mt-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Pay Type</label>
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
      )}
    </div>
  );
}
