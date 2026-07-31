"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createShift, updateShift, deleteShift } from "@/actions/shift.actions";
import type { Shift } from "@prisma/client";

interface Props { shifts: Shift[] }

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

const DAYS = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function formatWorkDays(workDays: number[]): string {
  if (workDays.length === 0) return "No days";
  if (workDays.length === 7) return "Every day";
  const sorted = [...workDays].sort((a, b) => a - b);
  if (sorted.length === 5 && sorted[0] === 1 && sorted[4] === 5) return "Mon – Fri";
  if (sorted.length === 6 && sorted[0] === 1 && sorted[5] === 6) return "Mon – Sat";
  return sorted.map((d) => DAYS[d].label).join(", ");
}

function DayPicker({ defaultDays }: { defaultDays: number[] }) {
  const [selected, setSelected] = useState<number[]>(defaultDays);
  function toggle(day: number) {
    setSelected((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  }
  return (
    <div>
      <label className="mb-1.5 block text-xs text-zinc-500">Work Days</label>
      <div className="flex flex-wrap gap-1.5">
        {DAYS.map((day) => {
          const active = selected.includes(day.value);
          return (
            <button
              key={day.value}
              type="button"
              onClick={() => toggle(day.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-300"
              }`}
            >
              {day.label}
            </button>
          );
        })}
      </div>
      {selected.map((d) => (
        <input key={d} type="hidden" name="workDays" value={d} />
      ))}
    </div>
  );
}

function ShiftFields({ shift }: { shift?: Shift }) {
  const defaultDays = shift?.workDays && shift.workDays.length > 0 ? shift.workDays : [1, 2, 3, 4, 5];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Shift Name</label>
          <input name="name" required defaultValue={shift?.name ?? ""} placeholder="e.g. Morning Shift" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Start Time</label>
          <input name="startTime" type="time" required defaultValue={shift?.startTime ?? ""} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">End Time</label>
          <input name="endTime" type="time" required defaultValue={shift?.endTime ?? ""} className={inputCls} />
        </div>
      </div>
      <DayPicker defaultDays={defaultDays} />

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Punch Tolerance</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { name: "earlyInMinutes",  label: "Early In",  default: shift?.earlyInMinutes  ?? 0 },
            { name: "lateInMinutes",   label: "Late In",   default: shift?.lateInMinutes   ?? 0 },
            { name: "earlyOutMinutes", label: "Early Out", default: shift?.earlyOutMinutes ?? 0 },
            { name: "lateOutMinutes",  label: "Late Out",  default: shift?.lateOutMinutes  ?? 0 },
          ].map((f) => (
            <div key={f.name}>
              <label className="mb-1 block text-xs text-zinc-500">{f.label} (min)</label>
              <input name={f.name} type="number" min="0" max="120" defaultValue={f.default} className={inputCls} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Scheduled Meal Break</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Break Start</label>
            <input name="mealBreakStart" type="time" defaultValue={shift?.mealBreakStart ?? ""} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Break End</label>
            <input name="mealBreakEnd" type="time" defaultValue={shift?.mealBreakEnd ?? ""} className={inputCls} />
          </div>
        </div>
        <p className="mt-1 text-xs text-zinc-400">Leave blank if no scheduled break.</p>
      </div>
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
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Close"
          >
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

export function ShiftsManager({ shifts }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }

  const visible = showInactive ? shifts : shifts.filter((s) => s.isActive);

  function openEdit(shift: Shift) {
    setEditingShift(shift);
    setConfirmDeleteId(null);
    setError(null);
  }

  function closeModal() {
    setEditingShift(null);
    setConfirmDeleteId(null);
    setError(null);
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const workDays = fd.getAll("workDays").map(Number);
    setError(null);
    startTransition(async () => {
      const result = await createShift({
        name: fd.get("name") as string,
        startTime: fd.get("startTime") as string,
        endTime: fd.get("endTime") as string,
        workDays,
        earlyInMinutes:  Number(fd.get("earlyInMinutes")  ?? 0),
        lateInMinutes:   Number(fd.get("lateInMinutes")   ?? 0),
        earlyOutMinutes: Number(fd.get("earlyOutMinutes") ?? 0),
        lateOutMinutes:  Number(fd.get("lateOutMinutes")  ?? 0),
        mealBreakStart: (fd.get("mealBreakStart") as string) || "",
        mealBreakEnd:   (fd.get("mealBreakEnd")   as string) || "",
      });
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(shift: Shift, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const workDays = fd.getAll("workDays").map(Number);
    setError(null);
    startTransition(async () => {
      const result = await updateShift({
        shiftId: shift.id,
        name: fd.get("name") as string,
        startTime: fd.get("startTime") as string,
        endTime: fd.get("endTime") as string,
        workDays,
        earlyInMinutes:  Number(fd.get("earlyInMinutes")  ?? 0),
        lateInMinutes:   Number(fd.get("lateInMinutes")   ?? 0),
        earlyOutMinutes: Number(fd.get("earlyOutMinutes") ?? 0),
        lateOutMinutes:  Number(fd.get("lateOutMinutes")  ?? 0),
        mealBreakStart: (fd.get("mealBreakStart") as string) || "",
        mealBreakEnd:   (fd.get("mealBreakEnd")   as string) || "",
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError(result.error); return; }
      closeModal();
      router.refresh();
    });
  }

  function handleDelete(shiftId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteShift({ shiftId });
      if (!result.success) { setError(result.error); setConfirmDeleteId(null); return; }
      setConfirmDeleteId(null);
      closeModal();
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      {error && !editingShift && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mb-3 flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-500">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
          Show inactive
        </label>
      </div>

      <div className="flex flex-col gap-2">
        {visible.length === 0 && (
          <p className="text-sm text-zinc-400">No shifts yet. Add one below.</p>
        )}

        {visible.map((shift) => (
          <button
            key={shift.id}
            type="button"
            onClick={() => openEdit(shift)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <p className={`font-medium ${shift.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                  {shift.name}
                </p>
                <p className="text-sm text-zinc-500">
                  {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                </p>
                <p className="text-sm text-zinc-400">{formatWorkDays(shift.workDays)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    shift.isActive
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                  }`}
                >
                  {shift.isActive ? "Active" : "Inactive"}
                </span>
                <span className="text-xs text-zinc-400">Click to edit →</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={openCreate}
        className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
      >
        + Add Shift
      </button>

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Shift" onClose={closeCreate}>
          {error && !editingShift && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
          )}
          <form onSubmit={handleCreate}>
            <ShiftFields />
            <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create"}</button>
              <button type="button" onClick={closeCreate} className={cancelBtnCls}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editingShift && (
        <Modal title={`Edit: ${editingShift.name}`} onClose={closeModal}>
          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          )}
          <form onSubmit={(e) => handleUpdate(editingShift, e)}>
            <ShiftFields shift={editingShift} />
            <div className="mt-3 grid grid-cols-4 gap-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Status</label>
                <select name="isActive" defaultValue={editingShift.isActive ? "true" : "false"} className={inputCls}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <div className="flex gap-2">
                <button type="submit" disabled={isPending} className={saveBtnCls}>
                  {isPending ? "Saving…" : "Save changes"}
                </button>
                <button type="button" onClick={closeModal} className={cancelBtnCls}>
                  Cancel
                </button>
              </div>
              {confirmDeleteId === editingShift.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">Are you sure?</span>
                  <button type="button" onClick={() => handleDelete(editingShift.id)} disabled={isPending} className={dangerBtnCls}>
                    {isPending ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDeleteId(editingShift.id)} className="text-xs text-red-500 hover:underline dark:text-red-400">
                  Delete shift
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
