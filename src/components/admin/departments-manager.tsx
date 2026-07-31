"use client";

import { useState, useTransition, useEffect } from "react";
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

function SiteCheckboxes({ sites, selected, onChange }: { sites: Site[]; selected: string[]; onChange: (ids: string[]) => void }) {
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

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Main manager ─────────────────────────────────────────────────────────────

export function DepartmentsManager({ departments, sites }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [editingDept, setEditingDept] = useState<DepartmentWithSites | null>(null);
  const [editSiteIds, setEditSiteIds] = useState<string[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [createSiteIds, setCreateSiteIds] = useState<string[]>([]);

  function openEdit(dept: DepartmentWithSites) {
    setEditingDept(dept);
    setEditSiteIds(dept.sites.map((ds) => ds.site.id));
    setError(null);
  }

  function closeEdit() {
    setEditingDept(null);
    setEditSiteIds([]);
    setError(null);
  }

  function openCreate() {
    setShowCreate(true);
    setCreateSiteIds([]);
    setError(null);
  }

  function closeCreate() {
    setShowCreate(false);
    setCreateSiteIds([]);
    setError(null);
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (createSiteIds.length === 0) { setError("Select at least one site."); return; }
    setError(null);
    startTransition(async () => {
      const result = await createDepartment({ name: fd.get("name") as string, siteIds: createSiteIds });
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(dept: DepartmentWithSites, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (editSiteIds.length === 0) { setError("Select at least one site."); return; }
    setError(null);
    startTransition(async () => {
      const result = await updateDepartment({
        departmentId: dept.id,
        name: fd.get("name") as string,
        siteIds: editSiteIds,
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError(result.error); return; }
      closeEdit();
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-2">
        {departments.map((dept) => (
          <button
            key={dept.id}
            type="button"
            onClick={() => openEdit(dept)}
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
              <span className="text-xs text-zinc-400">Click to edit →</span>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={openCreate}
        className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
      >
        + Add Department
      </button>

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Department" onClose={closeCreate}>
          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
          )}
          <form onSubmit={handleCreate}>
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Name</label>
                <input name="name" required placeholder="e.g. Operations" className={inputCls} />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Sites</p>
                <SiteCheckboxes sites={sites} selected={createSiteIds} onChange={setCreateSiteIds} />
              </div>
            </div>
            <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create"}</button>
              <button type="button" onClick={closeCreate} className={cancelBtnCls}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editingDept && (
        <Modal title={`Edit: ${editingDept.name}`} onClose={closeEdit}>
          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
          )}
          <form onSubmit={(e) => handleUpdate(editingDept, e)}>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Name</label>
                  <input name="name" defaultValue={editingDept.name} required placeholder="Name" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Status</label>
                  <select name="isActive" defaultValue={editingDept.isActive ? "true" : "false"} className={inputCls}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Sites</p>
                <SiteCheckboxes sites={sites} selected={editSiteIds} onChange={setEditSiteIds} />
              </div>
            </div>
            <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Saving…" : "Save changes"}</button>
              <button type="button" onClick={closeEdit} className={cancelBtnCls}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
