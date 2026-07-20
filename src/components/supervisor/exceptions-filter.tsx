"use client";

import { useRouter } from "next/navigation";

type Site = { id: string; name: string };
type Department = { id: string; name: string };

const EXCEPTION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "MISSING_PUNCH",    label: "Missing Punch" },
  { value: "LONG_SHIFT",       label: "Long Shift" },
  { value: "SHORT_BREAK",      label: "Short Break" },
  { value: "MISSED_MEAL",      label: "Missed Meal" },
  { value: "UNSCHEDULED_OT",   label: "Unscheduled OT" },
  { value: "CONSECUTIVE_DAYS", label: "Consecutive Days" },
  { value: "ABSENT",           label: "Absent" },
];

type PayPeriodOption = { id: string; label: string };

type Props = {
  sites: Site[];
  departments: Department[];
  payPeriods: PayPeriodOption[];
  selectedSiteId?: string;
  selectedDepartmentId?: string;
  selectedExceptionType?: string;
  selectedPayPeriodId?: string;
};

export function ExceptionsFilter({
  sites,
  departments,
  payPeriods,
  selectedSiteId,
  selectedDepartmentId,
  selectedExceptionType,
  selectedPayPeriodId,
}: Props) {
  const router = useRouter();

  function navigate(
    siteId?: string,
    departmentId?: string,
    exceptionType?: string,
    payPeriodId?: string,
  ) {
    const params = new URLSearchParams();
    if (siteId) params.set("siteId", siteId);
    if (departmentId) params.set("departmentId", departmentId);
    if (exceptionType) params.set("exceptionType", exceptionType);
    if (payPeriodId) params.set("payPeriodId", payPeriodId);
    const qs = params.toString();
    router.push(`/supervisor/exceptions${qs ? `?${qs}` : ""}`);
  }

  const hasFilters = selectedSiteId || selectedDepartmentId || selectedExceptionType || selectedPayPeriodId;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {payPeriods.length > 0 && (
        <select
          value={selectedPayPeriodId ?? ""}
          onChange={(e) =>
            navigate(selectedSiteId, selectedDepartmentId, selectedExceptionType, e.target.value || undefined)
          }
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          <option value="">All Pay Periods</option>
          {payPeriods.map((pp) => (
            <option key={pp.id} value={pp.id}>{pp.label}</option>
          ))}
        </select>
      )}
      {sites.length > 0 && (
        <select
          value={selectedSiteId ?? ""}
          onChange={(e) =>
            navigate(e.target.value || undefined, undefined, selectedExceptionType, selectedPayPeriodId)
          }
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          <option value="">All Sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
      <select
        value={selectedDepartmentId ?? ""}
        onChange={(e) =>
          navigate(selectedSiteId, e.target.value || undefined, selectedExceptionType, selectedPayPeriodId)
        }
        className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
      >
        <option value="">All Departments</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
      <select
        value={selectedExceptionType ?? ""}
        onChange={(e) =>
          navigate(selectedSiteId, selectedDepartmentId, e.target.value || undefined, selectedPayPeriodId)
        }
        className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
      >
        <option value="">All Types</option>
        {EXCEPTION_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hasFilters && (
        <button
          type="button"
          onClick={() => navigate()}
          className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          Clear
        </button>
      )}
    </div>
  );
}
