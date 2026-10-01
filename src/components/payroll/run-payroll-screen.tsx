"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { saveRunCodes, type RunCodes } from "@/lib/payroll/run-codes";
import { MultiSelectFilter } from "@/components/payroll/multi-select-filter";
import { fmtDay, includedDates } from "@/lib/payroll/run-range";
import { Download, Eye, Play } from "lucide-react";
import {
  previewPayrollRun,
  processPayrollRun,
  draftPayrollFile,
  type RunFrequency,
  type RunPeriod,
  type RunPayrollInput,
  type RunPreview,
} from "@/actions/payroll-run.actions";
import type { EpiSummary } from "@/lib/payroll/adp-epi";
import { Banner, Button, Card, Checkbox, ConfirmDialog, Input, PageHeader, Select, StatCard, Table, TBody, TD, TH, THead, TR } from "@/components/ui";

type Option = { id: string; name: string };

interface Props {
  frequencies: RunFrequency[];
  periods: RunPeriod[];
  ruleSets: Option[];
  payCategories: Option[];
  sites: Option[];
  departments: Option[];
  agencies: Option[];
  savedCodes: RunCodes;
}

const hrs = (minutes: number) => (minutes / 60).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>{label}</span>
      {children}
      {hint && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{hint}</span>}
    </label>
  );
}

const GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12 };

function download(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function RunPayrollScreen({ frequencies, periods, ruleSets, payCategories, sites, departments, agencies, savedCodes }: Props) {
  const [isPending, startTransition] = useTransition();
  const initial = frequencies.find((f) => f.value === "BIWEEKLY") ?? frequencies[0];
  const [frequency, setFrequency] = useState<string>(initial?.value ?? "BIWEEKLY");
  const [from, setFrom] = useState(initial?.defaultFrom ?? "");
  const [to, setTo] = useState(initial?.defaultTo ?? "");
  const [codes, setCodes] = useState<RunCodes>(savedCodes);
  const [filters, setFilters] = useState({ badgeIds: "", ruleSetIds: [] as string[], payCategoryIds: [] as string[], siteIds: [] as string[], departmentIds: [] as string[], agencyIds: [] as string[], excludeMissedPunches: false });
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [result, setResult] = useState<{ csv: string; filename: string; summary: EpiSummary; locked: number; leftOpen: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const included = useMemo(() => includedDates(periods, frequency, from, to), [periods, frequency, from, to]);
  const freqLabel = frequencies.find((f) => f.value === frequency)?.label.toLowerCase() ?? "";
  const input: RunPayrollInput = useMemo(
    () => ({ frequency: frequency as RunPayrollInput["frequency"], from, to, filters, codes }),
    [frequency, from, to, filters, codes],
  );

  function changeFrequency(value: string) {
    const f = frequencies.find((x) => x.value === value);
    setFrequency(value);
    setFrom(f?.defaultFrom ?? "");
    setTo(f?.defaultTo ?? "");
    setPreview(null);
    setResult(null);
  }
  const changeDate = (set: (v: string) => void, v: string) => {
    set(v);
    setPreview(null);
    setResult(null);
  };

  const setCode = (k: keyof typeof codes, v: string) => {
    setCodes((c) => ({ ...c, [k]: v.toUpperCase() }));
    setPreview(null);
  };
  const setFilter = <K extends keyof typeof filters>(k: K, v: (typeof filters)[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPreview(null);
  };

  function runDraft() {
    setError(null);
    startTransition(async () => {
      const r = await draftPayrollFile(input);
      if (!r.success) return setError(r.error);
      download(r.data.csv, r.data.filename);
    });
  }

  function runPreview() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await previewPayrollRun(input);
      if (!r.success) return setError(r.error);
      setPreview(r.data);
    });
  }

  function runProcess() {
    setError(null);
    startTransition(async () => {
      // The dialog has just shown any open missed punches.
      const r = await processPayrollRun({ ...input, acknowledgeMissedPunches: true });
      setConfirming(false);
      if (!r.success) return setError(r.error);
      saveRunCodes(codes);
      setResult(r.data);
      setPreview(null);
      download(r.data.csv, r.data.filename);
    });
  }

  const summary = result?.summary ?? preview?.summary ?? null;
  const otherMinutes = summary ? summary.byCode.reduce((n, c) => n + c.minutes, 0) : 0;
  const lockCount = preview?.toLock.length ?? 0;
  const outside = preview?.toLock.reduce((n, p) => n + p.alsoOutsideFilters, 0) ?? 0;
  const missedInFile = preview?.summary.missedPunches.filter((m) => !m.excluded).length ?? 0;
  const missedLeftOut = preview?.summary.missedPunches.filter((m) => m.excluded).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Run Payroll"
        subtitle="Lock a pay period and build the ADP import file"
        actions={
          <>
            <Button hierarchy="secondary" onClick={runPreview} disabled={isPending || included.length === 0} leadingIcon={<Eye className="h-4 w-4" aria-hidden="true" />}>
              {isPending && !confirming ? "Checking…" : "Preview"}
            </Button>
            <Button
              hierarchy="secondary"
              onClick={runDraft}
              disabled={isPending || included.length === 0}
              title="The file Process would build, without locking anything"
              leadingIcon={<Download className="h-4 w-4" aria-hidden="true" />}
            >
              Download draft file
            </Button>
            <Button tone="success" onClick={() => setConfirming(true)} disabled={isPending || !preview} leadingIcon={<Play className="h-4 w-4" aria-hidden="true" />}>
              Process
            </Button>
          </>
        }
      />

      {error && <Banner tone="error" body={error} />}

      <Card title="Pay period and file" subtitle="Every pay group of this frequency inside the dates is included; use the filters to narrow who goes in the file.">
        <div style={GRID}>
          <Field label="Pay frequency">
            <Select value={frequency} onChange={(e) => changeFrequency(e.target.value)} style={{ width: "100%" }}>
              {frequencies.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </Field>
          <Input label="From" type="date" required value={from} max={to || undefined} onChange={(e) => changeDate(setFrom, e.target.value)} />
          <Input label="To" type="date" required value={to} min={from || undefined} onChange={(e) => changeDate(setTo, e.target.value)} />
          <div style={{ gridColumn: "1 / -1" }}>
            {included.length === 0 ? (
              <p className="m-0" style={{ font: "var(--type-body2)", color: "var(--text-warning)" }}>
                No {freqLabel} pay periods fall entirely inside these dates.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                {included.map((g) => (
                  <li key={g.startDay}>
                    <span style={{ color: "var(--text-primary)", fontWeight: "var(--weight-medium)" }}>
                      {fmtDay(g.startDay)} to {fmtDay(g.lastDay)}
                    </span>
                    {` · ${g.timecards} timecards`}
                    {g.locked > 0 && (g.locked === g.names.length ? " · locked" : ` · ${g.locked} of ${g.names.length} locked`)}
                    <span style={{ color: "var(--text-tertiary)" }}>{` · ${g.names.join(", ")}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Input label="Co Code" required value={codes.coCode} onChange={(e) => setCode("coCode", e.target.value)} placeholder="e.g. ATW" hint="ADP company code, on every row" />
          <Input label="Batch ID" required value={codes.batchId} onChange={(e) => setCode("batchId", e.target.value)} placeholder="e.g. BATCH1" />
          <Input label="Double time code" value={codes.doubleTimeCode} onChange={(e) => setCode("doubleTimeCode", e.target.value)} placeholder="ADP hours code" hint="Needed when the period has double time" />
          <Input label="Meal penalty code" value={codes.mealPenaltyCode} onChange={(e) => setCode("mealPenaltyCode", e.target.value)} placeholder="MP" />
        </div>
      </Card>

      <Card title="Filters" subtitle="Filters use each employee's current setup.">
        <div style={GRID}>
          <MultiSelectFilter label="Site" value={filters.siteIds} onChange={(v) => setFilter("siteIds", v)} options={sites} />
          <MultiSelectFilter label="Department" value={filters.departmentIds} onChange={(v) => setFilter("departmentIds", v)} options={departments} />
          <MultiSelectFilter label="Rule set (pay policy)" value={filters.ruleSetIds} onChange={(v) => setFilter("ruleSetIds", v)} options={ruleSets} />
          <MultiSelectFilter label="Pay category" value={filters.payCategoryIds} onChange={(v) => setFilter("payCategoryIds", v)} options={payCategories} />
          <MultiSelectFilter label="Agency" value={filters.agencyIds} onChange={(v) => setFilter("agencyIds", v)} options={agencies} />
          <Input label="Employees" value={filters.badgeIds} onChange={(e) => setFilter("badgeIds", e.target.value)} placeholder="All, or Badge IDs: 636554, 630622" />
          <div style={{ gridColumn: "1 / -1" }} className="flex flex-col gap-1">
            <Checkbox
              checked={filters.excludeMissedPunches}
              onChange={(v) => setFilter("excludeMissedPunches", v)}
              label="Leave out people with open missed punches"
            />
            <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
              Their timecards stay unlocked so they can be corrected, locked and run later.
            </span>
          </div>
        </div>
      </Card>

      {result && (
        <Banner
          tone="success"
          title="Payroll file generated"
          body={`${result.filename}: ${result.summary.employees} employees, ${result.summary.rows} rows.${result.locked ? ` Locked ${result.locked} pay ${result.locked === 1 ? "group" : "groups"}.` : ""}${result.leftOpen ? ` ${result.leftOpen} ${result.leftOpen === 1 ? "timecard was" : "timecards were"} left out for missed punches and kept unlocked.` : ""}`}
          actions={
            <Button size="sm" hierarchy="secondary" onClick={() => download(result.csv, result.filename)} leadingIcon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}>
              Download again
            </Button>
          }
        />
      )}

      {summary && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 12 }}>
            <StatCard label="Employees" value={summary.employees.toLocaleString("en-US")} sub={`${summary.rows} rows in the file`} />
            <StatCard label="Regular hours" value={hrs(summary.regMinutes)} />
            <StatCard label="Overtime hours" value={hrs(summary.otMinutes)} />
            <StatCard label="Other hours" value={hrs(otherMinutes)} sub={`${summary.byCode.length} ${summary.byCode.length === 1 ? "code" : "codes"}`} />
          </div>

          {summary.needsDoubleTimeCode && <Banner tone="error" body="This period has double time. Enter the ADP code for double time before processing." />}
          {summary.needsMealPenaltyCode && <Banner tone="error" body="This period has meal penalties. Enter the ADP code for meal penalty before processing." />}
          {summary.noBadge.length > 0 && (
            <Banner
              tone="warning"
              title={`${summary.noBadge.length} ${summary.noBadge.length === 1 ? "employee has" : "employees have"} hours but no Badge ID, and will be left out`}
              body={summary.noBadge.map((p) => `${p.name} (${hrs(p.minutes)} h)`).join(", ")}
            />
          )}
          {summary.leftOut.length > 0 && (
            <Banner
              tone="warning"
              title="Some hours are on pay codes with no Express code, and will be left out. Add one under Company Setup → Pay Codes."
              body={summary.leftOut.map((l) => `${l.label}: ${hrs(l.minutes)} h, ${l.people} ${l.people === 1 ? "person" : "people"}`).join(" · ")}
            />
          )}
          {summary.unlockedLeftOut > 0 && (
            <Banner
              tone="info"
              body={`${summary.unlockedLeftOut} ${summary.unlockedLeftOut === 1 ? "timecard is" : "timecards are"} unlocked for a correction and left out until locked again.`}
            />
          )}

          {summary.openExceptions.length > 0 && (
            <Card
              title="Open exceptions"
              subtitle={
                summary.missedPunches.length > 0
                  ? "Missed punches change the hours: the day pays as punched and doesn't count toward overtime. Correct them before processing, or leave those people out with the filter above."
                  : "None of these change the hours in the file."
              }
              padding={0}
            >
              <div className="flex flex-wrap gap-x-6 gap-y-2" style={{ padding: "12px 16px", font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                {summary.openExceptions.map((e) => (
                  <span key={e.type}>
                    <span style={{ color: e.type === "MISSING_PUNCH" ? "var(--text-warning)" : "var(--text-primary)", fontWeight: "var(--weight-medium)" }}>{e.label}</span>
                    {` ${e.count.toLocaleString("en-US")} on ${e.people.toLocaleString("en-US")} ${e.people === 1 ? "person" : "people"}`}
                  </span>
                ))}
              </div>
              {summary.missedPunches.length > 0 && (
                <div style={{ maxHeight: 360, overflowY: "auto", borderTop: "1px solid var(--stroke-divider)" }}>
                  <Table>
                    <THead>
                      <TR><TH>Employee</TH><TH>Badge ID</TH><TH numeric>Missed punches</TH><TH>In the file</TH><TH><span className="sr-only">Timecard</span></TH></TR>
                    </THead>
                    <TBody>
                      {summary.missedPunches.map((m) => (
                        <TR key={m.timesheetId}>
                          <TD>{m.name}</TD>
                          <TD>{m.file}</TD>
                          <TD numeric>{m.count}</TD>
                          <TD>{m.excluded ? "Left out" : "Yes"}</TD>
                          <TD>
                            <Link
                              href={`/payroll/timecards?periodId=${m.payPeriodId}&employeeId=${m.employeeId}`}
                              target="_blank"
                              style={{ color: "var(--text-accent)", font: "var(--type-button2)" }}
                            >
                              Open timecard
                            </Link>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
            </Card>
          )}

          {summary.byCode.length > 0 && (
            <Card title="Hours by code" padding={0}>
              <Table>
                <THead>
                  <TR><TH>Code</TH><TH numeric>Hours</TH></TR>
                </THead>
                <TBody>
                  {summary.byCode.map((c) => (
                    <TR key={c.code}><TD>{c.code}</TD><TD numeric>{hrs(c.minutes)}</TD></TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </>
      )}

      {confirming && preview && (
        <ConfirmDialog
          title="Process payroll?"
          tone="warning"
          confirmLabel="Lock and generate file"
          pendingLabel="Processing…"
          pending={isPending}
          onConfirm={runProcess}
          onCancel={() => setConfirming(false)}
        >
          <div className="flex flex-col gap-3">
            <p className="m-0">
              {lockCount > 0
                ? `This locks ${lockCount} pay ${lockCount === 1 ? "group" : "groups"} (${preview.toLock.map((p) => p.name).join(", ")}) and every timecard in them${outside > 0 ? `, including ${outside} ${outside === 1 ? "timecard" : "timecards"} outside your filters` : ""}${missedLeftOut > 0 ? `, except the ${missedLeftOut} left out for missed punches` : ""}, posts their accruals and approved leave, then generates the ADP file for ${preview.summary.employees} employees.`
                : `These pay groups are already locked. This generates the ADP file for ${preview.summary.employees} employees.`}
            </p>
            {missedInFile > 0 && (
              <p className="m-0" style={{ color: "var(--text-warning)", fontWeight: "var(--weight-medium)" }}>
                {missedInFile} {missedInFile === 1 ? "timecard in the file has" : "timecards in the file have"} open missed punches, so their hours may be wrong. Process anyway?
              </p>
            )}
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
