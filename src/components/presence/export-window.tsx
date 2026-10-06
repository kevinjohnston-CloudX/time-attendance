"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Clock, DoorOpen, Download, FileSpreadsheet, FileText, Footprints, Monitor, Printer, ScanLine, Users, X, type LucideIcon } from "lucide-react";
import { Banner, Button, Checkbox, SegmentedControl, Select } from "@/components/ui";
import { getOnSiteMovements, getOnSiteScanLog } from "@/actions/presence.actions";
import type { PresencePerson } from "@/lib/presence/types";
import { buildSiteDay } from "@/lib/presence/movements";
import { recentDays } from "@/lib/presence/days";
import { counterQuery, scanLogLines } from "./scan-log";
import {
  ORDER_LABEL,
  dayWords,
  linesTable,
  movementsLines,
  peopleTable,
  printHtml,
  printSheet,
  saveFile,
  selectPeople,
  toCsv,
  toXlsx,
  type ExportTable,
  type PeopleOrder,
  type PeopleSet,
} from "./export-table";
import { fmtTime } from "./presence-meta";
import styles from "./export-window.module.css";

/**
 * Export on Live Attendance: pick a list, narrow it, and print it or save it.
 *
 * <p>The lists are the questions people bring to this page. Who is inside
 * right now (printed, it is the roll call sheet for a fire drill or an
 * evacuation), who is clocked in right now, everyone the board has today,
 * one day's movements, one day's scan log, and the view exactly as it is on
 * screen, which is what Export did on its own before.
 *
 * <p>Every count is worked out as the options change, so the window says how
 * many people a list holds before anything is made. The people lists come
 * from the board already on the page, so they match it to the person; the
 * day lists ask the server for the day picked, through the same checks the
 * Movements and Scan log views use.
 */

type Kind = PeopleSet | "movements" | "log" | "screen";
type Format = "print" | "xlsx" | "csv";

const FORMAT_ITEMS = [
  { value: "print", label: "Print" },
  { value: "xlsx", label: "Excel" },
  { value: "csv", label: "CSV" },
];

const ORDERS: PeopleOrder[] = ["name", "department", "code", "arrived"];

export function ExportWindow({
  site,
  people,
  generatedAt,
  today,
  initialDepartmentId,
  initialShiftId,
  initialDay,
  screen,
  canOpenReports,
  onClose,
}: {
  site: { id: string; name: string; timezone: string; hasGateData: boolean };
  /** Everyone on the board now, before any filter on screen. */
  people: PresencePerson[];
  generatedAt: string;
  /** The building's today, YYYY-MM-DD. */
  today: string;
  /** The filters on screen, which the window starts from. */
  initialDepartmentId: string;
  initialShiftId: string;
  /** The day the Movements or Scan log view is showing, or "" for today. */
  initialDay: string;
  /** The view as it is on screen: what it is called, and how to make it. */
  screen: { label: string; build: () => Promise<ExportTable | null> };
  /** Whether to point at the Reports page for more than one day. */
  canOpenReports: boolean;
  onClose: () => void;
}) {
  const tz = site.timezone;
  const [kind, setKind] = useState<Kind>(site.hasGateData ? "inside" : "clocked");
  const [departmentId, setDepartmentId] = useState(initialDepartmentId);
  const [shiftId, setShiftId] = useState(initialShiftId);
  const [includeBreaks, setIncludeBreaks] = useState(false);
  const [order, setOrder] = useState<PeopleOrder>("name");
  const [day, setDay] = useState(initialDay || today);
  const [format, setFormat] = useState<Format>("print");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const departments = useMemo(() => options(people, "departmentId", "department"), [people]);
  const shifts = useMemo(() => options(people, "shiftId", "shift"), [people]);
  const scope = { departmentId, shiftId, includeBreaks };
  const count = (set: PeopleSet) => selectPeople(people, set, scope).length;
  const isPeople = kind === "inside" || kind === "clocked" || kind === "everyone";
  const isDay = kind === "movements" || kind === "log";
  const days = recentDays(today);

  const filterWords = [
    departmentId ? `Department: ${departments.find((d) => d.id === departmentId)?.name ?? "One department"}` : null,
    shiftId ? `Shift: ${shifts.find((s) => s.id === shiftId)?.name ?? "One shift"}` : null,
    kind === "clocked" && includeBreaks ? "Includes people on a meal or break" : null,
  ].filter((w): w is string => !!w);

  // The people lists are made from the board on the page; a day list asks
  // the server for that day, only when the button is pressed.
  async function buildTable(): Promise<ExportTable | null> {
    if (kind === "screen") return screen.build();
    if (isPeople) {
      return peopleTable({
        people,
        set: kind as PeopleSet,
        scope,
        order,
        site: site.name,
        tz,
        generatedAt,
        hasGateData: site.hasGateData,
        filters: filterWords,
      });
    }
    const asked = day === today ? null : day;
    const meta = { site: site.name, filters: filterWords, rollCall: false, unit: { one: "row", many: "rows" } };
    if (kind === "movements") {
      const res = await getOnSiteMovements({ siteId: site.id, day: asked });
      if (!res.success || "unchanged" in res.data) throw new Error("load");
      const data = res.data;
      const views = buildSiteDay(data, Date.now())
        .filter((v) => (!departmentId || v.person.departmentId === departmentId) && (!shiftId || v.person.shiftId === shiftId))
        .sort((a, b) => a.person.name.localeCompare(b.person.name, "en", { sensitivity: "base" }));
      return linesTable(movementsLines(views, data), {
        ...meta,
        title: "Movements",
        when: dayWords(data.day, data.today),
        fileStem: `Movements ${site.name} ${data.day}`,
        printColumns: [0, 2, 5, 6, 7, 8, 9],
        note: data.truncated ? "This day had more scans than one export carries, so its earliest scans are left out." : undefined,
      });
    }
    const res = await getOnSiteScanLog({
      siteId: site.id,
      day: asked,
      ...counterQuery(null),
      departmentId: departmentId || null,
      shiftId: shiftId || null,
      q: null,
      ids: null,
      limit: 5000,
    });
    if (!res.success) throw new Error("load");
    return linesTable(scanLogLines(res.data.rows, tz, site.name), {
      ...meta,
      title: "Scan log",
      when: dayWords(res.data.day, res.data.today),
      fileStem: `Scan log ${site.name} ${res.data.day}`,
      unit: { one: "scan", many: "scans" },
      printColumns: [0, 1, 3, 5, 6, 8],
      note: res.data.hasMore ? "This day had more than 5,000 scans; the newest 5,000 are here." : undefined,
    });
  }

  async function run() {
    setBusy(true);
    setFailure(null);
    try {
      const table = await buildTable();
      if (!table) throw new Error("load");
      if (format === "print") printSheet(printHtml(table));
      else if (format === "xlsx") saveFile(await toXlsx(table), `${table.fileStem}.xlsx`);
      else saveFile(new Blob([toCsv(table)], { type: "text/csv;charset=utf-8" }), `${table.fileStem}.csv`);
      onClose();
    } catch {
      setFailure(
        isDay
          ? `The ${kind === "log" ? "scan log" : "movements"} for ${dayWords(day, today)} could not be loaded. Check your connection and try again.`
          : "The export could not be made. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  // ── Wording and the preview, which follow the choices ─────────────────
  const peopleCount = isPeople ? count(kind as PeopleSet) : null;
  const empty = peopleCount === 0;
  // The button says what it will do, in words that differ from the format
  // switch beside it: "Print list", never a second button just called Print.
  const printNoun = isPeople ? "list" : kind === "movements" ? "movements" : kind === "log" ? "scan log" : "view";
  const action = busy
    ? format === "print"
      ? "Preparing"
      : "Downloading"
    : format === "print"
      ? `Print ${printNoun}`
      : `Download ${format === "xlsx" ? "Excel" : "CSV"}`;

  // A people list is made here and now, so its preview is the real thing.
  const preview = useMemo(
    () =>
      isPeople
        ? peopleTable({
            people,
            set: kind as PeopleSet,
            scope: { departmentId, shiftId, includeBreaks },
            order,
            site: site.name,
            tz,
            generatedAt,
            hasGateData: site.hasGateData,
            filters: [],
          })
        : null,
    [isPeople, people, kind, departmentId, shiftId, includeBreaks, order, site, tz, generatedAt],
  );

  const sheetTitle = preview?.title ?? (kind === "movements" ? "Movements" : kind === "log" ? "Scan log" : screen.label);
  const sheetWhen = isPeople ? `${fmtTime(generatedAt, tz)} today` : isDay ? dayWords(day, today) : "As on screen";
  const fileName = `${preview?.fileStem ?? (isDay ? `${sheetTitle} ${site.name} ${day}` : `${sheetTitle} ${site.name}`)}.${format === "xlsx" ? "xlsx" : "csv"}`;

  const hint = empty
    ? kind === "clocked" && !includeBreaks
      ? "No one is working on the time clock right now. Include people on a meal or break, or change the department or shift."
      : "No one is on this list right now. Change the department or shift to see more people."
    : format === "print"
      ? kind === "inside" || kind === "clocked"
        ? "Prints with a tick box for each person and a line to sign."
        : isDay
          ? `Prints ${dayWords(day, today)}, one row per ${kind === "log" ? "scan" : "stretch of time"}.`
          : "Prints the list as it is on screen."
      : format === "xlsx"
        ? "Opens in Excel or Google Sheets, with a filter on every column."
        : "A plain file any spreadsheet or system can read.";

  return (
    <Shell
      title="Export"
      subtitle={`${site.name} · as of ${fmtTime(generatedAt, tz)}`}
      onClose={onClose}
      foot={
        <>
          <span className={styles.footHint} data-tone={empty ? "warning" : undefined} role={empty ? "status" : undefined}>
            {hint}
          </span>
          <Button hierarchy="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            hierarchy="primary"
            onClick={run}
            disabled={busy || empty}
            leadingIcon={format === "print" ? <Printer className="h-4 w-4" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          >
            {action}
          </Button>
        </>
      }
    >
      <div className={styles.panes}>
        {/* ── What to export ── */}
        <section className={styles.card} aria-labelledby="export-what">
          <h3 id="export-what" className="sr-only">
            What to export
          </h3>
          {failure && <Banner tone="error" title="Nothing was exported" body={failure} />}
          <div role="radiogroup" aria-labelledby="export-what" className={styles.groups}>
            <Group label="Right now">
              {site.hasGateData && (
                <Choice value="inside" kind={kind} onPick={setKind} icon={DoorOpen} title="In the building now" body="Everyone the security gate shows inside" count={count("inside")} />
              )}
              <Choice value="clocked" kind={kind} onPick={setKind} icon={Clock} title="Clocked in now" body="Everyone clocked in and working" count={count("clocked")} />
              <Choice value="everyone" kind={kind} onPick={setKind} icon={Users} title="Everyone today" body="Everyone scheduled or scanned here today" count={count("everyone")} />
            </Group>
            <Group label="For one day">
              <Choice value="movements" kind={kind} onPick={setKind} icon={Footprints} title="Movements" body="When each person came in, took breaks and left" />
              <Choice value="log" kind={kind} onPick={setKind} icon={ScanLine} title="Scan log" body="Every scan at the gate and the time clock" />
            </Group>
            {/* The old one click export, kept, and set apart at the foot of
                the list: it is a copy of the page, not a list of its own. */}
            <div className={styles.screenChoice}>
              <Choice value="screen" kind={kind} onPick={setKind} icon={Monitor} title="What is on screen" body={`${screen.label} exactly as you see it`} />
            </div>
          </div>
        </section>

        {/* ── How ── */}
        <aside className={styles.rail} aria-label="Export settings">
          <div className={styles.railBlock}>
            <SegmentedControl items={FORMAT_ITEMS} value={format} onChange={(v) => setFormat(v as Format)} ariaLabel="Format" fullWidth />
          </div>

          {kind !== "screen" && (
            <div className={styles.railBlock}>
              {isDay && (
                <Field label="Day" htmlFor="export-day">
                  <Select id="export-day" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: "100%" }}>
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {dayWords(d, today)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Department" htmlFor="export-dept">
                <Select id="export-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={{ width: "100%" }}>
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Shift" htmlFor="export-shift">
                <Select id="export-shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)} style={{ width: "100%" }}>
                  <option value="">All shifts</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {isPeople && (
                <Field label="Order" htmlFor="export-order">
                  <Select id="export-order" value={order} onChange={(e) => setOrder(e.target.value as PeopleOrder)} style={{ width: "100%" }}>
                    {ORDERS.map((o) => (
                      <option key={o} value={o}>
                        {ORDER_LABEL[o]}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {kind === "clocked" && <Checkbox checked={includeBreaks} onChange={setIncludeBreaks} label="Include people on a meal or break" />}
              {isDay && (
                <p className={styles.railNote}>
                  The last seven days.
                  {canOpenReports && (
                    <>
                      {" "}
                      Longer stretches are in{" "}
                      <Link href="/reports?new=1" className={styles.link}>
                        Reports
                      </Link>
                      .
                    </>
                  )}
                </p>
              )}
            </div>
          )}

          <div className={`${styles.railBlock} ${styles.previewBlock}`}>
            {format === "print" ? (
              <Sheet
                title={sheetTitle}
                when={`${site.name} · ${sheetWhen}`}
                count={preview ? preview.rows.length : null}
                names={preview ? preview.rows.slice(0, 4).map((r) => r[0]) : null}
                ticks={!!preview?.rollCall}
                grouped={isPeople && order === "department"}
              />
            ) : (
              <FileCard format={format} name={fileName} rows={preview ? preview.rows.length : null} columns={preview?.columns.length ?? null} />
            )}
            {format === "print" && <p className={styles.railNote}>For a PDF, choose Save as PDF in the print window.</p>}
          </div>
        </aside>
      </div>
    </Shell>
  );
}

/** The departments or shifts the board's people are in, by name. */
function options(people: PresencePerson[], idKey: "departmentId" | "shiftId", nameKey: "department" | "shift") {
  const seen = new Map<string, string>();
  for (const p of people) {
    const id = p[idKey];
    if (id && !seen.has(id)) seen.set(id, p[nameKey] ?? "Unnamed");
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>{label}</span>
      <div className={styles.choices}>{children}</div>
    </div>
  );
}

/** One list to pick: its glyph, name and what it holds, and how many people are on it. */
function Choice({
  value,
  kind,
  onPick,
  icon: Icon,
  title,
  body,
  count,
}: {
  value: Kind;
  kind: Kind;
  onPick: (k: Kind) => void;
  icon: LucideIcon;
  title: string;
  body: string;
  count?: number;
}) {
  const on = kind === value;
  return (
    <label className={styles.choice} data-on={on}>
      <input type="radio" name="export-list" value={value} checked={on} onChange={() => onPick(value)} className="sr-only" />
      <span className={styles.choiceIcon} aria-hidden="true">
        <Icon />
      </span>
      <span className={styles.choiceText}>
        <span className={styles.choiceTitle}>{title}</span>
        <span className={styles.choiceBody}>{body}</span>
      </span>
      {count !== undefined && (
        <span className={styles.choiceCount} aria-label={`${count} ${count === 1 ? "person" : "people"}`}>
          {count.toLocaleString("en-US")}
        </span>
      )}
    </label>
  );
}

/**
 * The printed page in miniature: its title, the building and time, the
 * count, and the first names on it with their tick boxes. A day list has
 * no names until it is loaded, so its lines are drawn as placeholders.
 */
function Sheet({
  title,
  when,
  count,
  names,
  ticks,
  grouped,
}: {
  title: string;
  when: string;
  count: number | null;
  names: string[] | null;
  ticks: boolean;
  grouped: boolean;
}) {
  const rest = count !== null && names ? count - names.length : 0;
  return (
    <div className={styles.sheet} aria-label="Preview of the printed page">
      <div className={styles.sheetHead}>
        <span className={styles.sheetTitles}>
          <span className={styles.sheetTitle}>{title}</span>
          <span className={styles.sheetWhen}>{when}</span>
        </span>
        {count !== null && (
          <span className={styles.sheetCount} data-testid="preview-count">
            {count.toLocaleString("en-US")}
          </span>
        )}
      </div>
      <div className={styles.sheetRows}>
        {grouped && names && names.length > 0 && <span className={styles.sheetGroup}>Grouped by department</span>}
        {(names ?? [null, null, null, null]).map((n, i) => (
          <span key={i} className={styles.sheetRow}>
            {ticks && <span className={styles.sheetTick} />}
            {n ? <span className={styles.sheetName}>{n}</span> : <span className={styles.sheetBar} style={{ width: `${78 - i * 12}%` }} />}
          </span>
        ))}
        {names && names.length === 0 && <span className={styles.sheetEmpty}>No one on this list</span>}
        {rest > 0 && <span className={styles.sheetMore}>and {rest.toLocaleString("en-US")} more</span>}
      </div>
      {ticks && (
        <div className={styles.sheetSign}>
          <span>Checked by</span>
          <span>Time</span>
        </div>
      )}
    </div>
  );
}

/** A download in miniature: the file's name, and what is in it when that is known. */
function FileCard({ format, name, rows, columns }: { format: "xlsx" | "csv"; name: string; rows: number | null; columns: number | null }) {
  const Icon = format === "xlsx" ? FileSpreadsheet : FileText;
  return (
    <div className={styles.file}>
      <span className={styles.fileIcon} data-format={format} aria-hidden="true">
        <Icon />
      </span>
      <span className={styles.fileText}>
        <span className={styles.fileName} title={name}>
          {name}
        </span>
        <span className={styles.fileMeta} data-testid="preview-count">
          {rows !== null && columns !== null
            ? `${rows.toLocaleString("en-US")} ${rows === 1 ? "row" : "rows"} · ${columns} columns`
            : format === "xlsx"
              ? "Excel workbook"
              : "Comma separated values"}
        </span>
      </span>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor} className={styles.fieldLabel}>
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * The frame: a grey window holding white cards, the header and the footer
 * on the grey, so the two panes read as the content and everything else as
 * the frame around it.
 */
function Shell({
  title,
  subtitle,
  foot,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  foot: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
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
    <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="export-window-title" className={styles.window}>
        <header className={styles.head}>
          <span className={styles.glyph} aria-hidden="true">
            <Download />
          </span>
          <span className={styles.titles}>
            <h2 id="export-window-title" className={styles.title}>
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
