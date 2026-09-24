"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import {
  CheckCircle2,
  Clock,
  Coffee,
  LogIn,
  LogOut,
  TriangleAlert,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { Button, EmptyState, FilterSelectChip, PageHeader, SearchInput, Toast, useToast } from "@/components/ui";
import { PUNCH_TYPE_LABEL, type PunchTypeValue } from "@/lib/state-machines/labels";
import type { PunchHistoryData, PunchHistoryParams, PunchHistoryPunch } from "@/lib/punch-history/punch-history-data";
import { PunchHistoryDatePicker, dayLabel, rangeLabel } from "./punch-history-date-picker";
import { Face, PhotoViewer, ZoomableFace } from "@/components/presence/face";

/**
 * Team Punch History, as the Claude Design handoff lays it out: a pinned bar
 * with the title, the dates and the filters, the people on the left, and the
 * selected person's punches on the right, one day at a time.
 *
 * <p>The one deliberate departure from the handoff's layout is the title. The
 * handoff lets it scroll away with the page; here it stays, full size and
 * still, in the pinned bar, the same as on Leave requests and Exceptions, so
 * the screen is never unnamed.
 *
 * <p>Every filter, the search and the selected person live in the address
 * bar, so any view of this screen is a link somebody can send. The server does
 * the narrowing; this component draws what it was given.
 */

const SOURCE_LABEL: Record<string, string> = {
  WEB: "Web",
  KIOSK: "Kiosk",
  MOBILE: "Mobile",
  MANUAL: "Manual",
  SYSTEM: "System",
};

const PUNCH_ICON: Record<string, LucideIcon> = {
  CLOCK_IN: LogIn,
  CLOCK_OUT: LogOut,
  MEAL_START: UtensilsCrossed,
  MEAL_END: UtensilsCrossed,
  BREAK_START: Coffee,
  BREAK_END: Coffee,
};

/** A punch row: the time, then what happened and where from, then a status only when it is not the normal one. */
const ROW_COLUMNS = "112px minmax(0, 1fr) auto";

const SHOW_OPTIONS = [{ id: "attention", name: "Needs attention" }];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function hours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/** "30 min", "1 h 5 min". A dash when there was none. */
function duration(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return "\u2014";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * The shape of one day, read off its punches: when the person arrived and
 * left, and how long they spent on meal and on breaks.
 *
 * <p>Superseded punches are left out, so a corrected time counts once and at
 * its corrected value. Each start is paired with the next end of the same
 * kind; an unpaired start adds nothing, which is exactly the missing punch the
 * day is already flagged for. Durations are real elapsed minutes and do not
 * depend on the site's timezone.
 */
function summarizeDay(punches: PunchHistoryPunch[]) {
  const live = punches
    .filter((p) => !p.isSuperseded)
    .sort((a, b) => new Date(a.punchTime).getTime() - new Date(b.punchTime).getTime());

  const firstIn = live.find((p) => p.punchType === "CLOCK_IN");
  const lastOut = [...live].reverse().find((p) => p.punchType === "CLOCK_OUT");

  /** Minutes spent, and whether a start was left without its end. */
  const paired = (startType: string, endType: string): { minutes: number; open: boolean } | null => {
    let total = 0;
    let seen = false;
    let openedAt: number | null = null;
    for (const p of live) {
      const t = new Date(p.punchTime).getTime();
      if (p.punchType === startType) {
        openedAt = t;
        seen = true;
      } else if (p.punchType === endType && openedAt !== null) {
        total += (t - openedAt) / 60000;
        openedAt = null;
      }
    }
    return seen ? { minutes: total, open: openedAt !== null } : null;
  };

  const out = lastOut && firstIn && new Date(lastOut.punchTime) > new Date(firstIn.punchTime) ? lastOut : null;
  return {
    inAt: firstIn?.roundedTime ?? null,
    outAt: out?.roundedTime ?? null,
    // A clock out the system wrote, at the end of the day, is the one a
    // supervisor most needs to see: the person left without punching, and the
    // hours up to midnight are counting as worked.
    outIsAuto: out?.source === "SYSTEM",
    meal: paired("MEAL_START", "MEAL_END"),
    breaks: paired("BREAK_START", "BREAK_END"),
    pending: live.filter((p) => !p.isApproved).length,
  };
}

export function PunchHistoryScreen({ data }: { data: PunchHistoryData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [query, setQuery] = useState(data.search);
  const { message: toast, flash } = useToast();
  const [exporting, setExporting] = useState(false);
  const [zoomed, setZoomed] = useState<string | null>(null);

  // Clock time on the site's clock, 12 hour, always.
  const clock = useCallback(
    (iso: string, seconds: boolean) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: data.timezone,
        hour: "numeric",
        minute: "2-digit",
        ...(seconds ? { second: "2-digit" } : {}),
        hour12: true,
      }).format(new Date(iso)),
    [data.timezone],
  );

  /**
   * Who changed a punch and when, as one quiet line under it: "By Paulett
   * Laje · Sep 23 at 4:10 PM · Forgot to clock out". A correction already
   * carries its tag, so its line starts with the person.
   */
  const changeLine = useCallback(
    (c: NonNullable<PunchHistoryPunch["change"]>) => {
      const who =
        c.kind === "corrected"
          ? c.by ? `By ${c.by}` : "Made automatically"
          : c.kind === "added"
            ? c.by ? `Added by ${c.by}` : "Added by hand"
            : c.by ? `Removed by ${c.by}` : "Removed";
      const when = c.at
        ? `${new Intl.DateTimeFormat("en-US", { timeZone: data.timezone, month: "short", day: "numeric" }).format(new Date(c.at))} at ${clock(c.at, false)}`
        : null;
      return [who, when, c.reason].filter(Boolean).join(" · ");
    },
    [clock, data.timezone],
  );

  // ── Pinned bar, and the height the panes sit under ──
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barHeight, setBarHeight] = useState(112);

  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver !== "function") return;
    // The bar wraps onto more lines on a narrow window, so the panes pin
    // under its measured height rather than a guess, the same as the handoff.
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h) setBarHeight((prev) => (prev === h ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── The address bar is the state ──
  const current: PunchHistoryParams = {
    startDate: data.isCustomRange ? data.startDate : undefined,
    endDate: data.isCustomRange ? data.endDate : undefined,
    employeeId: data.selected?.id,
    siteId: data.selectedSiteId ?? undefined,
    departmentId: data.selectedDepartmentId ?? undefined,
    q: data.search || undefined,
    show: data.attentionOnly ? "attention" : undefined,
  };

  const navigate = useCallback(
    (patch: PunchHistoryParams) => {
      const next = { ...current, ...patch };
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
      const qs = params.toString();
      startTransition(() => {
        router.push(`/supervisor/punch-history${qs ? `?${qs}` : ""}`, { scroll: false });
      });
    },
    // `current` is rebuilt from `data` each render; data is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, data],
  );

  // Search runs on the server, because payroll's list is the whole company.
  // Typing waits for a pause rather than sending a request per key. Only
  // typing starts the timer: when Clear all empties the box, the timer must
  // not fire afterwards with the old filters and put them back, which it would
  // on any connection slower than 300ms.
  const typed = useRef(false);
  const onType = useCallback((v: string) => {
    typed.current = true;
    setQuery(v);
  }, []);
  useEffect(() => {
    if (!typed.current) return;
    const q = query.trim();
    if (q === data.search) return;
    const t = setTimeout(() => {
      typed.current = false;
      navigate({ q: q || undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [query, data.search, navigate]);

  function pickRange(from: string, to: string) {
    setCalendarOpen(false);
    // The current pay period is the default, so choosing it clears the range
    // rather than pinning it: the link then keeps following the pay period.
    const period = data.payPeriods.find((p) => p.isCurrent);
    if (period && period.startDate === from && period.endDate === to) {
      navigate({ startDate: undefined, endDate: undefined });
    } else {
      navigate({ startDate: from, endDate: to });
    }
  }

  function openPerson(id: string) {
    navigate({ employeeId: id });
    // Back to the top of the record, as the handoff does, so the next person
    // opens at their first day rather than wherever the last one was left.
    barRef.current?.closest("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  const dirty =
    data.isCustomRange || !!data.selectedSiteId || !!data.selectedDepartmentId || !!data.search || data.attentionOnly;

  function clearAll() {
    typed.current = false;
    setQuery("");
    // The person you have open is a record, not a filter, and stays open.
    navigate({ startDate: undefined, endDate: undefined, siteId: undefined, departmentId: undefined, q: undefined, show: undefined });
  }

  /**
   * The spreadsheet of everything the filters match, for the dates on screen.
   *
   * <p>Fetched rather than opened as a link, so a refusal (too many rows, or
   * no longer signed in) comes back as a message on this screen instead of a
   * page of JSON in place of it. The dates are sent as shown, so the file
   * covers exactly the range the person was looking at.
   */
  async function exportPunches() {
    const params = new URLSearchParams({ startDate: data.startDate, endDate: data.endDate });
    if (data.selectedSiteId) params.set("siteId", data.selectedSiteId);
    if (data.selectedDepartmentId) params.set("departmentId", data.selectedDepartmentId);
    if (data.search) params.set("q", data.search);
    if (data.attentionOnly) params.set("show", "attention");
    setExporting(true);
    flash("Preparing your download");
    try {
      const res = await fetch(`/api/reports/team-punch-history?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        flash(body?.error ?? "The export did not work. Try again.");
        return;
      }
      // A session that ran out is redirected to the sign in page, which
      // arrives as a successful HTML response. Saving that as a .csv would
      // hand somebody a spreadsheet with no punches in it.
      if (!(res.headers.get("content-type") ?? "").includes("text/csv")) {
        flash("Your session has ended. Sign in again to export.");
        return;
      }
      const blob = await res.blob();
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "team-punch-history.csv";
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      a.click();
      URL.revokeObjectURL(href);
    } catch {
      flash("The export did not work. Check your connection and try again.");
    } finally {
      setExporting(false);
    }
  }

  const selected = data.selected;
  const range = rangeLabel(data.startDate, data.endDate);
  const exceptionsHref = selected
    ? `/supervisor/exceptions?employeeId=${encodeURIComponent(selected.id)}&exceptionType=MISSING_PUNCH`
    : null;

  // Which empty the list is showing. Each has a different next step.
  const noPeopleText =
    data.attentionOnly && data.scopedTotal > 0 && !data.search
      ? "No one has a missing or pending punch in these dates."
      : data.scopedTotal === 0
      ? data.selectedSiteId || data.selectedDepartmentId
        ? "No employees in this site or department."
        : data.isPayroll
          ? "No active employees."
          : "You have no direct reports."
      : `No one matching “${data.search}”.`;

  return (
    <div
      className="ta-tph relative flex flex-col"
      style={{ "--tph-bar": `${barHeight}px` } as CSSProperties}
    >
      {/* ── Pinned bar ─────────────────────────────────────────────────────── */}
      {/* Pulled up and out over the page's own padding (16px on each side and
          on top) and given it back inside, as on Leave requests. At rest it
          sits exactly where it would, but its box already starts at the top
          of the scroller, so it has nothing to travel before it pins and never
          slides; and rows cannot show through the side gutters. */}
      <div
        ref={barRef}
        className="sticky top-0 z-20 -mx-4 -mt-4 flex flex-col gap-3.5 px-4 pb-3.5 pt-4"
        style={{ background: "var(--surface-page)" }}
      >
        <PageHeader
          title="Team Punch History"
          subtitle="Every punch by employee, where it came from, and whether it is approved"
          actions={
            <Button
              hierarchy="secondary"
              size="sm"
              onClick={exportPunches}
              disabled={exporting || data.employeeTotal === 0}
              title="Every punch in this date range for everyone the filters match"
            >
              {exporting ? "Exporting" : "Export"}
            </Button>
          }
        />

        {/* Dates first, since they decide everything below, then the search
            and the filters as the same pills Employees and Live Attendance use. */}
        <div className="flex flex-wrap items-center gap-2.5">
          <PunchHistoryDatePicker
            startDate={data.startDate}
            endDate={data.endDate}
            today={data.today}
            payPeriods={data.payPeriods}
            isCustomRange={data.isCustomRange}
            open={calendarOpen}
            onOpenChange={setCalendarOpen}
            onPick={pickRange}
          />
          <Button hierarchy="secondary" onClick={() => navigate({ startDate: data.today, endDate: data.today })}>
            Today
          </Button>
          <span aria-hidden="true" className="mx-0.5 h-5 w-px flex-none" style={{ background: "var(--stroke-secondary)" }} />
          <SearchInput value={query} onValueChange={onType} placeholder="Name, ID or department" width={250} />
          {data.isPayroll && data.sites.length > 0 && (
            <FilterSelectChip
              label="Site"
              value={data.selectedSiteId ?? ""}
              options={data.sites}
              // Departments are listed per site, and the person you had open
              // may not work at the new one.
              onChange={(v) => navigate({ siteId: v || undefined, departmentId: undefined, employeeId: undefined })}
            />
          )}
          {data.isPayroll && (
            <FilterSelectChip
              label="Department"
              value={data.selectedDepartmentId ?? ""}
              options={data.departments}
              onChange={(v) => navigate({ departmentId: v || undefined, employeeId: undefined })}
            />
          )}
          <FilterSelectChip
            label="Show"
            allLabel="Everyone"
            value={data.attentionOnly ? "attention" : ""}
            options={SHOW_OPTIONS}
            onChange={(v) => navigate({ show: v || undefined })}
          />
          {dirty && (
            <Button hierarchy="link" size="sm" onClick={clearAll}>
              Clear all
            </Button>
          )}
        </div>
      </div>

      {/* ── Board ──────────────────────────────────────────────────────────── */}
      <div
        className="ta-tph-board flex flex-wrap items-start gap-3.5"
        style={{ opacity: isPending ? 0.6 : 1, transition: "opacity 120ms ease" }}
        aria-busy={isPending}
      >
        {/* People */}
        <div className="ta-tph-people z-[1] min-w-0 flex-[1_1_240px]">
          <div
            className="flex flex-col overflow-hidden"
            style={{
              border: "1px solid var(--stroke-secondary)",
              borderRadius: "var(--radius-m)",
              background: "var(--surface-card)",
            }}
          >
            <div
              className="flex items-baseline gap-2 px-3.5 py-3"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              <span
                className="flex-1"
                style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}
              >
                Employees
              </span>
              <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                {data.employeeTotal.toLocaleString("en-US")}
              </span>
            </div>

            <div className="ta-tph-list ta-scroll flex flex-col overflow-y-auto">
              {data.employees.map((e) => {
                const on = e.id === selected?.id;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => openPerson(e.id)}
                    aria-current={on ? "true" : undefined}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left ${on ? "" : "ta-tph-row"}`}
                    style={{
                      border: 0,
                      borderBottom: "1px solid var(--stroke-divider)",
                      background: on ? "var(--surface-info)" : "var(--surface-card)",
                      cursor: "pointer",
                    }}
                  >
                    {/* The tablet photo over the initials, which show when
                        there is no photo or it fails to load. */}
                    <span
                      className="relative inline-flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full [&>img]:absolute [&>img]:inset-0 [&>img]:h-full [&>img]:w-full [&>img]:object-cover"
                      style={{
                        background: on ? "var(--fill-accent)" : "var(--surface-tertiary)",
                        color: on ? "var(--text-on-accent)" : "var(--text-secondary)",
                        font: "var(--type-caption1)",
                        fontWeight: "var(--weight-semibold)",
                      }}
                    >
                      {initials(e.name)}
                      <Face src={e.photoUrl} personId={e.id} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span
                        className="truncate"
                        style={{
                          font: "var(--type-body1)",
                          fontWeight: "var(--weight-semibold)",
                          color: on ? "var(--text-accent)" : "var(--text-primary)",
                        }}
                      >
                        {e.name}
                      </span>
                      <span className="truncate" style={{ font: "var(--type-caption1)", color: "var(--text-secondary)" }}>
                        {e.employeeCode} · {e.department}
                      </span>
                    </span>
                    {/* What needs looking at, as one small tinted mark each:
                        a missing punch, and how many are waiting on approval. */}
                    {e.pendingCount > 0 && (
                      <span
                        title={`${e.pendingCount} ${e.pendingCount === 1 ? "punch" : "punches"} waiting on approval in these dates`}
                        className="tabular inline-flex h-5 flex-none items-center whitespace-nowrap rounded-full px-1.5"
                        style={{
                          background: "var(--surface-warning)",
                          color: "var(--text-warning)",
                          font: "var(--type-caption1)",
                          fontWeight: "var(--weight-semibold)",
                        }}
                      >
                        {e.pendingCount} pending
                      </span>
                    )}
                    {e.hasMissingPunch && (
                      <span title="Missing punch in these dates" className="inline-flex flex-none" style={{ color: "var(--text-warning)" }}>
                        <TriangleAlert className="h-4 w-4" aria-label="Missing punch" />
                      </span>
                    )}
                  </button>
                );
              })}

              {data.employees.length === 0 && (
                <div className="flex flex-col items-center gap-2.5 px-4 py-7 text-center">
                  <span style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>{noPeopleText}</span>
                  {dirty && (
                    <Button hierarchy="secondary" size="sm" onClick={clearAll}>
                      Clear all
                    </Button>
                  )}
                </div>
              )}

              {data.employeeTotal > data.employees.length && (
                <p
                  className="px-3.5 py-3"
                  style={{ margin: 0, font: "var(--type-caption1)", color: "var(--text-tertiary)" }}
                >
                  Showing the first {data.employees.length} of {data.employeeTotal.toLocaleString("en-US")}. Search to
                  find anyone else.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Punches */}
        <div className="ta-tph-punches flex min-w-0 flex-[3_1_480px] flex-col">
          {selected ? (
            <div className={`flex flex-col ${data.punches.length > 0 ? "ta-tph-punches-inner" : ""}`}>
              <div
                className="ta-tph-head z-[2]"
                style={{
                  border: "1px solid var(--stroke-secondary)",
                  borderBottom: 0,
                  borderRadius: "var(--radius-m) var(--radius-m) 0 0",
                  background: "var(--surface-card)",
                }}
              >
                <div
                  className="ta-tph-info flex flex-wrap items-center gap-3.5 px-[18px] py-4"
                  style={{ borderBottom: "1px solid var(--stroke-divider)" }}
                >
                  <span
                    className="relative inline-flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-full [&>img]:absolute [&>img]:inset-0 [&>img]:h-full [&>img]:w-full [&>img]:object-cover"
                    style={{
                      background: "var(--surface-info)",
                      color: "var(--text-accent)",
                      font: "var(--type-body1)",
                      fontWeight: "var(--weight-semibold)",
                    }}
                  >
                    {initials(selected.name)}
                    <ZoomableFace src={selected.photoUrl} personId={selected.id} name={selected.name} onZoom={setZoomed} />
                  </span>
                  <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
                    <span
                      className="truncate"
                      style={{ font: "var(--type-h4)", fontWeight: "var(--weight-bold)", letterSpacing: "-0.01em", color: "var(--text-primary)" }}
                    >
                      {selected.name}
                    </span>
                    <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                      {[selected.employeeCode, selected.department, selected.site].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <div className="flex items-center gap-[22px]">
                    <Stat value={hours(data.totals.workedMinutes)} label="Hours worked" />
                    <Stat value={String(data.totals.daysWorked)} label="Days worked" />
                    <Stat
                      value={String(data.totals.pending)}
                      label="Pending punches"
                      tone={data.totals.pending > 0 ? "var(--text-warning)" : undefined}
                    />
                    <Stat
                      value={String(data.totals.missingDays)}
                      label="Missing punches"
                      tone={data.totals.missingDays > 0 ? "var(--text-warning)" : undefined}
                    />
                  </div>
                </div>
              </div>

              <div
                className="overflow-hidden"
                style={{
                  border: "1px solid var(--stroke-secondary)",
                  borderTop: 0,
                  borderRadius: "0 0 var(--radius-m) var(--radius-m)",
                  background: "var(--surface-card)",
                }}
              >
                {data.punches.length > 0 ? (
                  <>
                    {data.days.map((day, dayIndex) => {
                      const dayPunches = data.punches.filter((p) => p.localDate === day.date);
                      const sum = summarizeDay(dayPunches);
                      // Worked keeps the pay engine's rules: it only counts
                      // approved punches, so a day still waiting says so
                      // rather than showing a zero that reads as no work.
                      const worked =
                        day.workedMinutes > 0
                          ? null
                          : day.isClockedIn
                            ? "In progress"
                            : day.hasPending
                              ? "Pending"
                              : day.hasMissingPunch
                                ? "No hours"
                                : null;
                      const warnTone = "var(--text-warning)";
                      const liveTone = "var(--text-accent)";
                      // The shape of the day as one quiet line: arrival to
                      // departure, then meal and breaks only when there were
                      // any. Anything that went wrong on it takes its colour.
                      const shape: { text: string; tone?: string }[] = [];
                      if (sum.inAt || sum.outAt || day.isClockedIn) {
                        const from = sum.inAt ? clock(sum.inAt, false) : "No clock in";
                        if (sum.outAt) {
                          shape.push({ text: `${from} to ${clock(sum.outAt, false)}` });
                          if (sum.outIsAuto) shape.push({ text: "Clocked out by system", tone: warnTone });
                        } else {
                          shape.push({ text: day.isClockedIn ? `In since ${from}` : `${from}, no clock out` });
                        }
                      }
                      // No meal punched, but the pay engine took one out: the automatic
                      // deduction, the one gap between the times and the hours.
                      if (!sum.meal && day.mealMinutes > 0) {
                        shape.push({ text: `Meal ${duration(day.mealMinutes)}, deducted` });
                      }
                      for (const [label, part, verb] of [
                        ["Meal", sum.meal, "On meal"],
                        ["Breaks", sum.breaks, "On break"],
                      ] as const) {
                        if (!part) continue;
                        if (part.open) {
                          shape.push(
                            day.isClockedIn
                              ? { text: verb, tone: liveTone }
                              : { text: `${label === "Meal" ? "Meal" : "Break"} not ended`, tone: warnTone },
                          );
                        } else if (part.minutes > 0) {
                          shape.push({ text: `${label} ${duration(part.minutes)}` });
                        }
                      }
                      return (
                      <div
                        key={day.date}
                        className="flex flex-col"
                        style={{ borderTop: dayIndex === 0 ? undefined : "1px solid var(--stroke-secondary)" }}
                      >
                        {/* The day as a heading: the date and the shape of the
                            day on the left, the hours on the right as the
                            answer, and the day's one status under them. The
                            punches that make it up follow as its rows. */}
                        <div
                          className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-[18px] pb-3 pt-4"
                          style={{ borderBottom: "1px solid var(--stroke-divider)" }}
                        >
                          <div className="flex min-w-0 flex-col gap-1">
                            <span
                              className="whitespace-nowrap"
                              style={{ font: "var(--type-h4)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}
                            >
                              {dayLabel(day.date, true)}
                            </span>
                            {shape.length > 0 && (
                              <span className="tabular flex flex-wrap items-center gap-x-2" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                                {shape.map((s, i) => (
                                  <span key={i} className="inline-flex items-center gap-2 whitespace-nowrap">
                                    {i > 0 && <span aria-hidden="true" style={{ color: "var(--text-tertiary)" }}>·</span>}
                                    <span style={s.tone ? { color: s.tone, fontWeight: "var(--weight-medium)" } : undefined}>{s.text}</span>
                                  </span>
                                ))}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-none flex-col items-end gap-1">
                            {worked === null ? (
                              <span
                                className="tabular whitespace-nowrap"
                                style={{ font: "var(--type-h3)", fontWeight: "var(--weight-bold)", letterSpacing: "-0.01em", color: "var(--text-primary)" }}
                              >
                                {hours(day.workedMinutes)}
                                <span style={{ font: "var(--type-body2)", fontWeight: "var(--weight-medium)", color: "var(--text-secondary)" }}> h</span>
                              </span>
                            ) : (
                              <span
                                className="whitespace-nowrap"
                                style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", lineHeight: "26px", color: "var(--text-tertiary)" }}
                              >
                                {worked}
                              </span>
                            )}
                            <div className="flex items-center gap-2.5">
                              {day.hasMissingPunch ? (
                                <>
                                  <span
                                    className="inline-flex items-center gap-1.5 whitespace-nowrap"
                                    style={{ font: "var(--type-body2)", fontWeight: "var(--weight-semibold)", color: warnTone }}
                                  >
                                    <TriangleAlert className="h-[14px] w-[14px]" />
                                    Missing punch
                                  </span>
                                  {data.canResolveExceptions && exceptionsHref && (
                                    <Button hierarchy="link" size="sm" onClick={() => router.push(exceptionsHref)}>
                                      Resolve
                                    </Button>
                                  )}
                                </>
                              ) : day.isClockedIn ? (
                                <span
                                  className="inline-flex items-center gap-1.5 whitespace-nowrap"
                                  style={{ font: "var(--type-body2)", fontWeight: "var(--weight-medium)", color: liveTone }}
                                >
                                  <span className="h-[7px] w-[7px] rounded-full" style={{ background: "var(--fill-accent)" }} />
                                  Clocked in
                                </span>
                              ) : sum.pending > 0 ? (
                                <span
                                  className="inline-flex items-center gap-1.5 whitespace-nowrap"
                                  style={{ font: "var(--type-body2)", fontWeight: "var(--weight-semibold)", color: warnTone }}
                                >
                                  <span className="h-2 w-2 rounded-full" style={{ background: "var(--fill-warning)" }} />
                                  {sum.pending} pending
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1.5 whitespace-nowrap"
                                  style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                                >
                                  <CheckCircle2 className="h-[14px] w-[14px]" style={{ color: "var(--icon-success)" }} />
                                  Approved
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* The punches under their day, read like a timeline:
                            the time first, then what happened, where it came
                            from, and a status only when it is not the normal
                            one. The rounded time leads because it is the one
                            that pays; the exact clock time joins it only when
                            rounding moved it by a minute or more. */}
                        {dayPunches.map((p) => {
                            const Icon = PUNCH_ICON[p.punchType] ?? Clock;
                            const sup = p.isSuperseded;
                            const shift = Math.round(
                              (new Date(p.roundedTime).getTime() - new Date(p.punchTime).getTime()) / 60000,
                            );
                            const flagged = p.source === "MANUAL" || p.source === "SYSTEM";
                            return (
                              <div
                                key={p.id}
                                className="grid min-h-[42px] items-center gap-x-4 px-[18px] py-2"
                                style={{
                                  gridTemplateColumns: ROW_COLUMNS,
                                  borderBottom: "1px solid var(--stroke-divider)",
                                  background: sup ? "var(--surface-tertiary)" : "var(--surface-card)",
                                }}
                                title={`Clock time ${clock(p.punchTime, true)}`}
                              >
                                <span className="flex min-w-0 flex-col">
                                  <span
                                    className="tabular whitespace-nowrap"
                                    style={{
                                      font: "var(--type-body1)",
                                      fontWeight: "var(--weight-semibold)",
                                      color: sup ? "var(--text-tertiary)" : "var(--text-primary)",
                                      textDecoration: sup ? "line-through" : "none",
                                    }}
                                  >
                                    {clock(p.roundedTime, false)}
                                  </span>
                                  {!sup && Math.abs(shift) >= 1 && (
                                    <span className="tabular whitespace-nowrap" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                                      Clocked {clock(p.punchTime, true)}
                                    </span>
                                  )}
                                </span>
                                <span className="flex min-w-0 flex-col gap-0.5">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <Icon
                                      className="h-4 w-4 flex-none"
                                      style={{ color: sup ? "var(--icon-disabled)" : "var(--icon-secondary)" }}
                                    />
                                    <span
                                      className="truncate"
                                      style={{ font: "var(--type-body1)", color: sup ? "var(--text-tertiary)" : "var(--text-primary)" }}
                                    >
                                      {PUNCH_TYPE_LABEL[p.punchType as PunchTypeValue] ?? p.punchType}
                                    </span>
                                    {p.isCorrection && (
                                      <span
                                        className="whitespace-nowrap rounded px-1.5"
                                        style={{
                                          background: "var(--surface-info)",
                                          color: "var(--text-accent)",
                                          font: "var(--type-caption1)",
                                          fontWeight: "var(--weight-medium)",
                                          lineHeight: "18px",
                                        }}
                                      >
                                        Correction
                                      </span>
                                    )}
                                    {/* Where it came from, right beside what it
                                        was. Routine sources are quiet. Manual and
                                        System are not: one means somebody entered
                                        it by hand, the other that the system wrote it. */}
                                    <span aria-hidden="true" style={{ color: "var(--text-tertiary)" }}>·</span>
                                    <span
                                      className="whitespace-nowrap"
                                      style={{
                                        font: "var(--type-body2)",
                                        fontWeight: !sup && flagged ? "var(--weight-medium)" : undefined,
                                        color: !sup && flagged ? "var(--text-primary)" : "var(--text-tertiary)",
                                      }}
                                    >
                                      {SOURCE_LABEL[p.source] ?? p.source}
                                    </span>
                                  </span>
                                  {p.change && (
                                    <span
                                      className="truncate pl-6"
                                      style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}
                                      title={p.change.reason ?? undefined}
                                    >
                                      {changeLine(p.change)}
                                    </span>
                                  )}
                                </span>
                                {/* Approved is the normal case and the day heading
                                    already says it, so an approved row carries no
                                    status. Removed, Superseded and Pending keep
                                    their words, which is what makes them findable. */}
                                <span className="flex justify-end">
                                  {p.isRemoved ? (
                                    <span className="whitespace-nowrap" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                                      Removed
                                    </span>
                                  ) : sup ? (
                                    <span className="whitespace-nowrap" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                                      Superseded
                                    </span>
                                  ) : p.isApproved ? (
                                    <span className="sr-only">Approved</span>
                                  ) : (
                                    <span
                                      className="inline-flex items-center gap-[7px] whitespace-nowrap"
                                      style={{ font: "var(--type-body2)", fontWeight: "var(--weight-semibold)", color: "var(--text-warning)" }}
                                    >
                                      <span className="h-2 w-2 flex-none rounded-full" style={{ background: "var(--fill-warning)" }} />
                                      Pending
                                    </span>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                      );
                    })}
                    <div
                      className="tabular px-[18px] py-3"
                      style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                    >
                      {data.punches.length} {data.punches.length === 1 ? "punch" : "punches"} · {range}
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={<Clock className="h-8 w-8" />}
                    title="No punches in this range"
                    body={`Nothing was recorded for ${selected.name} between ${dayLabel(data.startDate)} and ${dayLabel(data.endDate)}. Widen the range, or check whether they were on leave.`}
                    action={
                      <Button hierarchy="secondary" onClick={() => setCalendarOpen(true)}>
                        Change Dates
                      </Button>
                    }
                  />
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                border: "1px solid var(--stroke-secondary)",
                borderRadius: "var(--radius-m)",
                background: "var(--surface-card)",
              }}
            >
              <EmptyState
                icon={<Users className="h-8 w-8" />}
                title="No employee selected"
                body="Select an employee on the left to see every punch they made in this date range, where it came from and whether it has been approved."
              />
            </div>
          )}
        </div>
      </div>

      {zoomed && selected && (
        <PhotoViewer
          src={zoomed}
          name={selected.name}
          detail={[selected.employeeCode, selected.department, selected.site].filter(Boolean).join(" · ")}
          onClose={() => setZoomed(null)}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="flex flex-col items-end gap-px">
      <span
        className="tabular"
        style={{ font: "var(--type-h4)", fontWeight: "var(--weight-bold)", color: tone ?? "var(--text-primary)" }}
      >
        {value}
      </span>
      <span className="whitespace-nowrap" style={{ font: "var(--type-caption1)", color: "var(--text-secondary)" }}>
        {label}
      </span>
    </div>
  );
}
