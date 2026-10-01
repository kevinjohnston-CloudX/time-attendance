"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePayRates, type PayRateRow } from "@/actions/pay-rate.actions";

/** One editable line: numbers kept as typed until Save. */
export type DraftRate = { key: string; effectiveDate: string; rate1: string; rate2: string; rate3: string; note: string };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
let nextKey = 0;
const blank = (): DraftRate => ({ key: `new-${nextKey++}`, effectiveDate: today(), rate1: "", rate2: "", rate3: "", note: "" });
const toDraft = (r: PayRateRow): DraftRate => ({
  key: `row-${nextKey++}`,
  effectiveDate: r.effectiveDate,
  rate1: String(r.rate1),
  rate2: r.rate2 == null ? "" : String(r.rate2),
  rate3: r.rate3 == null ? "" : String(r.rate3),
  note: r.note ?? "",
});

/** "$15.00", or "" for no value. */
export const money = (n: number | null) =>
  n == null ? "" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2026-07-27" as "07/27/2026", read as a calendar day. */
export const usDate = (day: string) => {
  const [y, m, d] = day.split("-");
  return `${m}/${d}/${y}`;
};

/** The row in effect today: the latest one effective on or before it. */
export function currentRow(rows: PayRateRow[]): PayRateRow | null {
  const t = today();
  return rows.filter((r) => r.effectiveDate <= t).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null;
}

/** The Pay Rates table's state: read rows, an editable draft, and Save. */
export function usePayRates(employeeId: string, initial: PayRateRow[]) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [draft, setDraft] = useState<DraftRate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const edit = () => { setError(null); setDraft(rows.length ? rows.map(toDraft) : [blank()]); };
  const cancel = () => { setError(null); setDraft(null); };
  const add = () => setDraft((d) => [blank(), ...(d ?? [])]);
  const remove = (key: string) => setDraft((d) => (d ?? []).filter((r) => r.key !== key));
  const update = (key: string, field: keyof Omit<DraftRate, "key">, value: string) =>
    setDraft((d) => (d ?? []).map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  function save() {
    if (!draft) return;
    setError(null);
    const parsed: PayRateRow[] = [];
    for (const r of draft) {
      const empty = !r.effectiveDate && !r.rate1 && !r.rate2 && !r.rate3 && !r.note;
      if (empty) continue;
      if (!r.effectiveDate) return setError("Every row needs an effective date.");
      const rate1 = Number(r.rate1);
      if (!r.rate1 || !(rate1 > 0)) return setError(`Enter Rate 1 for ${usDate(r.effectiveDate)}.`);
      const opt = (v: string) => (v.trim() === "" ? null : Number(v));
      const rate2 = opt(r.rate2);
      const rate3 = opt(r.rate3);
      if ((rate2 !== null && !(rate2 > 0)) || (rate3 !== null && !(rate3 > 0))) return setError("Rates must be more than 0.");
      parsed.push({ effectiveDate: r.effectiveDate, rate1, rate2, rate3, note: r.note.trim() || null });
    }
    startTransition(async () => {
      const res = await savePayRates({ employeeId, rows: parsed });
      if (!res.success) return setError(res.error);
      setRows(res.data);
      setDraft(null);
      router.refresh();
    });
  }

  return { rows, draft, error, pending, edit, cancel, add, remove, update, save };
}

/** Enter inside a rate field must not submit the employee form around the table. */
export const noSubmitOnEnter = (e: React.KeyboardEvent) => {
  if (e.key === "Enter") e.preventDefault();
};
