"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { ShieldCheck } from "lucide-react";
import { Banner, Switch } from "@/components/ui";
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

  function setNoMedicalNotes(on: boolean) {
    setError(null);
    setSaved(false);
    const before = settings;
    setSettings({ ...settings, noMedicalNotes: on });
    startTransition(async () => {
      const res = await updateDataProtection({ noMedicalNotes: on });
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
        <Switch checked={settings.noMedicalNotes} onChange={setNoMedicalNotes} disabled={pending} label={<span className="sr-only">Keep medical details out of sick leave</span>} />
      </div>

      <p role="status" className="m-0" style={{ minHeight: 18, font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
        {pending ? "Saving…" : saved ? "Saved." : ""}
      </p>
    </section>
  );
}
