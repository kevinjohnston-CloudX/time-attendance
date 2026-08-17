"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createPayCategory, updatePayCategory, deletePayCategory } from "@/actions/pay-category.actions";

type PolicyRule = { leaveTypeId: string; leaveType: { id: string; name: string } };
type PolicyOption = { id: string; name: string; rules: PolicyRule[] };
type LeaveTypeOption = { id: string; name: string };

type CategoryWithPolicies = {
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
  ptoPolicies: PolicyOption[];
  leaveTypes: LeaveTypeOption[];
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

function CategoryFields({ category, defaultNumber }: { category?: CategoryWithPolicies; defaultNumber?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Category Number</label>
        <input name="number" type="number" min="1" max="9999" required defaultValue={category?.number ?? defaultNumber ?? ""} placeholder="e.g. 100" className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Description</label>
        <input name="description" maxLength={255} defaultValue={category?.description ?? ""} placeholder="e.g. Full-Time Hourly" className={inputCls} />
      </div>
    </div>
  );
}

// ─── Policy picker sub-component ──────────────────────────────────────────────

function PolicyPicker({
  assigned,
  allPolicies,
  onChange,
}: {
  assigned: PolicyOption[];
  allPolicies: PolicyOption[];
  onChange: (policies: PolicyOption[]) => void;
}) {
  const [pickerId, setPickerId] = useState("");
  const [overlapError, setOverlapError] = useState<string | null>(null);

  const assignedIds = new Set(assigned.map((p) => p.id));
  const available = allPolicies.filter((p) => !assignedIds.has(p.id));

  function handleAdd() {
    if (!pickerId) return;
    const policy = allPolicies.find((p) => p.id === pickerId);
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
    onChange([...assigned, policy]);
  }

  function handleRemove(id: string) {
    setOverlapError(null);
    onChange(assigned.filter((p) => p.id !== id));
  }

  return (
    <div className="mt-4">
      <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-500">Leave Policies</label>

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

function LeaveTypePicker({
  allLeaveTypes,
  initialAvailableIds,
  onChange,
}: {
  allLeaveTypes: LeaveTypeOption[];
  initialAvailableIds: string[] | null;
  onChange: (availableIds: string[]) => void;
}) {
  const [availableIds, setAvailableIds] = useState<Set<string>>(() => {
    // null = no existing config → default all available
    if (initialAvailableIds === null) return new Set(allLeaveTypes.map((lt) => lt.id));
    return new Set(initialAvailableIds);
  });

  function move(id: string, toAvailable: boolean) {
    setAvailableIds((prev) => {
      const next = new Set(prev);
      if (toAvailable) next.add(id); else next.delete(id);
      onChange([...next]);
      return next;
    });
  }

  const availableList   = allLeaveTypes.filter((lt) =>  availableIds.has(lt.id));
  const unavailableList = allLeaveTypes.filter((lt) => !availableIds.has(lt.id));

  const boxCls = "min-h-[120px] rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50 flex flex-col gap-1";
  const itemCls = "w-full rounded px-2 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors";

  return (
    <div className="mt-4">
      <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-500">Available for Leave Request</label>
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

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Main manager ─────────────────────────────────────────────────────────────

export function PayCategoriesManager({ categories, ptoPolicies, leaveTypes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingCat, setEditingCat] = useState<CategoryWithPolicies | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const [createPolicies, setCreatePolicies] = useState<PolicyOption[]>([]);
  const [editPolicies,   setEditPolicies]   = useState<PolicyOption[]>([]);

  const [createLimitLeaveTypes, setCreateLimitLeaveTypes] = useState(false);
  const [editLimitLeaveTypes,   setEditLimitLeaveTypes]   = useState(false);

  const [createAvailableLeaveTypeIds, setCreateAvailableLeaveTypeIds] = useState<string[]>(() =>
    leaveTypes.map((lt) => lt.id)
  );
  const [editAvailableLeaveTypeIds, setEditAvailableLeaveTypeIds] = useState<string[]>([]);

  const visible = showInactive ? categories : categories.filter((c) => c.isActive);

  function openEdit(cat: CategoryWithPolicies) {
    setEditingCat(cat);
    setEditPolicies(cat.ptoPolicies.map((link) => link.ptoPolicy));
    setEditLimitLeaveTypes(cat.limitLeaveTypes);
    const ids = cat.availableLeaveTypes.length === 0
      ? leaveTypes.map((lt) => lt.id)
      : cat.availableLeaveTypes.map((r) => r.leaveTypeId);
    setEditAvailableLeaveTypeIds(ids);
    setConfirmDeleteId(null);
    setError(null);
  }
  function closeEdit() { setEditingCat(null); setConfirmDeleteId(null); setError(null); }
  function openCreate() {
    setShowCreate(true);
    setCreatePolicies([]);
    setCreateLimitLeaveTypes(false);
    setCreateAvailableLeaveTypeIds(leaveTypes.map((lt) => lt.id));
    setError(null);
  }
  function closeCreate() { setShowCreate(false); setError(null); }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createPayCategory({
        number:                fd.get("number"),
        description:           (fd.get("description") as string) || undefined,
        ptoPolicyIds:          createPolicies.map((p) => p.id),
        limitLeaveTypes:       createLimitLeaveTypes,
        availableLeaveTypeIds: createLimitLeaveTypes ? createAvailableLeaveTypeIds : [],
      });
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(cat: CategoryWithPolicies, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updatePayCategory({
        id:                    cat.id,
        number:                fd.get("number"),
        description:           (fd.get("description") as string) || undefined,
        isActive:              fd.get("isActive") === "true",
        ptoPolicyIds:          editPolicies.map((p) => p.id),
        limitLeaveTypes:       editLimitLeaveTypes,
        availableLeaveTypeIds: editLimitLeaveTypes ? editAvailableLeaveTypeIds : [],
      });
      if (!result.success) { setError(result.error); return; }
      closeEdit();
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deletePayCategory({ id });
      if (!result.success) { setError(result.error); setConfirmDeleteId(null); return; }
      setConfirmDeleteId(null);
      closeEdit();
      router.refresh();
    });
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
        {visible.length === 0 && <p className="text-sm text-zinc-400">No pay categories yet. Add one below.</p>}

        {visible.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => openEdit(cat)}
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
                <span className="text-xs text-zinc-400">Click to edit →</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={openCreate}
        className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
      >
        + Add Pay Category
      </button>

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Pay Category" onClose={closeCreate}>
          <form onSubmit={handleCreate}>
            <CategoryFields defaultNumber={Math.max(0, ...categories.map((c) => c.number)) + 1} />
            <PolicyPicker assigned={createPolicies} allPolicies={ptoPolicies} onChange={setCreatePolicies} />
            {leaveTypes.length > 0 && (
              <div className="mt-4">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={createLimitLeaveTypes}
                    onChange={(e) => setCreateLimitLeaveTypes(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Limit leave request options</span>
                </label>
                {createLimitLeaveTypes && (
                  <LeaveTypePicker
                    allLeaveTypes={leaveTypes}
                    initialAvailableIds={null}
                    onChange={setCreateAvailableLeaveTypeIds}
                  />
                )}
              </div>
            )}
            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
            )}
            <div className="mt-4 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create"}</button>
              <button type="button" onClick={closeCreate} className={cancelBtnCls}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editingCat && (
        <Modal title={`Edit: ${editingCat.number}${editingCat.description ? ` — ${editingCat.description}` : ""}`} onClose={closeEdit}>
          <form onSubmit={(e) => handleUpdate(editingCat, e)}>
            <CategoryFields category={editingCat} />
            <div className="mt-3 w-32">
              <label className="mb-1 block text-xs text-zinc-500">Status</label>
              <select name="isActive" defaultValue={editingCat.isActive ? "true" : "false"} className={inputCls}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <PolicyPicker assigned={editPolicies} allPolicies={ptoPolicies} onChange={setEditPolicies} />
            {leaveTypes.length > 0 && (
              <div className="mt-4">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={editLimitLeaveTypes}
                    onChange={(e) => setEditLimitLeaveTypes(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Limit leave request options</span>
                </label>
                {editLimitLeaveTypes && (
                  <LeaveTypePicker
                    key={editingCat.id}
                    allLeaveTypes={leaveTypes}
                    initialAvailableIds={
                      editingCat.availableLeaveTypes.length === 0
                        ? null
                        : editingCat.availableLeaveTypes.map((r) => r.leaveTypeId)
                    }
                    onChange={setEditAvailableLeaveTypeIds}
                  />
                )}
              </div>
            )}
            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
            )}
            <div className="mt-4 flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <div className="flex gap-2">
                <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Saving…" : "Save changes"}</button>
                <button type="button" onClick={closeEdit} className={cancelBtnCls}>Cancel</button>
              </div>
              {confirmDeleteId === editingCat.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">Are you sure?</span>
                  <button type="button" onClick={() => handleDelete(editingCat.id)} disabled={isPending} className={dangerBtnCls}>
                    {isPending ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDeleteId(editingCat.id)} className="text-xs text-red-500 hover:underline dark:text-red-400">
                  Delete category
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
