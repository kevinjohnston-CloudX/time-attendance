"use client";

export type LeaveLogEntry = {
  id: string;
  date: string;
  type: "policy_assigned" | "policy_cleared" | "adjustment" | "tier_change" | "yearly_increase";
  label: string;
  detail: string;
  actorName: string | null;
};

const TYPE_STYLES: Record<LeaveLogEntry["type"], { dot: string; badge: string }> = {
  policy_assigned: {
    dot: "bg-blue-400 dark:bg-blue-500",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  policy_cleared: {
    dot: "bg-zinc-400 dark:bg-zinc-500",
    badge: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
  adjustment: {
    dot: "bg-amber-400 dark:bg-amber-500",
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  tier_change: {
    dot: "bg-emerald-400 dark:bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  yearly_increase: {
    dot: "bg-emerald-400 dark:bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
};

export function LeaveHistoryPanel({ entries }: { entries: LeaveLogEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-zinc-400">No leave history recorded yet.</p>;
  }

  return (
    <ol className="relative border-l border-zinc-200 dark:border-zinc-700">
      {entries.map((entry) => {
        const styles = TYPE_STYLES[entry.type];
        return (
          <li key={entry.id} className="mb-5 ml-4 last:mb-0">
            <div
              className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white dark:border-zinc-900 ${styles.dot}`}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${styles.badge}`}>
                {entry.label}
              </span>
              <time className="text-xs text-zinc-500 dark:text-zinc-400">
                {new Date(entry.date).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
              </time>
              {entry.actorName && (
                <span className="text-xs text-zinc-400">by {entry.actorName}</span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">{entry.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}
