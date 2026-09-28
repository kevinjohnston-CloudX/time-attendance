"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { reorderPayCodes } from "@/actions/pay-code.actions";
import type { PayCode } from "@prisma/client";

interface Props { payCodes: PayCode[] }

const PAY_BUCKETS = ["REG","OT","DT","PTO","SICK","HOLIDAY","FMLA","BEREAVEMENT","JURY_DUTY","MILITARY","UNPAID"] as const;

export const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

export function PayCodeFields({ initial, mode = "create" }: { initial?: PayCode; mode?: "create" | "edit" }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Numeric Code</label>
        <input name="code" type="number" min={0} required defaultValue={initial?.code ?? ""} placeholder="e.g. 5" className={inputCls} />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs text-zinc-500">Label</label>
        <input name="label" required defaultValue={initial?.label ?? ""} placeholder="e.g. PTO" className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Express Code</label>
        <input name="expressCode" maxLength={4} defaultValue={initial?.expressCode ?? ""} placeholder="e.g. WKHR" className={inputCls} style={{ textTransform: "uppercase" }} />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs text-zinc-500">Pay Bucket</label>
        <select name="payBucket" defaultValue={initial?.payBucket ?? ""} className={inputCls}>
          <option value="">— None —</option>
          {PAY_BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>
      <div className="col-span-2 sm:col-span-4">
        <label className="mb-1 block text-xs text-zinc-500">Overtime Calculation</label>
        <select name="countsTowardOt" defaultValue={initial ? (initial.countsTowardOt ? "true" : "false") : "true"} className={inputCls}>
          <option value="true">Counts toward OT — hours apply to daily and weekly OT thresholds</option>
          <option value="false">Excluded from OT — hours stay REG regardless of daily or weekly totals</option>
        </select>
      </div>
      {mode === "edit" && (
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Status</label>
          <select name="isActive" defaultValue={initial?.isActive ? "true" : "false"} className={inputCls}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      )}
    </div>
  );
}

export function PayCodesManager({ payCodes }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [showInactive, setShowInactive] = useState(false);
  const [items, setItems] = useState<PayCode[]>(() => [...payCodes].sort((a, b) => a.sortOrder - b.sortOrder));
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    setItems([...payCodes].sort((a, b) => a.sortOrder - b.sortOrder));
  }, [payCodes]);

  const visible = showInactive ? items : items.filter((p) => p.isActive);

  function handleDragStart(id: string) { setDragId(id); }
  function handleDragOver(e: React.DragEvent, id: string) { e.preventDefault(); if (id !== dragId) setDragOverId(id); }
  function handleDragEnd() { setDragId(null); setDragOverId(null); }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const arr = [...items];
    const srcIdx = arr.findIndex((p) => p.id === dragId);
    const tgtIdx = arr.findIndex((p) => p.id === targetId);
    const [item] = arr.splice(srcIdx, 1);
    arr.splice(tgtIdx, 0, item);
    setItems(arr);
    setDragId(null);
    setDragOverId(null);
    startTransition(async () => { await reorderPayCodes({ orderedIds: arr.map((p) => p.id) }); router.refresh(); });
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
        {visible.length === 0 && <p className="text-sm text-zinc-400">No pay codes yet. Add one below.</p>}
        {visible.map((pc) => (
          <div
            key={pc.id}
            draggable
            onDragStart={() => handleDragStart(pc.id)}
            onDragOver={(e) => handleDragOver(e, pc.id)}
            onDrop={(e) => handleDrop(e, pc.id)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-2 rounded-xl border bg-white transition-opacity dark:bg-zinc-900 ${
              dragId === pc.id ? "opacity-40" : "opacity-100"
            } ${dragOverId === pc.id ? "border-blue-400 dark:border-blue-500" : "border-zinc-200 dark:border-zinc-800"}`}
          >
            <button
              type="button"
              className="cursor-grab pl-3 py-3 text-zinc-400 active:cursor-grabbing dark:text-zinc-500"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <GripVertical className="h-4 w-4 shrink-0" />
            </button>
            <Link
              href={`/admin/site-settings/pay-codes/${pc.id}`}
              className="flex flex-1 items-center justify-between px-3 py-3 hover:bg-zinc-50 rounded-r-xl dark:hover:bg-zinc-800/60"
            >
              <div className="flex items-center gap-3">
                <span className="w-10 rounded bg-zinc-100 px-1.5 py-0.5 text-center text-xs font-mono font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {pc.code}
                </span>
                <span className={`font-medium ${pc.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>{pc.label}</span>
                {pc.expressCode && (
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-mono font-medium text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                    {pc.expressCode}
                  </span>
                )}
                {pc.payBucket && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">{pc.payBucket}</span>}
                {!pc.countsTowardOt && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">No OT</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${pc.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                  {pc.isActive ? "Active" : "Inactive"}
                </span>
                <span className="text-xs text-zinc-400">Edit →</span>
              </div>
            </Link>
          </div>
        ))}
      </div>

      <Link
        href="/admin/site-settings/pay-codes/new"
        className="mt-4 inline-block rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
      >
        + Add Pay Code
      </Link>
    </div>
  );
}
