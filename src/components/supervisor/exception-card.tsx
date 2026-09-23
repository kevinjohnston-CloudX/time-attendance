"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import type { PunchType } from "@prisma/client";
import {
  addMissingPunchForEmployee,
  correctPunchAndResolve,
  getExceptionPunches,
  resolveException,
} from "@/actions/supervisor.actions";
import { Button, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { formatTimeOfDay } from "@/lib/utils/date";
import type { ExceptionRow } from "@/components/supervisor/exceptions-screen";

/**
 * One exception, as the handoff draws it: who and when, what is wrong in a
 * sentence, the four facts that decide what to do about it, and the two ways
 * out of it.
 *
 * <p>Both ways out write to a timecard payroll will pay from, so neither is a
 * single click. Each opens a form inside the card, and each needs a reason
 * before it will submit.
 */

const PUNCH_LABEL: Record<string, string> = {
  CLOCK_IN: "Clock In",
  MEAL_START: "Meal Start",
  MEAL_END: "Meal End",
  CLOCK_OUT: "Clock Out",
  BREAK_START: "Break Start",
  BREAK_END: "Break End",
};

const SEVERITY_INK = ["var(--text-error)", "var(--text-warning)", "var(--text-secondary)"];
const SEVERITY_RULE = ["var(--fill-error)", "var(--fill-warning)", "var(--stroke-secondary)"];

type Punch = { id: string; punchType: PunchType; roundedTime: Date };

type Meridiem = "AM" | "PM";

/**
 * A typed time of day, read against the AM or PM the field is set to.
 *
 * <p>Nothing here is inferred. A punch entered twelve hours out is a wrong
 * paycheck, not a typo somebody notices, so the half of the day is an explicit
 * control rather than a guess at what 8:30 meant. A time typed on a 24 hour
 * clock is taken as written, because it cannot mean anything else, and an
 * explicit am or pm in the text wins over the control.
 */
function parseTimeOfDay(input: string, meridiem: Meridiem): { hours: number; minutes: number } | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return null;

  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  if (minutes > 59) return null;
  const typed: Meridiem | null = m[3] ? (m[3] === "pm" ? "PM" : "AM") : null;

  if (hours === 0 || (hours >= 13 && hours <= 23)) {
    // A 24 hour time. Saying "13:00 am" is a contradiction, not a correction.
    return typed ? null : { hours, minutes };
  }
  if (hours > 12) return null;

  const half = typed ?? meridiem;
  if (hours === 12) hours = half === "AM" ? 0 : 12;
  else if (half === "PM") hours += 12;
  return { hours, minutes };
}

/** An "HH:mm" stored time, split into what the field shows and which half of the day it is. */
function splitTime(hhmm: string | null): { text: string; meridiem: Meridiem } {
  const pretty = formatTimeOfDay(hhmm);
  const m = pretty ? /^(\d{1,2}:\d{2}) (AM|PM)$/.exec(pretty) : null;
  if (!m) return { text: "", meridiem: "AM" };
  return { text: m[1], meridiem: m[2] as Meridiem };
}

function at(day: Date, time: { hours: number; minutes: number }): string {
  const d = new Date(day);
  d.setHours(time.hours, time.minutes, 0, 0);
  return d.toISOString();
}

/** What was recorded, in words, because half a range needs saying rather than drawing. */
function recordedLabel(recorded: { in: string | null; out: string | null }): string {
  const start = formatTimeOfDay(recorded.in);
  const end = formatTimeOfDay(recorded.out);
  if (start && end) return `${start} to ${end}`;
  if (start) return `${start}, no clock out`;
  if (end) return `${end}, no clock in`;
  return "No punches";
}

export function ExceptionCard({
  row,
  typeLabel,
  severity,
  reasonCodes,
  onDone,
}: {
  row: ExceptionRow;
  typeLabel: string;
  severity: number;
  reasonCodes: { id: string; code: string; label: string }[];
  onDone: (message: string) => void;
}) {
  const [mode, setMode] = useState<"punch" | "note" | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Fetched the first time the punch form is opened, then kept. The list
  // itself never carries punches: sending every sheet's punches with every
  // card is what made this page 25MB.
  const [punches, setPunches] = useState<Punch[] | null>(null);
  const [loadingPunches, setLoadingPunches] = useState(false);

  const [inValue, setInValue] = useState("");
  const [inHalf, setInHalf] = useState<Meridiem>("AM");
  const [outValue, setOutValue] = useState("");
  const [outHalf, setOutHalf] = useState<Meridiem>("PM");
  const [punchId, setPunchId] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newHalf, setNewHalf] = useState<Meridiem>("AM");
  const [reasonId, setReasonId] = useState(reasonCodes[0]?.id ?? "");
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState("");

  const isMissingPunch = row.exceptionType === "MISSING_PUNCH";
  const isAbsent = row.exceptionType === "ABSENT";
  /** Missing punches are added on a clock in and clock out pair. Everything
      else is a punch that exists and is wrong, which may be a meal punch, so
      that one keeps the picker. */
  const addsPunches = isMissingPunch || isAbsent;

  const dayPunches = (punches ?? []).filter(
    (p) => format(p.roundedTime, "yyyy-MM-dd") === format(row.occurredAt, "yyyy-MM-dd"),
  );
  const existingIn = dayPunches.find((p) => p.punchType === "CLOCK_IN") ?? null;
  const existingOut = dayPunches.find((p) => p.punchType === "CLOCK_OUT") ?? null;

  const reasonText = (() => {
    const code = reasonCodes.find((r) => r.id === reasonId);
    const head = code ? `${code.code}: ${code.label}` : detail.trim();
    if (!code) return head;
    return detail.trim() ? `${head}. ${detail.trim()}` : head;
  })();

  const fixLabel = isAbsent
    ? "Add Punches"
    : isMissingPunch
      ? "Add Missing Punch"
      : "Correct a Punch";

  async function openPunchForm() {
    setError(null);
    setLoadingPunches(true);
    try {
      const result = await getExceptionPunches({ timesheetId: row.timesheetId });
      const rows = result.success && result.data ? result.data : [];
      setPunches(rows);
      setMode("punch");
      // Prefilled from what is on the timecard, and where there is nothing,
      // from the half of the day that side of a shift usually falls in.
      const start = splitTime(row.recorded.in);
      const end = splitTime(row.recorded.out);
      setInValue(start.text);
      setInHalf(start.text ? start.meridiem : splitTime(row.scheduled.start).meridiem);
      setOutValue(end.text);
      setOutHalf(end.text ? end.meridiem : (splitTime(row.scheduled.end).meridiem || "PM"));
      const first = rows[0];
      if (first) {
        setPunchId(first.id);
        setNewTime(format(first.roundedTime, "h:mm"));
        setNewHalf(format(first.roundedTime, "a").toUpperCase() === "PM" ? "PM" : "AM");
      }
    } finally {
      setLoadingPunches(false);
    }
  }

  function closeForm() {
    setMode(null);
    setError(null);
    setDetail("");
    setNote("");
  }

  /**
   * Save whichever side of the day changed.
   *
   * <p>Run one after another rather than together: both paths rebuild the
   * timesheet's segments when they finish, and two rebuilds racing on one
   * sheet is how a day ends up with the hours of whichever finished last.
   */
  function savePunch() {
    if (!reasonText.trim()) {
      setError("Pick a reason before saving.");
      return;
    }

    startTransition(async () => {
      setError(null);

      if (addsPunches) {
        const sides: {
          value: string;
          half: Meridiem;
          existing: Punch | null;
          punchType: PunchType;
        }[] = [
          { value: inValue, half: inHalf, existing: existingIn, punchType: "CLOCK_IN" },
          { value: outValue, half: outHalf, existing: existingOut, punchType: "CLOCK_OUT" },
        ];

        let wrote = false;
        for (const side of sides) {
          const raw = side.value.trim();
          if (!raw) continue;
          // Unchanged from what is already on the timecard, so there is
          // nothing to write and nothing to put in the audit log.
          const parsed = parseTimeOfDay(raw, side.half);
          if (!parsed) {
            setError(`${PUNCH_LABEL[side.punchType]} is not a time. Try 8:00 or 830.`);
            return;
          }
          // Unchanged from what is already on the timecard, so there is
          // nothing to write and nothing to put in the audit log.
          if (
            side.existing &&
            side.existing.roundedTime.getHours() === parsed.hours &&
            side.existing.roundedTime.getMinutes() === parsed.minutes
          ) {
            continue;
          }

          const result = side.existing
            ? await correctPunchAndResolve({
                originalPunchId: side.existing.id,
                newPunchTime: at(row.occurredAt, parsed),
                reason: reasonText,
                exceptionId: row.id,
              })
            : await addMissingPunchForEmployee({
                timesheetId: row.timesheetId,
                exceptionId: row.id,
                punchType: side.punchType,
                punchTime: at(row.occurredAt, parsed),
                reason: reasonText,
              });

          if (!result.success) {
            setError(result.error ?? "That did not save.");
            return;
          }
          wrote = true;
        }

        if (!wrote) {
          setError("Enter a clock in or a clock out first.");
          return;
        }
      } else {
        const parsed = parseTimeOfDay(newTime, newHalf);
        if (!punchId || !parsed) {
          setError("Pick a punch and a time. Try 8:00 or 830.");
          return;
        }
        const result = await correctPunchAndResolve({
          originalPunchId: punchId,
          newPunchTime: at(row.occurredAt, parsed),
          reason: reasonText,
          exceptionId: row.id,
        });
        if (!result.success) {
          setError(result.error ?? "That did not save.");
          return;
        }
      }

      closeForm();
      onDone(`Punch saved and exception resolved for ${row.employeeName}`);
    });
  }

  function saveNote() {
    if (!note.trim()) return;
    startTransition(async () => {
      setError(null);
      const result = await resolveException({ exceptionId: row.id, resolution: note.trim() });
      if (!result.success) {
        setError(result.error ?? "That did not save.");
        return;
      }
      closeForm();
      onDone(`Exception resolved for ${row.employeeName}`);
    });
  }

  const scheduled =
    row.scheduled.start && row.scheduled.end
      ? `${formatTimeOfDay(row.scheduled.start)} to ${formatTimeOfDay(row.scheduled.end)}`
      : "Not scheduled";

  const facts: { label: string; value: string; color: string }[] = [
    { label: "Exception", value: typeLabel, color: SEVERITY_INK[severity] },
    { label: "Scheduled", value: scheduled, color: "var(--text-primary)" },
    {
      label: "Recorded",
      value: recordedLabel(row.recorded),
      color: row.recorded.in && row.recorded.out ? "var(--text-primary)" : SEVERITY_INK[severity],
    },
    {
      label: "Pay period",
      value: `${format(row.payPeriod.startDate, "MMM d")} to ${format(row.payPeriod.endDate, "MMM d")}`,
      color: "var(--text-primary)",
    },
  ];

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        border: "1px solid var(--stroke-secondary)",
        borderLeft: `3px solid ${SEVERITY_RULE[severity]}`,
        borderRadius: "var(--radius-l)",
        background: "var(--surface-card)",
      }}
    >
      <div className="flex items-baseline gap-3 px-4 pb-3 pt-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className="truncate"
            style={{
              font: "var(--type-body1)",
              fontSize: 16,
              lineHeight: "22px",
              fontWeight: "var(--weight-semibold)",
              letterSpacing: "-0.01em",
              color: "var(--text-primary)",
            }}
          >
            {row.employeeName}
          </span>
          <span
            className="truncate"
            style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
          >
            {[row.departmentName, row.siteName].filter(Boolean).join(" · ")}
          </span>
        </div>
        <span
          className="tabular whitespace-nowrap"
          style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
        >
          {format(row.occurredAt, "EEE MMM d, yyyy")}
        </span>
      </div>

      <div className="px-4 pb-3.5">
        <span
          style={{
            font: "var(--type-body1)",
            fontSize: 15,
            lineHeight: "21px",
            fontWeight: "var(--weight-medium)",
            color: "var(--text-primary)",
            textWrap: "pretty",
          }}
        >
          {row.description}
        </span>
      </div>

      {/* The four facts, as a grid whose 1px gaps are the dividers. */}
      <div
        className="grid grid-cols-2"
        style={{
          gap: 1,
          background: "var(--stroke-divider)",
          borderTop: "1px solid var(--stroke-divider)",
          borderBottom: "1px solid var(--stroke-divider)",
        }}
      >
        {facts.map((f) => (
          <div
            key={f.label}
            className="flex flex-col gap-0.5 px-4 py-2.5"
            style={{ background: "var(--surface-card)" }}
          >
            <span className="wms-overline" style={{ color: "var(--text-secondary)" }}>
              {f.label}
            </span>
            <span
              className="tabular"
              style={{
                font: "var(--type-body2)",
                fontWeight: "var(--weight-medium)",
                color: f.color,
              }}
            >
              {f.value}
            </span>
          </div>
        ))}
      </div>

      {error && (
        <p
          className="px-4 pt-3"
          style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-error)" }}
        >
          {error}
        </p>
      )}

      {mode === null && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <Button
            size="sm"
            disabled={loadingPunches || (!addsPunches && !row.hasPunches)}
            onClick={openPunchForm}
          >
            {fixLabel}
          </Button>
          <Button hierarchy="secondary" size="sm" onClick={() => setMode("note")}>
            Resolve with Note
          </Button>
          {/* Pushed to the far end of the row, as the handoff has it: it
              leaves the screen, and the two buttons that do not should not
              sit next to something that does. */}
          <span style={{ marginLeft: "auto" }}>
            <LinkButton
              href={`/payroll/timecards?payPeriodId=${row.payPeriod.id}&employeeId=${row.employeeId}`}
              hierarchy="link"
              size="sm"
            >
              View timecard
            </LinkButton>
          </span>
        </div>
      )}

      {mode === "punch" && (
        <div
          className="flex flex-col gap-3 px-4 py-3.5"
          style={{ background: "var(--surface-tertiary)" }}
        >
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
            {addsPunches ? (
              <>
                <TimeField
                  label="Clock In"
                  value={inValue}
                  meridiem={inHalf}
                  placeholder={formatTimeOfDay(row.scheduled.start)?.replace(/ [AP]M$/, "") ?? "8:00"}
                  onChange={setInValue}
                  onMeridiemChange={setInHalf}
                />
                <TimeField
                  label="Clock Out"
                  value={outValue}
                  meridiem={outHalf}
                  placeholder={formatTimeOfDay(row.scheduled.end)?.replace(/ [AP]M$/, "") ?? "4:30"}
                  onChange={setOutValue}
                  onMeridiemChange={setOutHalf}
                />
              </>
            ) : (
              <>
                <Field label="Punch">
                  <Select
                    aria-label="Punch to correct"
                    value={punchId}
                    onChange={(e) => {
                      setPunchId(e.target.value);
                      const p = (punches ?? []).find((x) => x.id === e.target.value);
                      if (p) setNewTime(format(p.roundedTime, "HH:mm"));
                    }}
                    style={{ width: "100%" }}
                  >
                    {(punches ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {PUNCH_LABEL[p.punchType] ?? p.punchType} {format(p.roundedTime, "MMM d, h:mm a")}
                      </option>
                    ))}
                  </Select>
                </Field>
                <TimeField
                  label="New time"
                  value={newTime}
                  meridiem={newHalf}
                  placeholder={formatTimeOfDay(row.scheduled.start)?.replace(/ [AP]M$/, "") ?? "8:00"}
                  onChange={setNewTime}
                  onMeridiemChange={setNewHalf}
                />
              </>
            )}

            <Field label="Reason">
              {reasonCodes.length > 0 ? (
                <Select
                  aria-label="Reason"
                  value={reasonId}
                  onChange={(e) => setReasonId(e.target.value)}
                  style={{ width: "100%" }}
                >
                  {reasonCodes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} ({r.code})
                    </option>
                  ))}
                </Select>
              ) : (
                // No codes set up in this tenant, so the reason is typed. The
                // server asks for one either way.
                <Input
                  aria-label="Reason"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Why this changed"
                />
              )}
            </Field>

            {reasonCodes.length > 0 && (
              <Field label="Detail">
                <Input
                  aria-label="Detail"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Anything the code does not say (optional)"
                />
              </Field>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" disabled={isPending || !reasonText.trim()} onClick={savePunch}>
              {isPending ? "Saving" : "Save and Resolve"}
            </Button>
            <Button hierarchy="tertiary" size="sm" disabled={isPending} onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "note" && (
        <div
          className="flex flex-col gap-3 px-4 py-3.5"
          style={{ background: "var(--surface-tertiary)" }}
        >
          <Field label="Resolution note">
            <Textarea
              aria-label="Resolution note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="The employee sees this note"
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={isPending || !note.trim()} onClick={saveNote}>
              {isPending ? "Saving" : "Resolve"}
            </Button>
            <Button hierarchy="tertiary" size="sm" disabled={isPending} onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Label above a control, in the handoff's overline.
 *
 * <p>The shared Input draws its own label, and it is not this one, so every
 * cell here is labelled the same way instead: one grid, one label style.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="wms-overline" style={{ color: "var(--text-tertiary)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * A time, with the half of the day beside it rather than inferred from it.
 *
 * <p>The toggle is a control and not a hint: this writes to a timecard, and
 * the difference between 8:00 AM and 8:00 PM is a full shift of pay.
 */
function TimeField({
  label,
  value,
  meridiem,
  placeholder,
  onChange,
  onMeridiemChange,
}: {
  label: string;
  value: string;
  meridiem: Meridiem;
  placeholder: string;
  onChange: (value: string) => void;
  onMeridiemChange: (value: Meridiem) => void;
}) {
  return (
    <Field label={label}>
      <span className="flex items-center gap-1.5">
        <Input
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode="numeric"
          className="tabular"
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button
          hierarchy="secondary"
          size="sm"
          aria-label={`${label} is ${meridiem}`}
          onClick={() => onMeridiemChange(meridiem === "AM" ? "PM" : "AM")}
        >
          {meridiem}
        </Button>
      </span>
    </Field>
  );
}
