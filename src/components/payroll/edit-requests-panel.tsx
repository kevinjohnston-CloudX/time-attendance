"use client";

import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { decideTimecardEdits, withdrawTimecardEdit } from "@/actions/timecard-edit.actions";
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
    /** The change in words: "Change clock in 7:31 AM to 7:30 AM". */
    text: string;
  }[];
};

const dayLabel = (day: string) => format(parseISO(day), "EEE, MMM d");

/**
 * Supervisors' changes on this timecard waiting for HR (11/11). HR approves a
 * request, or unticks the changes to turn down and says why; a supervisor sees
 * what waits and may take a change back. Decided ones leave the list: the
 * day's notes say what HR did and why.
 */
export function EditRequestsPanel({
  requests,
  mode,
  onChanged,
}: {
  requests: EditRequestView[];
  /** decide: HR and payroll; send: the supervisor; view: anyone else. */
  mode: "decide" | "send" | "view";
  onChanged: () => void;
}) {
  const pending = requests.filter((r) => r.status === "PENDING" && r.items.some((i) => i.status === "PENDING"));
  // One line until opened: the changes are on the grid already, in blue, and
  // a long list here pushed the timecard down the page.
  const [open, setOpen] = useState(false);
  if (pending.length === 0) return null;
  const waiting = pending.reduce((n, r) => n + r.items.filter((i) => i.status === "PENDING").length, 0);
  const from = [...new Set(pending.map((r) => r.submittedBy))];
  const summary = `${waiting} ${waiting === 1 ? "change" : "changes"} waiting for HR approval${from.length ? ` from ${from.join(", ")}` : ""}`;
  return (
    <section
      aria-label="Changes sent for HR approval"
      className="flex shrink-0 flex-col gap-3 px-5 py-2.5"
      style={{ borderBottom: "1px solid var(--stroke-divider)", background: "var(--surface-info)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}>
          <strong style={{ fontWeight: "var(--weight-semibold)" }}>{summary}.</strong>
        </span>
        <Button hierarchy="tertiary" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : mode === "decide" && waiting > 0 ? "Review" : "Show"}
        </Button>
      </div>
      {open && pending.map((r) => (
        <PendingRequest key={r.id} request={r} mode={mode} onChanged={onChanged} />
      ))}
    </section>
  );
}

function PendingRequest({ request, mode, onChanged }: { request: EditRequestView; mode: "decide" | "send" | "view"; onChanged: () => void }) {
  const items = request.items.filter((i) => i.status === "PENDING");
  const [approve, setApprove] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const turningDown = items.filter((i) => !approve.has(i.id));

  function decide() {
    const reject = turningDown.map((i) => i.id);
    if (reject.length > 0 && !note.trim()) {
      setError("Say why, for the changes you turn down. The supervisor reads it.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await decideTimecardEdits({ requestId: request.id, rejectItemIds: reject, note: note.trim() || undefined });
      if (!r.success) { setError(r.error); return; }
      if (r.data.failed.length > 0) setError(`${r.data.failed.length} could not be applied: ${r.data.failed.map((f) => f.error).join(" ")}`);
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

  const approveLabel = turningDown.length === 0
    ? "Approve"
    : approve.size === 0
      ? (turningDown.length === 1 ? "Turn down" : "Turn down all")
      : `Approve ${approve.size}, turn down ${turningDown.length}`;

  return (
    <div className="flex flex-col gap-2">
      <span style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}>
        {request.submittedBy}, {format(parseISO(request.createdAt), "MMM d, h:mm a")}: &ldquo;{request.reason}&rdquo;
      </span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2" style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}>
            {mode === "decide" ? (
              <Checkbox
                checked={approve.has(i.id)}
                onChange={(on) => setApprove((prev) => { const n = new Set(prev); if (on) n.add(i.id); else n.delete(i.id); return n; })}
                label={`${dayLabel(i.day)}: ${i.text}`}
              />
            ) : (
              <span>{dayLabel(i.day)}: {i.text}</span>
            )}
            {mode === "send" && (
              <Button hierarchy="tertiary" size="sm" disabled={isPending} onClick={() => takeBack(i.id)}>
                Take back
              </Button>
            )}
          </li>
        ))}
      </ul>
      {mode === "decide" && (
        <div className="flex flex-wrap items-end gap-2">
          {turningDown.length > 0 && (
            <span className="w-full min-w-0 sm:w-80">
              <Textarea
                aria-label="Why the changes are turned down"
                placeholder="Why, for the supervisor"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </span>
          )}
          <Button size="sm" pending={isPending} disabled={isPending} onClick={decide}>
            {approveLabel}
          </Button>
          {turningDown.length === 0 && (
            <Button hierarchy="secondary" size="sm" disabled={isPending} onClick={() => { setApprove(new Set()); }}>
              Turn down…
            </Button>
          )}
        </div>
      )}
      {error && <span role="alert" style={{ font: "var(--type-caption1)", color: "var(--text-error)" }}>{error}</span>}
    </div>
  );
}
