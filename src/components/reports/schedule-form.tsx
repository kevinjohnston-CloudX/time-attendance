"use client";

import { useState, useTransition, useEffect } from "react";
import type { ReactNode } from "react";
import { Mail, Plus, Trash2, X } from "lucide-react";
import {
  Badge,
  Banner,
  Button,
  Input,
  SegmentedControl,
  Select,
  statusTone,
} from "@/components/ui";
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
  // Capitals, as the schedule schema takes them. Lowercase failed its check,
  // so no schedule could be saved.
  { value: "XLSX", label: "Excel" },
  { value: "CSV", label: "CSV" },
  { value: "PDF", label: "PDF" },
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
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * When a report goes out, in what format, and to whom.
 *
 * <p>The cron the form builds is unchanged — the presets, the 1st-and-15th
 * approximation of "biweekly" and the parse back out of a saved expression are
 * all the same code. What changed is the shell: it is the design system's
 * modal, its fields are the kit's, and format is one segmented choice instead
 * of three radios.
 */
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [minute, setMinute] = useState(parsed?.minute ?? "0");
  const [dayOfWeek, setDayOfWeek] = useState(parsed?.dayOfWeek ?? "1");
  const [dayOfMonth, setDayOfMonth] = useState(parsed?.dayOfMonth ?? "1");
  const [customCron, setCustomCron] = useState(parsed?.customCron ?? "0 8 * * *");

  const [timezone, setTimezone] = useState(
    existingSchedule?.timezone ?? "America/New_York",
  );
  const [format, setFormat] = useState(existingSchedule?.format?.toUpperCase() ?? "XLSX");
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
      setEmailError("That does not look like an email address.");
      return;
    }
    if (recipients.includes(email)) {
      setEmailError("That address is already on the list.");
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
      setError("Add at least one email address.");
      return;
    }

    const cronExpr = buildCron(preset, hour, minute, dayOfWeek, dayOfMonth, customCron);

    startTransition(async () => {
      try {
        // The actions answer with a result rather than throwing, so a
        // refused save used to close this window as if it had worked.
        const res = existingSchedule
          ? await updateSchedule({
            id: existingSchedule.id,
            data: {
              reportId,
              cronExpr,
              timezone,
              format,
              recipients,
            },
          })
          : await createSchedule({
            reportId,
            cronExpr,
            timezone,
            format,
            recipients,
          });
        if (!res.success) {
          setError(friendlyError(res.error, "The schedule could not be saved. Try again."));
          return;
        }
        onSaved();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "The schedule could not be saved. Try again.",
        );
      }
    });
  }

  function handleDelete() {
    if (!existingSchedule) return;
    // Asked in the footer, in place, rather than in a browser pop up.
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    startTransition(async () => {
      try {
        const res = await deleteSchedule({ id: existingSchedule.id });
        if (!res.success) {
          setError(friendlyError(res.error, "The schedule could not be deleted. Try again."));
          setConfirmingDelete(false);
          return;
        }
        onSaved();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "The schedule could not be deleted. Try again.",
        );
      }
    });
  }

  /* ---- Time options ---- */

  // On a 12 hour clock with its own AM or PM, as every time here is; the
  // schedule itself still stores the 24 hour value.
  const hour24 = parseInt(hour, 10) || 0;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const isPm = hour24 >= 12;
  const setHour12 = (h12: number, pm: boolean) => setHour(String((h12 % 12) + (pm ? 12 : 0)));
  const hourOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const minuteOptions = [0, 15, 30, 45];
  const dayOfMonthOptions = Array.from({ length: 28 }, (_, i) => i + 1);

  /* ---- Render ---- */

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={existingSchedule ? "Email schedule" : "Email this report"}
        className="ta-modal flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden"
        style={{ borderRadius: "var(--radius-l)" }}
      >
        <header
          className="flex flex-none items-center gap-3 px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--stroke-divider)" }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
              {existingSchedule ? "Email schedule" : "Email this report"}
            </h2>
            <p style={{ margin: 0, font: "var(--type-subtitle)", color: "var(--text-secondary)" }}>
              Sent automatically to the people below, with the file attached
            </p>
          </div>
          {existingSchedule && (
            // ACTIVE and OPEN are the shared helper's own words for "running"
            // and "sitting there doing nothing", which is exactly the
            // difference between a live schedule and a paused one.
            <Badge tone={statusTone(existingSchedule.isActive ? "ACTIVE" : "OPEN")} size="sm">
              {existingSchedule.isActive ? "Active" : "Paused"}
            </Badge>
          )}
          <Button hierarchy="tertiary" iconOnly onClick={onClose} aria-label="Close" title="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {emailConfigured === false && (
            <Banner
              tone="warning"
              title="Email is not turned on yet"
              body="You can save the schedule now, but no emails go out until an administrator turns email on."
            />
          )}

          {error && <Banner tone="error" title="The schedule was not saved" body={error} />}

          <Field label="Frequency" htmlFor="sched-frequency">
            <Select
              id="sched-frequency"
              value={preset}
              onChange={(e) => setPreset(e.target.value as PresetType)}
              style={{ width: "100%" }}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Twice a month (1st and 15th)</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom (advanced)</option>
            </Select>
          </Field>

          {preset !== "custom" && (
            <div className="flex flex-wrap items-end gap-3">
              {/* Twice a month runs on the 1st and 15th, whatever the day
                  of the week, so it asks for no day. */}
              {preset === "weekly" && (
                <div className="min-w-[160px] flex-1">
                  <Field label="Day" htmlFor="sched-dow">
                    <Select
                      id="sched-dow"
                      value={dayOfWeek}
                      onChange={(e) => setDayOfWeek(e.target.value)}
                      style={{ width: "100%" }}
                    >
                      {DAYS_OF_WEEK.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}

              {preset === "monthly" && (
                <div className="min-w-[160px] flex-1">
                  <Field label="Day of month" htmlFor="sched-dom">
                    <Select
                      id="sched-dom"
                      value={dayOfMonth}
                      onChange={(e) => setDayOfMonth(e.target.value)}
                      style={{ width: "100%" }}
                    >
                      {dayOfMonthOptions.map((d) => (
                        <option key={d} value={String(d)}>
                          {d}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}

              <Field label="Time" htmlFor="sched-hour">
                <span className="flex items-center gap-1.5">
                  <Select
                    id="sched-hour"
                    value={String(hour12)}
                    onChange={(e) => setHour12(Number(e.target.value), isPm)}
                    aria-label="Hour"
                    style={{ width: 72 }}
                  >
                    {hourOptions.map((h) => (
                      <option key={h} value={String(h)}>
                        {h}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={minute}
                    onChange={(e) => setMinute(e.target.value)}
                    aria-label="Minutes"
                    style={{ width: 72 }}
                  >
                    {minuteOptions.map((m) => (
                      <option key={m} value={String(m)}>
                        {String(m).padStart(2, "0")}
                      </option>
                    ))}
                  </Select>
                  <SegmentedControl
                    items={[
                      { value: "AM", label: "AM" },
                      { value: "PM", label: "PM" },
                    ]}
                    value={isPm ? "PM" : "AM"}
                    onChange={(v) => setHour12(hour12, v === "PM")}
                    ariaLabel="AM or PM"
                  />
                </span>
              </Field>
            </div>
          )}

          {preset === "custom" && (
            <Input
              label="Cron expression"
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder="0 8 * * *"
              hint="Five values: minute, hour (0 to 23), day of the month, month, day of the week"
            />
          )}

          <Field label="Time zone" htmlFor="sched-tz">
            <Select
              id="sched-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              style={{ width: "100%" }}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Send as">
            <SegmentedControl
              items={FORMATS.map((f) => ({ value: f.value, label: f.label }))}
              value={format}
              onChange={setFormat}
              fullWidth
              ariaLabel="Attachment format"
            />
          </Field>

          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  label="Send to"
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
                  placeholder="name@company.com"
                  leadingIcon={<Mail className="h-4 w-4" />}
                />
              </div>
              <Button
                hierarchy="secondary"
                onClick={addRecipient}
                leadingIcon={<Plus className="h-4 w-4" />}
              >
                Add
              </Button>
            </div>

            {/* The message sits outside the field rather than inside it: the
                Add button is aligned to the bottom of the input, and an error
                that grew under the input would shunt the button down the
                moment somebody mistyped an address. */}
            {emailError && (
              <p style={{ margin: 0, font: "var(--type-caption1)", color: "var(--text-error)" }}>
                {emailError}
              </p>
            )}

            {/* The list is the only confirmation an address was accepted, and
                a schedule with no recipients is refused on save — so say so
                here rather than at the bottom of the form. */}
            {recipients.length === 0 ? (
              <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                Add at least one email address to save the schedule.
              </p>
            ) : (
              <ul
                className="flex flex-col"
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  border: "1px solid var(--stroke-divider)",
                  borderRadius: "var(--radius-m)",
                }}
              >
                {recipients.map((email, i) => (
                  <li
                    key={email}
                    className="flex items-center gap-2 px-3 py-1.5"
                    style={{ borderTop: i === 0 ? undefined : "1px solid var(--stroke-divider)" }}
                  >
                    <span
                      className="min-w-0 flex-1 truncate"
                      style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}
                    >
                      {email}
                    </span>
                    <Button
                      hierarchy="tertiary"
                      tone="error"
                      size="sm"
                      iconOnly
                      onClick={() => removeRecipient(email)}
                      title={`Remove ${email}`}
                      aria-label={`Remove ${email}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer
          className="flex flex-none flex-wrap items-center gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--stroke-divider)" }}
        >
          {existingSchedule && !confirmingDelete && (
            <Button hierarchy="link" tone="error" disabled={isPending} onClick={handleDelete}>
              Delete schedule
            </Button>
          )}
          {existingSchedule && confirmingDelete && (
            <span className="flex flex-wrap items-center gap-2">
              <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>Stop emailing this report?</span>
              <Button size="sm" hierarchy="primary" tone="error" disabled={isPending} onClick={handleDelete}>
                Yes, delete schedule
              </Button>
              <Button size="sm" hierarchy="tertiary" disabled={isPending} onClick={() => setConfirmingDelete(false)}>
                Keep it
              </Button>
            </span>
          )}
          <div className="flex-1" />
          <Button hierarchy="secondary" disabled={isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button hierarchy="primary" disabled={isPending} onClick={handleSave}>
            {isPending ? "Saving" : existingSchedule ? "Save changes" : "Save schedule"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

/**
 * A label over a control the kit does not label itself.
 *
 * <p>Select is a bare control by design — it goes in table toolbars as often
 * as in forms — so the label stack that Input brings with it is written out
 * here, at the same measurements, rather than a second styling of it per
 * field.
 */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const text = { font: "var(--type-button2)", color: "var(--text-secondary)" };
  return (
    <div className="flex flex-col gap-1.5">
      {/* A <label> needs something to be the label of. The format switch is a
          group of buttons, not one control, so that one gets a span. */}
      {htmlFor ? (
        <label htmlFor={htmlFor} style={text}>
          {label}
        </label>
      ) : (
        <span style={text}>{label}</span>
      )}
      {children}
    </div>
  );
}

/** A server refusal in words, rather than FORBIDDEN or a database message. */
function friendlyError(code: string, fallback: string): string {
  if (code === "FORBIDDEN") return "You do not have permission to schedule reports.";
  if (code === "UNAUTHENTICATED") return "Your session ended. Sign in again, then try once more.";
  if (/No .* found|Record to update not found/i.test(code)) return "This report is no longer available to you.";
  if (/cron/i.test(code)) return "That custom schedule could not be read. Check the five values.";
  return fallback;
}
