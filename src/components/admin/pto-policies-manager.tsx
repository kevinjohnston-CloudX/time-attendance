"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Trash2 } from "lucide-react";
import { createPtoPolicy, updatePtoPolicy, deletePtoPolicy } from "@/actions/pto-policy.actions";

// ─── Types ───────────────────────────────────────────────────────────────────

type Tier = {
  minTenureMonths: number;
  maxTenureMonths: number | null;
  annualHours: number;
  earnedHoursPerYear: number;
  carryOverHours: number | null;
};

type LeaveTypeGroup = {
  leaveTypeId: string;
  tiers: Tier[];
};

// Flat rule as stored / sent to server
type Rule = Tier & { leaveTypeId: string };

type RuleFromServer = Rule & {
  id?: string;
  leaveType?: { id: string; name: string; category: string };
};

type Policy = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  rules: RuleFromServer[];
  _count: { siteLinks: number; empOverrides: number };
};

type LeaveTypeOption = { id: string; name: string; category: string };

interface Props { policies: Policy[]; leaveTypes: LeaveTypeOption[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupRules(rules: RuleFromServer[]): LeaveTypeGroup[] {
  const map = new Map<string, Tier[]>();
  for (const r of rules) {
    const list = map.get(r.leaveTypeId) ?? [];
    list.push({
      minTenureMonths:    r.minTenureMonths,
      maxTenureMonths:    r.maxTenureMonths,
      annualHours:        r.annualHours,
      earnedHoursPerYear: r.earnedHoursPerYear,
      carryOverHours:     r.carryOverHours,
    });
    map.set(r.leaveTypeId, list);
  }
  return [...map.entries()].map(([leaveTypeId, tiers]) => ({
    leaveTypeId,
    tiers: tiers.sort((a, b) => a.minTenureMonths - b.minTenureMonths),
  }));
}

function flattenGroups(groups: LeaveTypeGroup[]): Rule[] {
  return groups.flatMap((g) => g.tiers.map((t) => ({ leaveTypeId: g.leaveTypeId, ...t })));
}

function defaultTier(minTenureMonths = 0): Tier {
  return { minTenureMonths, maxTenureMonths: null, annualHours: 0, earnedHoursPerYear: 0, carryOverHours: null };
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const smInputCls = "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const labelCls = "mb-1 block text-xs text-zinc-500";
const smLabelCls = "mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-400";
const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls = "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Policy form ──────────────────────────────────────────────────────────────

function PolicyForm({ leaveTypes, initial, isPending, onSubmit, onCancel }: {
  leaveTypes: LeaveTypeOption[];
  initial?: Policy;
  isPending: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>, rules: Rule[]) => void;
  onCancel: () => void;
}) {
  const [groups, setGroups] = useState<LeaveTypeGroup[]>(
    () => initial ? groupRules(initial.rules) : []
  );

  const usedLeaveTypeIds = new Set(groups.map((g) => g.leaveTypeId));
  const availableLeaveTypes = leaveTypes.filter((lt) => !usedLeaveTypeIds.has(lt.id));

  // ── Group-level helpers
  function addLeaveType() {
    const first = availableLeaveTypes[0];
    if (!first) return;
    setGroups((prev) => [...prev, { leaveTypeId: first.id, tiers: [defaultTier(0)] }]);
  }

  function removeLeaveType(gi: number) {
    setGroups((prev) => prev.filter((_, i) => i !== gi));
  }

  function changeLeaveType(gi: number, leaveTypeId: string) {
    setGroups((prev) => prev.map((g, i) => i === gi ? { ...g, leaveTypeId } : g));
  }

  // ── Tier-level helpers
  function addTier(gi: number) {
    setGroups((prev) => prev.map((g, i) => {
      if (i !== gi) return g;
      const last = g.tiers[g.tiers.length - 1];
      // If the last tier is open-ended, close it at lastMin + 12 before adding the new tier
      const closedMax = last?.maxTenureMonths != null ? last.maxTenureMonths : (last?.minTenureMonths ?? 0) + 12;
      const updatedTiers = last?.maxTenureMonths == null && last != null
        ? [...g.tiers.slice(0, -1), { ...last, maxTenureMonths: closedMax }]
        : g.tiers;
      return { ...g, tiers: [...updatedTiers, defaultTier(closedMax)] };
    }));
  }

  function removeTier(gi: number, ti: number) {
    setGroups((prev) => prev.map((g, i) => {
      if (i !== gi) return g;
      const newTiers = g.tiers.filter((_, j) => j !== ti);
      return newTiers.length === 0 ? null : { ...g, tiers: newTiers };
    }).filter(Boolean) as LeaveTypeGroup[]);
  }

  function updateTier(gi: number, ti: number, field: keyof Tier, value: number | null) {
    setGroups((prev) => prev.map((g, i) => {
      if (i !== gi) return g;
      return { ...g, tiers: g.tiers.map((t, j) => j === ti ? { ...t, [field]: value } : t) };
    }));
  }

  return (
    <form onSubmit={(e) => onSubmit(e, flattenGroups(groups))} className="space-y-5">
      {/* Name / description / meta */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className={labelCls}>Policy Name</label>
          <input name="name" required defaultValue={initial?.name ?? ""} placeholder="e.g. Full-Time PTO" className={inputCls} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className={labelCls}>Description <span className="text-zinc-400">(optional)</span></label>
          <input name="description" defaultValue={initial?.description ?? ""} placeholder="Brief description" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Default Policy</label>
          <select name="isDefault" defaultValue={initial?.isDefault ? "true" : "false"} className={inputCls}>
            <option value="false">No</option>
            <option value="true">Yes — tenant fallback</option>
          </select>
        </div>
        {initial && (
          <div>
            <label className={labelCls}>Status</label>
            <select name="isActive" defaultValue={initial.isActive ? "true" : "false"} className={inputCls}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        )}
      </div>

      {/* Leave type groups */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Leave Types</p>
          {availableLeaveTypes.length > 0 && (
            <button type="button" onClick={addLeaveType} className="flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400">
              <Plus className="h-3 w-3" /> Add leave type
            </button>
          )}
        </div>

        {groups.length === 0 && (
          <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-400 dark:border-zinc-700">
            No leave types added yet. Click "Add leave type" to configure PTO, Sick, Jury Duty, etc.
          </p>
        )}

        <div className="space-y-4">
          {groups.map((group, gi) => {
            const leaveTypesForRow = leaveTypes.filter(
              (lt) => lt.id === group.leaveTypeId || !usedLeaveTypeIds.has(lt.id)
            );
            return (
              <div key={gi} className="rounded-xl border border-zinc-200 dark:border-zinc-700">
                {/* Leave type header */}
                <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
                  <select
                    value={group.leaveTypeId}
                    onChange={(e) => changeLeaveType(gi, e.target.value)}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-sm font-medium focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  >
                    {leaveTypesForRow.map((lt) => (
                      <option key={lt.id} value={lt.id}>{lt.name}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => addTier(gi)} className="flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400">
                      <Plus className="h-3 w-3" /> Add tier
                    </button>
                    <button type="button" onClick={() => removeLeaveType(gi)} className="text-zinc-400 hover:text-red-500">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Tier rows */}
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {group.tiers.map((tier, ti) => (
                    <div key={ti} className="px-4 py-3">
                      {/* Tenure range header */}
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Tenure</span>
                          <div className="flex items-center gap-1">
                            <input
                              type="number" min="0" step="1" value={tier.minTenureMonths}
                              onChange={(e) => updateTier(gi, ti, "minTenureMonths", parseInt(e.target.value, 10) || 0)}
                              className="w-14 rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                            />
                            <span className="text-xs text-zinc-400">–</span>
                            <input
                              type="number" min="1" step="1" value={tier.maxTenureMonths ?? ""}
                              onChange={(e) => updateTier(gi, ti, "maxTenureMonths", e.target.value !== "" ? parseInt(e.target.value, 10) : null)}
                              placeholder="∞"
                              className="w-14 rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                            />
                            <span className="text-xs text-zinc-400">months</span>
                          </div>
                        </div>
                        {group.tiers.length > 1 && (
                          <button type="button" onClick={() => removeTier(gi, ti)} className="text-zinc-300 hover:text-red-500 dark:text-zinc-600">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Tier values */}
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className={smLabelCls}>Annual Hours</label>
                          <input type="number" min="0" max="9999" step="1"
                            value={tier.annualHours === 0 ? "" : tier.annualHours}
                            placeholder="0"
                            onChange={(e) => updateTier(gi, ti, "annualHours", e.target.value === "" ? 0 : (parseInt(e.target.value, 10) || 0))}
                            className={smInputCls}
                          />
                        </div>
                        <div>
                          <label className={smLabelCls}>+ Hrs/Yr Tenure</label>
                          <input type="number" min="0" max="999" step="1"
                            value={tier.earnedHoursPerYear === 0 ? "" : tier.earnedHoursPerYear}
                            placeholder="0"
                            onChange={(e) => updateTier(gi, ti, "earnedHoursPerYear", e.target.value === "" ? 0 : (parseInt(e.target.value, 10) || 0))}
                            className={smInputCls}
                          />
                        </div>
                        <div>
                          <label className={smLabelCls}>Carry-Over Hrs</label>
                          <input type="number" min="0" max="9999" step="1"
                            value={tier.carryOverHours ?? ""}
                            onChange={(e) => updateTier(gi, ti, "carryOverHours", e.target.value !== "" ? parseInt(e.target.value, 10) : null)}
                            placeholder="Unlimited"
                            className={smInputCls}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
        <button type="submit" disabled={isPending} className={saveBtnCls}>
          {isPending ? "Saving…" : initial ? "Save Changes" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className={cancelBtnCls}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Main manager ─────────────────────────────────────────────────────────────

export function PtoPoliciesManager({ policies, leaveTypes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function openEdit(p: Policy) { setEditingPolicy(p); setConfirmDeleteId(null); setError(null); }
  function closeEdit() { setEditingPolicy(null); setConfirmDeleteId(null); setError(null); }
  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }

  function handleCreate(e: React.FormEvent<HTMLFormElement>, rules: Rule[]) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createPtoPolicy({
        name:        fd.get("name") as string,
        description: (fd.get("description") as string) || undefined,
        isDefault:   fd.get("isDefault") === "true",
        rules,
      });
      if ("success" in result && !result.success) { setError((result as { success: false; error: string }).error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(policy: Policy, e: React.FormEvent<HTMLFormElement>, rules: Rule[]) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      await updatePtoPolicy({
        ptoPolicyId: policy.id,
        name:        fd.get("name") as string,
        description: (fd.get("description") as string) || null,
        isDefault:   fd.get("isDefault") === "true",
        isActive:    fd.get("isActive") === "true",
        rules,
      });
      closeEdit();
      router.refresh();
    });
  }

  function handleDelete(policyId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deletePtoPolicy({ ptoPolicyId: policyId });
      if (!result.success) { setError(result.error); setConfirmDeleteId(null); return; }
      setConfirmDeleteId(null);
      closeEdit();
      router.refresh();
    });
  }

  // Summarise a policy's rules grouped by leave type for tile display
  function summariseRules(rules: RuleFromServer[]) {
    const grouped = groupRules(rules);
    return grouped.map((g) => {
      const lt = rules.find((r) => r.leaveTypeId === g.leaveTypeId)?.leaveType;
      return { name: lt?.name ?? g.leaveTypeId, tierCount: g.tiers.length };
    });
  }

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-2">
        {policies.length === 0 && <p className="text-sm text-zinc-400">No PTO policies yet. Add one below.</p>}
        {policies.map((policy) => {
          const summary = summariseRules(policy.rules);
          return (
            <button
              key={policy.id}
              type="button"
              onClick={() => openEdit(policy)}
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
            >
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-medium ${policy.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                    {policy.name}
                  </span>
                  {policy.isDefault && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Default</span>
                  )}
                  {!policy.isActive && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">Inactive</span>
                  )}
                </div>
                <span className="text-xs text-zinc-400">Click to edit →</span>
              </div>
              {summary.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                  {summary.map((s, i) => (
                    <span key={i}>
                      <span className="text-zinc-700 dark:text-zinc-300">{s.name}</span>
                      {s.tierCount > 1 && <span className="ml-1 text-zinc-400">({s.tierCount} tiers)</span>}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-zinc-400">No leave types configured</p>
              )}
              {policy._count.siteLinks + policy._count.empOverrides > 0 && (
                <p className="mt-0.5 text-xs text-zinc-400">
                  {policy._count.siteLinks} site{policy._count.siteLinks !== 1 ? "s" : ""} · {policy._count.empOverrides} override{policy._count.empOverrides !== 1 ? "s" : ""}
                </p>
              )}
            </button>
          );
        })}
      </div>

      <button onClick={openCreate} className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:hover:border-zinc-400">
        + Add Policy
      </button>

      {showCreate && (
        <Modal title="New PTO Policy" onClose={closeCreate}>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
          <PolicyForm leaveTypes={leaveTypes} isPending={isPending} onSubmit={handleCreate} onCancel={closeCreate} />
        </Modal>
      )}

      {editingPolicy && (
        <Modal title={`Edit: ${editingPolicy.name}`} onClose={closeEdit}>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
          <PolicyForm
            leaveTypes={leaveTypes}
            initial={editingPolicy}
            isPending={isPending}
            onSubmit={(e, rules) => handleUpdate(editingPolicy, e, rules)}
            onCancel={closeEdit}
          />
          <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-700">
            {confirmDeleteId === editingPolicy.id ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Are you sure?</span>
                <button type="button" onClick={() => handleDelete(editingPolicy.id)} disabled={isPending} className={dangerBtnCls}>
                  {isPending ? "Deleting…" : "Yes, delete"}
                </button>
                <button type="button" onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDeleteId(editingPolicy.id)} className="flex items-center gap-1.5 text-xs text-red-500 hover:underline dark:text-red-400">
                <Trash2 className="h-3.5 w-3.5" /> Delete policy
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
