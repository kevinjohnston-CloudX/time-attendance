"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSite, updateSite } from "@/actions/admin.actions";
import type { Site } from "@prisma/client";

interface Props { sites: Site[] }

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function SitesManager({ sites }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function openEdit(site: Site) { setEditingSite(site); setError(null); }
  function closeEdit() { setEditingSite(null); setError(null); }
  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createSite({
        name: fd.get("name") as string,
        timezone: (fd.get("timezone") as string) || "America/New_York",
        address: (fd.get("address") as string) || undefined,
      });
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(site: Site, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateSite({
        siteId: site.id,
        name: fd.get("name") as string,
        timezone: (fd.get("timezone") as string) || "America/New_York",
        address: (fd.get("address") as string) || undefined,
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
        {sites.map((site) => (
          <div
            key={site.id}
            className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60 cursor-pointer"
            onClick={() => openEdit(site)}
          >
            <div className="flex items-center gap-3">
              <span className={`font-medium ${site.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                {site.name}
              </span>
              <span className="text-xs text-zinc-400">{site.timezone}</span>
              {site.address && <span className="text-xs text-zinc-400">{site.address}</span>}
              {!site.isActive && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">Inactive</span>
              )}
            </div>
            <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <Link href={`/admin/sites/${site.id}`} className="text-xs text-violet-600 hover:underline dark:text-violet-400">
                PTO Rules
              </Link>
              <span className="text-xs text-zinc-400">Click to edit →</span>
            </div>
          </div>
        ))}
      </div>

      <button onClick={openCreate} className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:hover:border-zinc-400">
        + Add Site
      </button>

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Site" onClose={closeCreate}>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
          <form onSubmit={handleCreate}>
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Name</label>
                <input name="name" required placeholder="e.g. Main Office" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Timezone</label>
                <input name="timezone" placeholder="e.g. America/New_York" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Address <span className="text-zinc-400">(optional)</span></label>
                <input name="address" placeholder="e.g. 123 Main St" className={inputCls} />
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
      {editingSite && (
        <Modal title={`Edit: ${editingSite.name}`} onClose={closeEdit}>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
          <form onSubmit={(e) => handleUpdate(editingSite, e)}>
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Name</label>
                <input name="name" defaultValue={editingSite.name} required className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Timezone</label>
                <input name="timezone" defaultValue={editingSite.timezone} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Address <span className="text-zinc-400">(optional)</span></label>
                <input name="address" defaultValue={editingSite.address ?? ""} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Status</label>
                <select name="isActive" defaultValue={editingSite.isActive ? "true" : "false"} className={inputCls}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
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
