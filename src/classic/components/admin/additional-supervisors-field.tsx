"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAdditionalSupervisors } from "@/actions/admin.actions";

/**
 * Supervisors besides the supervisor of record, Classic. Saved on its own,
 * like Site Access: they see this person on their team screens, with what
 * their own role allows.
 */
export function AdditionalSupervisorsField({
  employeeId,
  supervisorId,
  saved,
  employees,
  labelCls,
  inputCls,
}: {
  employeeId: string;
  supervisorId: string | null;
  saved: { id: string; name: string; isActive: boolean }[];
  employees: { id: string; user: { name: string | null } }[];
  labelCls: string;
  inputCls: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [list, setList] = useState<string[]>(saved.map((s) => s.id));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const nameOf = (id: string) =>
    employees.find((e) => e.id === id)?.user.name ?? saved.find((s) => s.id === id)?.name ?? id;
  const changed = list.length !== saved.length || list.some((id) => !saved.some((s) => s.id === id));

  function save() {
    setMsg(null);
    startTransition(async () => {
      const result = await updateAdditionalSupervisors({ employeeId, supervisorIds: list });
      if (result.success) {
        setMsg({ ok: true, text: "Additional supervisors saved." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: result.error ?? "Failed to save." });
      }
    });
  }

  return (
    <div className="col-span-2">
      <label className={labelCls}>Additional Supervisors</label>
      {list.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {list.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-2.5 pr-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {nameOf(id)}
              <button
                type="button"
                onClick={() => setList((l) => l.filter((x) => x !== id))}
                aria-label={`Remove ${nameOf(id)}`}
                className="rounded-full px-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <select
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (id) setList((l) => (l.includes(id) ? l : [...l, id]));
          }}
          className={inputCls}
        >
          <option value="">— Add a supervisor —</option>
          {employees
            .filter((e) => e.id !== employeeId && e.id !== supervisorId && !list.includes(e.id))
            .map((e) => <option key={e.id} value={e.id}>{e.user.name}</option>)}
        </select>
        {changed && (
          <button
            type="button"
            disabled={isPending}
            onClick={save}
            className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-400">
        They see this person on their team screens, with what their own role allows. The supervisor above stays the one on record.
      </p>
      {msg && <p className={`mt-1 text-xs ${msg.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}
