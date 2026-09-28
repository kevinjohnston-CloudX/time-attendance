"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createHolidayRule } from "@/actions/holiday-rule.actions";
import { HolidayRuleFields, buildPayload } from "@/components/admin/holiday-rules-manager";

const saveBtnCls = "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";

interface Props { payCodes: { id: string; code: string; label: string }[] }

export function CreateHolidayRuleClient({ payCodes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const payload = buildPayload(new FormData(e.currentTarget));
    setError(null);
    startTransition(async () => {
      const result = await createHolidayRule(payload);
      if (!result.success) { setError(result.error); return; }
      router.push("/admin/rules-setup?tab=holiday-rules");
    });
  }

  return (
    <div className="mt-6">
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      <form onSubmit={handleCreate}>
        <HolidayRuleFields payCodes={payCodes} />
        <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <button type="submit" disabled={isPending} className={saveBtnCls}>{isPending ? "Creating…" : "Create rule"}</button>
          <button type="button" onClick={() => router.push("/admin/rules-setup?tab=holiday-rules")} className={cancelBtnCls}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
