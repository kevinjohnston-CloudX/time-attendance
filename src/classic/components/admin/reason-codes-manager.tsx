"use client";

import { useState } from "react";
import Link from "next/link";

type ReasonCodeItem = { id: string; code: string; label: string; color: string | null; isActive: boolean };
interface Props { reasonCodes: ReasonCodeItem[] }

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

export function ColorPicker({ name, defaultValue }: { name: string; defaultValue?: string | null }) {
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

export function ReasonCodeFields({ initial, mode }: { initial?: ReasonCodeItem; mode?: "create" | "edit" }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Code</label>
        <input name="code" required defaultValue={initial?.code ?? ""} placeholder="e.g. LATE" className={inputCls} style={{ textTransform: "uppercase" }} />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs text-zinc-500">Label</label>
        <input name="label" required defaultValue={initial?.label ?? ""} placeholder="e.g. Late Arrival" className={inputCls} />
      </div>
      <div className="col-span-2 sm:col-span-2">
        <label className="mb-1 block text-xs text-zinc-500">Highlight Color</label>
        <ColorPicker name="color" defaultValue={initial?.color} />
      </div>
      {mode === "edit" && (
        <div className="col-span-2 sm:col-span-1">
          <label className="mb-1 block text-xs text-zinc-500">Status</label>
          <select name="isActive" defaultValue={initial?.isActive ? "true" : "false"} className={`${inputCls} max-w-[160px]`}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      )}
    </div>
  );
}

export function ReasonCodesManager({ reasonCodes }: Props) {
  const [showInactive, setShowInactive] = useState(false);

  const visible = reasonCodes.filter((rc) => showInactive || rc.isActive);

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
          <Link
            key={rc.id}
            href={`/admin/site-settings/reason-codes/${rc.id}`}
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
                <span className="text-xs text-zinc-400">Edit →</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <Link
        href="/admin/site-settings/reason-codes/new"
        className="mt-4 inline-block rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
      >
        + Add Reason Code
      </Link>
    </div>
  );
}
