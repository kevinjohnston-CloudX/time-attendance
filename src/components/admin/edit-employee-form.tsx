"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
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

export function EditEmployeeForm({
  employee,
  sites,
  departments,
  ruleSets,
  employees,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState(employee.siteId);

  const filteredDepts = departments.filter((d) => d.siteId === selectedSiteId);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await updateEmployee({
        employeeId: employee.id,
        name: fd.get("name") as string,
        role: fd.get("role") as "EMPLOYEE",
        siteId: fd.get("siteId") as string,
        departmentId: fd.get("departmentId") as string,
        ruleSetId: fd.get("ruleSetId") as string,
        supervisorId: (fd.get("supervisorId") as string) || null,
        isActive: fd.get("isActive") === "true",
      });

      if (!result.success) {
        setError(result.error);
      } else {
        setSuccess(true);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          Saved successfully.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Full Name
          </label>
          <input
            name="name"
            defaultValue={employee.user.name ?? ""}
            required
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Role
          </label>
          <select
            name="role"
            defaultValue={employee.role}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Site
          </label>
          <select
            name="siteId"
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Department
          </label>
          <select
            name="departmentId"
            defaultValue={employee.departmentId}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            {filteredDepts.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Rule Set
          </label>
          <select
            name="ruleSetId"
            defaultValue={employee.ruleSetId}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            {ruleSets.map((rs) => (
              <option key={rs.id} value={rs.id}>{rs.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Supervisor
          </label>
          <select
            name="supervisorId"
            defaultValue={employee.supervisorId ?? ""}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            <option value="">— None —</option>
            {employees
              .filter((e) => e.id !== employee.id)
              .map((e) => (
                <option key={e.id} value={e.id}>{e.user.name}</option>
              ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Status
          </label>
          <select
            name="isActive"
            defaultValue={employee.isActive ? "true" : "false"}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      </div>

      <div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {isPending ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
