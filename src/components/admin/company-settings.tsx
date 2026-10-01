"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ArrowRight, BellRing, BookOpen, CalendarCog, CalendarPlus, CalendarSync, CircleAlert } from "lucide-react";
import type { PayFrequency } from "@prisma/client";
import { Badge, Banner, Button, Input, LinkButton, Switch, Toast, useToast } from "@/components/ui";
import { SetupDialog } from "@/components/admin/setup/setup-ui";
import { generateNextPayPeriod, updateTenantSettings } from "@/actions/pay-period.actions";
import { setGateAlerts } from "@/actions/gate-refusals.actions";
import { getPeriodContaining, lastDayOf, periodAfter, periodDays } from "@/lib/pay-period-math";

/**
 * Company Settings, from the Company Settings handoff: the pay schedule on the
 * left with a live preview of the periods it produces, and Generate beside it.
 *
 * <p>The preview and Generate both run the server's own period arithmetic
 * (pay-period-math), so the dates on screen are the dates that get created.
 * Nothing is written until Save or a confirmed Generate.
 *
 * <p>Below them, for System Admins only, the Live Attendance switch for the
 * gate alert. It is a single company wide setting, so it sits here rather than
 * on a tab of its own, and it saves the moment it is flipped.
 */

const FREQS: { value: PayFrequency; label: string; detail: string }[] = [
  { value: "WEEKLY", label: "Weekly", detail: "Every 7 days" },
  { value: "BIWEEKLY", label: "Bi-weekly", detail: "Every 14 days" },
  { value: "SEMIMONTHLY", label: "Semi-monthly", detail: "1st to 15th, 16th to end" },
  { value: "MONTHLY", label: "Monthly", detail: "1st to end of month" },
];
const FREQ_LABEL = Object.fromEntries(FREQS.map((f) => [f.value, f.label])) as Record<PayFrequency, string>;
const TAGS = ["Current", "Next", "Following"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Schedule = { freq: PayFrequency; anchor: string };
type Period = { startDate: Date; endDate: Date };

/** A typed "yyyy-mm-dd" as local noon, the same way the server stores it. */
function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
}

function rangeText(freq: PayFrequency, p: Period): string {
  const last = lastDayOf(freq, p.endDate);
  const start = format(p.startDate, p.startDate.getFullYear() === last.getFullYear() ? "MMM d" : "MMM d, yyyy");
  return `${start} to ${format(last, "MMM d, yyyy")}`;
}

function anchorHint(s: Schedule, anchor: Date | null): string {
  if (!anchor) return "Choose a date that really was the first day of a pay period.";
  if (s.freq === "SEMIMONTHLY") return "Semi-monthly periods follow the calendar, 1st to 15th and 16th to the last day, so this date does not move them.";
  if (s.freq === "MONTHLY") return "Monthly periods follow the calendar, 1st to the last day of the month, so this date does not move them.";
  return `Periods start on ${WEEKDAYS[anchor.getDay()]} and end on ${WEEKDAYS[(anchor.getDay() + 6) % 7]}.`;
}

function listNames(names: string[]): string {
  if (names.length <= 3) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };
const WELL: CSSProperties = { background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)", borderRadius: 12 };
const OVERLINE: CSSProperties = {
  font: "var(--weight-semibold) 11px/14px var(--font-sans)",
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
};

function IconTile({ children, size = 36, tone = "neutral" }: { children: ReactNode; size?: number; tone?: "neutral" | "info" }) {
  return (
    <span
      className="grid flex-none place-items-center"
      style={{
        width: size,
        height: size,
        borderRadius: size > 36 ? 11 : size > 32 ? 10 : 9,
        background: tone === "info" ? "var(--surface-info)" : "var(--ta-well)",
        boxShadow: `inset 0 0 0 1px ${tone === "info" ? "var(--ta-nav-on-ring)" : "var(--ta-well-ring)"}`,
        color: tone === "info" ? "var(--icon-accent)" : "var(--icon-tertiary)",
      }}
    >
      {children}
    </span>
  );
}

function PanelHead({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3" style={{ marginBottom: 18 }}>
      <IconTile>{icon}</IconTile>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 style={{ margin: 0, font: "var(--weight-semibold) 15px/20px var(--font-sans)", color: "var(--text-primary)" }}>{title}</h2>
        <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>{subtitle}</span>
      </span>
    </div>
  );
}

/**
 * The gate alert switch. Saves on the flip, since there is nothing else to fill
 * in, and says in a sentence what each position means for loss prevention.
 */
function GateAlertsPanel({ onSince: stored, flash }: { onSince: string | null; flash: (message: string) => void }) {
  const router = useRouter();
  const [onSince, setOnSince] = useState(stored);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const on = onSince !== null;

  // A refresh brings the stored value back in, including a change made elsewhere.
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setOnSince(stored);
  }

  const flip = (next: boolean) => {
    setError(null);
    start(async () => {
      const result = await setGateAlerts({ on: next });
      if (!result.success) {
        setError(result.error === "FORBIDDEN" ? "Only System Admins can change gate alerts." : result.error);
        return;
      }
      setOnSince(result.data.onSince);
      flash(next ? "Gate alerts turned on" : "Gate alerts turned off");
      router.refresh();
    });
  };

  return (
    <section style={{ ...PANEL, padding: "18px 20px 20px" }}>
      <PanelHead
        icon={<BellRing className="h-[18px] w-[18px]" />}
        title="Live Attendance"
        subtitle="Applies to every building in the company."
      />
      <div className="flex items-start gap-4 px-4 py-3.5" style={WELL}>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <label
            htmlFor="gate-alerts-switch"
            style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)", cursor: "pointer" }}
          >
            Gate alerts
          </label>
          <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            A pop up on Live Attendance when the security gate turns away somebody with no shift today.
          </span>
          {/* The time is in the reader's own zone, which the server cannot know. */}
          <span suppressHydrationWarning style={{ font: "var(--type-body2)", color: on ? "var(--text-primary)" : "var(--text-warning)", textWrap: "pretty" }}>
            {onSince
              ? `On since ${format(new Date(onSince), "MMM d, h:mm a")}, for roles with Live Attendance Execute.`
              : "Off. The gate keeps checking people and CloudTime keeps a record of each refusal, but nobody gets the pop up."}
          </span>
        </span>
        <span className="flex-none pt-0.5">
          <Switch id="gate-alerts-switch" checked={on} disabled={pending} onChange={flip} />
        </span>
      </div>
      {error && (
        <div className="mt-3">
          <Banner tone="error" title="Not changed" body={error} />
        </div>
      )}
    </section>
  );
}

export function CompanySettings({
  frequency,
  anchor,
  next,
  defaultRuleSets,
  canOpenRules,
  gateAlerts = null,
}: {
  frequency: PayFrequency;
  anchor: string;
  next: { startDate: string; endDate: string; frequency: PayFrequency } | null;
  defaultRuleSets: string[];
  canOpenRules: boolean;
  /** The gate alert switch, for System Admins only; null leaves the panel out. */
  gateAlerts?: { onSince: string | null } | null;
}) {
  const router = useRouter();
  const { message, flash } = useToast();
  const [saved, setSaved] = useState<Schedule>({ freq: frequency, anchor });
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [tried, setTried] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [generating, startGenerate] = useTransition();

  // A refresh after a save or a generate brings the stored values back in.
  const stored = `${frequency}|${anchor}`;
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setSaved({ freq: frequency, anchor });
  }

  const current = draft ?? saved;
  const dirty = current.freq !== saved.freq || current.anchor !== saved.anchor;
  const anchorDay = parseDay(current.anchor);

  // Current, next and following under the settings as they stand on screen.
  const upcoming: Period[] = [];
  if (anchorDay) {
    upcoming.push(getPeriodContaining(current.freq, anchorDay, new Date()));
    for (let i = 0; i < 2; i++) upcoming.push(periodAfter(current.freq, anchorDay, upcoming[i].endDate));
  }

  const nextPeriod = next ? { startDate: new Date(next.startDate), endDate: new Date(next.endDate) } : null;
  const nextRange = next && nextPeriod ? rangeText(next.frequency, nextPeriod) : "";

  const edit = (patch: Partial<Schedule>) => {
    setDraft({ ...current, ...patch });
    setSaveError(null);
  };

  const save = () => {
    if (!current.anchor) {
      setTried(true);
      return;
    }
    const values = current;
    startSave(async () => {
      const result = await updateTenantSettings({ payFrequency: values.freq, payPeriodAnchorDate: values.anchor });
      if (!result.success) {
        setSaveError(result.error);
        return;
      }
      setSaved(values);
      setDraft(null);
      setTried(false);
      flash("Company settings saved");
      router.refresh();
    });
  };

  const generate = () => {
    if (!next) return;
    startGenerate(async () => {
      const result = await generateNextPayPeriod({ startDate: next.startDate });
      if (!result.success) {
        setGenError(result.error);
        return;
      }
      setConfirming(false);
      flash(`Pay period ${nextRange} created`);
      router.refresh();
    });
  };

  const barText = dirty ? "Unsaved changes" : saved.anchor ? "Saved" : "No anchor date saved yet";

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start gap-3.5" style={{ ...PANEL, borderRadius: 16, boxShadow: "var(--shadow-xs)", padding: "14px 18px 14px 14px" }}>
        <IconTile size={38} tone="info">
          <CalendarSync className="h-[18px] w-[18px]" />
        </IconTile>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px] pt-px">
          <span style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>
            Changes apply to future pay periods
          </span>
          <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            Saving these does not move pay periods that already exist. It decides how the next ones are generated.
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-3.5">
        <section className="min-w-0" style={{ ...PANEL, flex: "999 1 560px", padding: "18px 20px 20px" }}>
          <PanelHead
            icon={<CalendarCog className="h-[18px] w-[18px]" />}
            title="Pay Period Configuration"
            subtitle="The frequency and one real start date. Every other period is calculated from the pair."
          />

          <div id="pay-frequency-label" style={{ ...OVERLINE, marginBottom: 8 }}>Pay Frequency</div>
          <div role="radiogroup" aria-labelledby="pay-frequency-label" className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            {FREQS.map((f) => {
              const on = current.freq === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => edit({ freq: f.value })}
                  className={`ta-choice flex flex-col gap-1 text-left${on ? " ta-choice-on" : ""}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="ta-choice-dot" aria-hidden />
                    <span className="whitespace-nowrap" style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>
                      {f.label}
                    </span>
                  </span>
                  <span className="pl-6" style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                    {f.detail}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-[18px] flex flex-wrap items-start gap-4">
            <div className="flex min-w-[220px] flex-col" style={{ flex: "0 1 260px" }}>
              <Input
                label="Anchor Date"
                type="date"
                required
                value={current.anchor}
                onChange={(e) => edit({ anchor: e.target.value })}
                error={tried && !current.anchor ? anchorHint(current, null) : undefined}
                hint={anchorHint(current, anchorDay)}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5" style={{ flex: "1 1 280px" }}>
              <span className="flex items-center gap-2" style={{ font: "var(--weight-medium) 13px/18px var(--font-sans)", color: "var(--text-primary)" }}>
                Upcoming pay periods
                {dirty && <Badge tone="info" size="sm">Preview</Badge>}
              </span>
              <div className="flex flex-col gap-0.5 p-1" style={WELL}>
                {upcoming.length === 0 ? (
                  <div className="flex min-h-[34px] items-center px-2.5" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                    Choose an anchor date to see the periods it produces.
                  </div>
                ) : (
                  upcoming.map((p, i) => (
                    <div
                      key={i}
                      className="flex min-h-[34px] items-center gap-2.5 px-2.5"
                      style={{
                        borderRadius: 9,
                        background: i === 1 ? "var(--surface-card)" : "transparent",
                        boxShadow: i === 1 ? "var(--ta-raised)" : "none",
                      }}
                    >
                      <span
                        className="flex-none whitespace-nowrap"
                        style={{
                          width: 76,
                          font: "var(--weight-semibold) 11px/1 var(--font-sans)",
                          letterSpacing: ".05em",
                          textTransform: "uppercase",
                          color: i === 1 ? "var(--text-accent)" : "var(--text-tertiary)",
                        }}
                      >
                        {TAGS[i]}
                      </span>
                      <span className="tabular min-w-0 flex-1 truncate" style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}>
                        {rangeText(current.freq, p)}
                      </span>
                      <span className="whitespace-nowrap" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                        {periodDays(current.freq, p)} days
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {saveError && (
            <div className="mt-5">
              <Banner tone="error" title="Not saved" body={saveError} />
            </div>
          )}
          <div
            className="mt-5 flex items-center gap-2.5 py-2.5 pl-3.5 pr-2.5"
            style={{
              borderRadius: 12,
              background: dirty ? "var(--surface-info)" : "var(--ta-well)",
              boxShadow: `inset 0 0 0 1px ${dirty ? "var(--ta-nav-on-ring)" : "var(--ta-well-ring)"}`,
            }}
          >
            <span className="flex flex-1 items-center gap-2" style={{ font: "var(--type-body2)", color: dirty ? "var(--text-accent)" : "var(--text-secondary)" }}>
              <span
                aria-hidden
                style={{ width: 7, height: 7, borderRadius: 999, background: dirty ? "var(--fill-accent)" : saved.anchor ? "var(--fill-success)" : "var(--fill-warning)" }}
              />
              {barText}
            </span>
            {dirty && (
              <Button
                hierarchy="tertiary"
                onClick={() => {
                  setDraft(null);
                  setTried(false);
                  setSaveError(null);
                }}
                disabled={saving}
              >
                Discard
              </Button>
            )}
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save Settings"}
            </Button>
          </div>
        </section>

        <aside className="flex max-w-full flex-col gap-3.5" style={{ flex: "1 1 320px" }}>
          <section style={{ ...PANEL, padding: "18px 20px 20px" }}>
            <PanelHead
              icon={<CalendarPlus className="h-[18px] w-[18px]" />}
              title="Generate Next Pay Period"
              subtitle="Adds the next company pay period after the most recent one."
            />
            {next ? (
              <div className="flex flex-col gap-1 px-4 py-3.5" style={WELL}>
                <span style={OVERLINE}>Next period</span>
                <span className="tabular" style={{ font: "var(--weight-semibold) 17px/24px var(--font-sans)", letterSpacing: "-0.01em", color: "var(--text-primary)" }}>
                  {nextRange}
                </span>
                <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                  {FREQ_LABEL[next.frequency]} · {nextPeriod ? periodDays(next.frequency, nextPeriod) : 0} days
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 px-3.5 py-3" style={{ borderRadius: 12, background: "var(--surface-warning)", font: "var(--type-body2)", color: "var(--text-warning)" }}>
                <CircleAlert className="h-4 w-4 flex-none" />
                Save an anchor date before generating.
              </div>
            )}
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  setGenError(null);
                  setConfirming(true);
                }}
                disabled={!next || dirty}
              >
                Generate Pay Period
              </Button>
              <LinkButton href="/payroll/pay-periods" hierarchy="link" trailingIcon={<ArrowRight className="h-4 w-4" />}>
                View all pay periods
              </LinkButton>
            </div>
            {next && dirty && (
              <p className="mb-0 mt-2.5" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                Save or discard your changes first.
              </p>
            )}
          </section>

          <section className="px-5 py-4" style={PANEL}>
            <div className="flex items-start gap-3">
              <IconTile size={32}>
                <BookOpen className="h-4 w-4" />
              </IconTile>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <h2 style={{ margin: 0, font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>Company default</h2>
                <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                  Rule sets without their own pay schedule use these settings. A rule set with its own frequency and anchor date generates its own periods.
                </span>
                <span style={{ font: "var(--type-body2)", color: "var(--text-primary)", textWrap: "pretty" }}>
                  {defaultRuleSets.length === 0
                    ? "Every rule set has its own pay schedule right now, so company pay periods only catch time when a rule set has no open period."
                    : `Used by ${defaultRuleSets.length === 1 ? "1 rule set" : `${defaultRuleSets.length} rule sets`}: ${listNames(defaultRuleSets)}.`}
                </span>
                {canOpenRules && (
                  <span>
                    <LinkButton href="/admin/rules-setup" hierarchy="link" trailingIcon={<ArrowRight className="h-4 w-4" />}>
                      Open Rules Setup
                    </LinkButton>
                  </span>
                )}
              </span>
            </div>
          </section>
        </aside>
      </div>

      {gateAlerts && <GateAlertsPanel onSince={gateAlerts.onSince} flash={flash} />}

      {confirming && next && (
        <SetupDialog
          title="Generate pay period?"
          submitLabel="Generate"
          pending={generating}
          error={genError}
          onSubmit={generate}
          onClose={() => setConfirming(false)}
          width={440}
        >
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
            This creates {nextRange} as a new open pay period.
          </p>
        </SetupDialog>
      )}
      <Toast message={message} />
    </div>
  );
}
