"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import {
  resolveException,
  addMissingPunchForEmployee,
  correctPunchAndResolve,
  getExceptionPunches,
} from "@/actions/supervisor.actions";
import type { PunchType } from "@prisma/client";
import { Button, Input, Select, TBody, TD, TH, THead, TR, Table } from "@/components/ui";

/**
 * The three ways an exception leaves this screen: add the punch that is
 * missing, correct the punch that is wrong, or resolve it with a note because
 * the hours as recorded are right.
 *
 * <p>Every one of them writes to a timecard that payroll will pay from, which
 * is why none of them is a single click — each opens a form, and each needs a
 * reason before it will submit.
 */

interface Punch {
  id: string;
  punchType: PunchType;
  roundedTime: Date;
}

interface Props {
  exceptionId: string;
  exceptionType: string;
  timesheetId: string;
  occurredAt: Date;
  /**
   * Whether the timesheet has any punches at all.
   *
   * <p>The punches themselves are not sent with the page. One screen can hold
   * a few thousand of these panels, and carrying every sheet's punches into
   * all of them is what made this page 25MB. The collapsed panel only needs
   * to know whether there is anything to correct; the rest is fetched when a
   * form is opened.
   */
  hasPunches: boolean;
}

const PUNCH_LABEL: Record<string, string> = {
  CLOCK_IN: "Clock In", MEAL_START: "Meal Start", MEAL_END: "Meal End",
  CLOCK_OUT: "Clock Out", BREAK_START: "Break Start", BREAK_END: "Break End",
};

function parseTimeInput(str: string): { hours: number; minutes: number } | null {
  const s = str.trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(":")) {
    const [hPart, mPart] = s.split(":");
    const h = parseInt(hPart, 10);
    const m = parseInt(mPart, 10);
    if (!isNaN(h) && !isNaN(m) && h >= 1 && h <= 12 && m >= 0 && m < 60) return { hours: h, minutes: m };
    return null;
  }
  if (s.length <= 2) {
    const h = parseInt(s, 10);
    if (!isNaN(h) && h >= 1 && h <= 12) return { hours: h, minutes: 0 };
    return null;
  }
  if (s.length === 3 || s.length === 4) {
    const h = parseInt(s.slice(0, s.length - 2), 10);
    const m = parseInt(s.slice(-2), 10);
    if (!isNaN(h) && !isNaN(m) && h >= 1 && h <= 12 && m >= 0 && m < 60) return { hours: h, minutes: m };
    return null;
  }
  return null;
}

export function ExceptionActionPanel({ exceptionId, exceptionType, timesheetId, occurredAt, hasPunches }: Props) {
  const [mode, setMode] = useState<"add" | "correct" | "resolve" | null>(null);

  // Fetched the first time a form that needs them is opened, then kept.
  const [punches, setPunches] = useState<Punch[]>([]);
  const [isLoadingPunches, setLoadingPunches] = useState(false);

  /**
   * The day's punches, fetched once.
   *
   * <p>Returns them rather than relying on state, because the caller decides
   * which side of the row to open from what came back and state is not
   * readable yet in the same tick.
   */
  async function loadPunches(): Promise<Punch[]> {
    if (punches.length > 0) return punches;
    setLoadingPunches(true);
    try {
      const result = await getExceptionPunches({ timesheetId });
      const rows = result.success && result.data ? result.data : [];
      setPunches(rows);
      return rows;
    } finally {
      setLoadingPunches(false);
    }
  }

  // Row-style punch editor state (for MISSING_PUNCH add mode)
  const [rowSide, setRowSide] = useState<"in" | "out" | null>(null);
  const [editingExistingId, setEditingExistingId] = useState<string | null>(null);
  const [editTimeStr, setEditTimeStr] = useState("");
  const [editAmPm, setEditAmPm] = useState<"AM" | "PM">("AM");
  const [editReason, setEditReason] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Correct-a-punch form state (non-MISSING_PUNCH)
  const [selectedPunchId, setSelectedPunchId] = useState("");
  const [newPunchTime, setNewPunchTime] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isMissingPunch = exceptionType === "MISSING_PUNCH";
  const isAbsent = exceptionType === "ABSENT";
  const usesPunchRow = isMissingPunch || isAbsent;

  // Punches for the exception date
  const exDateStr = format(occurredAt, "yyyy-MM-dd");
  const dayPunches = punches.filter(
    (p) => format(p.roundedTime, "yyyy-MM-dd") === exDateStr
  );
  const clockIn = dayPunches.find((p) => p.punchType === "CLOCK_IN") ?? null;
  const clockOut = dayPunches.find((p) => p.punchType === "CLOCK_OUT") ?? null;

  function startRowEdit(side: "in" | "out", existingPunch: Punch | null) {
    setRowSide(side);
    setEditingExistingId(existingPunch?.id ?? null);
    if (existingPunch) {
      const d = existingPunch.roundedTime;
      const h24 = d.getHours();
      const mins = d.getMinutes();
      const ampm: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
      const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
      setEditTimeStr(`${h12}:${String(mins).padStart(2, "0")}`);
      setEditAmPm(ampm);
    } else {
      setEditTimeStr("");
      setEditAmPm(side === "in" ? "AM" : "PM");
    }
    setEditReason("");
    setEditError(null);
  }

  async function handleOpenAdd() {
    // Which side is missing is decided from the rows that just came back,
    // not from state, which has not been applied yet in this tick.
    const rows = await loadPunches();
    setMode("add");
    if (isAbsent) {
      // Both punches missing — let user click whichever side they want first
      setRowSide(null);
      setEditTimeStr("");
      setEditReason("");
      setEditError(null);
    } else {
      // MISSING_PUNCH — auto-open the missing side
      const onDay = rows.filter((p) => format(p.roundedTime, "yyyy-MM-dd") === exDateStr);
      const hasIn  = onDay.some((p) => p.punchType === "CLOCK_IN");
      const hasOut = onDay.some((p) => p.punchType === "CLOCK_OUT");
      const missingSide = !hasOut ? "out" : !hasIn ? "in" : "out";
      startRowEdit(missingSide, null);
    }
  }

  function handleRowSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseTimeInput(editTimeStr);
    if (!parsed) {
      setEditError("Invalid time — enter something like 8:30 or 530");
      return;
    }
    const { minutes } = parsed;
    let { hours } = parsed;
    if (editAmPm === "PM" && hours !== 12) hours += 12;
    if (editAmPm === "AM" && hours === 12) hours = 0;
    const punchDate = new Date(occurredAt);
    punchDate.setHours(hours, minutes, 0, 0);
    setEditError(null);

    startTransition(async () => {
      let result: { success: boolean; error?: string };
      if (editingExistingId) {
        result = await correctPunchAndResolve({
          originalPunchId: editingExistingId,
          newPunchTime: punchDate.toISOString(),
          reason: editReason,
          exceptionId,
        });
      } else {
        const punchType: PunchType = rowSide === "in" ? "CLOCK_IN" : "CLOCK_OUT";
        result = await addMissingPunchForEmployee({
          timesheetId,
          exceptionId,
          punchType,
          punchTime: punchDate.toISOString(),
          reason: editReason,
        });
      }
      if (!result.success) setEditError(result.error ?? "Failed");
    });
  }

  function toDatetimeLocal(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function handleCorrectPunch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await correctPunchAndResolve({
        originalPunchId: selectedPunchId,
        newPunchTime: new Date(newPunchTime).toISOString(),
        reason, exceptionId,
      });
      if (!result.success) setError(result.error ?? "Failed");
    });
  }

  function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await resolveException({ exceptionId, resolution: note });
      if (!result.success) setError(result.error ?? "Failed");
    });
  }

  /**
   * One side of the punch row: the recorded time, or "Missed" where there is
   * none, or the editor once you click either.
   *
   * <p>A plain function rather than a component, because a component declared
   * in here is a new type on every keystroke — React would tear the input down
   * and rebuild it, and the caret would jump to the end of whatever you were
   * halfway through typing.
   */
  function timeCell(side: "in" | "out", punch: Punch | null) {
    const label = side === "in" ? "Clock In" : "Clock Out";

    if (mode === "add" && rowSide === side) {
      return (
        <span className="flex items-center gap-1.5">
          <input
            value={editTimeStr}
            onChange={(e) => setEditTimeStr(e.target.value)}
            placeholder="8:30"
            aria-label={`${label} time`}
            autoFocus
            className="ta-cell"
            style={{ width: 72, minWidth: 0 }}
          />
          <Button
            hierarchy="secondary"
            size="sm"
            style={{ height: 28 }}
            onClick={() => setEditAmPm((p) => (p === "AM" ? "PM" : "AM"))}
          >
            {editAmPm}
          </Button>
        </span>
      );
    }

    if (punch) {
      return (
        <Button
          hierarchy="tertiary"
          size="sm"
          title={`Edit ${label}`}
          onClick={() => { setMode("add"); startRowEdit(side, punch); }}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {format(punch.roundedTime, "h:mm a")}
        </Button>
      );
    }

    return (
      <Button
        hierarchy="tertiary"
        size="sm"
        title={`Add ${label}`}
        onClick={() => { setMode("add"); startRowEdit(side, null); }}
        style={{ color: "var(--text-warning)" }}
      >
        Missed
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {error && (
        <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-error)" }}>{error}</p>
      )}

      {mode === null && (
        <div className="flex flex-wrap gap-2">
          {usesPunchRow ? (
            <Button size="sm" disabled={isLoadingPunches} onClick={handleOpenAdd}>
              {isAbsent ? "Add Punches" : "Add Missing Punch"}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!hasPunches || isLoadingPunches}
              onClick={async () => {
                const rows = await loadPunches();
                setMode("correct");
                const p = rows[0];
                if (p) {
                  setSelectedPunchId(p.id);
                  setNewPunchTime(toDatetimeLocal(p.roundedTime));
                }
              }}
            >
              Correct a Punch
            </Button>
          )}
          <Button hierarchy="secondary" size="sm" onClick={() => setMode("resolve")}>
            Resolve with Note
          </Button>
        </div>
      )}

      {/* Add or correct the day's clock in / clock out, laid out the way the
          timecard itself is — so the supervisor is looking at the same row
          they would fix it on. */}
      {mode === "add" && (
        <form
          onSubmit={handleRowSubmit}
          className="overflow-hidden"
          style={{
            border: "1px solid var(--stroke-secondary)",
            borderRadius: "var(--radius-m)",
            background: "var(--surface-secondary)",
          }}
        >
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>In</TH>
                <TH>Out</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD style={{ whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: "var(--weight-medium)" }}>{format(occurredAt, "EEE")}</span>{" "}
                  <span className="tabular" style={{ color: "var(--text-secondary)" }}>
                    {format(occurredAt, "MM/dd/yyyy")}
                  </span>
                </TD>
                <TD style={{ paddingLeft: 8, paddingRight: 8 }}>{timeCell("in", clockIn)}</TD>
                <TD style={{ paddingLeft: 8, paddingRight: 8 }}>{timeCell("out", clockOut)}</TD>
              </TR>
            </TBody>
          </Table>

          {/* No top rule here — the punch row's own cell border is already
              drawing one, and the two stack into a 2px line. */}
          <div className="flex flex-col gap-2 px-3 py-2.5">
            <Input
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="Reason…"
              aria-label="Reason"
              required
            />
            {/* Not hung off the reason field: what fails here is usually the
                time in the row above, and an error under the wrong control is
                how somebody retypes a reason that was fine. */}
            {editError && (
              <span style={{ font: "var(--type-caption1)", color: "var(--text-error)" }}>{editError}</span>
            )}
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={isPending || !editTimeStr.trim() || !editReason.trim()}
              >
                {isPending ? "Saving…" : editingExistingId ? "Correct & Resolve" : "Add & Resolve"}
              </Button>
              <Button
                hierarchy="tertiary"
                size="sm"
                onClick={() => { setMode(null); setRowSide(null); setEditingExistingId(null); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Correct an existing punch. Warning-toned, because unlike the row
          above this one replaces a time that is already on the timecard. */}
      {mode === "correct" && (
        <form
          onSubmit={handleCorrectPunch}
          className="flex flex-col gap-2.5 p-3"
          style={{
            border: "1px solid var(--stroke-warning)",
            borderRadius: "var(--radius-m)",
            background: "var(--surface-warning)",
          }}
        >
          <span
            style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", color: "var(--text-warning)" }}
          >
            Correct a Punch
          </span>

          <Select
            aria-label="Punch to correct"
            value={selectedPunchId}
            onChange={(e) => {
              setSelectedPunchId(e.target.value);
              const p = punches.find((x) => x.id === e.target.value);
              if (p) setNewPunchTime(toDatetimeLocal(p.roundedTime));
            }}
          >
            {punches.map((p) => (
              <option key={p.id} value={p.id}>
                {PUNCH_LABEL[p.punchType] ?? p.punchType} — {format(p.roundedTime, "MMM d, h:mm a")}
              </option>
            ))}
          </Select>

          {/* Explicit id: the label is what makes this field clickable, and a
              panel is rendered per exception card — two cards open on "Correct
              a Punch" at once would otherwise share one generated id, so the
              second card's label would focus the first card's input. */}
          <Input
            id={`correct-time-${exceptionId}`}
            label="New time"
            type="datetime-local"
            value={newPunchTime}
            onChange={(e) => setNewPunchTime(e.target.value)}
            required
          />

          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for correction…"
            aria-label="Reason for correction"
            required
          />

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !selectedPunchId || !newPunchTime || !reason.trim()}
            >
              {isPending ? "Saving…" : "Correct & Resolve"}
            </Button>
            <Button hierarchy="secondary" size="sm" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "resolve" && (
        <form onSubmit={handleResolve} className="flex flex-wrap items-center gap-2">
          <div className="min-w-[200px] flex-1">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Resolution note…"
              aria-label="Resolution note"
            />
          </div>
          <Button type="submit" size="sm" disabled={isPending || !note.trim()}>
            {isPending ? "Saving…" : "Resolve"}
          </Button>
          <Button hierarchy="secondary" size="sm" onClick={() => setMode(null)}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  );
}
