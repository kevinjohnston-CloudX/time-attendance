"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Clock, Contact, FileText, History, KeyRound, Mail, ScanFace, StickyNote, UserX, type LucideIcon } from "lucide-react";
import { Banner, Button, Input } from "@/components/ui";
import { anonymiseEmployee, getAnonymisePreview } from "@/actions/privacy.actions";
import styles from "@/components/presence/export-window.module.css";
import own from "./person-data-window.module.css";
import { Shell } from "./person-data-window";

/**
 * Anonymise, from the record of someone who has left, in a company that
 * switched it on. Drawn like the Export window: the left card says what is
 * removed and what stays, with counts from the server; the right card is the
 * confirmation. It cannot run until the person's data was exported in the
 * last day and their employee code is typed, and the server checks both again.
 */

type Preview = Extract<Awaited<ReturnType<typeof getAnonymisePreview>>, { success: true }>["data"];
type Result = Extract<Awaited<ReturnType<typeof anonymiseEmployee>>, { success: true }>["data"];

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function AnonymiseWindow({ employeeId, onClose, onDone }: { employeeId: string; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let live = true;
    getAnonymisePreview({ employeeId }).then(
      (res) => {
        if (!live) return;
        if (res.success) setPreview(res.data);
        else setLoadError(res.error);
      },
      () => live && setLoadError("The record could not be read. Close this window and try again."),
    );
    return () => {
      live = false;
    };
  }, [employeeId]);

  async function run() {
    setBusy(true);
    setFailure(null);
    const res = await anonymiseEmployee({ employeeId, confirmCode: code });
    setBusy(false);
    if (!res.success) {
      setFailure(res.error);
      return;
    }
    setResult(res.data);
  }

  const blocked = !preview || preview.blockers.length > 0;
  const confirmed = !!preview && code.trim() === preview.employeeCode;

  if (result) {
    return (
      <Shell
        title="Anonymised"
        subtitle={preview?.anonymousName ?? ""}
        onClose={onDone}
        glyph={<CheckCircle2 />}
        foot={
          <>
            <span className={styles.footHint}>The record now shows the anonymous name.</span>
            <Button hierarchy="primary" onClick={onDone}>
              Close
            </Button>
          </>
        }
      >
        <section className={styles.card}>
          <ul className={`${styles.choices} ${own.list}`} aria-label="What was done">
            <Line icon={Contact} title="Profile details cleared" body={plural(result.fieldsCleared, "field", "fields")} />
            <Line icon={KeyRound} title="Sign in removed" body={plural(result.signInsRemoved, "sign in record", "sign in records")} />
            <Line icon={StickyNote} title="Leave notes cleared" body={plural(result.leaveNotesCleared, "request", "requests")} />
            <Line icon={History} title="Change history updated" body={plural(result.historyEntriesUpdated, "entry", "entries")} />
            <Line icon={FileText} title="Documents deleted" body={plural(result.documentsDeleted, "document", "documents")} />
            <Line icon={ScanFace} title="Photo files deleted" body={plural(result.photoFilesDeleted, "file", "files")} />
          </ul>
          {result.storageProblems.map((p) => (
            <Banner key={p} tone="warning" title="Not everything was removed from storage" body={p} />
          ))}
        </section>
      </Shell>
    );
  }

  const exportedWords = preview?.exportedAt
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(preview.exportedAt))
    : null;

  return (
    <Shell
      title="Anonymise this person"
      subtitle={preview ? `${preview.name} · ${preview.employeeCode}` : "Reading the record"}
      onClose={onClose}
      glyph={<UserX />}
      foot={
        <>
          <span className={styles.footHint} data-tone={blocked && preview ? "warning" : undefined}>
            {preview && preview.blockers.length === 0
              ? "This cannot be undone. The export you downloaded is the only copy."
              : "Anonymising is not available for this person yet."}
          </span>
          <Button hierarchy="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button pending={busy} tone="error" onClick={run} disabled={busy || blocked || !confirmed}>
            {busy ? "Anonymising" : "Anonymise permanently"}
          </Button>
        </>
      }
    >
      <div className={styles.panes}>
        <section className={styles.card} aria-label="What changes">
          {loadError && <Banner tone="error" title="The record could not be read" body={loadError} />}
          {failure && <Banner tone="error" title="Nothing was changed" body={failure} />}
          {preview && (
            <div className={styles.groups}>
              <div className={styles.group}>
                <span className={styles.groupLabel}>Removed</span>
                <ul className={`${styles.choices} ${own.list}`} aria-label="Removed">
                  <Line icon={Contact} title="Name" body={`Shown as ${preview.anonymousName} from now on`} />
                  <Line icon={Contact} title="Profile details" body={preview.fields.length ? preview.fields.join(", ") : "None on the record"} count={preview.fields.length} />
                  <Line icon={Mail} title="Email addresses" body="Personal and work email" count={preview.emails} />
                  <Line icon={KeyRound} title="Sign in" body="Password, Google sign in, phone app and open sessions" count={preview.signIns} />
                  <Line icon={StickyNote} title="Leave notes" body="Notes written on leave requests" count={preview.leaveNotes} />
                  {preview.settings.deleteDocuments && <Line icon={FileText} title="Documents" body="Files on the record" count={preview.documents} />}
                  {preview.settings.deletePhoto && <Line icon={ScanFace} title="Time clock photo" body={preview.hasPhoto ? "Every stored copy" : "No photo on file"} count={preview.hasPhoto ? 1 : 0} />}
                  {preview.settings.history === "REPLACE" && <Line icon={History} title="Change history" body="Name, email and phone swapped for the anonymous name" count={preview.historyEntries} />}
                </ul>
              </div>
              <div className={styles.group}>
                <span className={styles.groupLabel}>Kept</span>
                <ul className={`${styles.choices} ${own.list}`} aria-label="Kept">
                  <Line icon={Clock} title="Punches and timesheets" body={`${plural(preview.kept.punches, "punch", "punches")}, ${plural(preview.kept.timesheets, "timesheet", "timesheets")}`} />
                  <Line icon={Clock} title="Leave and pay history" body={`${plural(preview.kept.leaveRequests, "leave request", "leave requests")}, ${plural(preview.kept.payRates, "pay rate", "pay rates")}`} />
                </ul>
              </div>
            </div>
          )}
        </section>

        <aside className={styles.rail} aria-label="Confirm">
          <div className={`${styles.railBlock} ${styles.previewBlock}`}>
            {preview?.blockers.map((b) => (
              <p key={b} className="m-0 flex items-start gap-2" style={{ font: "var(--type-body2)", color: "var(--text-warning)" }}>
                <CircleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                {b}
              </p>
            ))}
            {exportedWords && <p className={styles.railNote}>Data exported {exportedWords}.</p>}
            {preview && preview.blockers.length === 0 && (
              <Input
                label={`Type ${preview.employeeCode} to confirm`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                inputMode="numeric"
              />
            )}
            <p className={styles.railNote}>Payroll and working time records must be kept for years, so the hours stay. Only who the person was is removed.</p>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Line({ icon: Icon, title, body, count }: { icon: LucideIcon; title: string; body: string; count?: number }) {
  return (
    <li className={`${styles.choice} ${own.item}`}>
      <span className={styles.choiceIcon} aria-hidden="true">
        <Icon />
      </span>
      <span className={styles.choiceText}>
        <span className={styles.choiceTitle}>{title}</span>
        <span className={styles.choiceBody} title={body}>
          {body}
        </span>
      </span>
      {count !== undefined && <span className={styles.choiceCount}>{count.toLocaleString("en-US")}</span>}
    </li>
  );
}
