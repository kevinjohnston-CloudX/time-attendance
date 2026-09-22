import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getMyLeaveRequests, getMyLeaveBalances } from "@/actions/leave.actions";
import { LEAVE_STATUS_LABEL, type LeaveRequestStatusValue } from "@/lib/state-machines/labels";
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Toolbar,
  leaveTone,
} from "@/components/ui";
import { format, parseISO } from "date-fns";
import { CalendarOff } from "lucide-react";
import { LeaveCalendar } from "@/components/leave/leave-calendar";
import { CancelLeaveButton } from "@/components/leave/cancel-leave-button";

/**
 * My Leave, as the portal design lays it out: the list template, with this
 * year's balances above it and the month view underneath.
 *
 * <p>Balances lead because the question that brings people here is almost
 * never "what did I file" — it is "how much have I got left", and that number
 * was previously three cards down and rendered smaller than the request list.
 *
 * <p>The table is every request except the cancelled ones, which is what this
 * page has always shown. A cancelled request is not a record of anything that
 * happened; leaving them in made a list of five requests look like a list of
 * nine.
 */

// @db.Date fields come back as UTC midnight — extract YYYY-MM-DD and parse as local midnight.
function fmtDate(d: Date | string, fmt: string) {
  const iso = (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  return format(parseISO(iso), fmt);
}

/** The balance row: four up on a wide screen, one up on a phone. */
const BALANCE_GRID =
  "grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,23%)),1fr))]";

export default async function MyLeavePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "LEAVE_REQUEST_OWN")) redirect("/dashboard");

  const [requestsResult, balancesResult] = await Promise.all([
    getMyLeaveRequests(),
    getMyLeaveBalances(),
  ]);

  if (!requestsResult.success || !balancesResult.success) redirect("/dashboard");

  const requests = requestsResult.data;
  const balances = balancesResult.data;

  // Approved leave is already spoken for and comes off the remaining figure;
  // pending is shown beside it but not deducted, because a request the
  // supervisor has not looked at yet is not hours you have lost.
  const approvedByType: Record<string, number> = {};
  const pendingByType: Record<string, number> = {};
  for (const r of requests) {
    if (r.status === "APPROVED") {
      approvedByType[r.leaveTypeId] = (approvedByType[r.leaveTypeId] ?? 0) + r.durationMinutes;
    } else if (r.status === "PENDING") {
      pendingByType[r.leaveTypeId] = (pendingByType[r.leaveTypeId] ?? 0) + r.durationMinutes;
    }
  }

  const listed = requests.filter((req) => req.status !== "CANCELLED");

  // A supervisor's note only exists once somebody has reviewed a request, and
  // on a list of three that is usually nobody. Carrying the column anyway gives
  // the table a whole column of em dashes.
  const showNotes = listed.some((req) => req.reviewNote);

  // Serialize dates for client component — send as YYYY-MM-DD so the client
  // can parse them as local midnight (avoids UTC-offset day shift).
  const calendarRequests = requests.map((r) => ({
    id: r.id,
    status: r.status,
    startDate: (r.startDate instanceof Date ? r.startDate.toISOString() : String(r.startDate)).slice(0, 10),
    endDate:   (r.endDate   instanceof Date ? r.endDate.toISOString()   : String(r.endDate)).slice(0, 10),
    leaveType: { name: r.leaveType.name },
    durationMinutes: r.durationMinutes,
  }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="My Leave"
        subtitle="Balances, requests and upcoming time off"
        actions={
          <LinkButton href="/leave/request" hierarchy="primary">
            Request Leave
          </LinkButton>
        }
      />

      {balances.length > 0 && (
        <div className={BALANCE_GRID}>
          {balances.map((b) => {
            const totalMinutes     = b.balanceMinutes + b.usedMinutes;
            const approvedMinutes  = approvedByType[b.leaveTypeId] ?? 0;
            const pendingMinutes   = pendingByType[b.leaveTypeId] ?? 0;
            const remainingMinutes = Math.max(0, totalMinutes - b.usedMinutes - approvedMinutes);
            const booked = [
              approvedMinutes > 0 ? `${(approvedMinutes / 60).toFixed(2)} h booked` : null,
              pendingMinutes  > 0 ? `${(pendingMinutes  / 60).toFixed(2)} h pending` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <StatCard
                key={b.id}
                label={b.leaveType.name}
                value={(remainingMinutes / 60).toFixed(2)}
                sub={`hours left${booked ? ` · ${booked}` : ""}`}
              />
            );
          })}
        </div>
      )}

      {/* No view tabs and no search: this list is your own requests and runs to
          a handful of rows. The count still earns its place — it is the only
          thing that says whether the table below is short or empty. */}
      <Toolbar count={listed.length} countLabel="request" />

      <Card padding={0}>
        {listed.length === 0 ? (
          <EmptyState
            icon={<CalendarOff className="h-8 w-8" />}
            // "No requests" and "nothing left after the cancelled ones came
            // out" are different answers, and only one of them means you have
            // not asked for your time off yet.
            title={requests.length > 0 ? "No open leave requests" : "No leave requests"}
            body={
              requests.length > 0
                ? "Every request you have filed was cancelled. Cancelled requests are not listed here."
                : "Requests you file appear here with their status, and stay visible until they are posted to payroll."
            }
            action={
              <LinkButton href="/leave/request" hierarchy="primary" size="sm">
                Request Leave
              </LinkButton>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Leave Type</TH>
                <TH>Dates</TH>
                <TH numeric>Hours</TH>
                <TH>Filed</TH>
                {showNotes && <TH>Review Note</TH>}
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {listed.map((req) => (
                <TR key={req.id}>
                  <TD style={{ fontWeight: "var(--weight-medium)" }}>{req.leaveType.name}</TD>
                  <TD style={{ color: "var(--text-secondary)" }}>
                    {fmtDate(req.startDate, "MMM d")} – {fmtDate(req.endDate, "MMM d, yyyy")}
                  </TD>
                  <TD numeric>{(req.durationMinutes / 60).toFixed(2)}</TD>
                  {/* createdAt is a real timestamp, not @db.Date, so it is
                      formatted in site time rather than pulled apart as UTC. */}
                  <TD style={{ color: "var(--text-secondary)" }}>
                    {format(req.createdAt, "MMM d, yyyy")}
                  </TD>
                  {showNotes && (
                    <TD style={{ color: "var(--text-secondary)" }} title={req.reviewNote ?? undefined}>
                      {/* The clamp is on a block inside the cell: the table
                          sizes to max-content, so a max-width on the td itself
                          is ignored and one long note widens the whole list. */}
                      <div className="max-w-[280px] truncate">{req.reviewNote ?? "—"}</div>
                    </TD>
                  )}
                  <TD>
                    <Badge tone={leaveTone(req.status)} size="sm">
                      {LEAVE_STATUS_LABEL[req.status as LeaveRequestStatusValue]}
                    </Badge>
                  </TD>
                  <TD align="right">
                    {/* Self-cancel stops at PENDING. Once a supervisor has
                        approved it the hours are already off the balance, and
                        putting them back is their action, not this button. */}
                    {req.status === "PENDING" && <CancelLeaveButton leaveRequestId={req.id} />}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card title="Leave Calendar" subtitle="Your booked and pending days, month by month">
        <LeaveCalendar requests={calendarRequests} />
      </Card>
    </div>
  );
}
