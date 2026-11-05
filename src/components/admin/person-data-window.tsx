"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  Clock,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Hourglass,
  ListOrdered,
  PiggyBank,
  Plane,
  ScanLine,
  StickyNote,
  User,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { getPersonDataSummary } from "@/actions/privacy.actions";
import { saveFile } from "@/components/presence/export-table";
import styles from "@/components/presence/export-window.module.css";
import own from "./person-data-window.module.css";

/**
 * Export personal data, from an employee's record: everything CloudTime holds
 * about the person, as one Excel file, for a data access request.
 *
 * <p>Drawn like the Export window on Live Attendance. The left card lists
 * what the file will hold, sheet by sheet with its count, so HR sees what
 * they are handing over before they download it. The download itself is
 * made on the server, which checks the permission again and writes it to the
 * person's change history.
 */

type Summary = { title: string; description: string; count: number }[];

const GROUPS: { label: string; sheets: { title: string; icon: LucideIcon }[] }[] = [
  {
    label: "Record",
    sheets: [
      { title: "Profile", icon: User },
      { title: "Badges", icon: CreditCard },
      { title: "Pay rates", icon: Wallet },
      { title: "Documents", icon: FileText },
    ],
  },
  {
    label: "Time",
    sheets: [
      { title: "Punches", icon: Clock },
      { title: "Time clock scans", icon: ScanLine },
      { title: "Timesheets", icon: ListOrdered },
      { title: "Timesheet exceptions", icon: AlertTriangle },
      { title: "Timesheet notes", icon: StickyNote },
      { title: "Schedule", icon: CalendarDays },
      { title: "Gate refusals", icon: Ban },
    ],
  },
  {
    label: "Leave",
    sheets: [
      { title: "Leave requests", icon: Plane },
      { title: "Leave balances", icon: PiggyBank },
      { title: "Leave history", icon: Hourglass },
    ],
  },
  {
    label: "Changes",
    sheets: [{ title: "Change history", icon: History }],
  },
];

export function PersonDataWindow({
  employeeId,
  name,
  employeeCode,
  onClose,
}: {
  employeeId: string;
  name: string;
  employeeCode: string;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getPersonDataSummary({ employeeId }).then(
      (res) => {
        if (!live) return;
        if (res.success) setSummary(res.data);
        else setLoadFailed(true);
      },
      () => live && setLoadFailed(true),
    );
    return () => {
      live = false;
    };
  }, [employeeId]);

  // The profile is one record of many fields, so it carries no count.
  const countOf = (title: string) => (title === "Profile" ? null : (summary?.find((s) => s.title === title)?.count ?? null));
  const descriptionOf = (title: string) => summary?.find((s) => s.title === title)?.description ?? "";
  const total = summary?.filter((s) => s.title !== "Profile").reduce((n, s) => n + s.count, 0) ?? null;
  const fileName = `${name} personal data.xlsx`;

  async function download() {
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/data-export`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const header = res.headers.get("content-disposition") ?? "";
      const named = /filename\*=UTF-8''([^;]+)/.exec(header);
      saveFile(await res.blob(), named ? decodeURIComponent(named[1]) : fileName);
      onClose();
    } catch {
      setFailure("The file could not be made. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const hint = loadFailed
    ? "The record could not be read. Close this window and try again."
    : "One Excel file with a sheet for each kind of record. The download is saved in the change history.";

  return (
    <Shell
      title="Export personal data"
      subtitle={`${name} · ${employeeCode}`}
      onClose={onClose}
      foot={
        <>
          <span className={styles.footHint} data-tone={loadFailed ? "warning" : undefined} role={loadFailed ? "status" : undefined}>
            {hint}
          </span>
          <Button hierarchy="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            pending={busy}
            hierarchy="primary"
            onClick={download}
            disabled={busy || !summary}
            leadingIcon={<Download className="h-4 w-4" aria-hidden="true" />}
          >
            {busy ? "Downloading" : "Download Excel"}
          </Button>
        </>
      }
    >
      <div className={styles.panes}>
        <section className={styles.card} aria-labelledby="person-data-what">
          <h3 id="person-data-what" className="sr-only">
            What the file holds
          </h3>
          {failure && <Banner tone="error" title="Nothing was downloaded" body={failure} />}
          {loadFailed && <Banner tone="error" title="The record could not be read" body="Close this window and try again." />}
          <div className={styles.groups}>
            {GROUPS.map((g) => (
              <div key={g.label} className={styles.group}>
                <span className={styles.groupLabel}>{g.label}</span>
                <ul className={`${styles.choices} ${own.list}`} aria-label={g.label}>
                  {g.sheets.map((s) => (
                    <Item key={s.title} icon={s.icon} title={s.title} body={descriptionOf(s.title)} count={countOf(s.title)} loading={!summary && !loadFailed} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <aside className={styles.rail} aria-label="About the file">
          <div className={`${styles.railBlock} ${styles.previewBlock}`}>
            <div className={styles.file}>
              <span className={styles.fileIcon} data-format="xlsx" aria-hidden="true">
                <FileSpreadsheet />
              </span>
              <span className={styles.fileText}>
                <span className={styles.fileName} title={fileName}>
                  {fileName}
                </span>
                <span className={styles.fileMeta}>
                  {total === null ? "Excel workbook" : `${total.toLocaleString("en-US")} ${total === 1 ? "record" : "records"} · ${summary!.length} sheets`}
                </span>
              </span>
            </div>
            <p className={styles.railNote}>Includes the time clock photo when there is one. Document files are downloaded from the record.</p>
            <p className={styles.railNote}>For a personal data request, send the file to the person within one month of the request.</p>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

/** One sheet of the file: its glyph, name, what it holds, and how many rows. */
function Item({ icon: Icon, title, body, count, loading }: { icon: LucideIcon; title: string; body: string; count: number | null; loading: boolean }) {
  return (
    <li className={`${styles.choice} ${own.item}`}>
      <span className={styles.choiceIcon} aria-hidden="true">
        <Icon />
      </span>
      <span className={styles.choiceText}>
        <span className={styles.choiceTitle}>{title}</span>
        <span className={styles.choiceBody}>{body || (loading ? "Counting records" : "")}</span>
      </span>
      <span className={styles.choiceCount} aria-label={count === null ? undefined : `${count} rows`}>
        {count === null ? (loading && title !== "Profile" ? <span className={own.pending} aria-hidden="true" /> : null) : count.toLocaleString("en-US")}
      </span>
    </li>
  );
}

/** The Export window's frame, shared by the personal data windows. */
export function Shell({ title, subtitle, foot, onClose, children, glyph }: { title: string; subtitle: string; foot: ReactNode; onClose: () => void; children: ReactNode; glyph?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
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

  return createPortal(
    <div className={`${styles.scrim} ta-sheet-scrim`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="person-data-title" className={`${styles.window} ta-sheet`}>
        <header className={styles.head}>
          <span className={styles.glyph} aria-hidden="true">
            {glyph ?? <Download />}
          </span>
          <span className={styles.titles}>
            <h2 id="person-data-title" className={styles.title}>
              {title}
            </h2>
            <span className={`${styles.subtitle} truncate`}>{subtitle}</span>
          </span>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className={`ta-scroll ${styles.body}`}>{children}</div>
        <footer className={styles.foot}>{foot}</footer>
      </div>
    </div>,
    document.body,
  );
}
