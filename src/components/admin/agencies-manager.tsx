"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createAgency, updateAgency, deleteAgency } from "@/actions/agency.actions";

type Agency = {
  id: string;
  code: number;
  description: string;
  laborRate: number;
  chargeRate: number;
  inactiveOn: string | null;
  maxWorkHours: number;
};

interface Props {
  agencies: Agency[];
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";
const dangerBtnCls =
  "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

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
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
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

function AgencyFields({ agency }: { agency?: Agency }) {
  const [hasInactiveOn, setHasInactiveOn] = useState(!!agency?.inactiveOn);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs text-zinc-500">
          Agency Code <span className="text-red-500">*</span>
        </label>
        <input
          name="code"
          type="number"
          min={0}
          required
          defaultValue={agency?.code ?? 0}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">
          Description <span className="text-red-500">*</span>
        </label>
        <input
          name="description"
          required
          maxLength={255}
          defaultValue={agency?.description ?? ""}
          placeholder="e.g. Bergen"
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Labor Rate</label>
        <input
          name="laborRate"
          type="number"
          step="0.000001"
          min={0}
          defaultValue={agency?.laborRate ?? 0}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Charge Rate</label>
        <input
          name="chargeRate"
          type="number"
          step="0.000001"
          min={0}
          defaultValue={agency?.chargeRate ?? 0}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Max Allowed Work Hours</label>
        <input
          name="maxWorkHours"
          type="number"
          step="0.01"
          min={0}
          defaultValue={agency?.maxWorkHours ?? 0}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Inactive On</label>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="inactiveOnToggle"
            checked={hasInactiveOn}
            onChange={(e) => setHasInactiveOn(e.target.checked)}
            className="rounded"
          />
          {hasInactiveOn ? (
            <input
              name="inactiveOn"
              type="date"
              defaultValue={agency?.inactiveOn ? agency.inactiveOn.split("T")[0] : ""}
              className={`${inputCls} flex-1`}
            />
          ) : (
            <span className="text-sm text-zinc-400">Not set</span>
          )}
        </div>
        {!hasInactiveOn && <input type="hidden" name="inactiveOn" value="" />}
      </div>
    </div>
  );
}

export function AgenciesManager({ agencies }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Agency | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const today = new Date().toISOString();
  const searchLower = search.trim().toLowerCase();
  const visible = agencies
    .filter((a) => showInactive || !a.inactiveOn || a.inactiveOn > today)
    .filter((a) =>
      !searchLower ||
      String(a.code).includes(searchLower) ||
      a.description.toLowerCase().includes(searchLower)
    );

  function closeAll() {
    setEditing(null);
    setShowCreate(false);
    setConfirmDeleteId(null);
    setError(null);
  }

  function act(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        closeAll();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  function readForm(fd: FormData) {
    return {
      code:         Number(fd.get("code")),
      description:  (fd.get("description") as string).trim(),
      laborRate:    Number(fd.get("laborRate")),
      chargeRate:   Number(fd.get("chargeRate")),
      maxWorkHours: Number(fd.get("maxWorkHours")),
      inactiveOn:   (fd.get("inactiveOn") as string) || null,
    };
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    act(() => createAgency(readForm(new FormData(e.currentTarget))));
  }

  function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    act(() => updateAgency({ id: editing.id, ...readForm(new FormData(e.currentTarget)) }));
  }

  function handleDelete() {
    if (!editing) return;
    act(() => deleteAgency({ id: editing.id }));
  }

  function isActive(a: Agency) {
    return !a.inactiveOn || a.inactiveOn > today;
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search agencies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm text-zinc-700 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
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
          + Add Agency
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {visible.length === 0 && (
          <p className="text-sm text-zinc-400">
            {searchLower ? `No agencies match "${search}".` : "No agencies yet."}
          </p>
        )}
        {visible.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => { setEditing(a); setShowCreate(false); setConfirmDeleteId(null); setError(null); }}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {a.code}
                </span>
                <span className={`font-medium ${isActive(a) ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}>
                  {a.description}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-400">
                  Labor: ${Number(a.laborRate).toFixed(6)} · Charge: ${Number(a.chargeRate).toFixed(6)}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${isActive(a) ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                  {isActive(a) ? "Active" : "Inactive"}
                </span>
                <span className="text-xs text-zinc-400">Click to edit →</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {showCreate && (
        <Modal title="New Agency" onClose={closeAll}>
          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
          )}
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <AgencyFields />
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Saving…" : "Create"}</button>
              <button type="button" onClick={closeAll} className={cancelBtnCls}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {editing && !showCreate && (
        <Modal title="Edit Agency" onClose={closeAll}>
          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
          )}
          <form onSubmit={handleUpdate} className="flex flex-col gap-4">
            <AgencyFields agency={editing} />
            {confirmDeleteId === editing.id ? (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-sm text-red-600">Delete this agency?</span>
                <button type="button" onClick={handleDelete} disabled={isPending} className={dangerBtnCls}>
                  {isPending ? "Deleting…" : "Yes, delete"}
                </button>
                <button type="button" onClick={() => setConfirmDeleteId(null)} className={cancelBtnCls}>Cancel</button>
              </div>
            ) : (
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Saving…" : "Save Changes"}</button>
                <button type="button" onClick={() => setConfirmDeleteId(editing.id)} className={dangerBtnCls}>Delete</button>
                <button type="button" onClick={closeAll} className={cancelBtnCls}>Cancel</button>
              </div>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}
