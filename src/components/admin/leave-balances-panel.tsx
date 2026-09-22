"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Hourglass, Plus } from "lucide-react";
import {
  postAccrualCorrection,
  postManualAccrualEntry,
  getLeaveTypeLedgerDetail,
  type LedgerDetailEntry,
} from "@/actions/admin.actions";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Input,
  LinkButton,
  SegmentedControl,
  TBody,
  TD,
  TFoot,
  TH,
  THead,
  TR,
  Table,
  TableFooter,
  leaveTone,
} from "@/components/ui";

/**
 * The accrual ledger, on the design's doc template.
 *
 * <p>Three sections: the date range, the balances table, and the ledger for
 * whichever leave type is selected. The ledger used to open inline underneath
 * each row, several at once, with its own table nested inside the balances
 * table — which meant a wide ledger stretched the balance columns it was
 * nested in. One ledger, beside the row that owns it, is the shape the design
 * draws and the only one where both tables can size themselves.
 *
 * <p>Hours are two decimals throughout. This screen used to answer in
 * "64h 30m", which is the one format that cannot be checked against a
 * timesheet, the dashboard or the ADP export, and the accrual rates it has to
 * show — 3.08 hours a period — do not survive the conversion at all.
 */

interface BalanceRow {
  leaveTypeId: string;
  leaveTypeName: string;
  category: string;
  balanceMinutes: number;
  usedMinutes: number;
  accruedMinutes: number;
  approvedMinutes: number;
  pendingMinutes: number;
  postedMinutes: number;
  year: number;
  policyAnnualHours: number | null;
  policyName: string | null;
  policyRateMode: string | null;
  expectedAccrualMinutes: number | null;
  forecastedMinutes: number | null;
  forecastApplyToAvailable: boolean;
  netAdjustmentMinutes: number | null;
  accrualTracked: boolean;
}

interface Props {
  employeeId: string;
  balances: BalanceRow[];
  /** EMPLOYEE_MANAGE. Every write on this screen is gated on it server-side. */
  canManage: boolean;
}

/** Columns in the balances table — the section and expand rows span all of them. */
const BALANCE_COLS = 9;

/**
 * Minutes as decimal hours.
 *
 * <p>Rounds a sub-second negative to zero rather than to "-0.00", which is
 * what a balance that has been credited and debited the same amount produces.
 */
function hrs(minutes: number): string {
  const v = minutes / 60;
  return (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
}

/** A change rather than a level: the sign is the whole meaning, so it is kept. */
function delta(minutes: number): string {
  const s = hrs(minutes);
  return minutes > 0 ? `+${s}` : s;
}

/** Green up, red down — for figures that are a movement, never for a level. */
function deltaColor(minutes: number): string {
  if (minutes > 0) return "var(--text-success)";
  if (minutes < 0) return "var(--text-error)";
  return "var(--text-primary)";
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${parseInt(m)}/${parseInt(d)}/${y}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Hours available right now: booked and pending time is already spoken for. */
function availableMinutes(row: BalanceRow): number {
  const forecast =
    row.forecastApplyToAvailable && row.forecastedMinutes != null ? row.forecastedMinutes : 0;
  return row.balanceMinutes - row.approvedMinutes - row.pendingMinutes + forecast;
}

/** What the policy says should have posted by now, against what did. */
function accrualGap(row: BalanceRow): number | null {
  if (row.expectedAccrualMinutes === null) return null;
  const gap = row.expectedAccrualMinutes - row.accruedMinutes;
  // Under two minutes is rounding between the rate and the postings, not a gap.
  return Math.abs(gap) < 2 ? null : gap;
}

// ─── Amount field ─────────────────────────────────────────────────────────────

function SignToggle({ sign, onChange }: { sign: "+" | "-"; onChange: (s: "+" | "-") => void }) {
  return (
    /* The selected half used to be near-black. The design's selected state is
       the card surface lifted out of a gray track — the accent is reserved for
       actions, and a black fill on a sign toggle reads as a warning. */
    <SegmentedControl
      size="sm"
      ariaLabel="Sign"
      items={(["+", "-"] as const).map((s) => ({ value: s, label: s }))}
      value={sign}
      onChange={(v) => onChange(v as "+" | "-")}
    />
  );
}

/**
 * One signed hours-and-minutes amount.
 *
 * <p>Hours and minutes rather than a decimal because these are typed, not
 * read: a catch-up posting is "3 hours 5 minutes" on the policy sheet, and
 * asking somebody to enter 3.08 is asking them to enter 3.05 by mistake.
 */
function AmountField({
  label,
  hint,
  sign,
  onSign,
  hours,
  onHours,
  minutes,
  onMinutes,
}: {
  label: string;
  hint: string;
  sign: "+" | "-";
  onSign: (s: "+" | "-") => void;
  hours: string;
  onHours: (v: string) => void;
  minutes: string;
  onMinutes: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="wms-label">{label}</span>
      <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{hint}</span>
      <div className="flex items-center gap-1.5">
        <SignToggle sign={sign} onChange={onSign} />
        <div style={{ width: 76 }}>
          <Input
            type="number"
            min={0}
            placeholder="0"
            aria-label={`${label} — hours`}
            value={hours}
            onChange={(e) => onHours(e.target.value)}
          />
        </div>
        <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>h</span>
        <div style={{ width: 76 }}>
          <Input
            type="number"
            min={0}
            max={59}
            placeholder="0"
            aria-label={`${label} — minutes`}
            value={minutes}
            onChange={(e) => onMinutes(e.target.value)}
          />
        </div>
        <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>m</span>
      </div>
    </div>
  );
}

// ─── Add entry form ───────────────────────────────────────────────────────────

function AddEntryForm({
  row,
  employeeId,
  onClose,
}: {
  row: BalanceRow;
  employeeId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [effectiveDate, setEffectiveDate] = useState(todayIso);
  const [accrualSign, setAccrualSign] = useState<"+" | "-">("+");
  const [accrualH, setAccrualH] = useState("");
  const [accrualM, setAccrualM] = useState("");
  const [earnAdjSign, setEarnAdjSign] = useState<"+" | "-">("+");
  const [earnAdjH, setEarnAdjH] = useState("");
  const [earnAdjM, setEarnAdjM] = useState("");
  const [adjustSign, setAdjustSign] = useState<"+" | "-">("+");
  const [adjustH, setAdjustH] = useState("");
  const [adjustM, setAdjustM] = useState("");
  const [note, setNote] = useState("");

  const rawAccrual  = (parseInt(accrualH   || "0", 10) || 0) * 60 + (parseInt(accrualM   || "0", 10) || 0);
  const rawEarnAdj  = (parseInt(earnAdjH   || "0", 10) || 0) * 60 + (parseInt(earnAdjM   || "0", 10) || 0);
  const rawAdjust   = (parseInt(adjustH    || "0", 10) || 0) * 60 + (parseInt(adjustM    || "0", 10) || 0);
  const accrualMinutes    = rawAccrual * (accrualSign   === "+" ? 1 : -1);
  const adjustEarnMinutes = rawEarnAdj * (earnAdjSign   === "+" ? 1 : -1);
  const adjustMinutes     = rawAdjust  * (adjustSign    === "+" ? 1 : -1);
  const totalDelta = accrualMinutes + adjustEarnMinutes + adjustMinutes;
  const previewBalance = row.balanceMinutes + totalDelta;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await postManualAccrualEntry({
        employeeId,
        leaveTypeId: row.leaveTypeId,
        year: row.year,
        effectiveDate,
        accrualMinutes,
        adjustEarnMinutes,
        adjustMinutes,
        note,
      });
      if (!result.success) { setError((result as { success: false; error: string }).error); return; }
      onClose();
      router.refresh();
    });
  }

  const canSave = note.trim().length > 0 && (accrualMinutes !== 0 || adjustEarnMinutes !== 0 || adjustMinutes !== 0);

  return (
    <form
      onSubmit={handleSave}
      className="flex flex-col gap-3.5 px-4 py-3.5"
      style={{ background: "var(--surface-secondary)", borderBottom: "1px solid var(--stroke-divider)" }}
    >
      <span className="wms-overline">Add entry — {row.leaveTypeName}</span>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,30%)),1fr))]">
        <Input
          label="Effective Date"
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
        />
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(260px,30%)),1fr))]">
        <AmountField
          label="Accrual Hours"
          hint="Adds to the earned total — for missed or catch-up postings"
          sign={accrualSign} onSign={setAccrualSign}
          hours={accrualH} onHours={setAccrualH}
          minutes={accrualM} onMinutes={setAccrualM}
        />
        <AmountField
          label="Adjust Earn Hours"
          hint="Also counts toward accrued hours — for earn-rate corrections"
          sign={earnAdjSign} onSign={setEarnAdjSign}
          hours={earnAdjH} onHours={setEarnAdjH}
          minutes={earnAdjM} onMinutes={setEarnAdjM}
        />
        <AmountField
          label="Adjust Hours"
          hint="Balance only — for one-time grants and corrections"
          sign={adjustSign} onSign={setAdjustSign}
          hours={adjustH} onHours={setAdjustH}
          minutes={adjustM} onMinutes={setAdjustM}
        />
      </div>

      <Input
        label="Notes"
        required
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Catch-up for missed bi-weekly posting"
        hint="Stored on the ledger entry against your name."
      />

      {totalDelta !== 0 && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-2"
          style={{
            background: "var(--surface-card)",
            border: "1px solid var(--stroke-divider)",
            font: "var(--type-body2)",
            color: "var(--text-secondary)",
          }}
        >
          <span className="tabular">
            Balance {hrs(row.balanceMinutes)}
            {" → "}
            <span
              style={{
                fontWeight: "var(--weight-semibold)",
                color: previewBalance < 0 ? "var(--text-error)" : "var(--text-success)",
              }}
            >
              {hrs(previewBalance)}
            </span>
            {" h"}
          </span>
          {accrualMinutes !== 0 && (
            <span className="tabular" style={{ color: "var(--text-tertiary)" }}>
              Accrual {delta(accrualMinutes)}
            </span>
          )}
          {adjustEarnMinutes !== 0 && (
            <span className="tabular" style={{ color: "var(--text-tertiary)" }}>
              Earn adj. {delta(adjustEarnMinutes)}
            </span>
          )}
          {adjustMinutes !== 0 && (
            <span className="tabular" style={{ color: "var(--text-tertiary)" }}>
              Adj. {delta(adjustMinutes)}
            </span>
          )}
        </div>
      )}

      {error && (
        <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-error)" }}>{error}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending || !canSave}>
          {isPending ? "Saving…" : "Save entry"}
        </Button>
        <Button type="button" size="sm" hierarchy="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Accrual correction ───────────────────────────────────────────────────────

function CorrectionForm({
  row,
  employeeId,
  gap,
  onClose,
}: {
  row: BalanceRow;
  employeeId: string;
  gap: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handlePost(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await postAccrualCorrection({
        employeeId,
        leaveTypeId: row.leaveTypeId,
        year: row.year,
        deltaMinutes: gap,
        note,
      });
      if (!result.success) { setError((result as { success: false; error: string }).error); return; }
      onClose();
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handlePost}
      className="flex flex-col gap-3 px-4 py-3.5"
      style={{ background: "var(--surface-secondary)", borderBottom: "1px solid var(--stroke-divider)" }}
    >
      <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
        Posts an ADJUSTMENT of{" "}
        <span className="tabular" style={{ fontWeight: "var(--weight-semibold)", color: deltaColor(gap) }}>
          {delta(gap)} h
        </span>{" "}
        to bring accrued hours to {hrs(row.expectedAccrualMinutes ?? 0)} h.
      </span>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <Input
            label="Reason"
            required
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Catch-up for missed semi-monthly posting"
          />
        </div>
        <Button type="submit" size="sm" disabled={isPending || !note.trim()}>
          {isPending ? "Posting…" : "Post correction"}
        </Button>
        <Button type="button" size="sm" hierarchy="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>

      {error && (
        <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-error)" }}>{error}</p>
      )}
    </form>
  );
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

type DetailResult = {
  openingBalance: number;
  availableYears: number[];
  entries: LedgerDetailEntry[];
};

/**
 * One leave type's ledger: every posting, usage and adjustment.
 *
 * <p>The entry kind is plain text rather than a coloured pill. There is no
 * tone helper for ledger actions, and inventing a local colour map here is how
 * the status pills drifted apart in the first place — so the colour is spent
 * where it means something, on the sign of the change.
 *
 * <p>Mounted with the leave type as its key, so switching rows starts a clean
 * year selection and cache rather than showing the previous type's year.
 */
function LedgerCard({
  row,
  employeeId,
  canManage,
  fromDate,
  toDate,
}: {
  row: BalanceRow;
  employeeId: string;
  canManage: boolean;
  fromDate?: string;
  toDate?: string;
}) {
  const [selectedYear, setSelectedYear] = useState(row.year);
  const [result, setResult] = useState<DetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const cache = useRef<Map<number, DetailResult>>(new Map());

  useEffect(() => {
    const cached = cache.current.get(selectedYear);
    if (cached) { setResult(cached); return; }
    setLoading(true);
    setError(null);
    getLeaveTypeLedgerDetail({ employeeId, leaveTypeId: row.leaveTypeId, year: selectedYear })
      .then((res) => {
        if (res.success) { cache.current.set(selectedYear, res.data); setResult(res.data); }
        else setError((res as { success: false; error: string }).error);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, [employeeId, row.leaveTypeId, selectedYear]);

  const years = result?.availableYears ?? [row.year];
  const isFiltered = !!(fromDate || toDate);

  const allEntries = result?.entries ?? [];
  const entries = isFiltered
    ? allEntries.filter((e) => {
        if (fromDate && e.date < fromDate) return false;
        if (toDate && e.date > toDate) return false;
        return true;
      })
    : allEntries;

  // Opening balance for a filtered range is where the last entry before the
  // range left off, not where the year started.
  const openingBalance = (() => {
    if (!result) return 0;
    if (!fromDate) return result.openingBalance;
    const before = [...result.entries].reverse().find((e) => e.date < fromDate);
    return before ? before.runningBalance : result.openingBalance;
  })();

  const asOfBalance = entries.length > 0 ? entries[entries.length - 1].runningBalance : openingBalance;
  const gap = accrualGap(row);

  const rateLabel =
    row.policyAnnualHours == null
      ? "—"
      : row.policyRateMode === "PER_POSTING"
        ? `${row.policyAnnualHours.toFixed(2)} / period`
        : `${row.policyAnnualHours.toFixed(2)} / year`;

  const available = availableMinutes(row);

  // The design's summary strip, with the two figures it asks for that this app
  // does not hold — a balance cap and the next posting date — replaced by the
  // two it does: what has accrued this year, and what is actually spendable.
  const summary: { label: string; value: string; color?: string }[] = [
    { label: "Current Balance", value: `${hrs(row.balanceMinutes)} h` },
    { label: "Accrual Rate", value: rateLabel },
    { label: "Accrued This Year", value: `${hrs(row.accruedMinutes)} h` },
    isFiltered && toDate
      ? {
          label: `Balance as at ${fmtDate(toDate)}`,
          value: result ? `${hrs(asOfBalance)} h` : "—",
        }
      : {
          label: "Available",
          value: `${hrs(available)} h`,
          color: available < 0 ? "var(--text-error)" : undefined,
        },
  ];

  // Newest first, the way the ledger is read. The opening balance is the foot
  // of the table rather than another row in it — it is where the column starts
  // from, not something that happened.
  const newestFirst = [...entries].reverse();

  return (
    <Card
      title={`Ledger — ${row.leaveTypeName}`}
      subtitle={[
        row.policyName ?? "No policy",
        gap === null && row.expectedAccrualMinutes !== null ? "accrual on track" : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      padding={0}
      actions={
        <>
          <SegmentedControl
            size="sm"
            ariaLabel="Accrual year"
            items={years.map((y) => ({ value: String(y), label: String(y) }))}
            value={String(selectedYear)}
            onChange={(v) => setSelectedYear(Number(v))}
          />
          {canManage && (
            <Button
              size="sm"
              hierarchy="secondary"
              leadingIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => { setAddOpen((v) => !v); setFixOpen(false); }}
            >
              {addOpen ? "Cancel" : "Add entry"}
            </Button>
          )}
        </>
      }
    >
      <div
        className="grid gap-4 px-4 py-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))]"
        style={{ borderBottom: "1px solid var(--stroke-divider)" }}
      >
        {summary.map((s) => (
          <div key={s.label} className="flex min-w-0 flex-col gap-0.5">
            <span className="wms-label">{s.label}</span>
            <span
              className="tabular"
              style={{
                font: "var(--type-body1)",
                fontWeight: "var(--weight-medium)",
                color: s.color ?? "var(--text-primary)",
              }}
            >
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {gap !== null && (
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
          <Banner
            tone="warning"
            title="Accrual does not match the policy"
            body={`The policy should have posted ${hrs(row.expectedAccrualMinutes ?? 0)} h by now; the ledger has ${hrs(row.accruedMinutes)} h.`}
            meta={`Difference ${delta(gap)} h`}
            actions={
              canManage && !fixOpen ? (
                <Button size="sm" hierarchy="secondary" onClick={() => { setFixOpen(true); setAddOpen(false); }}>
                  Post correction
                </Button>
              ) : undefined
            }
          />
        </div>
      )}

      {canManage && fixOpen && gap !== null && (
        <CorrectionForm row={row} employeeId={employeeId} gap={gap} onClose={() => setFixOpen(false)} />
      )}

      {canManage && addOpen && (
        <AddEntryForm row={row} employeeId={employeeId} onClose={() => setAddOpen(false)} />
      )}

      {loading && (
        <p className="px-4 py-10 text-center" style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-tertiary)" }}>
          Loading…
        </p>
      )}

      {error && (
        <div className="px-4 py-3">
          <Banner tone="error" title="The ledger could not be loaded" body={error} />
        </div>
      )}

      {!loading && !error && result && (
        newestFirst.length === 0 ? (
          <EmptyState
            icon={<Hourglass className="h-8 w-8" />}
            title={isFiltered ? "No activity in this date range" : `No activity in ${selectedYear}`}
            body={
              isFiltered
                ? `Nothing posted, used or adjusted between the dates you chose. The balance carried into the range was ${hrs(openingBalance)} h.`
                : "Postings, leave taken and adjustments all appear here as they happen."
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Entry</TH>
                  <TH>Detail</TH>
                  <TH numeric>Change</TH>
                  <TH numeric>Balance</TH>
                  <TH>By</TH>
                </TR>
              </THead>
              <TBody>
                {newestFirst.map((e) => (
                  // Projected rows are dimmed rather than dropped: the running
                  // balance after them is what somebody booking leave in
                  // November is actually spending.
                  <TR key={e.id} style={e.isFuture ? { opacity: 0.6 } : undefined}>
                    <TD className="tabular" style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                      {fmtDate(e.date)}
                    </TD>
                    <TD>
                      <span className="flex items-center gap-2">
                        <span>{e.label}</span>
                        {e.isFuture && <Badge size="sm">Projected</Badge>}
                        {e.status === "PENDING" && (
                          <Badge tone={leaveTone("PENDING")} size="sm">Pending</Badge>
                        )}
                      </span>
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }} title={e.note ?? undefined}>
                      {/* Clamped on a block inside the cell: the table sizes to
                          max-content, so a max-width on the td is ignored and
                          one long note widens every column after it. */}
                      <div className="max-w-[260px] truncate">
                        {e.note ?? <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                      </div>
                    </TD>
                    <TD numeric style={{ fontWeight: "var(--weight-medium)", color: deltaColor(e.deltaMinutes) }}>
                      {delta(e.deltaMinutes)}
                    </TD>
                    <TD numeric style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-secondary)" }}>
                      {hrs(e.runningBalance)}
                    </TD>
                    <TD style={{ color: "var(--text-tertiary)" }}>
                      {e.createdByName ?? "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR>
                  <TD style={{ color: "var(--text-tertiary)" }}>—</TD>
                  <TD colSpan={2} style={{ fontWeight: "var(--weight-medium)", color: "var(--text-secondary)" }}>
                    {isFiltered ? "Balance carried into range" : "Opening balance"}
                  </TD>
                  <TD numeric style={{ color: "var(--text-tertiary)" }}>—</TD>
                  <TD numeric style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-secondary)" }}>
                    {hrs(openingBalance)}
                  </TD>
                  <TD />
                </TR>
              </TFoot>
            </Table>
            <TableFooter
              shown={newestFirst.length}
              total={isFiltered ? allEntries.length : newestFirst.length}
              label="entries"
            />
          </>
        )
      )}
    </Card>
  );
}

// ─── Balances table row ───────────────────────────────────────────────────────

function BalanceTableRow({
  row,
  selected,
  onSelect,
}: {
  row: BalanceRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const gap = accrualGap(row);
  const available = availableMinutes(row);
  const forecastInAvailable =
    row.forecastApplyToAvailable && row.forecastedMinutes != null && row.forecastedMinutes > 0;

  return (
    <TR onClick={onSelect} selected={selected}>
      <TD>
        <span className="flex items-center gap-2">
          <span style={{ fontWeight: "var(--weight-medium)", whiteSpace: "nowrap" }}>
            {row.leaveTypeName}
          </span>
          {gap !== null && (
            <Badge tone="warning" size="sm">
              {gap > 0 ? "Behind" : "Ahead"}
            </Badge>
          )}
        </span>
      </TD>

      <TD style={{ color: "var(--text-secondary)" }}>
        {row.policyName ? (
          <span className="flex flex-col">
            <span style={{ whiteSpace: "nowrap" }}>{row.policyName}</span>
            <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
              {row.policyRateMode === "PER_POSTING" ? "Per pay period" : "Per year"}
            </span>
          </span>
        ) : (
          <span style={{ color: "var(--text-tertiary)" }}>No policy</span>
        )}
      </TD>

      <TD numeric style={{ color: "var(--text-secondary)" }}>
        {row.policyAnnualHours != null
          ? row.policyAnnualHours.toFixed(2)
          : <span style={{ color: "var(--text-tertiary)" }}>—</span>}
      </TD>

      <TD numeric>{hrs(row.accruedMinutes)}</TD>

      <TD numeric style={{ color: "var(--text-accent)" }}>
        {row.forecastedMinutes != null
          ? delta(row.forecastedMinutes)
          : <span style={{ color: "var(--text-tertiary)" }}>—</span>}
      </TD>

      <TD
        numeric
        style={{
          color:
            row.netAdjustmentMinutes !== null
              ? deltaColor(row.netAdjustmentMinutes)
              : "var(--text-tertiary)",
        }}
      >
        {row.netAdjustmentMinutes !== null ? delta(row.netAdjustmentMinutes) : "—"}
      </TD>

      <TD numeric>
        <span className="flex flex-col items-end">
          <span>{hrs(row.approvedMinutes + row.postedMinutes)}</span>
          {row.pendingMinutes > 0 && (
            <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
              {hrs(row.pendingMinutes)} pending
            </span>
          )}
          {row.postedMinutes > 0 && (
            <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
              {hrs(row.postedMinutes)} on timecards
            </span>
          )}
        </span>
      </TD>

      <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>
        <span className="flex flex-col items-end">
          <span style={{ color: available < 0 ? "var(--text-error)" : "var(--text-primary)" }}>
            {hrs(available)}
          </span>
          {forecastInAvailable && (
            <span style={{ font: "var(--type-caption1)", fontWeight: "var(--weight-regular)", color: "var(--text-accent)" }}>
              incl. projected
            </span>
          )}
        </span>
      </TD>

      <TD align="right" style={{ width: 40 }}>
        <ChevronRight
          className="h-4 w-4"
          style={{ color: selected ? "var(--icon-accent)" : "var(--icon-tertiary)" }}
          aria-hidden="true"
        />
      </TD>
    </TR>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function LeaveBalancesPanel({ employeeId, balances, canManage }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [inputFrom, setInputFrom] = useState("");
  const [inputTo, setInputTo] = useState("");
  const [activeFrom, setActiveFrom] = useState("");
  const [activeTo, setActiveTo] = useState("");
  const isFiltered = !!(activeFrom || activeTo);

  function applyFilter() {
    setActiveFrom(inputFrom);
    setActiveTo(inputTo);
  }
  function clearFilter() {
    setInputFrom("");
    setInputTo("");
    setActiveFrom("");
    setActiveTo("");
  }

  const tracked   = balances.filter((r) => r.accrualTracked);
  const untracked = balances.filter((r) => !r.accrualTracked);
  const selected  = balances.find((r) => r.leaveTypeId === selectedId) ?? null;
  const year = balances[0]?.year;

  const shown = tracked.length + (otherOpen ? untracked.length : 0);

  return (
    <>
      <Card
        title="Date Range"
        subtitle="Narrows the ledger below and reports the balance as at the end date."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div style={{ width: 180 }}>
            <Input
              label="From"
              type="date"
              value={inputFrom}
              onChange={(e) => setInputFrom(e.target.value)}
            />
          </div>
          <div style={{ width: 180 }}>
            <Input
              label="To"
              type="date"
              value={inputTo}
              onChange={(e) => setInputTo(e.target.value)}
            />
          </div>
          <Button onClick={applyFilter} disabled={!inputFrom && !inputTo}>
            Apply
          </Button>
          {isFiltered && (
            <Button hierarchy="secondary" onClick={clearFilter}>
              Clear
            </Button>
          )}
          {isFiltered && (
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
              Showing activity
              {activeFrom ? ` from ${fmtDate(activeFrom)}` : ""}
              {activeTo ? ` to ${fmtDate(activeTo)}` : ""}.
            </span>
          )}
        </div>
      </Card>

      <Card
        title="Leave Balances"
        subtitle={
          balances.length > 0
            ? `Hours${year ? ` · ${year} accrual year` : ""} · open a row for its ledger`
            : undefined
        }
        padding={0}
      >
        {balances.length === 0 ? (
          <EmptyState
            icon={<Hourglass className="h-8 w-8" />}
            title="No active leave types"
            body="Nothing can accrue until at least one leave type exists."
            action={
              canManage ? (
                <LinkButton href="/admin/site-settings?tab=leave-types" hierarchy="secondary" size="sm">
                  Leave Types
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Leave Type</TH>
                  <TH>Policy</TH>
                  <TH numeric>Rate</TH>
                  <TH numeric>Accrued</TH>
                  <TH numeric>Forecast</TH>
                  <TH numeric>Net Adj.</TH>
                  <TH numeric>Booked</TH>
                  <TH numeric>Available</TH>
                  <TH align="right" />
                </TR>
              </THead>
              <TBody>
                {tracked.map((row) => (
                  <BalanceTableRow
                    key={row.leaveTypeId}
                    row={row}
                    selected={row.leaveTypeId === selectedId}
                    onSelect={() => setSelectedId(row.leaveTypeId)}
                  />
                ))}

                {untracked.length > 0 && (
                  <TR>
                    {/* A section break inside the table rather than a second
                        card: these are leave types with the same columns, and
                        splitting them out made the footer count below stop
                        matching what the page shows. */}
                    <TD
                      colSpan={BALANCE_COLS}
                      style={{ padding: 0, background: "var(--surface-secondary)" }}
                    >
                      <button
                        type="button"
                        onClick={() => setOtherOpen((v) => !v)}
                        className="flex w-full items-center gap-2 px-3.5 py-2 text-left"
                        style={{ background: "transparent", border: 0, cursor: "pointer" }}
                      >
                        {otherOpen
                          ? <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--icon-tertiary)" }} />
                          : <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--icon-tertiary)" }} />}
                        <span className="wms-overline">
                          Other leave types ({untracked.length})
                        </span>
                        <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                          not accrual-tracked
                        </span>
                      </button>
                    </TD>
                  </TR>
                )}

                {otherOpen &&
                  untracked.map((row) => (
                    <BalanceTableRow
                      key={row.leaveTypeId}
                      row={row}
                      selected={row.leaveTypeId === selectedId}
                      onSelect={() => setSelectedId(row.leaveTypeId)}
                    />
                  ))}
              </TBody>
            </Table>
            <TableFooter shown={shown} total={balances.length} label="leave types" />
          </>
        )}
      </Card>

      {selected ? (
        <LedgerCard
          // Keyed on the leave type so switching rows starts a fresh year
          // selection and cache rather than inheriting the previous one.
          key={selected.leaveTypeId}
          row={selected}
          employeeId={employeeId}
          canManage={canManage}
          fromDate={activeFrom || undefined}
          toDate={activeTo || undefined}
        />
      ) : (
        balances.length > 0 && (
          <Card title="Ledger" subtitle="Every posting, usage and adjustment" padding={0}>
            <EmptyState
              icon={<Hourglass className="h-8 w-8" />}
              title="Pick a leave type"
              body="Choose a row above to see how its balance was arrived at, entry by entry."
            />
          </Card>
        )
      )}
    </>
  );
}
