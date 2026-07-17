"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createReasonCode, updateReasonCode, deleteReasonCode } from "@/actions/reason-code.actions";

type ReasonCodeItem = {
  id: string;
  code: string;
  label: string;
  color: string | null;
  isActive: boolean;
};

interface Props {
  reasonCodes: ReasonCodeItem[];
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800/40 dark:text-red-400";

function ColorPicker({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue?: string | null;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const hasColor = value && value !== "";

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex items-center">
        <input
          type="color"
          value={hasColor ? value : "#6366f1"}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-zinc-300 bg-white p-0.5 dark:border-zinc-600 dark:bg-zinc-800"
          title="Pick a color"
        />
        {/* Hidden text input carries the actual form value */}
        <input type="hidden" name={name} value={hasColor ? value : ""} />
      </div>
      {hasColor ? (
        <button
          type="button"
          onClick={() => setValue("")}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Clear
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setValue("#6366f1")}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Set color
        </button>
      )}
      {hasColor && (
        <span
          className="inline-block h-4 w-4 rounded-full border border-zinc-200 dark:border-zinc-700"
          style={{ backgroundColor: value }}
        />
      )}
    </div>
  );
}

export function ReasonCodesManager({ reasonCodes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const visible = reasonCodes.filter((rc) => showInactive || rc.isActive);

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const colorVal = fd.get("color") as string;
      const result = await createReasonCode({
        code: fd.get("code") as string,
        label: fd.get("label") as string,
        color: colorVal || null,
      });
      if (!result.success) { setError(result.error); return; }
      setShowCreate(false);
      router.refresh();
    });
  }

  function handleUpdate(reasonCodeId: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const colorVal = fd.get("color") as string;
      const result = await updateReasonCode({
        reasonCodeId,
        code: fd.get("code") as string,
        label: fd.get("label") as string,
        color: colorVal || null,
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError(result.error); return; }
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(reasonCodeId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteReasonCode({ reasonCodeId });
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

      {/* List */}
      <div className="flex flex-col gap-2">
        {visible.length === 0 && (
          <p className="text-sm text-zinc-400">No reason codes yet. Add one below.</p>
        )}
        {visible.map((rc) =>
          editingId === rc.id ? (
            <form
              key={rc.id}
              onSubmit={(e) => handleUpdate(rc.id, e)}
              className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-800/40 dark:bg-blue-900/10"
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Code</label>
                  <input
                    name="code"
                    required
                    defaultValue={rc.code}
                    className={inputCls}
                    style={{ textTransform: "uppercase" }}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-zinc-500">Label</label>
                  <input name="label" required defaultValue={rc.label} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Status</label>
                  <select name="isActive" defaultValue={rc.isActive ? "true" : "false"} className={inputCls}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-zinc-500">Highlight Color</label>
                  <ColorPicker name="color" defaultValue={rc.color} />
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
          ) : confirmDeleteId === rc.id ? (
            <div
              key={rc.id}
              className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50/40 px-4 py-3 dark:border-red-800/40 dark:bg-red-900/10"
            >
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Delete <span className="font-semibold">{rc.code} — {rc.label}</span>?
              </p>
              <div className="flex gap-2">
                <button onClick={() => handleDelete(rc.id)} disabled={isPending} className={dangerBtnCls}>
                  {isPending ? "Deleting…" : "Delete"}
                </button>
                <button onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>Cancel</button>
              </div>
            </div>
          ) : (
            <div
              key={rc.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-3">
                {rc.color ? (
                  <span
                    className="w-20 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-mono font-semibold"
                    style={{ backgroundColor: rc.color + "33", color: rc.color, border: `1px solid ${rc.color}66` }}
                  >
                    {rc.code}
                  </span>
                ) : (
                  <span className="w-20 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-center text-xs font-mono font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {rc.code}
                  </span>
                )}
                <span className="font-medium text-zinc-900 dark:text-white">{rc.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    rc.isActive
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                  }`}
                >
                  {rc.isActive ? "Active" : "Inactive"}
                </span>
                <button
                  onClick={() => setEditingId(rc.id)}
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmDeleteId(rc.id)}
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
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">New Reason Code</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Code</label>
              <input
                name="code"
                required
                placeholder="e.g. LATE"
                className={inputCls}
                style={{ textTransform: "uppercase" }}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-zinc-500">Label</label>
              <input name="label" required placeholder="e.g. Late Arrival" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-zinc-500">Highlight Color</label>
              <ColorPicker name="color" />
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
          + Add Reason Code
        </button>
      )}
    </div>
  );
}
