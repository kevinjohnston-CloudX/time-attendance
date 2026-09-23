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

/**
 * A time of day, written the way this screen shows them.
 *
 * <p>The card states scheduled and recorded times on a 24 hour clock, so the
 * field under them reads one too, and 8:30 is the morning. An explicit am or
 * pm is still accepted, because somebody will type it, and a punch entered
 * twelve hours out is a paycheck that is wrong rather than a typo.
 */
function parseTimeOfDay(input: string): { hours: number; minutes: number } | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return null;

  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  if (minutes > 59) return null;

  if (m[3]) {
    if (hours < 1 || hours > 12) return null;
    if (m[3] === "pm" && hours !== 12) hours += 12;
    if (m[3] === "am" && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }
  return { hours, minutes };
}

function at(day: Date, time: { hours: number; minutes: number }): string {
  const d = new Date(day);
  d.setHours(time.hours, time.minutes, 0, 0);
  return d.toISOString();
}

/** What was recorded, in words, because half a range needs saying rather than drawing. */
function recordedLabel(recorded: { in: string | null; out: string | null }): string {
  if (recorded.in && recorded.out) return `${recorded.in} to ${recorded.out}`;
  if (recorded.in) return `${recorded.in}, no clock out`;
  if (recorded.out) return `${recorded.out}, no clock in`;
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
  const [outValue, setOutValue] = useState("");
  const [punchId, setPunchId] = useState("");
  const [newTime, setNewTime] = useState("");
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
      setInValue(row.recorded.in ?? "");
      setOutValue(row.recorded.out ?? "");
      const first = rows[0];
      if (first) {
        setPunchId(first.id);
        setNewTime(format(first.roundedTime, "HH:mm"));
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
        const sides: { value: string; existing: Punch | null; punchType: PunchType }[] = [
          { value: inValue, existing: existingIn, punchType: "CLOCK_IN" },
          { value: outValue, existing: existingOut, punchType: "CLOCK_OUT" },
        ];

        let wrote = false;
        for (const side of sides) {
          const raw = side.value.trim();
          if (!raw) continue;
          // Unchanged from what is already on the timecard, so there is
          // nothing to write and nothing to put in the audit log.
          if (side.existing && format(side.existing.roundedTime, "HH:mm") === raw) continue;

          const parsed = parseTimeOfDay(raw);
          if (!parsed) {
            setError(`${PUNCH_LABEL[side.punchType]} is not a time. Try 08:00 or 1630.`);
            return;
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
        const parsed = parseTimeOfDay(newTime);
        if (!punchId || !parsed) {
          setError("Pick a punch and a time. Try 08:00 or 1630.");
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
      ? `${row.scheduled.start} to ${row.scheduled.end}`
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
                  placeholder={row.scheduled.start ?? "08:00"}
                  onChange={setInValue}
                />
                <TimeField
                  label="Clock Out"
                  value={outValue}
                  placeholder={row.scheduled.end ?? "16:30"}
                  onChange={setOutValue}
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
                        {PUNCH_LABEL[p.punchType] ?? p.punchType} {format(p.roundedTime, "MMM d, HH:mm")}
                      </option>
                    ))}
                  </Select>
                </Field>
                <TimeField
                  label="New time"
                  value={newTime}
                  placeholder={row.scheduled.start ?? "08:00"}
                  onChange={setNewTime}
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
              <Field label="Detail (optional)">
                <Input
                  aria-label="Detail"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Anything the code does not say"
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
          <Field label="Why this is alright">
            <Textarea
              aria-label="Why this is alright"
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

function TimeField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <Input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="numeric"
        className="tabular"
      />
    </Field>
  );
}
