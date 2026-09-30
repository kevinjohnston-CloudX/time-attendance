"use client";

import Link from "next/link";
import { formatMinutes } from "@/lib/utils/duration";
import type { LeaveType } from "@prisma/client";

interface PayCodeOption { id: string; code: number; label: string }
interface Props { leaveTypes: LeaveType[]; payCodes: PayCodeOption[] }

const CATEGORIES = ["PTO","SICK","HOLIDAY","FMLA","BEREAVEMENT","JURY_DUTY","MILITARY","UNPAID"] as const;

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

export function HoursInput({ name, label, defaultMinutes, optional = false }: { name: string; label: string; defaultMinutes?: number | null; optional?: boolean }) {
  const defaultHours = defaultMinutes != null ? String(Math.floor(defaultMinutes / 60)) : "";
  const defaultMins  = defaultMinutes != null ? String(defaultMinutes % 60) : "0";
  return (
    <div className="col-span-2 sm:col-span-1">
      <label className="mb-1 block text-xs text-zinc-500">{label}{optional && <span className="ml-1 text-zinc-400">(optional)</span>}</label>
      <div className="flex items-center gap-1">
        <input name={`${name}_hours`} type="number" min={0} defaultValue={defaultHours} placeholder="0"
          className="w-16 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
        <span className="text-xs text-zinc-400">h</span>
        <select name={`${name}_mins`} defaultValue={defaultMins}
          className="w-20 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white">
          <option value="0">0 min</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="45">45 min</option>
        </select>
      </div>
    </div>
  );
}

export function parseLeaveTypeForm(fd: FormData) {
  function toMins(name: string): number {
    return (Number(fd.get(`${name}_hours`) ?? 0) * 60) + Number(fd.get(`${name}_mins`) ?? 0);
  }
  const maxH = fd.get("maxBalance_hours");
  const hasMax = maxH !== "" && maxH !== null;
  const codeRaw = fd.get("externalCode");
  const externalCode = codeRaw !== "" && codeRaw !== null ? Number(codeRaw) : null;
  const payCodeIdRaw = fd.get("payCodeId");
  return {
    name: fd.get("name") as string,
    category: fd.get("category") as "PTO",
    accrualRateMinutes: 0,
    maxBalanceMinutes: hasMax ? toMins("maxBalance") || null : null,
    requiresApproval: fd.get("requiresApproval") === "true",
    isPaid: fd.get("isPaid") === "true",
    accrualTracked: fd.get("accrualTracked") !== "false",
    externalCode,
    payCodeId: payCodeIdRaw && payCodeIdRaw !== "" ? (payCodeIdRaw as string) : null,
  };
}

export function LeaveTypeFields({
  initial,
  payCodes,
  mode,
}: {
  initial?: LeaveType & { payCodeId?: string | null };
  payCodes: PayCodeOption[];
  mode?: "create" | "edit";
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="col-span-2 sm:col-span-2">
        <label className="mb-1 block text-xs text-zinc-500">Name</label>
        <input name="name" defaultValue={initial?.name} required placeholder="e.g. Paid Time Off" className={inputCls} />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className="mb-1 block text-xs text-zinc-500">Category</label>
        <select name="category" defaultValue={initial?.category} required className={inputCls}>
          <option value="">— Choose —</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className="mb-1 block text-xs text-zinc-500">Paid / Unpaid</label>
        <select name="isPaid" defaultValue={initial ? (initial.isPaid ? "true" : "false") : "true"} className={inputCls}>
          <option value="true">Paid</option>
          <option value="false">Unpaid</option>
        </select>
      </div>
      <HoursInput name="maxBalance" label="Max balance" defaultMinutes={initial?.maxBalanceMinutes} optional />
      <div className="col-span-2 sm:col-span-1">
        <label className="mb-1 block text-xs text-zinc-500">Approval</label>
        <select name="requiresApproval" defaultValue={initial ? (initial.requiresApproval ? "true" : "false") : "true"} className={inputCls}>
          <option value="true">Requires supervisor approval</option>
          <option value="false">No approval needed</option>
        </select>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className="mb-1 block text-xs text-zinc-500">API Code <span className="text-zinc-400">(optional — auto-assigned)</span></label>
        <input name="externalCode" type="number" min={1} step={1}
          defaultValue={initial?.externalCode ?? ""}
          placeholder="Auto"
          className={inputCls} />
      </div>
      <div className="col-span-2 sm:col-span-2">
        <label className="mb-1 block text-xs text-zinc-500">Accrual Tracking</label>
        <select name="accrualTracked" defaultValue={initial ? (initial.accrualTracked ? "true" : "false") : "true"} className={inputCls}>
          <option value="true">Accrual tracked — balance managed by system</option>
          <option value="false">Not tracked — informational only</option>
        </select>
      </div>
      {payCodes.length > 0 && (
        <div className="col-span-2 sm:col-span-2">
          <label className="mb-1 block text-xs text-zinc-500">Pay Code <span className="text-zinc-400">(for timecard rows)</span></label>
          <select name="payCodeId" defaultValue={initial?.payCodeId ?? ""} className={inputCls}>
            <option value="">— None —</option>
            {payCodes.map((pc) => (
              <option key={pc.id} value={pc.id}>{pc.code}[{pc.label}]</option>
            ))}
          </select>
        </div>
      )}
      {mode === "edit" && (
        <div className="col-span-2 sm:col-span-1">
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

export function LeaveTypesManager({ leaveTypes }: Props) {
  return (
    <div className="mt-6">
      <div className="flex flex-col gap-2">
        {leaveTypes.map((lt) => (
          <Link
            key={lt.id}
            href={`/admin/site-settings/leave-types/${lt.id}`}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-medium ${lt.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>{lt.name}</span>
                {lt.externalCode != null && <span className="rounded px-1.5 py-0.5 text-xs bg-blue-50 text-blue-600 font-mono dark:bg-blue-900/20 dark:text-blue-400">#{lt.externalCode}</span>}
                <span className="rounded px-1.5 py-0.5 text-xs bg-zinc-100 text-zinc-500 dark:bg-zinc-800">{lt.category}</span>
                <span className="text-xs text-zinc-400">{lt.isPaid ? "Paid" : "Unpaid"}</span>
                {lt.maxBalanceMinutes != null && <span className="text-xs text-zinc-400">· Max {formatMinutes(lt.maxBalanceMinutes)}</span>}
              </div>
              <div className="flex items-center gap-2">
                {!lt.isActive && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">Inactive</span>}
                <span className="text-xs text-zinc-400">Edit →</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <Link
        href="/admin/site-settings/leave-types/new"
        className="mt-4 inline-block rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
      >
        + Add Leave Type
      </Link>
    </div>
  );
}
