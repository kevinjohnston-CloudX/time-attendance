"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDepartment, updateDepartment } from "@/actions/admin.actions";
import type { Site, Department } from "@prisma/client";

type DepartmentWithSite = Department & { site: Site };

interface Props {
  departments: DepartmentWithSite[];
  sites: Site[];
}

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";

export function DepartmentsManager({ departments, sites }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createDepartment({
        name: fd.get("name") as string,
        siteId: fd.get("siteId") as string,
      });
      if (!result.success) { setError(result.error); return; }
      setShowCreate(false);
      router.refresh();
    });
  }

  function handleUpdate(deptId: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateDepartment({
        departmentId: deptId,
        name: fd.get("name") as string,
        siteId: fd.get("siteId") as string,
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
              <div className="grid grid-cols-3 gap-3">
                <input name="name" defaultValue={dept.name} required placeholder="Name" className={inputCls} />
                <select name="siteId" defaultValue={dept.siteId} className={inputCls}>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select name="isActive" defaultValue={dept.isActive ? "true" : "false"} className={inputCls}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
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
                <span className="ml-3 text-xs text-zinc-400">{dept.site.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-xs ${dept.isActive ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-500"}`}>
                  {dept.isActive ? "Active" : "Inactive"}
                </span>
                <button onClick={() => setEditingId(dept.id)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">Edit</button>
              </div>
            </div>
          )
        )}
      </div>
      {showCreate ? (
        <form onSubmit={handleCreate} className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">New Department</p>
          <div className="grid grid-cols-2 gap-3">
            <input name="name" required placeholder="Name" className={inputCls} />
            <select name="siteId" required className={inputCls}>
              <option value="">— Select Site —</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create"}</button>
            <button type="button" onClick={() => setShowCreate(false)} className={cancelBtnCls}>Cancel</button>
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
