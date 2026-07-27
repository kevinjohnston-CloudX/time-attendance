"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPayCategory, updatePayCategory, deletePayCategory } from "@/actions/pay-category.actions";
import type { PayCategory } from "@prisma/client";

interface Props {
  categories: PayCategory[];
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

function CategoryFields({ category }: { category?: PayCategory }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Category Number</label>
        <input
          name="number"
          type="number"
          min="1"
          max="9999"
          required
          defaultValue={category?.number ?? ""}
          placeholder="e.g. 100"
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Description</label>
        <input
          name="description"
          maxLength={255}
          defaultValue={category?.description ?? ""}
          placeholder="e.g. Full-Time Hourly"
          className={inputCls}
        />
      </div>
    </div>
  );
}

export function PayCategoriesManager({ categories }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const visible = showInactive ? categories : categories.filter((c) => c.isActive);

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createPayCategory({
        number:      fd.get("number"),
        description: (fd.get("description") as string) || undefined,
      });
      if (!result.success) { setError(result.error); return; }
      setShowCreate(false);
      router.refresh();
    });
  }

  function handleUpdate(cat: PayCategory, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updatePayCategory({
        id:          cat.id,
        number:      fd.get("number"),
        description: (fd.get("description") as string) || undefined,
        isActive:    fd.get("isActive") === "true",
      });
      if (!result.success) { setError(result.error); return; }
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deletePayCategory({ id });
      if (!result.success) { setError(result.error); return; }
      setConfirmDeleteId(null);
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
          <p className="text-sm text-zinc-400">No pay categories yet. Add one below.</p>
        )}

        {visible.map((cat) => {
          if (confirmDeleteId === cat.id) {
            return (
              <div
                key={cat.id}
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/40 dark:bg-red-900/10"
              >
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  Delete category <span className="font-semibold">{cat.number}</span>? This cannot be undone.
                </p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => handleDelete(cat.id)} disabled={isPending} className={dangerBtnCls}>
                    {isPending ? "Deleting…" : "Delete"}
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>
                    Cancel
                  </button>
                </div>
              </div>
            );
          }

          if (editingId === cat.id) {
            return (
              <form
                key={cat.id}
                onSubmit={(e) => handleUpdate(cat, e)}
                className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-800/40 dark:bg-blue-900/10"
              >
                <CategoryFields category={cat} />
                <div className="mt-3 w-32">
                  <label className="mb-1 block text-xs text-zinc-500">Status</label>
                  <select name="isActive" defaultValue={cat.isActive ? "true" : "false"} className={inputCls}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="submit" disabled={isPending} className={saveBtnCls}>
                    {isPending ? "Saving…" : "Save"}
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className={cancelBtnCls}>
                    Cancel
                  </button>
                </div>
              </form>
            );
          }

          return (
            <div
              key={cat.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-4">
                <span className="font-mono font-semibold text-zinc-900 dark:text-white">{cat.number}</span>
                {cat.description && (
                  <span className="text-sm text-zinc-500">{cat.description}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  cat.isActive
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                }`}>
                  {cat.isActive ? "Active" : "Inactive"}
                </span>
                <button
                  onClick={() => { setEditingId(cat.id); setConfirmDeleteId(null); }}
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  Edit
                </button>
                <button
                  onClick={() => { setConfirmDeleteId(cat.id); setEditingId(null); }}
                  className="text-xs text-red-500 hover:underline dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showCreate ? (
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">New Pay Category</p>
          <CategoryFields />
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={isPending} className={saveBtnCls}>
              {isPending ? "Creating…" : "Create"}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className={cancelBtnCls}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="mt-4 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600"
        >
          + Add Pay Category
        </button>
      )}
    </div>
  );
}
