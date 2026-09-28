"use client";

import Link from "next/link";
import type { Site, Department } from "@prisma/client";

type DepartmentWithSites = Department & { sites: { site: Site }[] };

interface Props {
  departments: DepartmentWithSites[];
  sites: Site[];
}

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

export function SiteCheckboxes({
  sites,
  selected,
  onChange,
}: {
  sites: Site[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }
  return (
    <div className="flex flex-wrap gap-2">
      {sites.map((s) => {
        const checked = selected.includes(s.id);
        return (
          <label
            key={s.id}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              checked
                ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-900/20 dark:text-blue-300"
                : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            <input type="checkbox" className="h-3.5 w-3.5 accent-blue-600" checked={checked} onChange={() => toggle(s.id)} />
            {s.name}
          </label>
        );
      })}
    </div>
  );
}

export function DepartmentFields({
  sites,
  selectedSiteIds,
  onSiteIdsChange,
  initial,
  mode = "create",
}: {
  sites: Site[];
  selectedSiteIds: string[];
  onSiteIdsChange: (ids: string[]) => void;
  initial?: { name: string; isActive: boolean };
  mode?: "create" | "edit";
}) {
  return (
    <div className="flex flex-col gap-3">
      {mode === "edit" ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Name</label>
            <input name="name" required defaultValue={initial?.name ?? ""} placeholder="Name" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Status</label>
            <select name="isActive" defaultValue={initial?.isActive ? "true" : "false"} className={inputCls}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </div>
      ) : (
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Name</label>
          <input name="name" required defaultValue="" placeholder="e.g. Operations" className={inputCls} />
        </div>
      )}
      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Sites</p>
        <SiteCheckboxes sites={sites} selected={selectedSiteIds} onChange={onSiteIdsChange} />
      </div>
    </div>
  );
}

export function DepartmentsManager({ departments, sites }: Props) {
  return (
    <div className="mt-6">
      <div className="flex flex-col gap-2">
        {departments.map((dept) => (
          <Link
            key={dept.id}
            href={`/admin/site-settings/departments/${dept.id}`}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`font-medium ${dept.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                  {dept.name}
                </span>
                <span className="text-xs text-zinc-400">
                  {dept.sites.length === 0 ? "No sites" : dept.sites.map((ds) => ds.site.name).join(", ")}
                </span>
                {!dept.isActive && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">Inactive</span>
                )}
              </div>
              <span className="text-xs text-zinc-400">→</span>
            </div>
          </Link>
        ))}
      </div>

      <Link
        href="/admin/site-settings/departments/new"
        className="mt-4 inline-block rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:hover:border-zinc-400"
      >
        + Add Department
      </Link>
    </div>
  );
}
