"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import type { PayRateRow } from "@/actions/pay-rate.actions";
import { Banner, Button, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { currentRow, money, noSubmitOnEnter, usDate, usePayRates } from "./use-pay-rates";

const cell: React.CSSProperties = {
  border: "1px solid var(--stroke-default)",
  background: "var(--surface-card)",
  color: "var(--text-primary)",
  font: "var(--type-body2)",
};

/**
 * Pay rates from an effective date, as NovaTime's Pay Rates table. Saved on
 * its own, separately from the rest of the record. Rate 1 is the pay rate;
 * Rate 2 and Rate 3 are kept for reference.
 */
export function PayRatesTable({ employeeId, initial, salary }: { employeeId: string; initial: PayRateRow[]; salary: boolean }) {
  const { rows, draft, error, pending, edit, cancel, add, remove, update, save } = usePayRates(employeeId, initial);
  const current = currentRow(rows);
  const per = salary ? "per year" : "per hour";

  const num = (key: string, field: "rate1" | "rate2" | "rate3", value: string, label: string) => (
    <input
      type="number"
      min="0.01"
      step="0.01"
      inputMode="decimal"
      value={value}
      onChange={(e) => update(key, field, e.target.value)}
      onKeyDown={noSubmitOnEnter}
      placeholder="0.00"
      aria-label={label}
      className="ta-field h-8 w-full rounded-md px-2 text-right"
      style={{ ...cell, fontVariantNumeric: "tabular-nums" }}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>Pay rates</span>
          <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
            {current ? `Current: ${money(current.rate1)} ${per}, since ${usDate(current.effectiveDate)}` : "No rate in effect yet"}
            {" · "}Rate 1 is the pay rate; Rates 2 and 3 are for reference.
          </span>
        </div>
        {draft ? (
          <div className="flex gap-2">
            <Button type="button" size="sm" hierarchy="secondary" onClick={add} disabled={pending} leadingIcon={<Plus className="h-3.5 w-3.5" />}>
              Add rate
            </Button>
            <Button type="button" size="sm" hierarchy="secondary" onClick={cancel} disabled={pending}>Cancel</Button>
            <Button type="button" size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save rates"}</Button>
          </div>
        ) : (
          <Button type="button" size="sm" hierarchy="secondary" onClick={edit} leadingIcon={<Pencil className="h-3.5 w-3.5" />}>
            Edit pay rates
          </Button>
        )}
      </div>

      {error && <Banner tone="error" body={error} />}

      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--stroke-divider)" }}>
        <Table>
          <THead>
            <TR>
              <TH>Date effective</TH>
              <TH numeric>Rate 1</TH>
              <TH numeric>Rate 2</TH>
              <TH numeric>Rate 3</TH>
              <TH>Notes</TH>
              {draft && <TH align="right"><span className="sr-only">Remove</span></TH>}
            </TR>
          </THead>
          <TBody>
            {draft
              ? draft.map((r) => (
                  <TR key={r.key}>
                    <TD style={{ minWidth: 150 }}>
                      <input
                        type="date"
                        value={r.effectiveDate}
                        onChange={(e) => update(r.key, "effectiveDate", e.target.value)}
                        onKeyDown={noSubmitOnEnter}
                        aria-label="Date effective"
                        className="ta-field h-8 w-full rounded-md px-2"
                        style={cell}
                      />
                    </TD>
                    <TD style={{ minWidth: 110 }}>{num(r.key, "rate1", r.rate1, "Rate 1")}</TD>
                    <TD style={{ minWidth: 110 }}>{num(r.key, "rate2", r.rate2, "Rate 2")}</TD>
                    <TD style={{ minWidth: 110 }}>{num(r.key, "rate3", r.rate3, "Rate 3")}</TD>
                    <TD style={{ minWidth: 200 }}>
                      <input
                        value={r.note}
                        maxLength={500}
                        onChange={(e) => update(r.key, "note", e.target.value)}
                        onKeyDown={noSubmitOnEnter}
                        placeholder="e.g. Annual increase"
                        aria-label="Notes"
                        className="ta-field h-8 w-full rounded-md px-2"
                        style={cell}
                      />
                    </TD>
                    <TD align="right">
                      <Button type="button" size="sm" hierarchy="tertiary" iconOnly aria-label="Remove this rate" title="Remove this rate" onClick={() => remove(r.key)} leadingIcon={<Trash2 className="h-3.5 w-3.5" />} />
                    </TD>
                  </TR>
                ))
              : rows.map((r) => (
                  <TR key={r.effectiveDate}>
                    <TD>
                      {usDate(r.effectiveDate)}
                      {current?.effectiveDate === r.effectiveDate && (
                        <span className="ml-2" style={{ font: "var(--type-caption1)", color: "var(--text-success)" }}>Current</span>
                      )}
                      {r.effectiveDate > (current?.effectiveDate ?? "") && current && (
                        <span className="ml-2" style={{ font: "var(--type-caption1)", color: "var(--text-accent)" }}>Upcoming</span>
                      )}
                    </TD>
                    <TD numeric>{money(r.rate1)}</TD>
                    <TD numeric>{money(r.rate2) || "—"}</TD>
                    <TD numeric>{money(r.rate3) || "—"}</TD>
                    <TD>
                      <span className="block max-w-[320px] truncate" title={r.note ?? undefined} style={{ color: r.note ? "var(--text-secondary)" : "var(--text-tertiary)" }}>
                        {r.note || "—"}
                      </span>
                    </TD>
                  </TR>
                ))}
            {!draft && rows.length === 0 && (
              <TR>
                <TD colSpan={5} style={{ color: "var(--text-tertiary)" }}>No pay rates yet. Use Edit pay rates to add one.</TD>
              </TR>
            )}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
