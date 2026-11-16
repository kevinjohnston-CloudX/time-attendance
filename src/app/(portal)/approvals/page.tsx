import { redirect } from "next/navigation";
import { SESSION_ENDED_HREF } from "@/lib/auth.config";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { TIMECARD_EDITORS } from "@/lib/rbac/permissions";
import { getPendingTimecardEdits, getTimecardEditPreview } from "@/actions/timecard-edit.actions";
import { ApprovalsHeading, type ApprovalsView } from "@/components/approvals/approvals-heading";
import { TimecardEditsScreen } from "@/components/approvals/timecard-edits-screen";
import { LeaveSection, type LeaveParams } from "./leave-section";

/**
 * Approvals (11/11): what waits on this person's decision, in two queues.
 *
 * <p>Leave requests, as Team Leave showed them (the leave page sends here
 * now), and timecard edits: supervisors' changes waiting for HR
 * (lib/timecards/supervisor-edits). HR and payroll approve the edits; a
 * supervisor sees their team's waiting and may take one back. Whoever can do
 * neither goes to their dashboard.
 *
 * <p>This address was a phone-only list of everything waiting (the phone's
 * Approvals tab); Team Overview and the Dashboard still lead with that list.
 */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<LeaveParams & { view?: string; timesheet?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(SESSION_ENDED_HREF);
  const sp = (await searchParams) ?? {};

  const [approvesLeave, editor, supervisor] = await Promise.all([
    userHasPermission(session.user, "LEAVE_APPROVE_TEAM"),
    Promise.all(TIMECARD_EDITORS.map((p) => userHasPermission(session.user, p))).then((a) => a.some(Boolean)),
    userHasPermission(session.user, "PUNCH_FIX_MISSED_TEAM"),
  ]);
  const seesEdits = editor || supervisor;
  const views: ApprovalsView[] = [...(approvesLeave ? ["leave" as const] : []), ...(seesEdits ? ["timecards" as const] : [])];
  if (views.length === 0) redirect("/dashboard");
  const view: ApprovalsView = sp.view === "timecards" && seesEdits ? "timecards" : views[0];

  const edits = seesEdits ? await getPendingTimecardEdits({}) : null;
  const requests = edits?.success ? edits.data : [];
  const heading = <ApprovalsHeading view={view} views={views} leaveCount={null} timecardCount={seesEdits ? requests.length : null} />;

  if (view === "leave") return <LeaveSection user={session.user} params={sp} heading={heading} />;

  // The timecard picked, else the one waiting longest: the queue is worked from the top.
  const selectedId = requests.some((r) => r.timesheetId === sp.timesheet) ? sp.timesheet! : (requests[0]?.timesheetId ?? null);
  const preview = selectedId ? await getTimecardEditPreview({ timesheetId: selectedId }) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="ta-pin ta-canvas sticky top-0 z-20 flex flex-col gap-0.5 pb-3">
        {heading}
        <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
          {requests.length === 0
            ? "No timecard edits waiting"
            : `${requests.length} ${requests.length === 1 ? "timecard has" : "timecards have"} supervisor changes waiting for ${editor ? "you" : "approval"}`}
        </p>
      </div>
      <TimecardEditsScreen
        requests={requests}
        selectedId={selectedId}
        preview={preview?.success ? preview.data : null}
        mode={editor ? "decide" : "send"}
      />
    </div>
  );
}
