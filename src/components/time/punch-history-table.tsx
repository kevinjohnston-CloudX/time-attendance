import { format } from "date-fns";
import { PUNCH_TYPE_LABEL } from "@/lib/state-machines/labels";
import type { Punch, PunchSource } from "@prisma/client";

const SOURCE_LABEL: Record<PunchSource, string> = {
  WEB: "Web",
  KIOSK: "Kiosk",
  MOBILE: "Mobile",
  MANUAL: "Manual",
  SYSTEM: "System",
};

interface PunchHistoryTableProps {
  punches: Punch[];
}

export function PunchHistoryTable({ punches }: PunchHistoryTableProps) {
  if (punches.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">
        No punches this pay period.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Date</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Time</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Rounded</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Type</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Source</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {punches.map((punch) => {
            const isSuperseded = !!punch.correctedById;
            const isCorrection = !!punch.correctsId;
            return (
              <tr
                key={punch.id}
                className={`${
                  isSuperseded
                    ? "bg-zinc-50/50 opacity-50 dark:bg-zinc-900/20"
                    : "bg-white dark:bg-zinc-900"
                }`}
              >
                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                  {format(punch.punchTime, "MMM d")}
                </td>
                <td className={`px-4 py-3 font-mono ${isSuperseded ? "line-through text-zinc-400" : "text-zinc-700 dark:text-zinc-300"}`}>
                  {format(punch.punchTime, "h:mm:ss a")}
                </td>
                <td className="px-4 py-3 font-mono text-zinc-700 dark:text-zinc-300">
                  {format(punch.roundedTime, "h:mm a")}
                </td>
                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                  <span className="inline-flex items-center gap-1">
                    {PUNCH_TYPE_LABEL[punch.punchType]}
                    {isCorrection && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                        correction
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {SOURCE_LABEL[punch.source]}
                </td>
                <td className="px-4 py-3">
                  {isSuperseded ? (
                    <span className="text-xs text-zinc-400">superseded</span>
                  ) : punch.isApproved ? (
                    <span className="text-xs text-green-600 dark:text-green-400">approved</span>
                  ) : (
                    <span className="text-xs text-amber-600 dark:text-amber-400">pending</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
