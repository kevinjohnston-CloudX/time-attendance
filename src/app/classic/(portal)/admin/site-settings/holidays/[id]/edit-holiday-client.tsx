"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { updateHoliday, deleteHoliday } from "@/actions/holiday.actions";
import { HolidayFields } from "@/classic/components/admin/holidays-manager";

const saveBtnCls =
  "rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const cancelBtnCls =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300";

interface Props {
  holiday: {
    id: string;
    name: string;
    date: string;
    observedOn: string | null;
    bypassAfterEligibility: boolean;
    isActive: boolean;
    holidayRules?: { holidayRuleId: string }[];
  };
  holidayRules: { id: string; name: string; number?: number | null }[];
}

export function EditHolidayClient({ holiday, holidayRules }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateHoliday({
        holidayId: holiday.id,
        name: fd.get("name") as string,
        date: fd.get("date") as string,
        observedDate: (fd.get("observedOn") as string) || null,
        bypassAfterEligibility: fd.get("bypassAfterEligibility") === "true",
        isActive: fd.get("isActive") === "true",
        ruleIds: (fd.get("ruleIds") as string) || "",
      });
      if (!result.success) { setError(result.error); return; }
      router.push("/admin/site-settings?tab=holidays");
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteHoliday({ holidayId: holiday.id });
      if (!result.success) { setError(result.error); setConfirmDelete(false); return; }
      router.push("/admin/site-settings?tab=holidays");
    });
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}
      <form onSubmit={handleSave}>
        <HolidayFields
          holidayRules={holidayRules}
          initial={{
            name: holiday.name,
            date: holiday.date,
            observedOn: holiday.observedOn,
            bypassAfterEligibility: holiday.bypassAfterEligibility,
            isActive: holiday.isActive,
            holidayRules: holiday.holidayRules,
          }}
          mode="edit"
        />
        <div className="mt-6 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <button type="submit" disabled={isPending} className={saveBtnCls}>
            {isPending ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/site-settings?tab=holidays")}
            className={cancelBtnCls}
          >
            Cancel
          </button>
        </div>
      </form>

      {/* Delete section */}
      <div className="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-700">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700"
          >
            <Trash2 className="h-4 w-4" /> Delete Holiday
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Delete this holiday permanently?
            </span>
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {isPending ? "Deleting…" : "Yes, delete"}
            </button>
            <button onClick={() => setConfirmDelete(false)} className={cancelBtnCls}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
