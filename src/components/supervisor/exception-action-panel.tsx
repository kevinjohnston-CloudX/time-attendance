"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import {
  resolveException,
  addMissingPunchForEmployee,
  correctPunchAndResolve,
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
  punches: Punch[];
}

const PUNCH_TYPE_OPTIONS: { value: PunchType; label: string }[] = [
  { value: "CLOCK_IN", label: "Clock In" },
  { value: "MEAL_START", label: "Meal Start" },
  { value: "MEAL_END", label: "Meal End" },
  { value: "CLOCK_OUT", label: "Clock Out" },
  { value: "BREAK_START", label: "Break Start" },
  { value: "BREAK_END", label: "Break End" },
];

const PUNCH_LABEL: Record<string, string> = {
  CLOCK_IN: "Clock In", MEAL_START: "Meal Start", MEAL_END: "Meal End",
  CLOCK_OUT: "Clock Out", BREAK_START: "Break Start", BREAK_END: "Break End",
};

function toDatetimeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ExceptionActionPanel({ exceptionId, exceptionType, timesheetId, punches }: Props) {
  const [mode, setMode] = useState<"add" | "correct" | "resolve" | null>(null);
  const [punchType, setPunchType] = useState<PunchType>("CLOCK_OUT");
  const [punchTime, setPunchTime] = useState("");
  const [selectedPunchId, setSelectedPunchId] = useState(punches[0]?.id ?? "");
  const [newPunchTime, setNewPunchTime] = useState(punches[0] ? toDatetimeLocal(punches[0].roundedTime) : "");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isMissingPunch = exceptionType === "MISSING_PUNCH";

  function handleAddPunch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addMissingPunchForEmployee({
        timesheetId, exceptionId, punchType,
        punchTime: new Date(punchTime).toISOString(),
        reason,
      });
      if (!result.success) setError(result.error);
    });
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
      if (!result.success) setError(result.error);
    });
  }

  function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await resolveException({ exceptionId, resolution: note });
      if (!result.success) setError(result.error);
    });
  }

  return (
    <div className="mt-3 space-y-2">
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Action selection */}
      {mode === null && (
        <div className="flex flex-wrap gap-2">
          {isMissingPunch ? (
            <button
              onClick={() => setMode("add")}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Add Missing Punch
            </button>
          ) : (
            <button
              onClick={() => setMode("correct")}
              disabled={punches.length === 0}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-40"
            >
              Correct a Punch
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

      {/* Add missing punch form */}
      {mode === "add" && (
        <form
          onSubmit={handleAddPunch}
          className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30"
        >
          <p className="mb-2 text-sm font-medium text-blue-800 dark:text-blue-300">
            Add Missing Punch
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <select
                value={punchType}
                onChange={(e) => setPunchType(e.target.value as PunchType)}
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              >
                {PUNCH_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={punchTime}
                onChange={(e) => setPunchTime(e.target.value)}
                required
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              />
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason / note…"
              required
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending || !punchTime || !reason.trim()}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isPending ? "Saving…" : "Add Punch & Resolve"}
              </button>
              <button
                type="button"
                onClick={() => setMode(null)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Correct existing punch form */}
      {mode === "correct" && (
        <form
          onSubmit={handleCorrectPunch}
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30"
        >
          <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            Correct a Punch
          </p>
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
              <button
                type="submit"
                disabled={isPending || !selectedPunchId || !newPunchTime || !reason.trim()}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {isPending ? "Saving…" : "Correct & Resolve"}
              </button>
              <button
                type="button"
                onClick={() => setMode(null)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Resolve with note only */}
      {mode === "resolve" && (
        <form onSubmit={handleResolve} className="flex items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Resolution note…"
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          />
          <button
            type="submit"
            disabled={isPending || !note.trim()}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-900 disabled:opacity-50 dark:bg-zinc-600 dark:hover:bg-zinc-500"
          >
            {isPending ? "Saving…" : "Resolve"}
          </button>
          <button
            type="button"
            onClick={() => setMode(null)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
