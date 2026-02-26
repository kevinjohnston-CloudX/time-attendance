"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEmployee } from "@/actions/admin.actions";
import type { Site, Department, RuleSet, Employee, User } from "@prisma/client";

type EmployeeWithUser = Employee & { user: User };

interface Props {
  sites: Site[];
  departments: (Department & { site: Site })[];
  ruleSets: RuleSet[];
  employees: EmployeeWithUser[];
}

const ROLES = [
  { value: "EMPLOYEE", label: "Employee" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "PAYROLL_ADMIN", label: "Payroll Admin" },
  { value: "HR_ADMIN", label: "HR Admin" },
  { value: "SYSTEM_ADMIN", label: "System Admin" },
] as const;

export function CreateEmployeeForm({ sites, departments, ruleSets, employees }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [selectedSiteId, setSelectedSiteId] = useState(sites[0]?.id ?? "");
  const filteredDepts = departments.filter((d) => d.siteId === selectedSiteId);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await createEmployee({
        name: fd.get("name") as string,
        email: fd.get("email") as string,
        username: fd.get("username") as string,
        password: fd.get("password") as string,
        employeeCode: fd.get("employeeCode") as string,
        role: fd.get("role") as "EMPLOYEE",
        siteId: fd.get("siteId") as string,
        departmentId: fd.get("departmentId") as string,
        ruleSetId: fd.get("ruleSetId") as string,
        hireDate: fd.get("hireDate") as string,
        supervisorId: fd.get("supervisorId") as string,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        + Add Employee
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">New Employee</h3>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Field label="Full Name" name="name" required />
        <Field label="Employee Code" name="employeeCode" required />
        <Field label="Username" name="username" required />
        <Field label="Initial Password" name="password" type="password" required />
        <Field label="Email (optional)" name="email" type="email" />
        <Field label="Hire Date" name="hireDate" type="date" required />

        <SelectField label="Role" name="role">
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </SelectField>

        <SelectField
          label="Site"
          name="siteId"
          value={selectedSiteId}
          onChange={(v) => setSelectedSiteId(v)}
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

        <SelectField label="Rule Set" name="ruleSetId" required>
          {ruleSets.map((rs) => (
            <option key={rs.id} value={rs.id}>{rs.name}</option>
          ))}
        </SelectField>

        <SelectField label="Supervisor (optional)" name="supervisorId">
          <option value="">— None —</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.user.name}</option>
          ))}
        </SelectField>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {isPending ? "Creating…" : "Create Employee"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </label>
      <input
        name={name}
        type={type}
        required={required}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
      />
    </div>
  );
}

function SelectField({
  label,
  name,
  required,
  children,
  value,
  onChange,
}: {
  label: string;
  name: string;
  required?: boolean;
  children: React.ReactNode;
  value?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </label>
      <select
        name={name}
        required={required}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
      >
        {children}
      </select>
    </div>
  );
}
