import { format } from "date-fns";
import { PUNCH_TYPE_LABEL } from "@/lib/state-machines/labels";
import { Badge, EmptyState, Table, THead, TBody, TR, TH, TD, TableFooter, statusTone } from "@/components/ui";
import { Clock } from "lucide-react";
import type { Punch, PunchSource } from "@prisma/client";

/**
 * A punch list, as the portal design draws a table: no card of its own.
 *
 * <p>The caller owns the surface. Both screens that use this already title
 * their own panel — "Today's Punches" on the Punch Clock, the list card on
 * Punch History — and a Card in here put a second rounded, shadowed surface
 * inside the first.
 *
 * <p>The design's history screen is one row per day (In / Out / Meal / Hours).
 * This is one row per punch, which is what the table actually holds: a day row
 * would have to pair punches up, and a day with a missing clock-out — the row
 * somebody opens this page to find — is exactly the one that cannot be paired.
 */

const SOURCE_LABEL: Record<PunchSource, string> = {
  WEB: "Web",
  KIOSK: "Kiosk",
  MOBILE: "Mobile",
  MANUAL: "Manual",
  SYSTEM: "System",
};

interface PunchHistoryTableProps {
  punches: Punch[];
  /** What "nothing here" means on this page. Today's punches vs the period's. */
  emptyTitle?: string;
  emptyBody?: string;
  /**
   * Allow the note column. On Punch History it is where a missed-punch request
   * carries its explanation; on a card of today's punches it would be a column
   * of blanks. It appears only when a row in this list actually has a note.
   */
  showNote?: boolean;
  /** Row noun for the footer count. Omit it and no footer is rendered. */
  footerLabel?: string;
}

export function PunchHistoryTable({
  punches,
  emptyTitle = "No punches this pay period",
  emptyBody,
  showNote = false,
  footerLabel,
}: PunchHistoryTableProps) {
  if (punches.length === 0) {
    return <EmptyState icon={<Clock className="h-8 w-8" />} title={emptyTitle} body={emptyBody} />;
  }

  // Only the periods that actually contain a correction or a missed-punch
  // request get the column. Most punches are a badge scan with nothing to say,
  // and a column of em dashes is a column nobody reads.
  const withNotes = showNote && punches.some((p) => p.note);

  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>Date</TH>
            <TH>Time</TH>
            <TH>Rounded</TH>
            <TH>Type</TH>
            <TH>Source</TH>
            {withNotes && <TH>Note</TH>}
            <TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          {punches.map((punch) => {
            const isSuperseded = !!punch.correctedById;
            const isCorrection = !!punch.correctsId;
            return (
              <TR
                key={punch.id}
                style={isSuperseded ? { opacity: 0.55, background: "var(--surface-tertiary)" } : undefined}
              >
                <TD>{format(punch.punchTime, "MMM d")}</TD>

                {/* Times are read down the column against each other, so they
                    get tabular figures. The raw time is struck through when a
                    correction has replaced it — the row stays so the edit
                    trail is visible, which is the point of keeping it. */}
                <TD
                  numeric
                  align="left"
                  style={
                    isSuperseded
                      ? { textDecoration: "line-through", color: "var(--text-tertiary)" }
                      : undefined
                  }
                >
                  {format(punch.punchTime, "h:mm:ss a")}
                </TD>
                <TD numeric align="left">
                  {format(punch.roundedTime, "h:mm a")}
                </TD>

                <TD>
                  <span className="inline-flex items-center gap-2">
                    {PUNCH_TYPE_LABEL[punch.punchType]}
                    {isCorrection && (
                      <Badge tone="info" size="sm">
                        Correction
                      </Badge>
                    )}
                  </span>
                </TD>

                <TD style={{ color: "var(--text-secondary)" }}>{SOURCE_LABEL[punch.source]}</TD>

                {withNotes && (
                  <TD style={{ color: "var(--text-secondary)" }} title={punch.note ?? undefined}>
                    {/* A note is free text up to 500 characters. Clipped to one
                        line with the full text on hover, so one long
                        explanation cannot set the width of the whole table. */}
                    <span className="block max-w-[280px] truncate">{punch.note ?? "—"}</span>
                  </TD>
                )}

                <TD>
                  {isSuperseded ? (
                    // Deliberately toneless. A superseded punch is not a state
                    // anyone is waiting on, and colouring it would compete with
                    // the correction row that replaced it.
                    <Badge size="sm">Superseded</Badge>
                  ) : (
                    <Badge tone={statusTone(punch.isApproved ? "APPROVED" : "PENDING")} size="sm" dot>
                      {punch.isApproved ? "Approved" : "Pending"}
                    </Badge>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      {footerLabel && (
        <TableFooter shown={punches.length} total={punches.length} label={footerLabel} />
      )}
    </>
  );
}
