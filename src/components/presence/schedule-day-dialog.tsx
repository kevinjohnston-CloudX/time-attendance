"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { addToTodaysSchedule } from "@/actions/presence.actions";
import { parseTimeOfDay, toHHmm, type Meridiem } from "@/lib/utils/time-of-day";
import { formatTimeOfDay } from "@/lib/utils/date";
import styles from "./on-site.module.css";

/**
 * Add to schedule: a shift for today, for somebody who has none.
 *
 * <p>Start and end each carry their own AM or PM, set by hand rather than
 * guessed, because 8:00 AM and 8:00 PM are a whole shift apart. An end before
 * the start is an overnight shift and is said so under the fields rather than
 * refused. Nothing is saved until Add to schedule, and Escape closes this
 * without closing the panel underneath.
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
  onClose,
  onSaved,
}: {
  siteId: string;
  employeeId: string;
  name: string;
  /** Today, as the panel names it. */
  dayLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [start, setStart] = useState("");
  const [startHalf, setStartHalf] = useState<Meridiem>("AM");
  const [end, setEnd] = useState("");
  const [endHalf, setEndHalf] = useState<Meridiem>("PM");
  const [meal, setMeal] = useState("30");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Escape closes this, not the panel; focus comes in and goes back out.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

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
      else setError(SAVE_ERRORS[res.error] ?? "The schedule could not be saved. Try again.");
    } catch {
      setError("The schedule could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.peScrim} onClick={saving ? undefined : onClose}>
      <div
        ref={dialogRef}
        className={styles.peDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sd-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.peHead}>
          <div className="flex min-w-0 flex-col">
            <h2 id="sd-title" className={styles.peTitle}>
              Add to schedule
            </h2>
            <span className={styles.peSub} title={`${name} · ${dayLabel}`}>
              {[name, dayLabel].filter(Boolean).join(" · ")}
            </span>
          </div>
          <Button hierarchy="tertiary" size="sm" iconOnly aria-label="Close" onClick={onClose} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form
          className={styles.sdBody}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
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
          {error && <p className={styles.peError}>{error}</p>}
          <button type="submit" hidden />
        </form>

        <div className={styles.peFoot}>
          <span className={styles.peNote}>Saved in CloudTime only</span>
          <span className="flex gap-2">
            <Button hierarchy="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!ready || saving}>
              {saving ? "Saving…" : "Add to schedule"}
            </Button>
          </span>
        </div>
      </div>
    </div>
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
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={invalid || undefined}
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
    </div>
  );
}
