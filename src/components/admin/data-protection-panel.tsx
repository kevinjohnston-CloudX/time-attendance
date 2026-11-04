"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { ShieldCheck } from "lucide-react";
import { Banner, SegmentedControl, Switch } from "@/components/ui";
import { updateDataProtection } from "@/actions/privacy.actions";
import type { DataProtection } from "@/lib/privacy/data-protection";

/**
 * Data protection on Company Settings: the switches an EU company turns on.
 * Every one is off for a company that has never set it, which is how
 * CloudTime worked before they existed. Each saves the moment it is flipped,
 * and the save checks the permission again.
 */

const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };

export function DataProtectionPanel({ initial }: { initial: DataProtection }) {
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(change: { noMedicalNotes?: boolean; anonymise?: Partial<DataProtection["anonymise"]> }) {
    setError(null);
    setSaved(false);
    const before = settings;
    setSettings({
      noMedicalNotes: change.noMedicalNotes ?? settings.noMedicalNotes,
      anonymise: { ...settings.anonymise, ...change.anonymise },
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

      <p role="status" className="m-0" style={{ minHeight: 18, font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
        {pending ? "Saving…" : saved ? "Saved." : ""}
      </p>
    </section>
  );
}
