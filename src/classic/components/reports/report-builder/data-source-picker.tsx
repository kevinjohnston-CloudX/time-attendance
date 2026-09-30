"use client";

import {
  Clock,
  CalendarDays,
  Wallet,
  FileSearch,
  AlertCircle,
} from "lucide-react";
import type { DataSourceId } from "@/lib/validators/report.schema";

const ICONS: Record<string, React.ElementType> = {
  Clock,
  CalendarDays,
  Wallet,
  FileSearch,
  AlertCircle,
};

interface DataSourceMeta {
  id: DataSourceId;
  label: string;
  description: string;
  icon: string;
}

export function DataSourcePicker({
  sources,
  selected,
  onSelect,
}: {
  sources: DataSourceMeta[];
  selected: DataSourceId | null;
  onSelect: (id: DataSourceId) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sources.map((ds) => {
        const Icon = ICONS[ds.icon] ?? Clock;
        const isSelected = selected === ds.id;
        return (
          <button
            key={ds.id}
            type="button"
            onClick={() => onSelect(ds.id)}
            className={`flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors ${
              isSelected
                ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30"
                : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon
                className={`h-5 w-5 ${
                  isSelected
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-zinc-400"
                }`}
              />
              <span
                className={`text-sm font-semibold ${
                  isSelected
                    ? "text-blue-700 dark:text-blue-300"
                    : "text-zinc-900 dark:text-white"
                }`}
              >
                {ds.label}
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {ds.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
