"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePayRates, type PayRateRow } from "@/actions/pay-rate.actions";
import { chargeFor } from "@/lib/charge-rate";

/** One editable line: numbers kept as typed until Save. */
export type DraftRate = {
  key: string;
  effectiveDate: string;
  rate1: string;
  rate2: string;
  rate3: string;
  /** Percent as typed: "32" is 32%. */
  markupPct: string;
  /** Typed only when the charge rate is set by hand. */
  chargeRate: string;
  chargeManual: boolean;
  note: string;
};
type TextField = Exclude<keyof DraftRate, "key" | "chargeManual">;

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
let nextKey = 0;
const blank = (defaultMarkupPct: number | null): DraftRate => ({
  key: `new-${nextKey++}`,
  effectiveDate: today(),
  rate1: "",
  rate2: "",
  rate3: "",
  // A new rate starts from the markup in the person's agency agreement.
  markupPct: defaultMarkupPct == null ? "" : String(defaultMarkupPct),
  chargeRate: "",
  chargeManual: false,
  note: "",
});
const toDraft = (r: PayRateRow): DraftRate => ({
  key: `row-${nextKey++}`,
  effectiveDate: r.effectiveDate,
  rate1: String(r.rate1),
  rate2: r.rate2 == null ? "" : String(r.rate2),
  rate3: r.rate3 == null ? "" : String(r.rate3),
  markupPct: r.markupPct == null ? "" : String(r.markupPct),
  chargeRate: r.chargeRate == null ? "" : String(r.chargeRate),
  chargeManual: r.chargeManual,
  note: r.note ?? "",
});

/** "$15.00", or "" for no value. */
export const money = (n: number | null) =>
  n == null ? "" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "32%" or "" for no markup. */
export const percent = (n: number | null) => (n == null ? "" : `${Number(n.toFixed(3))}%`);

/** "2026-07-27" as "07/27/2026", read as a calendar day. */
export const usDate = (day: string) => {
  const [y, m, d] = day.split("-");
  return `${m}/${d}/${y}`;
};

/** The charge rate a draft line will be saved with, as the server works it out. */
export function draftCharge(r: DraftRate): number | null {
  if (r.chargeManual) return r.chargeRate.trim() === "" ? null : Number(r.chargeRate);
  const rate1 = Number(r.rate1);
  if (!(rate1 > 0) || r.markupPct.trim() === "") return null;
  return chargeFor(rate1, Number(r.markupPct));
}

/** The row in effect today: the latest one effective on or before it. */
export function currentRow(rows: PayRateRow[]): PayRateRow | null {
  const t = today();
  return rows.filter((r) => r.effectiveDate <= t).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null;
}

/** The Pay Rates table's state: read rows, an editable draft, and Save. */
export function usePayRates(employeeId: string, initial: PayRateRow[], defaultMarkupPct: number | null = null) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [draft, setDraft] = useState<DraftRate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const edit = () => { setError(null); setDraft(rows.length ? rows.map(toDraft) : [blank(defaultMarkupPct)]); };
  const cancel = () => { setError(null); setDraft(null); };
  const add = () => setDraft((d) => [blank(defaultMarkupPct), ...(d ?? [])]);
  const remove = (key: string) => setDraft((d) => (d ?? []).filter((r) => r.key !== key));
  const update = (key: string, field: TextField, value: string) =>
    setDraft((d) => (d ?? []).map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  /** Switch a line between a calculated charge rate and one set by hand, starting from what it shows. */
  const setManual = (key: string, manual: boolean) =>
    setDraft((d) =>
      (d ?? []).map((r) => {
        if (r.key !== key) return r;
        const shown = draftCharge(r);
        return { ...r, chargeManual: manual, chargeRate: manual && r.chargeRate === "" && shown != null ? String(shown) : r.chargeRate };
      }),
    );

  function save() {
    if (!draft) return;
    setError(null);
    const parsed: PayRateRow[] = [];
    for (const r of draft) {
      const empty = !r.effectiveDate && !r.rate1 && !r.rate2 && !r.rate3 && !r.note && !r.markupPct && !r.chargeRate;
      if (empty) continue;
      if (!r.effectiveDate) return setError("Every row needs an effective date.");
      const rate1 = Number(r.rate1);
      if (!r.rate1 || !(rate1 > 0)) return setError(`Enter Rate 1 for ${usDate(r.effectiveDate)}.`);
      const opt = (v: string) => (v.trim() === "" ? null : Number(v));
      const rate2 = opt(r.rate2);
      const rate3 = opt(r.rate3);
      if ((rate2 !== null && !(rate2 > 0)) || (rate3 !== null && !(rate3 > 0))) return setError("Rates must be more than 0.");
      const markupPct = opt(r.markupPct);
      if (markupPct !== null && !(markupPct >= 0)) return setError(`The markup for ${usDate(r.effectiveDate)} can't be below 0%.`);
      const chargeRate = r.chargeManual ? opt(r.chargeRate) : null;
      if (r.chargeManual && !(chargeRate !== null && chargeRate > 0)) {
        return setError(`Enter the charge rate for ${usDate(r.effectiveDate)}, or untick Set manually to work it out from the markup.`);
      }
      parsed.push({
        effectiveDate: r.effectiveDate, rate1, rate2, rate3,
        markupPct, chargeRate, chargeManual: r.chargeManual,
        note: r.note.trim() || null,
      });
    }
    startTransition(async () => {
      const res = await savePayRates({ employeeId, rows: parsed });
      if (!res.success) return setError(res.error);
      setRows(res.data);
      setDraft(null);
      router.refresh();
    });
  }

  return { rows, draft, error, pending, edit, cancel, add, remove, update, setManual, save };
}

/** Enter inside a rate field must not submit the employee form around the table. */
export const noSubmitOnEnter = (e: React.KeyboardEvent) => {
  if (e.key === "Enter") e.preventDefault();
};
