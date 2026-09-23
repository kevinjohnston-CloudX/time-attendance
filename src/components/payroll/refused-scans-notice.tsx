"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Badge, Banner, Button, Select } from "@/components/ui";
import { getTimecardRefusedScans, recoverTimecardRefusedScans } from "@/actions/refused-scans.actions";
import type { RefusedScan } from "@/lib/services/refused-scans.service";

/**
 * On a timecard: the time clock scans that were refused because this person
 * was not in CloudTime yet, and a way for payroll to add them.
 *
 * <p>Renders nothing unless there are some. When there are, one notice says
 * how many and opens a review where each scan is confirmed as Clock in,
 * Clock out or left out. The suggestion skips repeated taps and alternates
 * the rest from Clock in; payroll has the final word, because only a person
 * can tell a meal tap from a clock out after the fact.
 */

type Choice = "CLOCK_IN" | "CLOCK_OUT" | "";

const CHOICE_LABEL: Record<Exclude<Choice, "">, string> = { CLOCK_IN: "Clock in", CLOCK_OUT: "Clock out" };

export function RefusedScansNotice({
  employeeId,
  payPeriodId,
  canEdit,
  onAdded,
}: {
  employeeId: string | null;
  payPeriodId: string | null;
  canEdit: boolean;
  onAdded: (added: number) => void;
}) {
  const key = `${employeeId}|${payPeriodId}`;
  const [loaded, setLoaded] = useState<{ key: string; scans: RefusedScan[]; tz: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!employeeId || !payPeriodId) return;
    let dead = false;
    void getTimecardRefusedScans({ employeeId, payPeriodId }).then((r) => {
      if (dead) return;
      // Anyone who cannot add punches is refused here too; they simply see
      // no notice, which is the same as the timecard they can already read.
      setLoaded({ key, scans: r.success ? r.data.scans : [], tz: r.success ? r.data.timezone : "UTC" });
    });
    return () => {
      dead = true;
    };
  }, [employeeId, payPeriodId, key, nonce]);

  const current = loaded?.key === key ? loaded : null;
  const scans = current?.scans ?? [];
  if (!current || scans.length === 0) return null;

  const days = new Set(scans.map((s) => dayKey(s.at, current.tz))).size;

  return (
    <div className="shrink-0 px-5 py-3">
      <Banner
        tone="warning"
        title={`${scans.length} time clock ${scans.length === 1 ? "scan was" : "scans were"} refused before this person was added`}
        body={
          canEdit
            ? `They are not on this timecard. Review them to add the ones that should count${days > 1 ? `, across ${days} days` : ""}.`
            : "They are not on this timecard. It is locked or approved, so reopen it to add them."
        }
        actions={
          canEdit ? (
            <Button hierarchy="secondary" size="sm" onClick={() => setOpen(true)}>
              Review scans
            </Button>
          ) : undefined
        }
      />
      {open && employeeId && payPeriodId && (
        <ReviewDialog
          scans={scans}
          tz={current.tz}
          employeeId={employeeId}
          payPeriodId={payPeriodId}
          onClose={() => setOpen(false)}
          onAdded={(n) => {
            setOpen(false);
            setNonce((x) => x + 1);
            onAdded(n);
          }}
        />
      )}
    </div>
  );
}

function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
}

function ReviewDialog({
  scans,
  tz,
  employeeId,
  payPeriodId,
  onClose,
  onAdded,
}: {
  scans: RefusedScan[];
  tz: string;
  employeeId: string;
  payPeriodId: string;
  onClose: () => void;
  onAdded: (added: number) => void;
}) {
  const [choice, setChoice] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(scans.map((s) => [s.id, s.suggested ?? ""])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    if (!saving) onClose();
  }, [saving, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const byDay = useMemo(() => {
    const out: { day: string; label: string; scans: RefusedScan[] }[] = [];
    for (const s of scans) {
      const d = dayKey(s.at, tz);
      const last = out[out.length - 1];
      if (last?.day === d) last.scans.push(s);
      else
        out.push({
          day: d,
          label: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" }).format(new Date(s.at)),
          scans: [s],
        });
    }
    return out;
  }, [scans, tz]);

  const picked = scans.filter((s) => choice[s.id]);
  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(iso));

  async function save() {
    setSaving(true);
    setError(null);
    const r = await recoverTimecardRefusedScans({
      employeeId,
      payPeriodId,
      items: picked.map((s) => ({ scanId: s.id, punchType: choice[s.id] as "CLOCK_IN" | "CLOCK_OUT" })),
    });
    setSaving(false);
    if (!r.success) {
      setError(r.error === "FORBIDDEN" ? "You do not have permission to add punches." : r.error === "NOT_FOUND" ? "This timecard could not be found. Reload the page." : r.error);
      return;
    }
    onAdded(r.data.added);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Refused scans"
        className="ta-modal flex max-h-[90vh] w-full max-w-xl flex-col"
        style={{ borderRadius: "var(--radius-l)" }}
      >
        <header
          className="flex items-start justify-between gap-3 px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--stroke-divider)" }}
        >
          <div className="flex flex-col gap-0.5">
            <h3 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>Refused scans</h3>
            <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>
              Pick what each scan was. Repeated taps are left out unless you choose otherwise.
            </p>
          </div>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={close} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {byDay.map((d) => (
            <section key={d.day} aria-label={d.label}>
              <h4
                className="px-5 py-2"
                style={{
                  margin: 0,
                  font: "var(--type-button2)",
                  color: "var(--text-secondary)",
                  background: "var(--surface-secondary)",
                  borderBottom: "1px solid var(--stroke-divider)",
                }}
              >
                {d.label}
              </h4>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {d.scans.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 px-5 py-2.5"
                    style={{ borderBottom: "1px solid var(--stroke-divider)" }}
                  >
                    <span
                      className="tabular w-[92px] flex-none whitespace-nowrap"
                      style={{ font: "var(--weight-medium) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}
                    >
                      {time(s.at)}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }} title={s.reader ?? undefined}>
                        {s.reader ?? "Time clock"}
                      </span>
                      {s.repeat && (
                        <Badge tone="neutral" size="sm">
                          Repeat tap
                        </Badge>
                      )}
                    </span>
                    <Select
                      aria-label={`What the ${time(s.at)} scan was`}
                      value={choice[s.id]}
                      onChange={(e) => setChoice((c) => ({ ...c, [s.id]: e.target.value as Choice }))}
                      style={{ width: 132, flex: "none" }}
                    >
                      <option value="">Leave out</option>
                      <option value="CLOCK_IN">{CHOICE_LABEL.CLOCK_IN}</option>
                      <option value="CLOCK_OUT">{CHOICE_LABEL.CLOCK_OUT}</option>
                    </Select>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="flex flex-col gap-3 px-5 py-3.5" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
          {error && <Banner tone="error" body={error} />}
          <div className="flex items-center justify-between gap-3">
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
              {picked.length === 0
                ? "Nothing picked to add"
                : `Added as approved manual punches, noted as recovered from a refused scan`}
            </span>
            <div className="flex flex-none items-center gap-2">
              <Button hierarchy="secondary" size="sm" onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving || picked.length === 0}>
                {saving ? "Adding" : picked.length === 1 ? "Add 1 punch" : `Add ${picked.length} punches`}
              </Button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
