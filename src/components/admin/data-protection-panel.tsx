"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { ShieldCheck } from "lucide-react";
import { Banner, Button, SegmentedControl, Select, Switch } from "@/components/ui";
import { updateDataProtection } from "@/actions/privacy.actions";
import type { DataProtection } from "@/lib/privacy/data-protection";
import { PHOTO_DAY_CHOICES, RETENTION_COUNTRY_LABEL, RETENTION_YEARS, retentionYears, type RetentionCountry } from "@/lib/privacy/retention-rules";
import { RetentionWindow } from "./retention-window";

/**
 * Data protection on Company Settings: the switches an EU company turns on.
 * Every one is off for a company that has never set it, which is how
 * CloudTime worked before they existed. Each saves the moment it is flipped,
 * and the save checks the permission again.
 */

const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };

type Change = {
  noMedicalNotes?: boolean;
  anonymise?: Partial<DataProtection["anonymise"]>;
  retention?: Partial<DataProtection["retention"]>;
  leaverPhotos?: Partial<DataProtection["leaverPhotos"]>;
};

const TITLE: CSSProperties = { font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" };
const LINE: CSSProperties = { font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" };

/** `canReview`: the caller may also export people's data, which the review downloads. */
export function DataProtectionPanel({ initial, canReview }: { initial: DataProtection; canReview: boolean }) {
  const [reviewing, setReviewing] = useState(false);
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(change: Change) {
    setError(null);
    setSaved(false);
    const before = settings;
    setSettings({
      noMedicalNotes: change.noMedicalNotes ?? settings.noMedicalNotes,
      anonymise: { ...settings.anonymise, ...change.anonymise },
      retention: { ...settings.retention, ...change.retention },
      leaverPhotos: { ...settings.leaverPhotos, ...change.leaverPhotos },
    });
    startTransition(async () => {
      const res = await updateDataProtection(change);
      if (!res.success) {
        setSettings(before);
        setError(res.error);
        return;
      }
      setSettings(res.data);
      setSaved(true);
    });
  }

  const years = retentionYears(settings.retention);
  const countryYears = settings.retention.country ? RETENTION_YEARS[settings.retention.country] : null;
  const shorterThanLaw = !!years && !!countryYears && years < countryYears;
  const retentionOutcome = !settings.anonymise.enabled
    ? "Off. Turn on Allow anonymising leavers first."
    : !years
      ? "Off. Choose the country, then turn this on."
      : settings.retention.enabled
        ? `On. Leavers are listed for anonymising ${years === 1 ? "1 year" : `${years} years`} after the end of the year they left. Nothing changes until HR confirms it in the review.`
        : "Off. Leavers are kept until someone anonymises them.";

  return (
    <section style={{ ...PANEL, padding: "18px 20px 20px" }} aria-labelledby="data-protection-title">
      <div className="flex items-start gap-3" style={{ marginBottom: 14 }}>
        <span
          className="grid h-9 w-9 flex-none place-items-center"
          style={{ borderRadius: 10, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)", color: "var(--icon-tertiary)" }}
          aria-hidden="true"
        >
          <ShieldCheck className="h-[18px] w-[18px]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="data-protection-title" style={{ margin: 0, font: "var(--weight-semibold) 15px/20px var(--font-sans)", color: "var(--text-primary)" }}>
            Data Protection
          </h2>
          <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            For companies whose people work in the EU or the UK. Off for a company that does not use it.
          </span>
        </span>
      </div>

      {error && <Banner tone="error" title="Not saved" body={error} />}

      <div className="flex items-start gap-3 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>
            Keep medical details out of sick leave
          </span>
          <span id="no-medical-notes-outcome" style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            {settings.noMedicalNotes
              ? "On. Sick leave requests take no note, so no diagnosis or cause is stored. Notes already saved stay as they are."
              : "Off. Sick leave requests take a note like any other leave."}
          </span>
        </span>
        <Switch checked={settings.noMedicalNotes} onChange={(on) => save({ noMedicalNotes: on })} disabled={pending} label={<span className="sr-only">Keep medical details out of sick leave</span>} />
      </div>

      <div className="flex items-start gap-3 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>Allow anonymising leavers</span>
          <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            {settings.anonymise.enabled
              ? "On. HR can anonymise someone who has left: their name, contact details and sign in are removed, and their hours and pay history stay under Former employee and their employee code. It cannot be undone."
              : "Off. No one can be anonymised."}
          </span>
        </span>
        <Switch
          checked={settings.anonymise.enabled}
          onChange={(on) => save({ anonymise: { enabled: on } })}
          disabled={pending}
          label={<span className="sr-only">Allow anonymising leavers</span>}
        />
      </div>

      {settings.anonymise.enabled && (
        <div className="flex flex-col gap-3 pb-3 pl-4" style={{ borderLeft: "2px solid var(--stroke-divider)", marginLeft: 2 }}>
          <div className="flex items-start gap-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>Delete the time clock photo</span>
              <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                {settings.anonymise.deletePhoto ? "Every stored copy of the photo is deleted." : "The photo is kept."}
              </span>
            </span>
            <Switch checked={settings.anonymise.deletePhoto} onChange={(on) => save({ anonymise: { deletePhoto: on } })} disabled={pending} label={<span className="sr-only">Delete the time clock photo</span>} />
          </div>
          <div className="flex items-start gap-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>Delete uploaded documents</span>
              <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                {settings.anonymise.deleteDocuments ? "The files on the record are deleted. Download any to keep first." : "The files on the record are kept."}
              </span>
            </span>
            <Switch checked={settings.anonymise.deleteDocuments} onChange={(on) => save({ anonymise: { deleteDocuments: on } })} disabled={pending} label={<span className="sr-only">Delete uploaded documents</span>} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>Change history</span>
            <SegmentedControl
              items={[
                { value: "REPLACE", label: "Replace their details" },
                { value: "KEEP", label: "Keep as it is" },
              ]}
              value={settings.anonymise.history}
              onChange={(v) => save({ anonymise: { history: v as "REPLACE" | "KEEP" } })}
              ariaLabel="Change history"
            />
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
              {settings.anonymise.history === "REPLACE"
                ? "Every entry is kept, with the person's name, email and phone swapped for the anonymous name. Who changed what stays on record."
                : "Every entry is kept exactly as it is, including the person's name where it appears."}
            </span>
          </div>
        </div>
      )}


      <div className="flex items-start gap-3 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span style={TITLE}>Retention period</span>
          <span style={LINE}>{retentionOutcome}</span>
        </span>
        <Switch
          checked={settings.retention.enabled}
          onChange={(on) => save({ retention: { enabled: on } })}
          disabled={pending || !settings.anonymise.enabled || !years}
          label={<span className="sr-only">Retention period</span>}
        />
      </div>

      {settings.anonymise.enabled && (
        <div className="flex flex-col gap-1.5 pb-3 pl-4" style={{ borderLeft: "2px solid var(--stroke-divider)", marginLeft: 2 }}>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={settings.retention.country ?? ""}
              onChange={(e) => {
                const c = (e.target.value || null) as RetentionCountry | null;
                save({ retention: { country: c, years: c ? RETENTION_YEARS[c] : null } });
              }}
              disabled={pending}
              aria-label="Country"
              style={{ width: 200 }}
            >
              <option value="">Choose a country</option>
              {(Object.keys(RETENTION_COUNTRY_LABEL) as RetentionCountry[]).map((c) => (
                <option key={c} value={c}>
                  {RETENTION_COUNTRY_LABEL[c]}
                </option>
              ))}
            </Select>
            <Select
              value={years ?? ""}
              onChange={(e) => save({ retention: { years: Number(e.target.value) } })}
              disabled={pending || !settings.retention.country}
              aria-label="Years kept"
              style={{ width: 140 }}
            >
              {!years && <option value="">Years kept</option>}
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "1 year" : `${n} years`}
                </option>
              ))}
            </Select>
          </div>
          <span style={{ ...LINE, color: shorterThanLaw ? "var(--text-warning)" : "var(--text-secondary)" }}>
            {!settings.retention.country
              ? "The country sets how long payroll and tax law ask to keep a leaver's records."
              : shorterThanLaw
                ? `Shorter than the ${countryYears} years ${RETENTION_COUNTRY_LABEL[settings.retention.country]} asks for.`
                : `${RETENTION_COUNTRY_LABEL[settings.retention.country]} asks for ${countryYears} years. Your accountant may ask for longer.`}
          </span>
        </div>
      )}

      <div className="flex items-start gap-3 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span style={TITLE}>Delete leavers&apos; photos</span>
          <span style={LINE}>
            {settings.leaverPhotos.enabled
              ? `On. A leaver's time clock photo is listed for deletion ${settings.leaverPhotos.days} days after they leave. Nothing is deleted until HR confirms it in the review.`
              : "Off. A leaver's time clock photo is kept."}
          </span>
        </span>
        <Switch
          checked={settings.leaverPhotos.enabled}
          onChange={(on) => save({ leaverPhotos: { enabled: on } })}
          disabled={pending}
          label={<span className="sr-only">Delete leavers&apos; photos</span>}
        />
      </div>

      {settings.leaverPhotos.enabled && (
        <div className="flex flex-wrap items-center gap-2 pb-3 pl-4" style={{ borderLeft: "2px solid var(--stroke-divider)", marginLeft: 2 }}>
          <Select
            value={settings.leaverPhotos.days}
            onChange={(e) => save({ leaverPhotos: { days: Number(e.target.value) } })}
            disabled={pending}
            aria-label="Days after leaving"
            style={{ width: 200 }}
          >
            {PHOTO_DAY_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} days after leaving
              </option>
            ))}
          </Select>
        </div>
      )}

      {canReview && (settings.retention.enabled || settings.leaverPhotos.enabled) && (
        <div className="flex items-center gap-3 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span style={TITLE}>Retention review</span>
            <span style={LINE}>See who is due, download their data, then remove them in groups of 25.</span>
          </span>
          <Button hierarchy="secondary" onClick={() => setReviewing(true)}>
            Review leavers
          </Button>
        </div>
      )}
      {reviewing && <RetentionWindow onClose={() => setReviewing(false)} />}

      <p role="status" className="m-0" style={{ minHeight: 18, font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
        {pending ? "Saving…" : saved ? "Saved." : ""}
      </p>
    </section>
  );
}
