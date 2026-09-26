"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "@/components/layout/navigation-progress";
import { CalendarClock, Plus } from "lucide-react";
import type { DayScheduleRow } from "@/actions/shift.actions";
import { EmptyState, LinkButton, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { AreaPanel, StatusBadge, clock12, countLine, matches, useStatusView } from "./setup/setup-ui";
import { defaultDaySchedule, type ShiftRow } from "./shift-editor";

/**
 * The shifts list on the shared panel. A row opens the shift on its own
 * page (see ShiftEditor). Times read on a 12 hour clock; the list used to
 * show them as stored, on the 24 hour clock.
 */

const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TYPE: Record<string, string> = { FIXED: "Fixed", FLEXIBLE: "Flexible", DYNAMIC: "Dynamic" };

function daysText(days: number[]): string {
  if (days.length === 0) return "No days";
  if (days.length === 7) return "Every day";
  const sorted = [...days].sort((a, b) => a - b);
  const run = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (run && sorted.length >= 3) return `${SHORT[sorted[0]]} to ${SHORT[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => SHORT[d]).join(", ");
}

/** The hours in words, and whether some days differ from the first. */
function hours(schedule: DayScheduleRow[]): { main: string; note?: string } {
  const work = schedule.filter((d) => d.isWorkday && d.startTime && d.endTime);
  if (!work.length) return { main: "No hours set" };
  const first = work[0];
  const main = `${clock12(first.startTime)} to ${clock12(first.endTime)}`;
  const varies = work.some((d) => d.startTime !== first.startTime || d.endTime !== first.endTime);
  return { main, note: varies ? "Varies by day" : undefined };
}

export function ShiftsManager({ shifts }: { shifts: ShiftRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { view, setView, counts, kept } = useStatusView(shifts);
  const shown = kept.filter((s) => matches(query, s.name, s.number));

  const addButton = (
    <LinkButton href="/admin/rules-setup/shifts/new" hierarchy="primary" leadingIcon={<Plus className="h-4 w-4" />}>
      Add shift
    </LinkButton>
  );

  return (
    <AreaPanel
      title="Shifts"
      hint="The days and hours each group of employees is scheduled for, and how their meals are taken."
      action={addButton}
      status={{ view, onChange: setView, counts }}
      search={shifts.length ? { value: query, onChange: setQuery, placeholder: "Shift name or number" } : undefined}
      count={countLine(shown.length, shifts.length, "shift", "shifts")}
    >
      {shifts.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-8 w-8" />}
          title="No shifts yet"
          body="Add the first one with its days and hours, then put employees on it."
          action={addButton}
        />
      ) : shown.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-8 w-8" />} title="No shifts match" body="Nothing matches that search or status." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH numeric style={{ width: 48 }}>
                No.
              </TH>
              <TH>Shift</TH>
              <TH>Hours</TH>
              <TH>Days</TH>
              <TH>Type</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((s) => {
              const schedule = defaultDaySchedule(s);
              const h = hours(schedule);
              const people = s._count?.employees ?? 0;
              return (
                <TR key={s.id} onClick={() => router.push(`/admin/rules-setup/shifts/${s.id}`)}>
                  <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>
                    {s.number ?? ""}
                  </TD>
                  <TD>
                    <span className="flex flex-col" style={{ maxWidth: 280, whiteSpace: "normal" }}>
                      <Link
                        href={`/admin/rules-setup/shifts/${s.id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontWeight: "var(--weight-medium)", color: "var(--text-primary)", textDecoration: "none" }}
                      >
                        {s.name}
                      </Link>
                      <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                        {people ? `${people.toLocaleString()} ${people === 1 ? "employee" : "employees"}` : "No employees"}
                      </span>
                    </span>
                  </TD>
                  <TD>
                    <span className="flex flex-col">
                      <span className="tabular" style={{ color: "var(--text-primary)" }}>
                        {h.main}
                      </span>
                      {h.note && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{h.note}</span>}
                    </span>
                  </TD>
                  <TD style={{ color: "var(--text-secondary)" }}>{daysText(schedule.filter((d) => d.isWorkday).map((d) => d.day))}</TD>
                  <TD style={{ color: "var(--text-secondary)" }}>{TYPE[s.shiftType] ?? s.shiftType}</TD>
                  <TD>
                    <StatusBadge active={s.isActive} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </AreaPanel>
  );
}
