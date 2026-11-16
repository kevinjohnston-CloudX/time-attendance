"use client";

import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { decideTimesheetEdits, withdrawTimecardEdit } from "@/actions/timecard-edit.actions";
import { editsSeen } from "@/lib/timecards/supervisor-edit-rules";
import { Button, Checkbox, Textarea } from "@/components/ui";

/** A supervisor's request as the timecard shows it (payroll/timecards page). */
export type EditRequestView = {
  id: string;
  status: string;
  submittedBy: string;
  createdAt: string;
  reason: string;
  decisionNote: string | null;
  items: {
    id: string;
    kind: string;
    status: string;
    error: string | null;
    punchId: string | null;
    punchType: string | null;
    at: string | null;
    endAt: string | null;
    /** "yyyy-MM-dd", the person's own day. */
    day: string;
    minutes: number | null;
    waive: boolean | null;
    /** When it last changed: a supervisor putting it right changes it (editsSeen). */
    updatedAt: string;
    /** The change in words: "Change clock in 7:31 AM to 7:30 AM". */
    text: string;
  }[];
};

const dayLabel = (day: string) => format(parseISO(day), "EEE, MMM d");

/**
 * HR's decision on every supervisor change waiting on a timecard (John,
 * 11/12): each ticked to approve, unticked to turn down with one note, one
 * button for all. `items` are what HR is looking at, so the decision is
 * refused if a supervisor changes any of them meanwhile (editsSeen). A
 * supervisor takes their changes back one at a time.
 */
export function useEditDecision(timesheetId: string, items: { id: string; updatedAt: string }[], onChanged: () => void) {
  const [approve, setApprove] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const turningDown = items.filter((i) => !approve.has(i.id)).length;
  const label = turningDown === 0
    ? "Approve"
    : approve.size === 0
      ? (turningDown === 1 ? "Turn down" : "Turn down all")
      : `Approve ${approve.size}, turn down ${turningDown}`;

  function toggle(id: string, on: boolean) {
    setApprove((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  }

  function decide() {
    const reject = items.filter((i) => !approve.has(i.id)).map((i) => i.id);
    if (reject.length > 0 && !note.trim()) {
      setError("Say why, for the changes you turn down. The supervisor reads it.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await decideTimesheetEdits({ timesheetId, rejectItemIds: reject, note: note.trim() || undefined, seen: editsSeen(items) });
      if (!r.success) { setError(r.error); return; }
      if (r.data.failed.length > 0) setError(`${r.data.failed.length} could not be applied: ${r.data.failed.map((f: { error: string }) => f.error).join(" ")}`);
      onChanged();
    });
  }

  function takeBack(itemId: string) {
    setError(null);
    startTransition(async () => {
      const r = await withdrawTimecardEdit({ itemId });
      if (!r.success) { setError(r.error); return; }
      onChanged();
    });
  }

  return { approve, toggle, turnDownAll: () => setApprove(new Set()), note, setNote, error, isPending, turningDown, label, decide, takeBack };
}

export type EditDecision = ReturnType<typeof useEditDecision>;

/** Approve or Turn down, for every change waiting on the timecard. */
export function DecisionButtons({ d }: { d: EditDecision }) {
  return (
    <span className="flex items-center gap-2">
      <Button size="sm" pending={d.isPending} disabled={d.isPending} onClick={d.decide}>
        {d.label}
      </Button>
      {d.turningDown === 0 && (
        <Button hierarchy="secondary" size="sm" disabled={d.isPending} onClick={d.turnDownAll}>
          Turn down…
        </Button>
      )}
    </span>
  );
}

/** The note when anything is turned down, and what went wrong, if anything. */
export function DecisionNote({ d }: { d: EditDecision }) {
  return (
    <>
      {d.turningDown > 0 && (
        <span className="w-full min-w-0 sm:max-w-md">
          <Textarea aria-label="Why the changes are turned down" placeholder="Why, for the supervisor" value={d.note} onChange={(e) => d.setNote(e.target.value)} rows={2} />
        </span>
      )}
      {d.error && <span role="alert" style={{ font: "var(--type-caption1)", color: "var(--text-error)" }}>{d.error}</span>}
    </>
  );
}

/**
 * Supervisors' changes waiting for HR on this timecard (11/11), one line
 * until opened: they are on the grid already, in blue. Opened, every one with
 * its day and the reason it was sent with; HR approves them together, or
 * unticks those to turn down and says why, and a supervisor may take one back.
 * Decided ones leave the list: the day's notes say what HR did and why.
 */
export function EditRequestsPanel({
  timesheetId,
  requests,
  mode,
  onChanged,
}: {
  timesheetId: string | null;
  requests: EditRequestView[];
  /** decide: HR and payroll; send: the supervisor; view: anyone else. */
  mode: "decide" | "send" | "view";
  onChanged: () => void;
}) {
  const items = requests
    .filter((r) => r.status === "PENDING")
    .flatMap((r) => r.items.filter((i) => i.status === "PENDING").map((i) => ({ ...i, reason: r.reason, sender: r.submittedBy })))
    .sort((a, b) => a.day.localeCompare(b.day));
  // One line until opened: the changes are on the grid already, in blue, and
  // a long list here pushed the timecard down the page.
  const [open, setOpen] = useState(false);
  if (!timesheetId || items.length === 0) return null;
  const from = [...new Set(items.map((i) => i.sender))];
  return (
    <section
      aria-label="Changes sent for approval"
      className="flex shrink-0 flex-col gap-3 px-5 py-2.5"
      style={{ borderBottom: "1px solid var(--stroke-divider)", background: "var(--surface-info)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}>
          <strong style={{ fontWeight: "var(--weight-semibold)" }}>
            {items.length} {items.length === 1 ? "change" : "changes"} waiting for approval from {from.join(", ")}.
          </strong>
        </span>
        <Button hierarchy="tertiary" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : mode === "decide" ? "Review" : "Show"}
        </Button>
      </div>
      {open && <Waiting key={items.map((i) => i.id + i.updatedAt).join()} timesheetId={timesheetId} items={items} mode={mode} onChanged={onChanged} />}
    </section>
  );
}

function Waiting({
  timesheetId,
  items,
  mode,
  onChanged,
}: {
  timesheetId: string;
  items: (EditRequestView["items"][number] & { reason: string; sender: string })[];
  mode: "decide" | "send" | "view";
  onChanged: () => void;
}) {
  const d = useEditDecision(timesheetId, items, onChanged);
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}>
            {mode === "decide" ? (
              <Checkbox checked={d.approve.has(i.id)} onChange={(on) => d.toggle(i.id, on)} label={`${dayLabel(i.day)}: ${i.text}`} />
            ) : (
              <span>{dayLabel(i.day)}: {i.text}</span>
            )}
            <span style={{ color: "var(--text-secondary)" }}>&ldquo;{i.reason}&rdquo; ({i.sender})</span>
            {mode === "send" && (
              <Button hierarchy="tertiary" size="sm" disabled={d.isPending} onClick={() => d.takeBack(i.id)}>
                Take back
              </Button>
            )}
          </li>
        ))}
      </ul>
      {mode === "decide" && <DecisionButtons d={d} />}
      <DecisionNote d={d} />
    </div>
  );
}
