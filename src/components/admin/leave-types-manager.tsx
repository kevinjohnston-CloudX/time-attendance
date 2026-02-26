"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLeaveType, updateLeaveType } from "@/actions/admin.actions";
import { formatMinutes } from "@/lib/utils/duration";
import type { LeaveType } from "@prisma/client";

interface Props { leaveTypes: LeaveType[] }

const CATEGORIES = ["PTO","SICK","HOLIDAY","FMLA","BEREAVEMENT","JURY_DUTY","MILITARY","UNPAID"] as const;

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";

function HoursInput({ name, label, defaultMinutes, optional = false }: { name: string; label: string; defaultMinutes?: number | null; optional?: boolean }) {
  const defaultHours = defaultMinutes != null ? String(Math.floor(defaultMinutes / 60)) : "";
  const defaultMins  = defaultMinutes != null ? String(defaultMinutes % 60) : "0";
  return (
    <div className="col-span-2 sm:col-span-1">
      <label className="mb-1 block text-xs text-zinc-500">{label}{optional && <span className="ml-1 text-zinc-400">(optional)</span>}</label>
      <div className="flex items-center gap-1">
        <input
          name={`${name}_hours`}
          type="number"
          min={0}
          defaultValue={defaultHours}
          placeholder="0"
          className="w-16 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
        <span className="text-xs text-zinc-400">h</span>
        <select
          name={`${name}_mins`}
          defaultValue={defaultMins}
          className="w-20 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          <option value="0">0 min</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="45">45 min</option>
        </select>
      </div>
    </div>
  );
}

function LeaveTypeFields({ lt }: { lt?: LeaveType }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="col-span-2 sm:col-span-2">
        <label className="mb-1 block text-xs text-zinc-500">Name</label>
        <input name="name" defaultValue={lt?.name} required placeholder="e.g. Paid Time Off" className={inputCls} />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className="mb-1 block text-xs text-zinc-500">Category</label>
        <select name="category" defaultValue={lt?.category} required className={inputCls}>
          <option value="">— Choose —</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className="mb-1 block text-xs text-zinc-500">Paid / Unpaid</label>
        <select name="isPaid" defaultValue={lt ? (lt.isPaid ? "true" : "false") : "true"} className={inputCls}>
          <option value="true">Paid</option>
          <option value="false">Unpaid</option>
        </select>
      </div>

      <HoursInput name="maxBalance"    label="Max balance"            defaultMinutes={lt?.maxBalanceMinutes}       optional />
      <HoursInput name="carryOver"     label="Year-end carry-over"    defaultMinutes={lt?.carryOverMinutes ?? 0} />

      <div className="col-span-2 sm:col-span-1">
        <label className="mb-1 block text-xs text-zinc-500">Approval</label>
        <select name="requiresApproval" defaultValue={lt ? (lt.requiresApproval ? "true" : "false") : "true"} className={inputCls}>
          <option value="true">Requires supervisor approval</option>
          <option value="false">No approval needed</option>
        </select>
      </div>
    </div>
  );
}

export function LeaveTypesManager({ leaveTypes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function toMins(fd: FormData, name: string): number {
    return (Number(fd.get(`${name}_hours`) ?? 0) * 60) + Number(fd.get(`${name}_mins`) ?? 0);
  }

  function parseForm(fd: FormData) {
    const maxH = fd.get("maxBalance_hours");
    const maxM = fd.get("maxBalance_mins");
    const hasMax = maxH !== "" && maxH !== null;
    return {
      name: fd.get("name") as string,
      category: fd.get("category") as "PTO",
      accrualRateMinutes: 0,
      maxBalanceMinutes: hasMax ? toMins(fd, "maxBalance") || null : null,
      carryOverMinutes: toMins(fd, "carryOver"),
      requiresApproval: fd.get("requiresApproval") === "true",
      isPaid: fd.get("isPaid") === "true",
    };
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createLeaveType(parseForm(fd));
      if (!result.success) { setError(result.error); return; }
      setShowCreate(false);
      router.refresh();
    });
  }

  function handleUpdate(leaveTypeId: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateLeaveType({
        leaveTypeId,
        isActive: fd.get("isActive") === "true",
        ...parseForm(fd),
      });
      if (!result.success) { setError(result.error); return; }
      setEditingId(null);
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      <div className="flex flex-col gap-2">
        {leaveTypes.map((lt) =>
          editingId === lt.id ? (
            <form key={lt.id} onSubmit={(e) => handleUpdate(lt.id, e)}
              className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-800/40 dark:bg-blue-900/10">
              <LeaveTypeFields lt={lt} />
              <div className="mt-3 grid grid-cols-4 gap-3">
                <select name="isActive" defaultValue={lt.isActive ? "true" : "false"} className={inputCls}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
              <div className="mt-3 flex gap-2">
                <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Saving…" : "Save"}</button>
                <button type="button" onClick={() => setEditingId(null)} className={cancelBtnCls}>Cancel</button>
              </div>
            </form>
          ) : (
            <div key={lt.id} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <span className="font-medium text-zinc-900 dark:text-white">{lt.name}</span>
                <span className="ml-2 rounded px-1.5 py-0.5 text-xs bg-zinc-100 text-zinc-500 dark:bg-zinc-800">{lt.category}</span>
                {lt.maxBalanceMinutes && (
                  <span className="ml-2 text-xs text-zinc-400">· Max {formatMinutes(lt.maxBalanceMinutes)}</span>
                )}
                {lt.carryOverMinutes > 0 && (
                  <span className="ml-2 text-xs text-zinc-400">· Carries over {formatMinutes(lt.carryOverMinutes)}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-xs ${lt.isActive ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-500"}`}>
                  {lt.isActive ? "Active" : "Inactive"}
                </span>
                <span className="text-xs text-zinc-400">{lt.isPaid ? "Paid" : "Unpaid"}</span>
                <button onClick={() => setEditingId(lt.id)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">Edit</button>
              </div>
            </div>
          )
        )}
      </div>
      {showCreate ? (
        <form onSubmit={handleCreate} className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">New Leave Type</p>
          <LeaveTypeFields />
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create"}</button>
            <button type="button" onClick={() => setShowCreate(false)} className={cancelBtnCls}>Cancel</button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowCreate(true)} className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600">
          + Add Leave Type
        </button>
      )}
    </div>
  );
}
