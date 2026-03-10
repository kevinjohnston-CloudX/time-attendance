"use client";

import { useState, useTransition, useEffect } from "react";
import { Clock, Mail, X, Plus, Trash2, Calendar, AlertTriangle } from "lucide-react";
import {
  createSchedule,
  updateSchedule,
  deleteSchedule,
  checkEmailConfigured,
} from "@/actions/report.actions";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ScheduleFormProps {
  reportId: string;
  existingSchedule?: {
    id: string;
    cronExpr: string;
    timezone: string;
    format: string;
    recipients: string[];
    isActive: boolean;
  };
  onClose: () => void;
  onSaved: () => void;
}

type PresetType = "daily" | "weekly" | "biweekly" | "monthly" | "custom";

const DAYS_OF_WEEK = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
] as const;

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
  { value: "UTC", label: "UTC" },
] as const;

const FORMATS = [
  { value: "csv", label: "CSV" },
  { value: "pdf", label: "PDF" },
  { value: "xlsx", label: "XLSX" },
] as const;

/* ------------------------------------------------------------------ */
/*  Cron helpers                                                       */
/* ------------------------------------------------------------------ */

function buildCron(
  preset: PresetType,
  hour: string,
  minute: string,
  dayOfWeek: string,
  dayOfMonth: string,
  customCron: string,
): string {
  const h = parseInt(hour, 10);
  const m = parseInt(minute, 10);

  switch (preset) {
    case "daily":
      return `${m} ${h} * * *`;
    case "weekly":
      return `${m} ${h} * * ${dayOfWeek}`;
    case "biweekly":
      // Approximate biweekly as 1st and 15th of the month
      return `${m} ${h} 1,15 * *`;
    case "monthly":
      return `${m} ${h} ${parseInt(dayOfMonth, 10)} * *`;
    case "custom":
      return customCron;
    default:
      return `${m} ${h} * * *`;
  }
}

/** Best-effort parse of a cron expression back into preset fields. */
function parseCron(expr: string): {
  preset: PresetType;
  hour: string;
  minute: string;
  dayOfWeek: string;
  dayOfMonth: string;
  customCron: string;
} {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      preset: "custom",
      hour: "8",
      minute: "0",
      dayOfWeek: "1",
      dayOfMonth: "1",
      customCron: expr,
    };
  }

  const [min, hr, dom, , dow] = parts;
  const base = {
    hour: hr,
    minute: min,
    dayOfWeek: dow === "*" ? "1" : dow,
    dayOfMonth: dom === "*" ? "1" : dom.split(",")[0],
    customCron: expr,
  };

  // daily: m h * * *
  if (dom === "*" && dow === "*") {
    return { ...base, preset: "daily" };
  }
  // weekly: m h * * <dow>
  if (dom === "*" && dow !== "*") {
    return { ...base, preset: "weekly" };
  }
  // biweekly approximation: m h 1,15 * *
  if (dom === "1,15" && dow === "*") {
    return { ...base, preset: "biweekly" };
  }
  // monthly: m h <dom> * *
  if (dom !== "*" && dow === "*") {
    return { ...base, preset: "monthly" };
  }

  return { ...base, preset: "custom" };
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

const btnPrimary =
  "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

const btnSecondary =
  "rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ScheduleForm({
  reportId,
  existingSchedule,
  onClose,
  onSaved,
}: ScheduleFormProps) {
  const parsed = existingSchedule
    ? parseCron(existingSchedule.cronExpr)
    : null;

  const [preset, setPreset] = useState<PresetType>(parsed?.preset ?? "daily");
  const [hour, setHour] = useState(parsed?.hour ?? "8");
  const [minute, setMinute] = useState(parsed?.minute ?? "0");
  const [dayOfWeek, setDayOfWeek] = useState(parsed?.dayOfWeek ?? "1");
  const [dayOfMonth, setDayOfMonth] = useState(parsed?.dayOfMonth ?? "1");
  const [customCron, setCustomCron] = useState(parsed?.customCron ?? "0 8 * * *");

  const [timezone, setTimezone] = useState(
    existingSchedule?.timezone ?? "America/New_York",
  );
  const [format, setFormat] = useState(existingSchedule?.format ?? "csv");
  const [recipients, setRecipients] = useState<string[]>(
    existingSchedule?.recipients ?? [],
  );
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState("");

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    checkEmailConfigured(undefined as never).then((res) => {
      if (res.success) setEmailConfigured(res.data.configured);
    });
  }, []);

  /* ---- Email helpers ---- */

  function addRecipient() {
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Invalid email address");
      return;
    }
    if (recipients.includes(email)) {
      setEmailError("Email already added");
      return;
    }
    setRecipients((prev) => [...prev, email]);
    setEmailInput("");
    setEmailError("");
  }

  function removeRecipient(email: string) {
    setRecipients((prev) => prev.filter((r) => r !== email));
  }

  /* ---- Submit ---- */

  function handleSave() {
    setError(null);

    if (recipients.length === 0) {
      setError("At least one recipient is required.");
      return;
    }

    const cronExpr = buildCron(preset, hour, minute, dayOfWeek, dayOfMonth, customCron);

    startTransition(async () => {
      try {
        if (existingSchedule) {
          await updateSchedule({
            id: existingSchedule.id,
            data: {
              reportId,
              cronExpr,
              timezone,
              format,
              recipients,
            },
          });
        } else {
          await createSchedule({
            reportId,
            cronExpr,
            timezone,
            format,
            recipients,
          });
        }
        onSaved();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to save schedule.",
        );
      }
    });
  }

  function handleDelete() {
    if (!existingSchedule) return;
    if (!confirm("Remove this schedule? This cannot be undone.")) return;

    startTransition(async () => {
      try {
        await deleteSchedule({ id: existingSchedule.id });
        onSaved();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete schedule.",
        );
      }
    });
  }

  /* ---- Time options ---- */

  const hourOptions = Array.from({ length: 24 }, (_, i) => i);
  const minuteOptions = [0, 15, 30, 45];
  const dayOfMonthOptions = Array.from({ length: 28 }, (_, i) => i + 1);

  /* ---- Render ---- */

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg dark:bg-zinc-900">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-white">
            <Calendar className="h-5 w-5" />
            {existingSchedule ? "Edit Schedule" : "Schedule Report"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {emailConfigured === false && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              Email delivery is not configured yet. Schedules will be saved but emails
              won&apos;t be sent until <strong>SENDGRID_API_KEY</strong> and{" "}
              <strong>SENDGRID_FROM_EMAIL</strong> environment variables are set.
            </span>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Frequency preset */}
        <fieldset className="mb-4">
          <legend className="mb-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Frequency
          </legend>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as PresetType)}
            className={inputClass + " w-full"}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly (1st &amp; 15th)</option>
            <option value="monthly">Monthly</option>
            <option value="custom">Custom cron</option>
          </select>
        </fieldset>

        {/* Preset-specific fields */}
        {preset !== "custom" && (
          <div className="mb-4 flex flex-wrap gap-3">
            {/* Day of week — weekly / biweekly */}
            {(preset === "weekly" || preset === "biweekly") && (
              <div className="flex-1">
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Day
                </label>
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(e.target.value)}
                  className={inputClass + " w-full"}
                >
                  {DAYS_OF_WEEK.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Day of month — monthly */}
            {preset === "monthly" && (
              <div className="flex-1">
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Day of month
                </label>
                <select
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  className={inputClass + " w-full"}
                >
                  {dayOfMonthOptions.map((d) => (
                    <option key={d} value={String(d)}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Time */}
            <div className="flex gap-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Hour
                </label>
                <select
                  value={hour}
                  onChange={(e) => setHour(e.target.value)}
                  className={inputClass + " w-20"}
                >
                  {hourOptions.map((h) => (
                    <option key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Min
                </label>
                <select
                  value={minute}
                  onChange={(e) => setMinute(e.target.value)}
                  className={inputClass + " w-20"}
                >
                  {minuteOptions.map((m) => (
                    <option key={m} value={String(m)}>
                      {String(m).padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Custom cron */}
        {preset === "custom" && (
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Cron expression
            </label>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0 text-zinc-400" />
              <input
                type="text"
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                placeholder="0 8 * * *"
                className={inputClass + " w-full font-mono"}
              />
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Format: minute hour day-of-month month day-of-week
            </p>
          </div>
        )}

        {/* Timezone */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Timezone
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={inputClass + " w-full"}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>

        {/* Format */}
        <fieldset className="mb-4">
          <legend className="mb-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Format
          </legend>
          <div className="flex gap-4">
            {FORMATS.map((f) => (
              <label
                key={f.value}
                className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300"
              >
                <input
                  type="radio"
                  name="format"
                  value={f.value}
                  checked={format === f.value}
                  onChange={() => setFormat(f.value)}
                  className="accent-zinc-900 dark:accent-zinc-100"
                />
                {f.label}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Recipients */}
        <div className="mb-5">
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <Mail className="h-4 w-4" />
            Recipients
          </label>

          <div className="flex gap-2">
            <input
              type="email"
              value={emailInput}
              onChange={(e) => {
                setEmailInput(e.target.value);
                setEmailError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addRecipient();
                }
              }}
              placeholder="email@example.com"
              className={inputClass + " flex-1"}
            />
            <button
              type="button"
              onClick={addRecipient}
              className={btnSecondary + " flex items-center gap-1"}
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>

          {emailError && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {emailError}
            </p>
          )}

          {recipients.length > 0 && (
            <ul className="mt-2 space-y-1">
              {recipients.map((email) => (
                <li
                  key={email}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                >
                  <span className="truncate">{email}</span>
                  <button
                    type="button"
                    onClick={() => removeRecipient(email)}
                    className="ml-2 shrink-0 text-zinc-400 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div>
            {existingSchedule && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
              >
                Delete schedule
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className={btnSecondary}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className={btnPrimary}
            >
              {isPending
                ? "Saving..."
                : existingSchedule
                  ? "Update"
                  : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
