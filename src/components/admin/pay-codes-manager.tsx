"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { createPayCode, updatePayCode, reorderPayCodes } from "@/actions/pay-code.actions";
import type { PayCode } from "@prisma/client";

interface Props {
  payCodes: PayCode[];
}

const PAY_BUCKETS = [
  "REG",
  "OT",
  "DT",
  "PTO",
  "SICK",
  "HOLIDAY",
  "FMLA",
  "BEREAVEMENT",
  "JURY_DUTY",
  "MILITARY",
  "UNPAID",
] as const;

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";

function PayCodeFields({ pc }: { pc?: PayCode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Numeric Code</label>
        <input
          name="code"
          type="number"
          min={0}
          required
          defaultValue={pc?.code ?? ""}
          placeholder="e.g. 5"
          className={inputCls}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs text-zinc-500">Label</label>
        <input
          name="label"
          required
          defaultValue={pc?.label ?? ""}
          placeholder="e.g. PTO"
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Pay Bucket</label>
        <select name="payBucket" defaultValue={pc?.payBucket ?? ""} className={inputCls}>
          <option value="">— None —</option>
          {PAY_BUCKETS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function PayCodesManager({ payCodes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [items, setItems] = useState<PayCode[]>(() =>
    [...payCodes].sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    setItems([...payCodes].sort((a, b) => a.sortOrder - b.sortOrder));
  }, [payCodes]);

  const visible = showInactive ? items : items.filter((p) => p.isActive);

  function handleDragStart(id: string) {
    setDragId(id);
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    if (id !== dragId) setDragOverId(id);
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const arr = [...items];
    const srcIdx = arr.findIndex((p) => p.id === dragId);
    const tgtIdx = arr.findIndex((p) => p.id === targetId);
    const [item] = arr.splice(srcIdx, 1);
    arr.splice(tgtIdx, 0, item);
    setItems(arr);
    setDragId(null);
    setDragOverId(null);
    const orderedIds = arr.map((p) => p.id);
    startTransition(async () => {
      await reorderPayCodes({ orderedIds });
      router.refresh();
    });
  }

  function handleDragEnd() {
    setDragId(null);
    setDragOverId(null);
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createPayCode({
        code: Number(fd.get("code")),
        label: fd.get("label") as string,
        payBucket: (fd.get("payBucket") as string) || null,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setShowCreate(false);
      router.refresh();
    });
  }

  function handleUpdate(pc: PayCode, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const sortOrder = items.findIndex((p) => p.id === pc.id);
    setError(null);
    startTransition(async () => {
      const result = await updatePayCode({
        payCodeId: pc.id,
        code: Number(fd.get("code")),
        label: fd.get("label") as string,
        payBucket: (fd.get("payBucket") as string) || null,
        sortOrder,
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
          <p className="text-sm text-zinc-400">No pay codes yet. Add one below.</p>
        )}
        {visible.map((pc) =>
          editingId === pc.id ? (
            <form
              key={pc.id}
              onSubmit={(e) => handleUpdate(pc, e)}
              className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-800/40 dark:bg-blue-900/10"
            >
              <PayCodeFields pc={pc} />
              <div className="mt-3 grid grid-cols-4 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Status</label>
                  <select
                    name="isActive"
                    defaultValue={pc.isActive ? "true" : "false"}
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
          ) : (
            <div
              key={pc.id}
              draggable
              onDragStart={() => handleDragStart(pc.id)}
              onDragOver={(e) => handleDragOver(e, pc.id)}
              onDrop={(e) => handleDrop(e, pc.id)}
              onDragEnd={handleDragEnd}
              className={`flex items-center justify-between rounded-xl border bg-white px-4 py-3 transition-opacity dark:bg-zinc-900 ${
                dragId === pc.id ? "opacity-40" : "opacity-100"
              } ${
                dragOverId === pc.id
                  ? "border-blue-400 dark:border-blue-500"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-center gap-3">
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-zinc-400 active:cursor-grabbing dark:text-zinc-500" />
                <span className="w-10 rounded bg-zinc-100 px-1.5 py-0.5 text-center text-xs font-mono font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {pc.code}
                </span>
                <span className="font-medium text-zinc-900 dark:text-white">{pc.label}</span>
                {pc.payBucket && (
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                    {pc.payBucket}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    pc.isActive
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                  }`}
                >
                  {pc.isActive ? "Active" : "Inactive"}
                </span>
                <button
                  onClick={() => setEditingId(pc.id)}
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  Edit
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {showCreate ? (
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">
            New Pay Code
          </p>
          <PayCodeFields />
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
          + Add Pay Code
        </button>
      )}
    </div>
  );
}
