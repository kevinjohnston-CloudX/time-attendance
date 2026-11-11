"use client";

import { useRef, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { Window, WindowCard } from "@/components/ui/window";
import { addToTodaysSchedule } from "@/actions/presence.actions";
import { parseTimeOfDay, toHHmm, type Meridiem } from "@/lib/utils/time-of-day";
import { formatTimeOfDay } from "@/lib/utils/date";
import styles from "./on-site.module.css";
import { codeOf } from "@/lib/action-errors";

/**
 * Add to schedule: a shift for today, for somebody who has none.
 *
 * <p>Start and end each carry their own AM or PM, set by hand rather than
 * guessed, because 8:00 AM and 8:00 PM are a whole shift apart. An end before
 * the start is an overnight shift and is said so under the fields rather than
 * refused. Nothing is saved until Add to schedule. It is a window on the
 * shared frame, so Escape closes this and not the panel or alert under it.
 * Opened from the gate alert, it starts filled in with the hours of the
 * shift on their record.
 */

const SAVE_ERRORS: Record<string, string> = {
  NOT_LIVE: "Adding to the schedule is not turned on yet.",
  FORBIDDEN: "You do not have permission to change schedules.",
  UNAUTHENTICATED: "Your session has ended. Sign in again to save.",
  NOT_FOUND: "This employee could not be found at this site.",
  INACTIVE: "This employee is inactive and cannot be scheduled.",
  ALREADY_SCHEDULED: "This employee is already on today's schedule.",
  BAD_TIME: "Enter a start and an end time.",
};

/** "07:00" as the fields hold it: "7:00" and AM. */
function toField(hhmm: string | null | undefined): { text: string; half: Meridiem } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  return { text: `${h % 12 || 12}:${m[2]}`, half: h < 12 ? "AM" : "PM" };
}

const MEALS = [
  { value: "", label: "No meal" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hr" },
];

export function ScheduleDayDialog({
  siteId,
  employeeId,
  name,
  dayLabel,
  initial,
  onClose,
  onSaved,
}: {
  siteId: string;
  employeeId: string;
  name: string;
  /** Today, as the panel names it. */
  dayLabel: string;
  /** Hours to start from, HH:mm, such as the shift on their record. */
  initial?: { startTime: string | null; endTime: string | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [start, setStart] = useState(() => toField(initial?.startTime)?.text ?? "");
  const [startHalf, setStartHalf] = useState<Meridiem>(() => toField(initial?.startTime)?.half ?? "AM");
  const [end, setEnd] = useState(() => toField(initial?.endTime)?.text ?? "");
  const [endHalf, setEndHalf] = useState<Meridiem>(() => toField(initial?.endTime)?.half ?? "PM");
  const [meal, setMeal] = useState("30");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldsRef = useRef<HTMLElement>(null);

  const from = start.trim() ? parseTimeOfDay(start, startHalf) : null;
  const to = end.trim() ? parseTimeOfDay(end, endHalf) : null;
  const startBad = start.trim() !== "" && !from;
  const endBad = end.trim() !== "" && !to;
  const same = from && to && toHHmm(from) === toHHmm(to);
  const overnight = from && to && !same && toHHmm(to) < toHHmm(from);
  const ready = !!from && !!to && !same;

  async function save() {
    if (!from || !to || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await addToTodaysSchedule({
        siteId,
        employeeId,
        startTime: toHHmm(from),
        endTime: toHHmm(to),
        mealMinutes: meal ? Number(meal) : null,
      });
      if (res.success) onSaved();
      else setError(SAVE_ERRORS[codeOf(res)] ?? res.error);
    } catch {
      setError("The schedule could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Window
      size="sm"
      icon={<CalendarPlus />}
      title="Add to schedule"
      subtitle={dayLabel ? `${name}, ${dayLabel === "Today" ? "today" : dayLabel}` : name}
      busy={saving}
      initialFocus={fieldsRef}
      foot={error ?? "Saved in CloudTime only."}
      footTone={error ? "error" : undefined}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      actions={
        <>
          <Button hierarchy="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" pending={saving} disabled={!ready || saving}>
            {saving ? "Saving…" : "Add to schedule"}
          </Button>
        </>
      }
    >
      <WindowCard padded ref={fieldsRef}>
        <div className={styles.sdRow}>
          <TimeField
            id="sd-start"
            label="Start"
            value={start}
            meridiem={startHalf}
            placeholder="8:00"
            invalid={startBad}
            onChange={setStart}
            onMeridiemChange={setStartHalf}
          />
          <TimeField
            id="sd-end"
            label="End"
            value={end}
            meridiem={endHalf}
            placeholder="4:30"
            invalid={endBad}
            onChange={setEnd}
            onMeridiemChange={setEndHalf}
          />
        </div>
        <label className={styles.sdField} htmlFor="sd-meal">
          <span className={styles.sdLabel}>Meal</span>
          <Select id="sd-meal" value={meal} onChange={(e) => setMeal(e.target.value)}>
            {MEALS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
        <p className={styles.sdHint} aria-live="polite">
          {startBad || endBad
            ? "Enter times like 8:00 or 4:30."
            : same
              ? "The start and the end are the same time."
              : from && to
                ? `${formatTimeOfDay(toHHmm(from))} to ${formatTimeOfDay(toHHmm(to))}${overnight ? ", ending the next day" : ""}`
                : "Today only. Their schedule from WMS is not changed."}
        </p>
      </WindowCard>
    </Window>
  );
}

/** A time, with the half of the day beside it rather than inferred from it. */
function TimeField({
  id,
  label,
  value,
  meridiem,
  placeholder,
  invalid,
  onChange,
  onMeridiemChange,
}: {
  id: string;
  label: string;
  value: string;
  meridiem: Meridiem;
  placeholder: string;
  invalid: boolean;
  onChange: (value: string) => void;
  onMeridiemChange: (value: Meridiem) => void;
}) {
  return (
    <div className={styles.sdField}>
      <label className={styles.sdLabel} htmlFor={id}>
        {label}
      </label>
      <span className="flex items-center gap-1.5">
        {/* The input's field fills its parent, so it gets one that may
            shrink, and the AM or PM button beside it keeps its room. */}
        <span className="min-w-0 flex-1">
          <Input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={invalid || undefined}
            className="tabular"
            style={{ minWidth: 0 }}
          />
        </span>
        <Button
          hierarchy="secondary"
          size="sm"
          aria-label={`${label} is ${meridiem}`}
          onClick={() => onMeridiemChange(meridiem === "AM" ? "PM" : "AM")}
        >
          {meridiem}
        </Button>
      </span>
    </div>
  );
}
