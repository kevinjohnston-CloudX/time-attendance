"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createShift, updateShift, deleteShift } from "@/actions/shift.actions";
import type { Shift } from "@prisma/client";

interface Props {
  shifts: Shift[];
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function ShiftFields({ shift }: { shift?: Shift }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Shift Name</label>
        <input
          name="name"
          required
          defaultValue={shift?.name ?? ""}
          placeholder="e.g. Morning Shift"
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Start Time</label>
        <input
          name="startTime"
          type="time"
          required
          defaultValue={shift?.startTime ?? ""}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">End Time</label>
        <input
          name="endTime"
          type="time"
          required
          defaultValue={shift?.endTime ?? ""}
          className={inputCls}
        />
      </div>
    </div>
  );
}

export function ShiftsManager({ shifts }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const visible = showInactive ? shifts : shifts.filter((s) => s.isActive);

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createShift({
        name: fd.get("name") as string,
        startTime: fd.get("startTime") as string,
        endTime: fd.get("endTime") as string,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setShowCreate(false);
      router.refresh();
    });
  }

  function handleUpdate(shift: Shift, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateShift({
        shiftId: shift.id,
        name: fd.get("name") as string,
        startTime: fd.get("startTime") as string,
        endTime: fd.get("endTime") as string,
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(shiftId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteShift({ shiftId });
      if (!result.success) {
        setError(result.error);
        return;
      }
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

      <div className="mb-3 flex items-center gap-3">
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

      <div className="flex flex-col gap-2">
        {visible.length === 0 && (
          <p className="text-sm text-zinc-400">No shifts yet. Add one below.</p>
        )}

        {visible.map((shift) => {
          if (confirmDeleteId === shift.id) {
            return (
              <div
                key={shift.id}
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/40 dark:bg-red-900/10"
              >
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  Delete <span className="font-semibold">{shift.name}</span>? This cannot be undone.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleDelete(shift.id)}
                    disabled={isPending}
                    className={dangerBtnCls}
                  >
                    {isPending ? "Deleting…" : "Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className={cancelBtnCls}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          }

          if (editingId === shift.id) {
            return (
              <form
                key={shift.id}
                onSubmit={(e) => handleUpdate(shift, e)}
                className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-800/40 dark:bg-blue-900/10"
              >
                <ShiftFields shift={shift} />
                <div className="mt-3 grid grid-cols-4 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Status</label>
                    <select
                      name="isActive"
                      defaultValue={shift.isActive ? "true" : "false"}
                      className={inputCls}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="submit" disabled={isPending} className={saveBtnCls}>
                    {isPending ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className={cancelBtnCls}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            );
          }

          return (
            <div
              key={shift.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-4">
                <p className="font-medium text-zinc-900 dark:text-white">{shift.name}</p>
                <p className="text-sm text-zinc-500">
                  {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    shift.isActive
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                  }`}
                >
                  {shift.isActive ? "Active" : "Inactive"}
                </span>
                <button
                  onClick={() => {
                    setEditingId(shift.id);
                    setConfirmDeleteId(null);
                  }}
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    setConfirmDeleteId(shift.id);
                    setEditingId(null);
                  }}
                  className="text-xs text-red-500 hover:underline dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showCreate ? (
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">New Shift</p>
          <ShiftFields />
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={isPending} className={saveBtnCls}>
              {isPending ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className={cancelBtnCls}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
        >
          + Add Shift
        </button>
      )}
    </div>
  );
}
