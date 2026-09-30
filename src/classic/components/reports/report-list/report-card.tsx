"use client";

import Link from "next/link";
import {
  Clock,
  CalendarDays,
  Wallet,
  FileSearch,
  AlertCircle,
  FileText,
} from "lucide-react";

const SOURCE_ICONS: Record<string, React.ElementType> = {
  HOURS_SUMMARY: Clock,
  ATTENDANCE_DETAIL: CalendarDays,
  LEAVE_SUMMARY: CalendarDays,
  LEAVE_BALANCE: Wallet,
  PUNCH_AUDIT: FileSearch,
  EXCEPTION_REPORT: AlertCircle,
};

const SOURCE_LABELS: Record<string, string> = {
  HOURS_SUMMARY: "Hours Summary",
  ATTENDANCE_DETAIL: "Attendance Detail",
  LEAVE_SUMMARY: "Leave Summary",
  LEAVE_BALANCE: "Leave Balances",
  PUNCH_AUDIT: "Punch Audit",
  EXCEPTION_REPORT: "Exception Report",
};

interface ReportCardProps {
  report: {
    id: string;
    name: string;
    description?: string | null;
    dataSource: string;
    updatedAt: Date | string;
    owner?: { name: string | null } | null;
    _count?: { runs: number };
  };
}

export function ReportCard({ report }: ReportCardProps) {
  const Icon = SOURCE_ICONS[report.dataSource] ?? FileText;
  const sourceLabel = SOURCE_LABELS[report.dataSource] ?? report.dataSource;
  const updated = new Date(report.updatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Link
      href={`/reports/${report.id}`}
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {sourceLabel}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
        {report.name}
      </h3>
      {report.description && (
        <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
          {report.description}
        </p>
      )}
      <div className="mt-auto flex items-center gap-3 text-xs text-zinc-400">
        <span>Updated {updated}</span>
        {report._count && report._count.runs > 0 && (
          <span>{report._count.runs} runs</span>
        )}
        {report.owner?.name && <span>by {report.owner.name}</span>}
      </div>
    </Link>
  );
}
