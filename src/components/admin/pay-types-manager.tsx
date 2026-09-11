"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPayType, updatePayType, deletePayType } from "@/actions/pay-type.actions";

type PayType = {
  id: string;
  number: number;
  description: string | null;
  includeInEmployeeSetup: boolean;
  isActive: boolean;
};

interface Props {
  payTypes: PayType[];
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

function PayTypeFields({ payType }: { payType?: PayType }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Type Number</label>
          <input
            name="number"
            type="number"
            min="1"
            max="9999"
            required
            defaultValue={payType?.number ?? ""}
            placeholder="e.g. 3"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Description</label>
          <input
            name="description"
            maxLength={255}
            defaultValue={payType?.description ?? ""}
            placeholder="e.g. Non-Exempt"
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Include in Employee Setup</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="radio"
              name="includeInEmployeeSetup"
              value="true"
              defaultChecked={payType ? payType.includeInEmployeeSetup : true}
            />
            Include
          </label>
          <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="radio"
              name="includeInEmployeeSetup"
              value="false"
              defaultChecked={payType ? !payType.includeInEmployeeSetup : false}
            />
            Exclude
          </label>
        </div>
      </div>
    </div>
  );
}

export function PayTypesManager({ payTypes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PayType | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const searchLower = search.trim().toLowerCase();
  const visible = (showInactive ? payTypes : payTypes.filter((pt) => pt.isActive))
    .filter((pt) => !searchLower ||
      String(pt.number).includes(searchLower) ||
      (pt.description ?? "").toLowerCase().includes(searchLower)
    );

  function act(fn: () => Promise<{ success: true } | { success: true; data: unknown }>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        setEditing(null);
        setShowCreate(false);
        setConfirmDeleteId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    act(() => createPayType({
      number: fd.get("number"),
      description: fd.get("description") as string,
      includeInEmployeeSetup: fd.get("includeInEmployeeSetup") !== "false",
    }) as Promise<{ success: true; data: unknown }>);
  }

  function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    act(() => updatePayType({
      id: editing.id,
      number: fd.get("number"),
      description: fd.get("description") as string,
      includeInEmployeeSetup: fd.get("includeInEmployeeSetup") !== "false",
      isActive: fd.get("isActive") === "true",
    }) as Promise<{ success: true }>);
  }

  function handleDelete() {
    if (!editing) return;
    act(() => deletePayType({ id: editing.id }) as Promise<{ success: true }>);
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
        <div className="relative max-w-xs flex-1">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search pay types…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm text-zinc-700 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-500">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
          Show inactive
        </label>
        <button
          onClick={() => { setShowCreate(true); setEditing(null); setError(null); }}
          className="ml-auto rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + Add Pay Type
        </button>
      </div>

      {/* List */}
      <div className="flex flex-col gap-2">
        {visible.length === 0 && (
          <p className="text-sm text-zinc-400">
            {searchLower ? `No pay types match "${search}".` : "No pay types yet."}
          </p>
        )}
        {visible.map((pt) => (
          <button
            key={pt.id}
            type="button"
            onClick={() => { setEditing(pt); setShowCreate(false); setConfirmDeleteId(null); setError(null); }}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="font-mono text-sm text-zinc-400">{pt.number}</span>
                <span className={`font-medium ${pt.isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                  {pt.description ?? "—"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${pt.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                  {pt.isActive ? "Active" : "Inactive"}
                </span>
                <span className="text-xs text-zinc-400">Click to edit →</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <h3 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-white">New Pay Type</h3>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <PayTypeFields />
            <div className="flex gap-2">
              <button type="submit" disabled={isPending} className={saveBtnCls}>
                {isPending ? "Saving…" : "Create"}
              </button>
              <button type="button" onClick={() => { setShowCreate(false); setError(null); }} className={cancelBtnCls}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit form */}
      {editing && !showCreate && (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <h3 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-white">Edit Pay Type</h3>
          <form onSubmit={handleUpdate} className="flex flex-col gap-4">
            <PayTypeFields payType={editing} />

            <div>
              <label className="mb-1 block text-xs text-zinc-500">Status</label>
              <select name="isActive" defaultValue={editing.isActive ? "true" : "false"} className={inputCls}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>

            {confirmDeleteId === editing.id ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-600">Delete this pay type?</span>
                <button type="button" onClick={handleDelete} disabled={isPending} className={dangerBtnCls}>
                  {isPending ? "Deleting…" : "Yes, delete"}
                </button>
                <button type="button" onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button type="submit" disabled={isPending} className={saveBtnCls}>
                  {isPending ? "Saving…" : "Save Changes"}
                </button>
                <button type="button" onClick={() => setConfirmDeleteId(editing.id)} className={dangerBtnCls}>
                  Delete
                </button>
                <button type="button" onClick={() => { setEditing(null); setError(null); }} className={cancelBtnCls}>
                  Cancel
                </button>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
