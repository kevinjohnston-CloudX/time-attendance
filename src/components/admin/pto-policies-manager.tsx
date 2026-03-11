"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Trash2, Plus, X } from "lucide-react";
import {
  createPtoPolicy,
  updatePtoPolicy,
  deletePtoPolicy,
} from "@/actions/pto-policy.actions";

type Band = {
  leaveTypeId: string;
  minTenureMonths: number;
  maxTenureMonths: number | null;
  annualDays: number;
};

type BandWithLeaveType = Band & {
  id?: string;
  leaveType?: { id: string; name: string; category: string };
};

type Policy = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  bands: BandWithLeaveType[];
  _count: { siteLinks: number; empOverrides: number };
};

type LeaveTypeOption = { id: string; name: string; category: string };

interface Props {
  policies: Policy[];
  leaveTypes: LeaveTypeOption[];
}

export function PtoPoliciesManager({ policies, leaveTypes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  function handleCreate(e: React.FormEvent<HTMLFormElement>, bands: Band[]) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createPtoPolicy({
        name: fd.get("name") as string,
        description: (fd.get("description") as string) || undefined,
        isDefault: fd.get("isDefault") === "true",
        bands,
      });
      if ("success" in result && !result.success) {
        setError((result as { success: false; error: string }).error);
        return;
      }
      setShowCreate(false);
      router.refresh();
    });
  }

  function handleUpdate(policyId: string, e: React.FormEvent<HTMLFormElement>, bands: Band[]) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      await updatePtoPolicy({
        ptoPolicyId: policyId,
        name: fd.get("name") as string,
        description: (fd.get("description") as string) || null,
        isDefault: fd.get("isDefault") === "true",
        isActive: fd.get("isActive") === "true",
        bands,
      });
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(policyId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deletePtoPolicy({ ptoPolicyId: policyId });
      if (!result.success) {
        setError(result.error);
        setDeleteConfirm(null);
        return;
      }
      setDeleteConfirm(null);
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

      <div className="flex flex-col gap-2">
        {policies.map((policy) => (
          <div key={policy.id} className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            {/* Header row */}
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === policy.id ? null : policy.id)}
                className="flex flex-1 items-center gap-3 text-left"
              >
                {expandedId === policy.id ? (
                  <ChevronUp className="h-4 w-4 text-zinc-400 shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-zinc-400 shrink-0" />
                )}
                <span className="font-medium text-zinc-900 dark:text-white">{policy.name}</span>
                {policy.isDefault && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    Default
                  </span>
                )}
                {!policy.isActive && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                    Inactive
                  </span>
                )}
                <span className="ml-auto text-xs text-zinc-400">
                  {[...new Set(policy.bands.map((b) => b.leaveTypeId))].length} leave type
                  {[...new Set(policy.bands.map((b) => b.leaveTypeId))].length !== 1 ? "s" : ""} · {policy.bands.length} band
                  {policy.bands.length !== 1 ? "s" : ""}
                  {policy._count.siteLinks + policy._count.empOverrides > 0 && (
                    <> · {policy._count.siteLinks} site{policy._count.siteLinks !== 1 ? "s" : ""}, {policy._count.empOverrides} override{policy._count.empOverrides !== 1 ? "s" : ""}</>
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => { setEditingId(policy.id); setExpandedId(policy.id); }}
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                Edit
              </button>
              {deleteConfirm === policy.id ? (
                <span className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => handleDelete(policy.id)}
                    disabled={isPending}
                    className="font-medium text-red-600 hover:underline"
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(null)}
                    className="text-zinc-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(policy.id)}
                  className="text-zinc-400 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Expanded / editing */}
            {expandedId === policy.id && (
              <div className="border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
                {editingId === policy.id ? (
                  <PolicyForm
                    leaveTypes={leaveTypes}
                    initial={policy}
                    isPending={isPending}
                    onSubmit={(e, bands) => handleUpdate(policy.id, e, bands)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <BandTable bands={policy.bands} />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {showCreate ? (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">New PTO Policy</p>
          <PolicyForm
            leaveTypes={leaveTypes}
            isPending={isPending}
            onSubmit={(e, bands) => handleCreate(e, bands)}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:hover:border-zinc-400"
        >
          + Add Policy
        </button>
      )}
    </div>
  );
}

// ─── Band-only read view ──────────────────────────────────────────────────────

function BandTable({ bands }: { bands: BandWithLeaveType[] }) {
  if (bands.length === 0) return <p className="text-xs text-zinc-400">No bands configured.</p>;

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-zinc-400">
          <th className="pb-1 pr-4 font-medium">Leave Type</th>
          <th className="pb-1 pr-4 font-medium">From (months)</th>
          <th className="pb-1 pr-4 font-medium">To (months)</th>
          <th className="pb-1 font-medium">Days/Year</th>
        </tr>
      </thead>
      <tbody>
        {bands.map((b, i) => (
          <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
            <td className="py-1 pr-4 text-zinc-700 dark:text-zinc-300">{b.leaveType?.name ?? b.leaveTypeId}</td>
            <td className="py-1 pr-4 text-zinc-500">{b.minTenureMonths}</td>
            <td className="py-1 pr-4 text-zinc-500">{b.maxTenureMonths ?? "∞"}</td>
            <td className="py-1 text-zinc-700 dark:text-zinc-300">{b.annualDays}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Policy form (create + edit) ─────────────────────────────────────────────

function PolicyForm({
  leaveTypes,
  initial,
  isPending,
  onSubmit,
  onCancel,
}: {
  leaveTypes: LeaveTypeOption[];
  initial?: Policy;
  isPending: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>, bands: Band[]) => void;
  onCancel: () => void;
}) {
  const [bands, setBands] = useState<Band[]>(
    initial?.bands.map((b) => ({
      leaveTypeId: b.leaveTypeId,
      minTenureMonths: b.minTenureMonths,
      maxTenureMonths: b.maxTenureMonths,
      annualDays: b.annualDays,
    })) ?? []
  );

  function addBand() {
    setBands((prev) => [
      ...prev,
      { leaveTypeId: leaveTypes[0]?.id ?? "", minTenureMonths: 0, maxTenureMonths: null, annualDays: 10 },
    ]);
  }

  function removeBand(i: number) {
    setBands((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateBand(i: number, field: keyof Band, value: string | number | null) {
    setBands((prev) =>
      prev.map((b, idx) => (idx === i ? { ...b, [field]: value } : b))
    );
  }

  return (
    <form onSubmit={(e) => onSubmit(e, bands)} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-0.5 sm:col-span-2">
          <span className={labelCls}>Name</span>
          <input name="name" defaultValue={initial?.name} required placeholder="e.g. Standard PTO" className={inputCls} />
        </label>
        <label className="flex flex-col gap-0.5 sm:col-span-2">
          <span className={labelCls}>Description</span>
          <input name="description" defaultValue={initial?.description ?? ""} placeholder="Optional" className={inputCls} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={labelCls}>Is Default?</span>
          <select name="isDefault" defaultValue={initial?.isDefault ? "true" : "false"} className={inputCls}>
            <option value="false">No</option>
            <option value="true">Yes — tenant fallback</option>
          </select>
        </label>
        {initial && (
          <label className="flex flex-col gap-0.5">
            <span className={labelCls}>Status</span>
            <select name="isActive" defaultValue={initial.isActive ? "true" : "false"} className={inputCls}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
        )}
      </div>

      {/* Band editor */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Tenure Bands</p>
          <button type="button" onClick={addBand} className="flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400">
            <Plus className="h-3 w-3" /> Add band
          </button>
        </div>
        {bands.length === 0 && (
          <p className="text-xs text-zinc-400">Add at least one band.</p>
        )}
        <div className="space-y-2">
          {bands.map((band, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/50">
              <label className="flex flex-col gap-0.5">
                <span className={labelCls}>Leave Type</span>
                <select
                  value={band.leaveTypeId}
                  onChange={(e) => updateBand(i, "leaveTypeId", e.target.value)}
                  className={inputCls}
                  required
                >
                  {leaveTypes.map((lt) => (
                    <option key={lt.id} value={lt.id}>{lt.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className={labelCls}>From (months)</span>
                <input
                  type="number" min="0" step="1"
                  value={band.minTenureMonths}
                  onChange={(e) => updateBand(i, "minTenureMonths", parseInt(e.target.value, 10))}
                  className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  required
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className={labelCls}>To (months, blank = ∞)</span>
                <input
                  type="number" min="1" step="1"
                  value={band.maxTenureMonths ?? ""}
                  onChange={(e) =>
                    updateBand(i, "maxTenureMonths", e.target.value ? parseInt(e.target.value, 10) : null)
                  }
                  className="w-28 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  placeholder="∞"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className={labelCls}>Days/Year</span>
                <input
                  type="number" min="0" max="365" step="1"
                  value={band.annualDays}
                  onChange={(e) => updateBand(i, "annualDays", parseInt(e.target.value, 10))}
                  className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  required
                />
              </label>
              <button
                type="button"
                onClick={() => removeBand(i)}
                className="mb-0.5 text-zinc-400 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={isPending || bands.length === 0} className={saveBtnCls}>
          {isPending ? "Saving…" : initial ? "Save Changes" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className={cancelBtnCls}>Cancel</button>
      </div>
    </form>
  );
}

const inputCls = "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const labelCls = "text-[10px] font-medium uppercase tracking-wide text-zinc-500";
const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800";
