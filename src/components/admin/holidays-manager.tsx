"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { createHoliday, updateHoliday, deleteHoliday } from "@/actions/holiday.actions";
import type { Holiday } from "@prisma/client";

interface Props {
  holidays: Holiday[];
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800/40 dark:text-red-400";

function toDateInputValue(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "yyyy-MM-dd");
}

export function HolidaysManager({ holidays }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const [yearFilter, setYearFilter] = useState(String(currentYear));

  const years = [...new Set(holidays.map((h) => new Date(h.date).getUTCFullYear()))].sort(
    (a, b) => b - a
  );
  if (!years.includes(currentYear)) years.unshift(currentYear);

  const visible = holidays
    .filter((h) => showInactive || h.isActive)
    .filter((h) => !yearFilter || new Date(h.date).getUTCFullYear() === Number(yearFilter));

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createHoliday({
        name: fd.get("name") as string,
        date: fd.get("date") as string,
        observedDate: (fd.get("observedDate") as string) || null,
      });
      if (!result.success) { setError(result.error); return; }
      setShowCreate(false);
      router.refresh();
    });
  }

  function handleUpdate(holidayId: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateHoliday({
        holidayId,
        name: fd.get("name") as string,
        date: fd.get("date") as string,
        observedDate: (fd.get("observedDate") as string) || null,
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError(result.error); return; }
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(holidayId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteHoliday({ holidayId });
      if (!result.success) { setError(result.error); return; }
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          <option value="">All Years</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>{y}</option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-500">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show inactive
        </label>
      </div>

      {/* List */}
      <div className="flex flex-col gap-2">
        {visible.length === 0 && (
          <p className="text-sm text-zinc-400">No holidays for this period. Add one below.</p>
        )}
        {visible.map((h) =>
          editingId === h.id ? (
            <form
              key={h.id}
              onSubmit={(e) => handleUpdate(h.id, e)}
              className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-800/40 dark:bg-blue-900/10"
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-zinc-500">Holiday Name</label>
                  <input name="name" required defaultValue={h.name} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Date</label>
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={toDateInputValue(h.date)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Observed On</label>
                  <input
                    name="observedDate"
                    type="date"
                    defaultValue={h.observedDate ? toDateInputValue(h.observedDate) : ""}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Status</label>
                  <select name="isActive" defaultValue={h.isActive ? "true" : "false"} className={inputCls}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button type="submit" disabled={isPending} className={saveBtnCls}>
                  {isPending ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => setEditingId(null)} className={cancelBtnCls}>
                  Cancel
                </button>
              </div>
            </form>
          ) : confirmDeleteId === h.id ? (
            <div
              key={h.id}
              className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50/40 px-4 py-3 dark:border-red-800/40 dark:bg-red-900/10"
            >
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Delete <span className="font-semibold">{h.name}</span>?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleDelete(h.id)}
                  disabled={isPending}
                  className={dangerBtnCls}
                >
                  {isPending ? "Deleting…" : "Delete"}
                </button>
                <button onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              key={h.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-3">
                <span className="w-24 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-center text-xs font-mono font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {format(new Date(h.date), "MMM d, yyyy")}
                </span>
                <span className="font-medium text-zinc-900 dark:text-white">{h.name}</span>
                {h.observedDate && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    Observed {format(new Date(h.observedDate), "MMM d")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    h.isActive
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                  }`}
                >
                  {h.isActive ? "Active" : "Inactive"}
                </span>
                <button
                  onClick={() => setEditingId(h.id)}
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmDeleteId(h.id)}
                  className="text-xs text-red-500 hover:underline dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {/* Create form */}
      {showCreate ? (
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">New Holiday</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-zinc-500">Holiday Name</label>
              <input name="name" required placeholder="e.g. Christmas Day" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Date</label>
              <input name="date" type="date" required className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Observed On</label>
              <input name="observedDate" type="date" className={inputCls} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={isPending} className={saveBtnCls}>
              {isPending ? "Creating…" : "Create"}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className={cancelBtnCls}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
        >
          + Add Holiday
        </button>
      )}
    </div>
  );
}
