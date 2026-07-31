"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignEmployeePtoPolicyOverride } from "@/actions/pto-policy.actions";

type PolicyOption = { id: string; name: string };

interface Props {
  employeeId: string;
  policies: PolicyOption[];
  currentPolicyId: string | null;
}

export function EmployeePtoPolicyPanel({ employeeId, policies, currentPolicyId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(currentPolicyId ?? "");

  function handleChange(ptoPolicyId: string) {
    setSelected(ptoPolicyId);
    setError(null);
    startTransition(async () => {
      const result = await assignEmployeePtoPolicyOverride({
        employeeId,
        ptoPolicyId: ptoPolicyId || null,
      });
      if (result && !result.success) {
        setError((result as { success: false; error: string }).error);
        setSelected(currentPolicyId ?? "");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <select
          value={selected}
          onChange={(e) => handleChange(e.target.value)}
          disabled={isPending}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white disabled:opacity-60"
        >
          <option value="">— No override (use site / tenant default) —</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {isPending && <span className="text-xs text-zinc-400">Saving…</span>}
      </div>
      {selected && (
        <p className="mt-1.5 text-xs text-zinc-400">
          This policy overrides the site default for all leave types it covers.
        </p>
      )}
    </div>
  );
}
