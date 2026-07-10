"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDepartment, updateDepartment } from "@/actions/admin.actions";
import type { Site, Department } from "@prisma/client";

type DepartmentWithSites = Department & { sites: { site: Site }[] };

interface Props {
  departments: DepartmentWithSites[];
  sites: Site[];
}

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";

function SiteCheckboxes({
  sites,
  selected,
  onChange,
}: {
  sites: Site[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
    );
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
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-blue-600"
              checked={checked}
              onChange={() => toggle(s.id)}
            />
            {s.name}
          </label>
        );
      })}
    </div>
  );
}

export function DepartmentsManager({ departments, sites }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSiteIds, setEditSiteIds] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createSiteIds, setCreateSiteIds] = useState<string[]>([]);

  function startEdit(dept: DepartmentWithSites) {
    setEditingId(dept.id);
    setEditSiteIds(dept.sites.map((ds) => ds.site.id));
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (createSiteIds.length === 0) { setError("Select at least one site."); return; }
    setError(null);
    startTransition(async () => {
      const result = await createDepartment({
        name: fd.get("name") as string,
        siteIds: createSiteIds,
      });
      if (!result.success) { setError(result.error); return; }
      setShowCreate(false);
      setCreateSiteIds([]);
      router.refresh();
    });
  }

  function handleUpdate(deptId: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (editSiteIds.length === 0) { setError("Select at least one site."); return; }
    setError(null);
    startTransition(async () => {
      const result = await updateDepartment({
        departmentId: deptId,
        name: fd.get("name") as string,
        siteIds: editSiteIds,
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError(result.error); return; }
      setEditingId(null);
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
      )}
      <div className="flex flex-col gap-2">
        {departments.map((dept) =>
          editingId === dept.id ? (
            <form key={dept.id} onSubmit={(e) => handleUpdate(dept.id, e)}
              className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-800/40 dark:bg-blue-900/10">
              <div className="grid grid-cols-2 gap-3">
                <input name="name" defaultValue={dept.name} required placeholder="Name" className={inputCls} />
                <select name="isActive" defaultValue={dept.isActive ? "true" : "false"} className={inputCls}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Sites</p>
                <SiteCheckboxes sites={sites} selected={editSiteIds} onChange={setEditSiteIds} />
              </div>
              <div className="mt-3 flex gap-2">
                <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Saving…" : "Save"}</button>
                <button type="button" onClick={() => setEditingId(null)} className={cancelBtnCls}>Cancel</button>
              </div>
            </form>
          ) : (
            <div key={dept.id} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <span className="font-medium text-zinc-900 dark:text-white">{dept.name}</span>
                <span className="ml-3 text-xs text-zinc-400">
                  {dept.sites.length === 0
                    ? "No sites"
                    : dept.sites.map((ds) => ds.site.name).join(", ")}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-xs ${dept.isActive ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-500"}`}>
                  {dept.isActive ? "Active" : "Inactive"}
                </span>
                <button onClick={() => startEdit(dept)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">Edit</button>
              </div>
            </div>
          )
        )}
      </div>
      {showCreate ? (
        <form onSubmit={handleCreate} className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">New Department</p>
          <input name="name" required placeholder="Name" className={`${inputCls} mb-3`} />
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Sites</p>
            <SiteCheckboxes sites={sites} selected={createSiteIds} onChange={setCreateSiteIds} />
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create"}</button>
            <button type="button" onClick={() => { setShowCreate(false); setCreateSiteIds([]); }} className={cancelBtnCls}>Cancel</button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowCreate(true)} className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600">
          + Add Department
        </button>
      )}
    </div>
  );
}
