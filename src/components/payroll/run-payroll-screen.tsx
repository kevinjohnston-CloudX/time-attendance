"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { saveRunCodes, type RunCodes } from "@/lib/payroll/run-codes";
import { MultiSelectFilter } from "@/components/payroll/multi-select-filter";
import { Download, Eye, Play } from "lucide-react";
import {
  previewPayrollRun,
  processPayrollRun,
  type PeriodGroup,
  type RunPayrollInput,
  type RunPreview,
} from "@/actions/payroll-run.actions";
import type { EpiSummary } from "@/lib/payroll/adp-epi";
import { Banner, Button, Card, ConfirmDialog, Input, PageHeader, Select, StatCard, Table, TBody, TD, TH, THead, TR } from "@/components/ui";

type Option = { id: string; name: string };

interface Props {
  periodGroups: PeriodGroup[];
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

export function RunPayrollScreen({ periodGroups, ruleSets, payCategories, sites, departments, agencies, savedCodes }: Props) {
  const [isPending, startTransition] = useTransition();
  const [periodKey, setPeriodKey] = useState(periodGroups[0]?.key ?? "");
  const [codes, setCodes] = useState<RunCodes>(savedCodes);
  const [filters, setFilters] = useState({ badgeIds: "", ruleSetIds: [] as string[], payCategoryIds: [] as string[], siteIds: [] as string[], departmentIds: [] as string[], agencyIds: [] as string[] });
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [result, setResult] = useState<{ csv: string; filename: string; summary: EpiSummary; locked: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const group = periodGroups.find((g) => g.key === periodKey) ?? null;
  const input: RunPayrollInput = useMemo(() => ({ periodKey, filters, codes }), [periodKey, filters, codes]);

  const setCode = (k: keyof typeof codes, v: string) => {
    setCodes((c) => ({ ...c, [k]: v.toUpperCase() }));
    setPreview(null);
  };
  const setFilter = <K extends keyof typeof filters>(k: K, v: (typeof filters)[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPreview(null);
  };

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
      const r = await processPayrollRun(input);
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Run Payroll"
        subtitle="Lock a pay period and build the ADP import file"
        actions={
          <>
            <Button hierarchy="secondary" onClick={runPreview} disabled={isPending || !periodKey} leadingIcon={<Eye className="h-4 w-4" aria-hidden="true" />}>
              {isPending && !confirming ? "Checking…" : "Preview"}
            </Button>
            <Button tone="success" onClick={() => setConfirming(true)} disabled={isPending || !preview} leadingIcon={<Play className="h-4 w-4" aria-hidden="true" />}>
              Process
            </Button>
          </>
        }
      />

      {error && <Banner tone="error" body={error} />}

      <Card title="Pay period and file" subtitle="Every pay group on these dates is included; use the filters to narrow who goes in the file.">
        <div style={GRID}>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Pay period">
              <Select value={periodKey} onChange={(e) => { setPeriodKey(e.target.value); setPreview(null); setResult(null); }} style={{ width: "100%" }}>
                {periodGroups.map((g) => {
                  const locked = g.periods.filter((p) => p.status === "LOCKED").length;
                  const cards = g.periods.reduce((n, p) => n + p.timecards, 0);
                  return (
                    <option key={g.key} value={g.key}>
                      {g.label} · {g.periods.length} pay {g.periods.length === 1 ? "group" : "groups"} · {cards} timecards
                      {locked === g.periods.length ? " · Locked" : locked > 0 ? ` · ${locked} locked` : ""}
                    </option>
                  );
                })}
              </Select>
            </Field>
            {group && (
              <p className="m-0 mt-1.5" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                {group.periods.filter((p) => p.timecards > 0).map((p) => `${p.name}${p.status === "LOCKED" ? " (locked)" : ""}`).join(" · ")}
              </p>
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
        </div>
      </Card>

      {result && (
        <Banner
          tone="success"
          title="Payroll file generated"
          body={`${result.filename}: ${result.summary.employees} employees, ${result.summary.rows} rows.${result.locked ? ` Locked ${result.locked} pay ${result.locked === 1 ? "group" : "groups"}.` : ""}`}
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
              title="Some hours have no export code and will be left out"
              body={summary.leftOut.map((l) => `${l.label}: ${hrs(l.minutes)} h, ${l.people} ${l.people === 1 ? "person" : "people"}`).join(" · ")}
            />
          )}
          {summary.unlockedLeftOut > 0 && (
            <Banner
              tone="info"
              body={`${summary.unlockedLeftOut} ${summary.unlockedLeftOut === 1 ? "timecard is" : "timecards are"} unlocked for a correction and left out until locked again.`}
            />
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
          {lockCount > 0
            ? `This locks ${lockCount} pay ${lockCount === 1 ? "group" : "groups"} (${preview.toLock.map((p) => p.name).join(", ")}) and every timecard in them${outside > 0 ? `, including ${outside} ${outside === 1 ? "timecard" : "timecards"} outside your filters` : ""}, posts their accruals and approved leave, then generates the ADP file for ${preview.summary.employees} employees.`
            : `These pay groups are already locked. This generates the ADP file for ${preview.summary.employees} employees.`}
        </ConfirmDialog>
      )}
    </div>
  );
}
