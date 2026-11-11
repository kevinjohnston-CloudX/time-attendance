"use client";

import { useEffect, useMemo, useState } from "react";
import { ScanLine } from "lucide-react";
import { Badge, Banner, Button, Select } from "@/components/ui";
import { getTimecardRefusedScans, recoverTimecardRefusedScans } from "@/actions/refused-scans.actions";
import type { RefusedScan } from "@/lib/services/refused-scans.service";
import styles from "./refused-scans.module.css";
import { codeOf } from "@/lib/action-errors";
import { Window, WindowCard, WindowGroupLabel } from "@/components/ui/window";

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
            : "They are not on this timecard, and it cannot be changed here."
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
      setError(codeOf(r) === "FORBIDDEN" ? "You do not have permission to add punches." : codeOf(r) === "NOT_FOUND" ? "This timecard could not be found. Reload the page." : r.error);
      return;
    }
    onAdded(r.data.added);
  }

  return (
    <Window
      width={600}
      tone="warning"
      icon={<ScanLine />}
      title="Refused scans"
      subtitle="Pick what each scan was. Repeated taps are left out unless you choose otherwise."
      busy={saving}
      foot={
        error ??
        (picked.length === 0
          ? "Nothing picked to add."
          : "Added as approved manual punches, noted as recovered from a refused scan.")
      }
      footTone={error ? "error" : undefined}
      onClose={onClose}
      actions={
        <>
          <Button hierarchy="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button pending={saving} onClick={() => void save()} disabled={saving || picked.length === 0}>
            {saving ? "Adding" : picked.length === 0 ? "Add punches" : picked.length === 1 ? "Add 1 punch" : `Add ${picked.length} punches`}
          </Button>
        </>
      }
    >
      {byDay.map((d) => (
        <section key={d.day} aria-label={d.label} className={styles.day}>
          <WindowGroupLabel>{d.label}</WindowGroupLabel>
          <WindowCard>
            <ul className={styles.list}>
              {d.scans.map((s) => (
                <li key={s.id} className={styles.scan}>
                  <span className={`tabular ${styles.time}`}>{time(s.at)}</span>
                  <span className={styles.where}>
                    <span className={styles.reader} title={s.reader ?? undefined}>
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
          </WindowCard>
        </section>
      ))}
    </Window>
  );
}
