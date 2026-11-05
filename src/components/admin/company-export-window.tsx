"use client";

import { useState, type CSSProperties } from "react";
import { Building2, CalendarDays, Clock, Database, Download, FileArchive, FileText, History, KeyRound, LineChart, ScanFace, Server, Users, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui";
import styles from "@/components/presence/export-window.module.css";
import own from "./person-data-window.module.css";
import { Shell } from "./person-data-window";

/**
 * Export company data, from Company Settings: everything CloudTime holds for
 * the company as one ZIP of CSV files, to keep or to move to another system.
 * Drawn like the Export window: the left card is the choice (with or without
 * photos) and what the file holds; the right card is the file itself.
 *
 * <p>The download is a plain link, so the browser saves the ZIP as it
 * arrives instead of holding it in memory. The server checks the permission
 * again and records the download.
 */

type Include = "data" | "photos";

/** What each group of files holds, in the order the ZIP has them. Mirrors EXPORT_TABLES. */
export const COMPANY_EXPORT_GROUPS: { title: string; icon: LucideIcon; body: string; files: number }[] = [
  { title: "Company setup", icon: Building2, body: "Sites, departments, rule sets, shifts, pay codes and roles", files: 24 },
  { title: "People", icon: Users, body: "Employees, badges, supervisors, pay rates and documents", files: 8 },
  { title: "Time", icon: Clock, body: "Timesheets, punches, scans, schedules and paid hours", files: 14 },
  { title: "Leave", icon: CalendarDays, body: "Leave requests, balances and their history", files: 3 },
  { title: "Reports", icon: LineChart, body: "Saved reports, folders, schedules and runs", files: 5 },
  { title: "History and connections", icon: History, body: "The change history, API keys and webhooks", files: 3 },
];

const FILES = COMPANY_EXPORT_GROUPS.reduce((n, g) => n + g.files, 0);

const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };

/** Company Data on Company Settings, for those who may export it. */
export function CompanyDataPanel({ companyName }: { companyName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section style={{ ...PANEL, padding: "18px 20px" }} aria-labelledby="company-data-title">
      <div className="flex items-center gap-3">
        <span
          className="grid h-9 w-9 flex-none place-items-center"
          style={{ borderRadius: 10, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)", color: "var(--icon-tertiary)" }}
          aria-hidden="true"
        >
          <Database className="h-[18px] w-[18px]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="company-data-title" style={{ margin: 0, font: "var(--weight-semibold) 15px/20px var(--font-sans)", color: "var(--text-primary)" }}>
            Company Data
          </h2>
          <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            Everything CloudTime holds for this company in one ZIP of spreadsheets, to keep or to move to another system.
          </span>
        </span>
        <Button hierarchy="secondary" onClick={() => setOpen(true)} leadingIcon={<Download className="h-4 w-4" aria-hidden="true" />}>
          Export company data
        </Button>
      </div>
      {open && <CompanyExportWindow companyName={companyName} onClose={() => setOpen(false)} />}
    </section>
  );
}

export function CompanyExportWindow({ companyName, onClose }: { companyName: string; onClose: () => void }) {
  const [include, setInclude] = useState<Include>("data");
  const [started, setStarted] = useState(false);
  const fileName = `${companyName} CloudTime data.zip`;

  function download() {
    const a = document.createElement("a");
    a.href = `/api/privacy/company-export${include === "photos" ? "?photos=1" : ""}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStarted(true);
  }

  return (
    <Shell
      title="Export company data"
      subtitle={companyName}
      onClose={onClose}
      glyph={<Database />}
      foot={
        <>
          <span className={styles.footHint} role={started ? "status" : undefined}>
            {started ? "The download has started. Your browser shows its progress." : "Every export is recorded in the change history."}
          </span>
          <Button hierarchy="tertiary" onClick={onClose}>
            {started ? "Close" : "Cancel"}
          </Button>
          <Button hierarchy="primary" onClick={download} disabled={started} leadingIcon={<Download className="h-4 w-4" aria-hidden="true" />}>
            Download ZIP
          </Button>
        </>
      }
    >
      <div className={styles.panes}>
        <section className={styles.card} aria-labelledby="company-export-what">
          <h3 id="company-export-what" className="sr-only">
            What the file holds
          </h3>
          <div className={styles.groups}>
            <div role="radiogroup" aria-label="What to include" className={styles.group}>
              <span className={styles.groupLabel}>What to include</span>
              <Choice value="data" include={include} onPick={setInclude} icon={FileText} title="Data and documents" body="Every record, plus the files uploaded to people's records" />
              <Choice value="photos" include={include} onPick={setInclude} icon={ScanFace} title="Data, documents and photos" body="Adds everyone's time clock photo. A much bigger file" />
            </div>
            <div className={styles.group}>
              <span className={styles.groupLabel}>In the file</span>
              <ul className={`${styles.choices} ${own.list}`} aria-label="In the file">
                {COMPANY_EXPORT_GROUPS.map((g) => (
                  <Line key={g.title} icon={g.icon} title={g.title} body={g.body} count={g.files} />
                ))}
              </ul>
            </div>
            <div className={styles.group}>
              <span className={styles.groupLabel}>Not included</span>
              <ul className={`${styles.choices} ${own.list}`} aria-label="Not included">
                <Line icon={KeyRound} title="Sign in secrets" body="Passwords, sessions, phone app tokens and the secret part of API keys" />
                <Line icon={Server} title="System logs" body="Time clock health reports, sync jobs and delivery attempts" />
              </ul>
            </div>
          </div>
        </section>

        <aside className={styles.rail} aria-label="About the file">
          <div className={`${styles.railBlock} ${styles.previewBlock}`}>
            <div className={styles.file}>
              <span className={styles.fileIcon} data-format="csv" aria-hidden="true">
                <FileArchive />
              </span>
              <span className={styles.fileText}>
                <span className={styles.fileName} title={fileName}>
                  {fileName}
                </span>
                <span className={styles.fileMeta}>
                  ZIP · {FILES} spreadsheets (CSV){include === "photos" ? " · photos" : ""}
                </span>
              </span>
            </div>
            <p className={styles.railNote}>One spreadsheet per kind of record, with a header row. Any spreadsheet or database can open them.</p>
            <p className={styles.railNote}>Times are in UTC, written so another system reads them exactly. A list of every file and its number of rows comes with it.</p>
            <p className={styles.railNote}>A large company can take a few minutes. Keep this tab open until the download finishes.</p>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Choice({ value, include, onPick, icon: Icon, title, body }: { value: Include; include: Include; onPick: (v: Include) => void; icon: LucideIcon; title: string; body: string }) {
  const on = include === value;
  return (
    <label className={styles.choice} data-on={on}>
      <input type="radio" name="company-export-include" value={value} checked={on} onChange={() => onPick(value)} className="sr-only" />
      <span className={styles.choiceIcon} aria-hidden="true">
        <Icon />
      </span>
      <span className={styles.choiceText}>
        <span className={styles.choiceTitle}>{title}</span>
        <span className={styles.choiceBody}>{body}</span>
      </span>
    </label>
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
      {count !== undefined && (
        <span className={styles.choiceCount} aria-label={`${count} files`}>
          {count}
        </span>
      )}
    </li>
  );
}
