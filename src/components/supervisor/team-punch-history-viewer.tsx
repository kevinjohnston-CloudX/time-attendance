"use client";

import { useState, useRef, useEffect, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  format,
  parseISO,
  addMonths,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameDay,
  isSameMonth,
} from "date-fns";
import { PUNCH_TYPE_LABEL, type PunchTypeValue } from "@/lib/state-machines/labels";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterBar,
  FilterChip,
  SearchInput,
  Select,
  Table,
  TableFooter,
  THead,
  TBody,
  TR,
  TH,
  TD,
  Toolbar,
  statusTone,
} from "@/components/ui";
import { Calendar, ChevronLeft, ChevronRight, Clock, Users } from "lucide-react";

/**
 * Team Punch History, on the portal design's list template with the screen's
 * one departure from it: a split pane.
 *
 * <p>The design draws this as a flat table of every punch on the team. This
 * page queries one employee's punches at a time, so the employee list is the
 * first column rather than the first column of a table — but everything above
 * it is the list template: the filter card, then a toolbar carrying the search
 * and the count, then the chips for the filters that are actually on.
 *
 * <p>Both counts are shown, and they count different things. The toolbar counts
 * the employees the search and the site/department filters left standing; the
 * table footer counts the punches in range for whoever is selected. An empty
 * right pane means "this person did not punch", an empty left pane means "no
 * one matched" — without both numbers those two look identical, and one of them
 * is a payroll problem.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type SiteItem = { id: string; name: string };
type DepartmentItem = { id: string; name: string };

type EmployeeListItem = {
  id: string;
  name: string;
  employeeCode: string;
  department: string;
};

type PunchItem = {
  id: string;
  punchTime: string;
  roundedTime: string;
  punchType: string;
  source: string;
  isApproved: boolean;
  correctedById: string | null;
  correctsId: string | null;
};

/** The five parameters this screen keeps in the URL. */
type Params = {
  startDate: string | null;
  endDate: string | null;
  employeeId: string | null;
  siteId: string | null;
  departmentId: string | null;
};

interface TeamPunchHistoryViewerProps {
  employees: EmployeeListItem[];
  selectedEmployeeId: string | null;
  punches: PunchItem[];
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  /** True when the range came from the URL rather than the current pay period. */
  isCustomRange: boolean;
  isPayroll: boolean;
  sites: SiteItem[];
  selectedSiteId: string | null;
  departments: DepartmentItem[];
  selectedDepartmentId: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  WEB: "Web",
  KIOSK: "Kiosk",
  MOBILE: "Mobile",
  MANUAL: "Manual",
  SYSTEM: "System",
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// ─── Component ────────────────────────────────────────────────────────────────

export function TeamPunchHistoryViewer({
  employees,
  selectedEmployeeId,
  punches,
  startDate,
  endDate,
  isCustomRange,
  isPayroll,
  sites,
  selectedSiteId,
  departments,
  selectedDepartmentId,
}: TeamPunchHistoryViewerProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  // Calendar picker state
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(
    () => new Date(startDate + "T12:00:00")
  );
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    }
    if (showCalendar) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCalendar]);

  /**
   * This screen's URL with some of the current parameters replaced.
   *
   * <p>The chips need an href, not a handler: a filter you can only take off by
   * clicking is a filter you cannot link a colleague to with it already off.
   * Writing the parameters in one place also keeps the chips and the selects
   * from drifting apart about what a cleared site does to the department.
   */
  function hrefWith(next: Partial<Params>) {
    const merged: Params = {
      startDate,
      endDate,
      employeeId: selectedEmployeeId,
      siteId: selectedSiteId,
      departmentId: selectedDepartmentId,
      ...next,
    };
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) p.set(key, value);
    }
    const qs = p.toString();
    return qs ? `/supervisor/punch-history?${qs}` : "/supervisor/punch-history";
  }

  // Navigate preserving all current params; explicit null clears a param
  function go(
    sd: string | null = startDate,
    ed: string | null = endDate,
    eid: string | null = selectedEmployeeId,
    sid: string | null = selectedSiteId,
    did: string | null = selectedDepartmentId,
  ) {
    router.push(
      hrefWith({ startDate: sd, endDate: ed, employeeId: eid, siteId: sid, departmentId: did }),
    );
  }

  function handleCalendarDateSelect(d: Date) {
    if (!rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(d);
      setRangeEnd(null);
      setHoverDate(null);
    } else {
      if (d < rangeStart) {
        setRangeStart(d);
        setRangeEnd(null);
      } else {
        setRangeEnd(d);
        go(format(rangeStart, "yyyy-MM-dd"), format(d, "yyyy-MM-dd"));
        setShowCalendar(false);
      }
    }
  }

  const filteredEmployees = employees.filter((emp) => {
    const q = search.toLowerCase();
    return (
      emp.name.toLowerCase().includes(q) ||
      emp.employeeCode.toLowerCase().includes(q) ||
      emp.department.toLowerCase().includes(q)
    );
  });

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId) ?? null;
  const displayStart = new Date(startDate + "T12:00:00");
  const displayEnd = new Date(endDate + "T12:00:00");
  const rangeLabel = `${format(displayStart, "MMM d")} – ${format(displayEnd, "MMM d")}`;

  // A filtered id that no longer appears in its dropdown still has to show a
  // chip. The department list is narrowed by the selected site, so a department
  // carried in from another site resolves to no name — and a filter with no
  // chip is one nobody knows is on.
  const siteChipValue = selectedSiteId
    ? (sites.find((s) => s.id === selectedSiteId)?.name ?? "Filtered")
    : null;
  const departmentChipValue = selectedDepartmentId
    ? (departments.find((d) => d.id === selectedDepartmentId)?.name ?? "Filtered")
    : null;

  const hasChips = isCustomRange || (isPayroll && !!(selectedSiteId || selectedDepartmentId));

  // Which of the three empties the left pane is showing. They are three
  // different next actions — widen the filter, ask why the roster is empty, or
  // ask who reports to you — and a message that names a site filter nobody
  // applied sends a supervisor looking for a control this screen never gave
  // them.
  const noEmployeesReason =
    selectedSiteId || selectedDepartmentId
      ? "No employees in this site or department."
      : isPayroll
        ? "No active employees."
        : "You have no direct reports.";

  return (
    <div className="flex flex-col gap-3">
      {/* ── Filters ───────────────────────────────────────────────────────────
          The design opens every list screen with its filters in a card of
          labelled fields, rather than a strip of unlabelled controls. On this
          screen that matters more than most: the date range decides whether a
          punch is missing or merely outside the window you are looking at. */}
      <div className="ta-card flex flex-wrap items-end gap-3 rounded-xl px-4 py-3.5">

        {/* Calendar date range picker */}
        {/* Not a <label>: a <button> is labelable, so wrapping one would make
            clicking the word "Date range" open the calendar. */}
        <div className="relative flex flex-col gap-1.5" ref={calendarRef}>
          <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>Date range</span>
          <button
            type="button"
            onClick={() => {
              if (!showCalendar) {
                setRangeStart(new Date(startDate + "T12:00:00"));
                setRangeEnd(new Date(endDate + "T12:00:00"));
                setHoverDate(null);
                setCalendarMonth(new Date(startDate + "T12:00:00"));
              }
              setShowCalendar((v) => !v);
            }}
            className="ta-field tabular flex h-8 items-center gap-2 rounded-md px-2.5"
            style={{
              border: "1px solid var(--stroke-default)",
              background: "var(--surface-card)",
              color: "var(--text-primary)",
              font: "var(--type-body1)",
              cursor: "pointer",
            }}
            title="Pick a date range"
          >
            <Calendar className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} />
            {format(displayStart, "MM/dd/yyyy")} – {format(displayEnd, "MM/dd/yyyy")}
          </button>

          {showCalendar && (
            <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg ta-modal p-3">
              {/* Month navigation */}
              <div className="mb-2 flex items-center justify-between">
                <Button
                  hierarchy="tertiary"
                  size="sm"
                  iconOnly
                  aria-label="Previous month"
                  onClick={() => setCalendarMonth((m) => addMonths(m, -1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span
                  style={{
                    font: "var(--type-body1)",
                    fontWeight: "var(--weight-semibold)",
                    color: "var(--text-primary)",
                  }}
                >
                  {format(calendarMonth, "MMMM yyyy")}
                </span>
                <Button
                  hierarchy="tertiary"
                  size="sm"
                  iconOnly
                  aria-label="Next month"
                  onClick={() => setCalendarMonth((m) => addMonths(m, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-0">
                {WEEKDAYS.map((d) => (
                  <div
                    key={d}
                    className="py-1 text-center"
                    style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}
                  >
                    {d}
                  </div>
                ))}
                {(() => {
                  const calDays = eachDayOfInterval({
                    start: startOfWeek(startOfMonth(calendarMonth)),
                    end: endOfWeek(endOfMonth(calendarMonth)),
                  });
                  const effectiveEnd = rangeEnd ?? hoverDate;
                  return calDays.map((d) => {
                    const inMonth = isSameMonth(d, calendarMonth);
                    const isNow = isSameDay(d, new Date());
                    const isStart = !!rangeStart && isSameDay(d, rangeStart);
                    const isEnd = !!rangeEnd && isSameDay(d, rangeEnd);
                    const isEndpoint = isStart || isEnd;
                    const inRange =
                      !!rangeStart && !!effectiveEnd && d > rangeStart && d < effectiveEnd;

                    // The two selected states carry the accent fill and the
                    // accent surface, the same pair the rest of the product
                    // uses for "chosen" and "inside the choice". They were
                    // blue-600 and blue-100 with hand-written dark variants,
                    // which is a palette this app has nowhere else.
                    const dayStyle: CSSProperties = isEndpoint
                      ? {
                          background: "var(--fill-accent)",
                          color: "var(--text-on-accent)",
                          fontWeight: "var(--weight-semibold)",
                        }
                      : inRange
                        ? { background: "var(--surface-info)", color: "var(--text-accent)" }
                        : { color: inMonth ? "var(--text-secondary)" : "var(--text-disabled)" };

                    // Today is a hairline rather than a fill, so it cannot be
                    // mistaken for one end of the range you are picking.
                    if (isNow && !isEndpoint && !inRange) {
                      dayStyle.boxShadow = "inset 0 0 0 1px var(--stroke-accent)";
                    }

                    return (
                      <button
                        key={d.toISOString()}
                        type="button"
                        onClick={() => handleCalendarDateSelect(d)}
                        onMouseEnter={() => rangeStart && !rangeEnd && setHoverDate(d)}
                        onMouseLeave={() => rangeStart && !rangeEnd && setHoverDate(null)}
                        className={`tabular h-7 w-7 rounded transition-colors ${
                          isEndpoint || inRange ? "" : "hover:bg-[var(--fill-hover)]"
                        }`}
                        style={{ font: "var(--type-body2)", ...dayStyle }}
                      >
                        {d.getDate()}
                      </button>
                    );
                  });
                })()}
              </div>

              {/* Footer */}
              <div
                className="mt-2 flex items-center justify-between pt-2"
                style={{ borderTop: "1px solid var(--stroke-divider)" }}
              >
                <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                  {rangeStart && !rangeEnd ? "Select end date" : "Select start date"}
                </span>
                <div className="flex gap-1">
                  <Button
                    hierarchy="tertiary"
                    size="sm"
                    onClick={() => {
                      setRangeStart(null);
                      setRangeEnd(null);
                      setHoverDate(null);
                    }}
                  >
                    Clear
                  </Button>
                  <Button hierarchy="tertiary" size="sm" onClick={() => setShowCalendar(false)}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Today button */}
        <Button
          hierarchy="secondary"
          onClick={() => {
            const today = format(new Date(), "yyyy-MM-dd");
            go(today, today);
          }}
        >
          Today
        </Button>

        {/* Site filter — payroll+ only */}
        {isPayroll && sites.length > 0 && (
          <label className="flex flex-col gap-1.5">
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>Site</span>
            <Select
              value={selectedSiteId ?? ""}
              onChange={(e) => go(startDate, endDate, null, e.target.value || null, null)}
            >
              <option value="">All Sites</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </Select>
          </label>
        )}

        {/* Department filter — payroll+ only */}
        {isPayroll && (
          <label className="flex flex-col gap-1.5">
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>Department</span>
            <Select
              value={selectedDepartmentId ?? ""}
              onChange={(e) => go(startDate, endDate, null, selectedSiteId, e.target.value || null)}
            >
              <option value="">All Departments</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────────────
          The search moved out of the employee column and into the toolbar,
          where the design puts it, so that it sits next to the number it
          changes. "0 employees" is the answer to a search that matched
          nothing; the column going blank is not. */}
      <Toolbar count={filteredEmployees.length} countLabel="employee">
        <SearchInput value={search} onValueChange={setSearch} placeholder="Employee name" />
      </Toolbar>

      {/* Chips for the filters this page really has. There is no Shift chip:
          the design lists one for every team screen, but nothing here filters
          by shift, and a chip that cannot be taken off is worse than none.

          "Clear all" clears the filters and nothing else. The selected employee
          is not a filter — it is the record you have open — and the bare URL
          would hand you back the first person on the list, so somebody mid-way
          through disputing Maria's Tuesday would be reading someone else's
          punches without being told. */}
      <FilterBar
        clearHref={
          hasChips
            ? hrefWith({ startDate: null, endDate: null, siteId: null, departmentId: null })
            : undefined
        }
      >
        {isCustomRange && (
          <FilterChip
            label="Dates"
            value={rangeLabel}
            clearHref={hrefWith({ startDate: null, endDate: null })}
          />
        )}
        {isPayroll && selectedSiteId && (
          <FilterChip
            label="Site"
            value={siteChipValue}
            // Departments are listed per site and the employee list is scoped
            // by both, so dropping the site has to drop what hangs off it —
            // the same thing the Site dropdown does when you change it.
            clearHref={hrefWith({ siteId: null, departmentId: null, employeeId: null })}
          />
        )}
        {isPayroll && selectedDepartmentId && (
          <FilterChip
            label="Department"
            value={departmentChipValue}
            clearHref={hrefWith({ departmentId: null, employeeId: null })}
          />
        )}
      </FilterBar>

      {/* ── Split pane ────────────────────────────────────────────────────── */}
      <div
        className="grid h-[calc(100vh-20rem)] min-h-[380px] grid-cols-[260px_1fr] overflow-hidden rounded-xl"
        style={{ background: "var(--surface-card)", boxShadow: "var(--shadow-card)" }}
      >

        {/* ── Left: employee list ──────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-col overflow-y-auto" style={{ borderRight: "1px solid var(--stroke-divider)" }}>
          {filteredEmployees.length === 0 && (
            <p
              className="p-4 text-center"
              style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}
            >
              {employees.length === 0 ? noEmployeesReason : `No one matching “${search}”.`}
            </p>
          )}
          {filteredEmployees.map((emp) => {
            const isSelected = emp.id === selectedEmployeeId;
            return (
              <button
                key={emp.id}
                onClick={() => go(startDate, endDate, emp.id)}
                className={`flex w-full flex-none flex-col items-start px-3 py-2.5 text-left transition-colors [border-bottom:1px_solid_var(--stroke-divider)] ${
                  isSelected ? "bg-[var(--surface-info)]" : "hover:bg-[var(--fill-hover)]"
                }`}
              >
                <p
                  className="w-full truncate"
                  style={{
                    margin: 0,
                    font: "var(--type-body1)",
                    fontWeight: "var(--weight-semibold)",
                    color: isSelected ? "var(--text-accent)" : "var(--text-primary)",
                  }}
                >
                  {emp.name}
                </p>
                <p
                  className="w-full truncate"
                  style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                >
                  {emp.employeeCode} · {emp.department}
                </p>
              </button>
            );
          })}
        </div>

        {/* ── Right: punch detail ──────────────────────────────────────────── */}
        <div className="overflow-y-auto">
          {!selectedEmployee ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={<Users className="h-7 w-7" />}
                title="No employee selected"
                body="Pick someone on the left to see every punch they made in this date range, where it came from and whether it has been approved."
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-5">
              <div className="pb-3" style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
                <h2 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
                  {selectedEmployee.name}
                </h2>
                <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                  {selectedEmployee.employeeCode} · {selectedEmployee.department} · {rangeLabel}
                </p>
              </div>

              {punches.length === 0 ? (
                <EmptyState
                  icon={<Clock className="h-7 w-7" />}
                  title="No punches in this range"
                  // Which of the two this is decides what happens next: chase a
                  // missing scan, or widen the window and look again.
                  body={`Nothing was recorded for ${selectedEmployee.name} between ${format(displayStart, "d MMM")} and ${format(displayEnd, "d MMM")}. Widen the range, or check whether they were on leave.`}
                />
              ) : (
                <Card padding={0}>
                  {/* The header used to be a hardcoded #2492c7 with white
                      text — a colour from nowhere in the system, and the only
                      blue table header in the product. It now matches every
                      other table. */}
                  <Table>
                    <THead>
                      <TR>
                        <TH>Date</TH>
                        <TH>Time</TH>
                        <TH>Rounded</TH>
                        <TH>Type</TH>
                        <TH>Source</TH>
                        <TH>Status</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {punches.map((punch) => {
                        const isSuperseded = !!punch.correctedById;
                        const isCorrection = !!punch.correctsId;
                        return (
                          <TR
                            key={punch.id}
                            style={
                              isSuperseded
                                ? { opacity: 0.55, background: "var(--surface-tertiary)" }
                                : undefined
                            }
                          >
                            <TD>{format(parseISO(punch.punchTime), "MMM d")}</TD>
                            <TD
                              numeric
                              align="left"
                              style={
                                isSuperseded
                                  ? { textDecoration: "line-through", color: "var(--text-tertiary)" }
                                  : undefined
                              }
                            >
                              {format(parseISO(punch.punchTime), "h:mm:ss a")}
                            </TD>
                            <TD numeric align="left">
                              {format(parseISO(punch.roundedTime), "h:mm a")}
                            </TD>
                            <TD>
                              <span className="inline-flex items-center gap-2">
                                {PUNCH_TYPE_LABEL[punch.punchType as PunchTypeValue] ??
                                  punch.punchType}
                                {isCorrection && (
                                  <Badge tone="info" size="sm">
                                    Correction
                                  </Badge>
                                )}
                              </span>
                            </TD>
                            <TD style={{ color: "var(--text-secondary)" }}>
                              {SOURCE_LABEL[punch.source] ?? punch.source}
                            </TD>
                            <TD>
                              {isSuperseded ? (
                                // Deliberately toneless, as on the employee's
                                // own punch history: a superseded punch is not
                                // a state anyone is waiting on, and colouring
                                // it would compete with the correction that
                                // replaced it.
                                <Badge size="sm">Superseded</Badge>
                              ) : (
                                <Badge
                                  tone={statusTone(punch.isApproved ? "APPROVED" : "PENDING")}
                                  size="sm"
                                  dot
                                >
                                  {punch.isApproved ? "Approved" : "Pending"}
                                </Badge>
                              )}
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                  <TableFooter
                    shown={punches.length}
                    total={punches.length}
                    label={punches.length === 1 ? "punch" : "punches"}
                  />
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
