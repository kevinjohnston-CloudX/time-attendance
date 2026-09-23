"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import {
  resolveException,
  addMissingPunchForEmployee,
  correctPunchAndResolve,
  getPunchesForTimesheet,
} from "@/actions/supervisor.actions";
import type { PunchType } from "@prisma/client";

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

export function ExceptionActionPanel({ exceptionId, exceptionType, timesheetId, occurredAt }: Props) {
  const [mode, setMode] = useState<"add" | "correct" | "resolve" | null>(null);

  // Lazy-loaded punches — fetched only when the user opens an action
  const [punches, setPunches] = useState<Punch[]>([]);
  const [punchesLoaded, setPunchesLoaded] = useState(false);
  const [loadingPunches, setLoadingPunches] = useState(false);

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

  // Punches for the exception date (derived from lazy-loaded state)
  const exDateStr = format(occurredAt, "yyyy-MM-dd");
  const dayPunches = punches.filter(
    (p) => format(p.roundedTime, "yyyy-MM-dd") === exDateStr
  );
  const clockIn = dayPunches.find((p) => p.punchType === "CLOCK_IN") ?? null;
  const clockOut = dayPunches.find((p) => p.punchType === "CLOCK_OUT") ?? null;

  async function loadPunches(): Promise<Punch[]> {
    if (punchesLoaded) return punches;
    setLoadingPunches(true);
    const result = await getPunchesForTimesheet({ timesheetId });
    const loaded: Punch[] = result.success ? (result.data as Punch[]) : [];
    setPunches(loaded);
    setPunchesLoaded(true);
    setLoadingPunches(false);
    return loaded;
  }

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

  function handleOpenAdd() {
    startTransition(async () => {
      const loaded = await loadPunches();
      const dayPs = loaded.filter((p) => format(p.roundedTime, "yyyy-MM-dd") === exDateStr);
      const ci = dayPs.find((p) => p.punchType === "CLOCK_IN") ?? null;
      const co = dayPs.find((p) => p.punchType === "CLOCK_OUT") ?? null;
      setMode("add");
      if (isAbsent) {
        // Both punches missing — let user click whichever side they want first
        setRowSide(null);
        setEditTimeStr("");
        setEditReason("");
        setEditError(null);
      } else {
        // MISSING_PUNCH — auto-open the missing side
        const missingSide = !co ? "out" : !ci ? "in" : "out";
        setRowSide(missingSide);
        setEditingExistingId(null);
        setEditTimeStr("");
        setEditAmPm(missingSide === "in" ? "AM" : "PM");
        setEditReason("");
        setEditError(null);
      }
    });
  }

  function handleRowSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseTimeInput(editTimeStr);
    if (!parsed) {
      setEditError("Invalid time — enter something like 8:30 or 530");
      return;
    }
    let { hours, minutes } = parsed;
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

  // Time cell renderer — shows time as clickable button or inline editor
  function TimeCell({ side, punch }: { side: "in" | "out"; punch: Punch | null }) {
    const isEditing = mode === "add" && rowSide === side;
    const label = side === "in" ? "Clock In" : "Clock Out";

    if (isEditing) {
      return (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <input
              value={editTimeStr}
              onChange={(e) => setEditTimeStr(e.target.value)}
              placeholder="8:30"
              autoFocus
              className="w-14 rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
            <button
              type="button"
              onClick={() => setEditAmPm((p) => p === "AM" ? "PM" : "AM")}
              className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs font-medium dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            >
              {editAmPm}
            </button>
          </div>
        </div>
      );
    }

    if (punch) {
      return (
        <button
          type="button"
          onClick={() => { setMode("add"); startRowEdit(side, punch); }}
          className="rounded px-1 py-0.5 text-xs hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
          title={`Edit ${label}`}
        >
          {format(punch.roundedTime, "h:mm a")}
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => { setMode("add"); startRowEdit(side, null); }}
        className="rounded px-1 py-0.5 text-xs font-medium text-amber-500 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
        title={`Add ${label}`}
      >
        Missed
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Action buttons */}
      {mode === null && (
        <div className="flex flex-wrap gap-2">
          {usesPunchRow ? (
            <button
              onClick={handleOpenAdd}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              {isAbsent ? "Add Punches" : "Add Missing Punch"}
            </button>
          ) : (
            <button
              onClick={() => {
                startTransition(async () => {
                  const loaded = await loadPunches();
                  setMode("correct");
                  const p = loaded[0];
                  if (p) {
                    setSelectedPunchId(p.id);
                    setNewPunchTime(toDatetimeLocal(p.roundedTime));
                  }
                });
              }}
              disabled={loadingPunches}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-40"
            >
              {loadingPunches ? "Loading…" : "Correct a Punch"}
            </button>
          )}
          <button
            onClick={() => setMode("resolve")}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Resolve with Note
          </button>
        </div>
      )}

      {/* Punch row editor (MISSING_PUNCH add mode) */}
      {mode === "add" && (
        <form onSubmit={handleRowSubmit} className="rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-700">
                <th className="px-3 py-1.5 text-left text-xs font-medium text-zinc-500">Date</th>
                <th className="px-3 py-1.5 text-left text-xs font-medium text-zinc-500">In</th>
                <th className="px-3 py-1.5 text-left text-xs font-medium text-zinc-500">Out</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium">{format(occurredAt, "EEE")}</span>{" "}
                  {format(occurredAt, "MM/dd/yyyy")}
                </td>
                <td className="px-3 py-2">
                  <TimeCell side="in" punch={clockIn} />
                </td>
                <td className="px-3 py-2">
                  <TimeCell side="out" punch={clockOut} />
                </td>
              </tr>
            </tbody>
          </table>

          <div className="flex flex-col gap-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
            <input
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="Reason…"
              required
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
            {editError && <span className="text-xs text-red-500">{editError}</span>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending || !editTimeStr.trim() || !editReason.trim()}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isPending ? "Saving…" : editingExistingId ? "Correct & Resolve" : "Add & Resolve"}
              </button>
              <button
                type="button"
                onClick={() => { setMode(null); setRowSide(null); setEditingExistingId(null); }}
                className="text-xs text-zinc-500 hover:text-zinc-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Correct existing punch (non-MISSING_PUNCH) */}
      {mode === "correct" && (
        <form
          onSubmit={handleCorrectPunch}
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30"
        >
          <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">Correct a Punch</p>
          <div className="flex flex-col gap-2">
            <select
              value={selectedPunchId}
              onChange={(e) => {
                setSelectedPunchId(e.target.value);
                const p = punches.find((x) => x.id === e.target.value);
                if (p) setNewPunchTime(toDatetimeLocal(p.roundedTime));
              }}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            >
              {punches.map((p) => (
                <option key={p.id} value={p.id}>
                  {PUNCH_LABEL[p.punchType] ?? p.punchType} — {format(p.roundedTime, "MMM d, h:mm a")}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">New time:</span>
              <input
                type="datetime-local"
                value={newPunchTime}
                onChange={(e) => setNewPunchTime(e.target.value)}
                required
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              />
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for correction…"
              required
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
            <div className="flex gap-2">
              <button type="submit" disabled={isPending || !selectedPunchId || !newPunchTime || !reason.trim()}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                {isPending ? "Saving…" : "Correct & Resolve"}
              </button>
              <button type="button" onClick={() => setMode(null)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400">
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Resolve with note */}
      {mode === "resolve" && (
        <form onSubmit={handleResolve} className="flex items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Resolution note…"
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          />
          <button type="submit" disabled={isPending || !note.trim()}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-900 disabled:opacity-50 dark:bg-zinc-600 dark:hover:bg-zinc-500">
            {isPending ? "Saving…" : "Resolve"}
          </button>
          <button type="button" onClick={() => setMode(null)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400">
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
