"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import type { PayRateRow } from "@/actions/pay-rate.actions";
import { Banner, Button, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { currentRow, draftCharge, money, noSubmitOnEnter, percent, usDate, usePayRates } from "./use-pay-rates";

const cell: React.CSSProperties = {
  border: "1px solid var(--stroke-default)",
  background: "var(--surface-card)",
  color: "var(--text-primary)",
  font: "var(--type-body2)",
};

/**
 * Pay rates from an effective date, as NovaTime's Pay Rates table. Saved on
 * its own, separately from the rest of the record. Rate 1 is the pay rate;
 * Rate 2 and Rate 3 are kept for reference. Each row's charge rate is Rate 1
 * plus the markup, or set by hand when an agency agreement differs; a new row
 * starts from the markup of the person's agency.
 */
export function PayRatesTable({
  employeeId,
  initial,
  salary,
  defaultMarkupPct = null,
}: {
  employeeId: string;
  initial: PayRateRow[];
  salary: boolean;
  /** The person's agency's default markup, for new rows. */
  defaultMarkupPct?: number | null;
}) {
  const { rows, draft, error, pending, edit, cancel, add, remove, update, setManual, save } = usePayRates(employeeId, initial, defaultMarkupPct);
  const current = currentRow(rows);
  const per = salary ? "per year" : "per hour";

  const num = (key: string, field: "rate1" | "rate2" | "rate3" | "chargeRate", value: string, label: string) => (
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
  const muted = { color: "var(--text-tertiary)" } as const;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>Pay rates</span>
          <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
            {current
              ? `Current: ${money(current.rate1)} ${per}${current.chargeRate != null ? `, charged at ${money(current.chargeRate)}` : ""}, since ${usDate(current.effectiveDate)}`
              : "No rate in effect yet"}
            {" · "}Rate 1 is the pay rate; Rates 2 and 3 are for reference. The charge rate is Rate 1 plus the markup
            {defaultMarkupPct != null ? ` (agency default ${percent(defaultMarkupPct)})` : ""}, unless set manually.
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

      {/* On a phone, read mode stacks each rate as a small labelled block
          (globals.css, .ta-rates); editing keeps the grid, which swipes. */}
      <div
        className="ta-rates overflow-x-auto rounded-lg"
        data-mode={draft ? "edit" : "read"}
        style={{ border: "1px solid var(--stroke-divider)" }}
      >
        <Table>
          <THead>
            <TR>
              <TH>Date effective</TH>
              <TH numeric>Rate 1</TH>
              <TH numeric>Markup</TH>
              <TH numeric>Charge rate</TH>
              <TH numeric>Rate 2</TH>
              <TH numeric>Rate 3</TH>
              <TH>Notes</TH>
              {draft && <TH align="right"><span className="sr-only">Remove</span></TH>}
            </TR>
          </THead>
          <TBody>
            {draft
              ? draft.map((r) => {
                  const shown = draftCharge(r);
                  return (
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
                      <TD style={{ minWidth: 100 }}>
                        <span className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={r.markupPct}
                            onChange={(e) => update(r.key, "markupPct", e.target.value)}
                            onKeyDown={noSubmitOnEnter}
                            placeholder="0"
                            aria-label="Markup percent"
                            className="ta-field h-8 w-full rounded-md px-2 text-right"
                            style={{ ...cell, fontVariantNumeric: "tabular-nums" }}
                          />
                          <span style={muted}>%</span>
                        </span>
                      </TD>
                      <TD style={{ minWidth: 150 }}>
                        <span className="flex flex-col gap-1">
                          {r.chargeManual ? (
                            num(r.key, "chargeRate", r.chargeRate, "Charge rate")
                          ) : (
                            <span className="h-8 px-2 text-right leading-8" style={{ fontVariantNumeric: "tabular-nums", color: shown == null ? "var(--text-tertiary)" : "var(--text-primary)" }}>
                              {shown == null ? "—" : money(shown)}
                            </span>
                          )}
                          <label className="flex items-center justify-end gap-1.5" style={{ font: "var(--type-caption1)", color: "var(--text-secondary)" }}>
                            <input type="checkbox" checked={r.chargeManual} onChange={(e) => setManual(r.key, e.target.checked)} />
                            Set manually
                          </label>
                        </span>
                      </TD>
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
                  );
                })
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
                    <TD numeric data-label="Rate 1">{money(r.rate1)}</TD>
                    <TD numeric data-label="Markup">{percent(r.markupPct) || "—"}</TD>
                    <TD numeric data-label="Charge rate">
                      {money(r.chargeRate) || "—"}
                      {r.chargeManual && r.chargeRate != null && (
                        <span className="ml-1.5" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }} title="Set by hand, not worked out from the markup">
                          Manual
                        </span>
                      )}
                    </TD>
                    <TD numeric data-label="Rate 2">{money(r.rate2) || "—"}</TD>
                    <TD numeric data-label="Rate 3">{money(r.rate3) || "—"}</TD>
                    <TD className="ta-rates-note" data-empty={r.note ? undefined : "true"}>
                      <span className="block max-w-[320px] truncate" title={r.note ?? undefined} style={{ color: r.note ? "var(--text-secondary)" : "var(--text-tertiary)" }}>
                        {r.note || "—"}
                      </span>
                    </TD>
                  </TR>
                ))}
            {!draft && rows.length === 0 && (
              <TR>
                <TD colSpan={7} style={{ color: "var(--text-tertiary)" }}>No pay rates yet. Use Edit pay rates to add one.</TD>
              </TR>
            )}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
