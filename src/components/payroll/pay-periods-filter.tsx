"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { format, addDays } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar, CalendarCheck } from "lucide-react";
import { parseUtcDate } from "@/lib/utils/date";
import { Button, FilterSelectChip } from "@/components/ui";

/**
 * How the pay period rail is narrowed and stepped through.
 *
 * <p>Everything here writes to the query string. A payroll clerk chasing one
 * period sends the URL to the supervisor who owns the blocking timesheet, and
 * a scope held in React state would arrive on the current period instead —
 * which is a different set of hours with the same layout.
 *
 * <p>Two navigation modes share one pair of arrows. Normally they step through
 * the filtered list of periods; once a month has been picked they step through
 * months that actually contain a period. Stepping by month through months with
 * nothing in them is how you end up convinced the periods were never generated.
 */

type FilterValue = "all" | "current" | "ytd";
type StatusFilter = "all" | "open" | "ready" | "locked";

interface PayPeriodItem {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  ruleSetId?: string | null;
  ruleSetName?: string | null;
  ruleSetFrequency?: string | null;
}

interface Props {
  allPayPeriods: PayPeriodItem[];
  selectedId: string | undefined;
  currentFilter: FilterValue;
  statusFilter: StatusFilter;
  monthParam?: string; // "YYYY-MM" — set when browsing by month
  siteId?: string;
  departmentId?: string;
}

const SCOPE_OPTIONS = [
  { id: "current", name: "Current" },
  { id: "ytd", name: "Year to date" },
];

const STATUS_OPTIONS = [
  { id: "open", name: "Open" },
  { id: "ready", name: "Ready" },
  { id: "locked", name: "Locked" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function PayPeriodsFilter({
  allPayPeriods,
  selectedId,
  currentFilter,
  statusFilter,
  monthParam,
  siteId,
  departmentId,
}: Props) {
  const router = useRouter();
  const pickerRef = useRef<HTMLDivElement>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(() =>
    monthParam ? parseInt(monthParam.slice(0, 4)) : new Date().getFullYear()
  );

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const sorted = [...allPayPeriods].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );

  const currentYear = new Date().getFullYear();

  // All unique "YYYY-MM" values that have at least one pay period
  const allMonthKeys = [
    ...new Set(
      sorted.flatMap((pp) => {
        const keys: string[] = [];
        const s = parseUtcDate(pp.startDate);
        const e = parseUtcDate(pp.endDate);
        // Include all months the period overlaps
        const cur = new Date(s.getFullYear(), s.getMonth(), 1);
        const end = new Date(e.getFullYear(), e.getMonth(), 1);
        while (cur <= end) {
          keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
          cur.setMonth(cur.getMonth() + 1);
        }
        return keys;
      })
    ),
  ].sort();

  function applyFilter(scope: FilterValue, id?: string, newStatus?: StatusFilter) {
    const params = new URLSearchParams();
    if (id) params.set("id", id);
    if (scope !== "all") params.set("filter", scope);
    const resolvedStatus = newStatus ?? statusFilter;
    if (resolvedStatus !== "all") params.set("status", resolvedStatus);
    // clear month when changing scope filter
    if (siteId) params.set("siteId", siteId);
    if (departmentId) params.set("departmentId", departmentId);
    router.push(`/payroll/pay-periods?${params.toString()}`);
  }

  function jumpToCurrent() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const current = sorted.find((pp) => {
      const s = parseUtcDate(pp.startDate);
      const e = parseUtcDate(pp.endDate);
      return s <= today && today <= e;
    });
    if (current) applyFilter("current", current.id, "all");
  }

  const isOnCurrentPeriod = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const current = sorted.find((pp) => {
      const s = parseUtcDate(pp.startDate);
      const e = parseUtcDate(pp.endDate);
      return s <= today && today <= e;
    });
    return current?.id === selectedId && currentFilter === "current" && statusFilter === "all" && !monthParam;
  })();

  // Find the first pay period overlapping a given month
  function findPayPeriodForMonth(year: number, month: number): PayPeriodItem | undefined {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const startsInMonth = sorted.find((pp) => {
      const s = parseUtcDate(pp.startDate);
      return s.getFullYear() === year && s.getMonth() === month;
    });
    if (startsInMonth) return startsInMonth;
    return sorted.find((pp) => {
      const s = parseUtcDate(pp.startDate);
      const e = parseUtcDate(pp.endDate);
      return s <= monthEnd && e >= monthStart;
    });
  }

  function handleMonthSelect(month: number) {
    const key = `${pickerYear}-${String(month + 1).padStart(2, "0")}`;
    const match = findPayPeriodForMonth(pickerYear, month);
    const params = new URLSearchParams();
    params.set("month", key);
    if (match) params.set("id", match.id);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (siteId) params.set("siteId", siteId);
    if (departmentId) params.set("departmentId", departmentId);
    router.push(`/payroll/pay-periods?${params.toString()}`);
    setShowPicker(false);
  }

  // Month-mode prev/next: navigate to adjacent month key
  const monthModeIndex = monthParam ? allMonthKeys.indexOf(monthParam) : -1;
  const inMonthMode = monthParam != null && monthModeIndex >= 0;
  const hasPrevMonth = inMonthMode && monthModeIndex > 0;
  const hasNextMonth = inMonthMode && monthModeIndex < allMonthKeys.length - 1;

  function navigateMonth(delta: -1 | 1) {
    const newKey = allMonthKeys[monthModeIndex + delta];
    if (!newKey) return;
    const [y, m] = newKey.split("-").map(Number);
    const match = findPayPeriodForMonth(y, m - 1);
    const params = new URLSearchParams();
    params.set("month", newKey);
    if (match) params.set("id", match.id);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (siteId) params.set("siteId", siteId);
    if (departmentId) params.set("departmentId", departmentId);
    router.push(`/payroll/pay-periods?${params.toString()}`);
  }

  // Pay-period-mode prev/next (when not in month mode)
  const filtered = inMonthMode ? [] : sorted.filter((pp) => {
    if (currentFilter === "current") {
      const s = parseUtcDate(pp.startDate);
      const e = parseUtcDate(pp.endDate);
      if (!(s <= todayMidnight && todayMidnight <= e)) return false;
    } else if (currentFilter === "ytd") {
      if (
        parseUtcDate(pp.startDate).getFullYear() !== currentYear &&
        parseUtcDate(pp.endDate).getFullYear() !== currentYear
      ) return false;
    }
    if (statusFilter === "open") return pp.status === "OPEN";
    if (statusFilter === "ready") return pp.status === "READY";
    if (statusFilter === "locked") return pp.status === "LOCKED";
    return true;
  });

  const currentIndex = filtered.findIndex((pp) => pp.id === selectedId);
  const hasPrev = inMonthMode ? hasPrevMonth : currentIndex > 0;
  const hasNext = inMonthMode ? hasNextMonth : currentIndex < filtered.length - 1;

  const selectedPp = sorted.find((pp) => pp.id === selectedId);

  // Label: show "Month YYYY" in month mode, date range otherwise
  const label = (() => {
    if (inMonthMode && monthParam) {
      const [y, m] = monthParam.split("-").map(Number);
      return format(new Date(y, m - 1, 1), "MMMM yyyy");
    }
    if (selectedPp) {
      return `${format(parseUtcDate(selectedPp.startDate), "MMM d")} – ${format(addDays(parseUtcDate(selectedPp.endDate), -1), "MMM d, yyyy")}`;
    }
    return "—";
  })();

  // Which months in the picker year have any pay period
  const monthsWithPeriods = new Set(
    allMonthKeys
      .filter((k) => k.startsWith(`${pickerYear}-`))
      .map((k) => parseInt(k.slice(5, 7)) - 1)
  );

  const selectedMonthIdx = monthParam
    ? parseInt(monthParam.slice(5, 7)) - 1
    : -1;
  const selectedMonthYear = monthParam ? parseInt(monthParam.slice(0, 4)) : -1;


  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    if (showPicker) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPicker]);

  return (
    <div className="relative flex shrink-0 flex-col gap-2.5 px-4 pb-3">
      {/* Scope and status as the same pills the rest of the app filters
          with, the way back to everything beside them, and the jump to the
          current period at the end. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterSelectChip
          label="Show"
          allLabel="All periods"
          value={currentFilter === "all" ? "" : currentFilter}
          options={SCOPE_OPTIONS}
          onChange={(v) => applyFilter((v || "all") as FilterValue, selectedId)}
        />
        <FilterSelectChip
          label="Status"
          allLabel="All statuses"
          value={statusFilter === "all" ? "" : statusFilter}
          options={STATUS_OPTIONS}
          onChange={(v) => applyFilter(currentFilter, selectedId, (v || "all") as StatusFilter)}
        />
        {/* One way back to the unfiltered list. Without it, undoing a scope,
            a status and a month is three separate controls, and the usual
            outcome is a clerk who believes half the periods no longer exist. */}
        {/* A single pill clears itself with its own x; the link is for when
            there is more than one thing to undo, or a month with no pill. */}
        {(inMonthMode || (currentFilter !== "all" && statusFilter !== "all")) && (
          <Button hierarchy="link" size="sm" onClick={() => applyFilter("all", selectedId, "all")}>
            Clear
          </Button>
        )}
      </div>

      {/* Step through periods, or once a month is picked, through months.
          The label in the middle is the month picker itself. */}
      <div
        className="flex items-center gap-1 rounded-lg p-1"
        style={{ border: "1px solid var(--stroke-secondary)", background: "var(--surface-card)" }}
      >
        <Button
          hierarchy="tertiary"
          size="sm"
          iconOnly
          disabled={!hasPrev}
          onClick={() => {
            if (inMonthMode) navigateMonth(-1);
            else if (currentIndex > 0) applyFilter(currentFilter, filtered[currentIndex - 1].id);
          }}
          title={inMonthMode ? "Previous month" : "Previous pay period"}
          aria-label={inMonthMode ? "Previous month" : "Previous pay period"}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="relative min-w-0 flex-1" ref={pickerRef}>
          <button
            type="button"
            onClick={() => {
              if (!showPicker) {
                setPickerYear(
                  monthParam
                    ? parseInt(monthParam.slice(0, 4))
                    : selectedPp
                      ? parseUtcDate(selectedPp.startDate).getFullYear()
                      : new Date().getFullYear()
                );
              }
              setShowPicker((v) => !v);
            }}
            title="Jump to a month"
            aria-label={`Jump to a month. Showing ${label}`}
            aria-expanded={showPicker}
            className="ta-hoverable tabular flex h-7 w-full items-center justify-center gap-1.5 rounded-md px-2"
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              font: "var(--type-body2)",
              fontWeight: "var(--weight-semibold)",
              color: inMonthMode ? "var(--text-accent)" : "var(--text-primary)",
            }}
          >
            <Calendar className="h-3.5 w-3.5 flex-none" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
            <span className="truncate">{label}</span>
          </button>

          {showPicker && (
            <div className="ta-modal absolute left-1/2 top-full z-50 mt-1 w-56 -translate-x-1/2 rounded-lg p-3">
              <div className="mb-2.5 flex items-center justify-between">
                <Button
                  hierarchy="tertiary"
                  size="sm"
                  iconOnly
                  onClick={() => setPickerYear((y) => y - 1)}
                  aria-label="Previous year"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="tabular" style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>
                  {pickerYear}
                </span>
                <Button
                  hierarchy="tertiary"
                  size="sm"
                  iconOnly
                  onClick={() => setPickerYear((y) => y + 1)}
                  aria-label="Next year"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* A month with no period is disabled rather than hidden: the gap
                  in the grid is itself the answer to "were those generated?" */}
              <div className="grid grid-cols-4 gap-1">
                {MONTHS.map((m, idx) => {
                  const hasPeriod = monthsWithPeriods.has(idx);
                  const isSelected = pickerYear === selectedMonthYear && idx === selectedMonthIdx;
                  const isCurrentMonth =
                    pickerYear === new Date().getFullYear() && idx === new Date().getMonth();
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={!hasPeriod}
                      onClick={() => handleMonthSelect(idx)}
                      className={hasPeriod && !isSelected ? "ta-hoverable" : undefined}
                      style={{
                        border: "none",
                        borderRadius: "var(--radius-s)",
                        padding: "6px 0",
                        font: "var(--type-button2)",
                        cursor: hasPeriod ? "pointer" : "default",
                        background: isSelected
                          ? "var(--fill-accent)"
                          : isCurrentMonth && hasPeriod
                            ? "var(--surface-info)"
                            : "transparent",
                        color: isSelected
                          ? "var(--text-on-accent)"
                          : !hasPeriod
                            ? "var(--text-disabled)"
                            : isCurrentMonth
                              ? "var(--text-accent)"
                              : "var(--text-secondary)",
                      }}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <Button
          hierarchy="tertiary"
          size="sm"
          iconOnly
          disabled={!hasNext}
          onClick={() => {
            if (inMonthMode) navigateMonth(1);
            else if (currentIndex < filtered.length - 1) applyFilter(currentFilter, filtered[currentIndex + 1].id);
          }}
          title={inMonthMode ? "Next month" : "Next pay period"}
          aria-label={inMonthMode ? "Next month" : "Next pay period"}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <span aria-hidden="true" className="mx-0.5 h-4 w-px flex-none" style={{ background: "var(--stroke-divider)" }} />

        <Button
          hierarchy="tertiary"
          size="sm"
          iconOnly
          onClick={jumpToCurrent}
          disabled={isOnCurrentPeriod}
          title="Jump to the current pay period"
          aria-label="Jump to the current pay period"
        >
          <CalendarCheck className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
