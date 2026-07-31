"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createReasonCode, updateReasonCode, deleteReasonCode } from "@/actions/reason-code.actions";

type ReasonCodeItem = { id: string; code: string; label: string; color: string | null; isActive: boolean };
interface Props { reasonCodes: ReasonCodeItem[] }

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

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

function ColorPicker({ name, defaultValue }: { name: string; defaultValue?: string | null }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const hasColor = value && value !== "";
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex items-center">
        <input type="color" value={hasColor ? value : "#6366f1"} onChange={(e) => setValue(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-zinc-300 bg-white p-0.5 dark:border-zinc-600 dark:bg-zinc-800" title="Pick a color" />
        <input type="hidden" name={name} value={hasColor ? value : ""} />
      </div>
      {hasColor ? (
        <button type="button" onClick={() => setValue("")} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">Clear</button>
      ) : (
        <button type="button" onClick={() => setValue("#6366f1")} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">Set color</button>
      )}
      {hasColor && <span className="inline-block h-4 w-4 rounded-full border border-zinc-200 dark:border-zinc-700" style={{ backgroundColor: value }} />}
    </div>
  );
}

function ReasonCodeFields({ rc }: { rc?: ReasonCodeItem }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Code</label>
        <input name="code" required defaultValue={rc?.code ?? ""} placeholder="e.g. LATE" className={inputCls} style={{ textTransform: "uppercase" }} />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs text-zinc-500">Label</label>
        <input name="label" required defaultValue={rc?.label ?? ""} placeholder="e.g. Late Arrival" className={inputCls} />
      </div>
      <div className="col-span-2 sm:col-span-2">
        <label className="mb-1 block text-xs text-zinc-500">Highlight Color</label>
        <ColorPicker name="color" defaultValue={rc?.color} />
      </div>
    </div>
  );
}

export function ReasonCodesManager({ reasonCodes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingRc, setEditingRc] = useState<ReasonCodeItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const visible = reasonCodes.filter((rc) => showInactive || rc.isActive);

  function openEdit(rc: ReasonCodeItem) { setEditingRc(rc); setConfirmDeleteId(null); setError(null); }
  function closeEdit() { setEditingRc(null); setConfirmDeleteId(null); setError(null); }
  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createReasonCode({ code: fd.get("code") as string, label: fd.get("label") as string, color: (fd.get("color") as string) || null });
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(rc: ReasonCodeItem, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateReasonCode({
        reasonCodeId: rc.id,
        code: fd.get("code") as string,
        label: fd.get("label") as string,
        color: (fd.get("color") as string) || null,
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError(result.error); return; }
      closeEdit();
      router.refresh();
    });
  }

  function handleDelete(reasonCodeId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteReasonCode({ reasonCodeId });
      if (!result.success) { setError(result.error); setConfirmDeleteId(null); return; }
      setConfirmDeleteId(null);
      closeEdit();
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-500">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
          Show inactive
        </label>
      </div>

      <div className="flex flex-col gap-2">
        {visible.length === 0 && <p className="text-sm text-zinc-400">No reason codes yet. Add one below.</p>}
        {visible.map((rc) => (
          <button
            key={rc.id}
            type="button"
            onClick={() => openEdit(rc)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {rc.color ? (
                  <span className="w-20 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-mono font-semibold"
                    style={{ backgroundColor: rc.color + "33", color: rc.color, border: `1px solid ${rc.color}66` }}>
                    {rc.code}
                  </span>
                ) : (
                  <span className="w-20 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-center text-xs font-mono font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {rc.code}
                  </span>
                )}
                <span className={`font-medium ${rc.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>{rc.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${rc.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                  {rc.isActive ? "Active" : "Inactive"}
                </span>
                <span className="text-xs text-zinc-400">Click to edit →</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <button onClick={openCreate} className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600">
        + Add Reason Code
      </button>

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Reason Code" onClose={closeCreate}>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
          <form onSubmit={handleCreate}>
            <ReasonCodeFields />
            <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create"}</button>
              <button type="button" onClick={closeCreate} className={cancelBtnCls}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editingRc && (
        <Modal title={`Edit: ${editingRc.code} — ${editingRc.label}`} onClose={closeEdit}>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
          <form onSubmit={(e) => handleUpdate(editingRc, e)}>
            <ReasonCodeFields rc={editingRc} />
            <div className="mt-3">
              <label className="mb-1 block text-xs text-zinc-500">Status</label>
              <select name="isActive" defaultValue={editingRc.isActive ? "true" : "false"} className={`${inputCls} max-w-[160px]`}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <div className="flex gap-2">
                <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Saving…" : "Save changes"}</button>
                <button type="button" onClick={closeEdit} className={cancelBtnCls}>Cancel</button>
              </div>
              {confirmDeleteId === editingRc.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">Are you sure?</span>
                  <button type="button" onClick={() => handleDelete(editingRc.id)} disabled={isPending} className={dangerBtnCls}>
                    {isPending ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDeleteId(editingRc.id)} className="text-xs text-red-500 hover:underline dark:text-red-400">
                  Delete code
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
