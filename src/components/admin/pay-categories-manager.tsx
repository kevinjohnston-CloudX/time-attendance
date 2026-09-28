"use client";

import { useState } from "react";
import Link from "next/link";

export type PolicyRule = { leaveTypeId: string; leaveType: { id: string; name: string } };
export type PolicyOption = { id: string; name: string; rules: PolicyRule[] };
export type LeaveTypeOption = { id: string; name: string };

export type CategoryWithPolicies = {
  id: string;
  number: number;
  description: string | null;
  isActive: boolean;
  limitLeaveTypes: boolean;
  ptoPolicies: Array<{ ptoPolicy: PolicyOption }>;
  availableLeaveTypes: Array<{ leaveTypeId: string }>;
};

interface Props {
  categories: CategoryWithPolicies[];
  ptoPolicies?: PolicyOption[];
  leaveTypes?: LeaveTypeOption[];
}

export const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

// ─── Policy picker sub-component ──────────────────────────────────────────────

export function PolicyPicker({
  ptoPolicies,
  initial = [],
}: {
  ptoPolicies: PolicyOption[];
  initial?: PolicyOption[];
}) {
  const [assigned, setAssigned] = useState<PolicyOption[]>(initial);
  const [pickerId, setPickerId] = useState("");
  const [overlapError, setOverlapError] = useState<string | null>(null);

  const assignedIds = new Set(assigned.map((p) => p.id));
  const available = ptoPolicies.filter((p) => !assignedIds.has(p.id));

  function handleAdd() {
    if (!pickerId) return;
    const policy = ptoPolicies.find((p) => p.id === pickerId);
    if (!policy) return;

    const existingLeaveTypeIds = new Set(assigned.flatMap((p) => p.rules.map((r) => r.leaveTypeId)));
    const conflicts = policy.rules
      .filter((r) => existingLeaveTypeIds.has(r.leaveTypeId))
      .map((r) => r.leaveType.name);

    if (conflicts.length > 0) {
      setOverlapError(`Cannot add "${policy.name}" — leave type${conflicts.length > 1 ? "s" : ""} already covered by another policy: ${conflicts.join(", ")}`);
      return;
    }

    setOverlapError(null);
    setPickerId("");
    setAssigned((prev) => [...prev, policy]);
  }

  function handleRemove(id: string) {
    setOverlapError(null);
    setAssigned((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="mt-4">
      <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-500">Leave Policies</label>

      {assigned.map((p) => (
        <input key={p.id} type="hidden" name="ptoPolicyIds" value={p.id} />
      ))}

      {assigned.length === 0 && (
        <p className="mb-2 text-xs text-zinc-400">No policies assigned to this category.</p>
      )}

      <div className="mb-3 flex flex-col gap-2">
        {assigned.map((p) => (
          <div key={p.id} className="flex items-start justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/50">
            <div>
              <span className="text-sm font-medium text-zinc-900 dark:text-white">{p.name}</span>
              {p.rules.length > 0 && (
                <p className="mt-0.5 text-xs text-zinc-400">
                  {p.rules.map((r) => r.leaveType.name).join(", ")}
                </p>
              )}
            </div>
            <button type="button" onClick={() => handleRemove(p.id)} className="ml-3 shrink-0 text-xs text-red-500 hover:underline dark:text-red-400">
              Remove
            </button>
          </div>
        ))}
      </div>

      {available.length > 0 && (
        <div className="flex gap-2">
          <select value={pickerId} onChange={(e) => { setPickerId(e.target.value); setOverlapError(null); }} className={inputCls}>
            <option value="">— Add a policy —</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!pickerId}
            className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Add
          </button>
        </div>
      )}

      {overlapError && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {overlapError}
        </p>
      )}
    </div>
  );
}

// ─── Leave type dual-box picker ───────────────────────────────────────────────

export function LeaveTypePicker({
  leaveTypes,
  initialAvailableIds,
}: {
  leaveTypes: LeaveTypeOption[];
  initialAvailableIds: string[] | null;
}) {
  const [availableIds, setAvailableIds] = useState<Set<string>>(() => {
    if (initialAvailableIds === null) return new Set(leaveTypes.map((lt) => lt.id));
    return new Set(initialAvailableIds);
  });

  function move(id: string, toAvailable: boolean) {
    setAvailableIds((prev) => {
      const next = new Set(prev);
      if (toAvailable) next.add(id); else next.delete(id);
      return next;
    });
  }

  const availableList   = leaveTypes.filter((lt) =>  availableIds.has(lt.id));
  const unavailableList = leaveTypes.filter((lt) => !availableIds.has(lt.id));

  const boxCls = "min-h-[120px] rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50 flex flex-col gap-1";
  const itemCls = "w-full rounded px-2 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors";

  return (
    <div className="mt-4">
      <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-500">Available for Leave Request</label>
      {[...availableIds].map((id) => (
        <input key={id} type="hidden" name="availableLeaveTypeIds" value={id} />
      ))}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">Available</p>
          <div className={boxCls}>
            {availableList.length === 0 && <p className="text-xs text-zinc-400">None</p>}
            {availableList.map((lt) => (
              <button key={lt.id} type="button" onClick={() => move(lt.id, false)} className={itemCls} title="Click to make unavailable">
                {lt.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Unavailable</p>
          <div className={boxCls}>
            {unavailableList.length === 0 && <p className="text-xs text-zinc-400">None</p>}
            {unavailableList.map((lt) => (
              <button key={lt.id} type="button" onClick={() => move(lt.id, true)} className={itemCls} title="Click to make available">
                {lt.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-zinc-400">Click a leave type to move it between boxes.</p>
    </div>
  );
}

// ─── CategoryFields: exported composite form section ─────────────────────────

interface CategoryFieldsProps {
  initial?: CategoryWithPolicies;
  mode?: "create" | "edit";
  ptoPolicies: PolicyOption[];
  leaveTypes: LeaveTypeOption[];
  defaultNumber?: number;
}

export function CategoryFields({ initial, mode = "create", ptoPolicies, leaveTypes, defaultNumber }: CategoryFieldsProps) {
  const [limitLeaveTypes, setLimitLeaveTypes] = useState(initial?.limitLeaveTypes ?? false);

  const assignedPolicies: PolicyOption[] = initial
    ? initial.ptoPolicies.map((link) => link.ptoPolicy)
    : [];

  const initialAvailableIds: string[] | null = initial
    ? (initial.availableLeaveTypes.length === 0 ? null : initial.availableLeaveTypes.map((r) => r.leaveTypeId))
    : null;

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Category Number</label>
          <input
            name="number"
            type="number"
            min="1"
            max="9999"
            required
            defaultValue={initial?.number ?? defaultNumber ?? ""}
            placeholder="e.g. 100"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Description</label>
          <input
            name="description"
            maxLength={255}
            defaultValue={initial?.description ?? ""}
            placeholder="e.g. Full-Time Hourly"
            className={inputCls}
          />
        </div>
      </div>

      {mode === "edit" && (
        <div className="mt-3 w-32">
          <label className="mb-1 block text-xs text-zinc-500">Status</label>
          <select name="isActive" defaultValue={initial?.isActive ? "true" : "false"} className={inputCls}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      )}

      <PolicyPicker ptoPolicies={ptoPolicies} initial={assignedPolicies} />

      {leaveTypes.length > 0 && (
        <div className="mt-4">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              name="limitLeaveTypes"
              checked={limitLeaveTypes}
              onChange={(e) => setLimitLeaveTypes(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Limit leave request options</span>
          </label>
          {limitLeaveTypes && (
            <LeaveTypePicker
              key={initial?.id ?? "new"}
              leaveTypes={leaveTypes}
              initialAvailableIds={initialAvailableIds}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main manager ─────────────────────────────────────────────────────────────

export function PayCategoriesManager({ categories }: Props) {
  const [showInactive, setShowInactive] = useState(false);

  const visible = showInactive ? categories : categories.filter((c) => c.isActive);

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-500">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
          Show inactive
        </label>
      </div>

      <div className="flex flex-col gap-2">
        {visible.length === 0 && <p className="text-sm text-zinc-400">No pay categories yet. Add one below.</p>}

        {visible.map((cat) => (
          <Link
            key={cat.id}
            href={`/admin/site-settings/pay-categories/${cat.id}`}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className={`font-mono font-semibold ${cat.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                  {cat.number}
                </span>
                {cat.description && <span className="text-sm text-zinc-500">{cat.description}</span>}
                {!cat.isActive && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">Inactive</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {cat.ptoPolicies.length > 0 && (
                  <span className="text-xs text-zinc-400">
                    {cat.ptoPolicies.length} {cat.ptoPolicies.length === 1 ? "policy" : "policies"}
                  </span>
                )}
                <span className="text-xs text-zinc-400">Edit →</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <Link
        href="/admin/site-settings/pay-categories/new"
        className="mt-4 inline-block rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
      >
        + Add Pay Category
      </Link>
    </div>
  );
}
