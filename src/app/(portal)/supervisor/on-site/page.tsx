import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getOnSiteBoard, getOnSiteSites } from "@/actions/presence.actions";
import { OnSiteBoard } from "@/components/presence/on-site-board";
import { gateReadsCloudTimeSchedule } from "@/lib/presence/gate-schedule";

/**
 * On Site: who is in the building right now, for HR and loss prevention.
 *
 * <p>Two views of the same people: who is where right now, and the scan log
 * of every security gate and time clock scan today.
 *
 * <p>This half picks the site and draws the first snapshot on the server, so
 * the page opens full rather than empty-then-full. From then on the board
 * polls every 30 seconds on its own; the server keeps no timer.
 *
 * <p>The permission is checked here for the page and again inside every
 * action the board calls, because the board polls with whatever site id the
 * browser sends.
 */
export default async function OnSitePage({
  searchParams,
}: {
  searchParams: Promise<{
    site?: string;
    status?: string;
    dept?: string;
    shift?: string;
    view?: string;
    sort?: string;
    group?: string;
    tab?: string;
    scans?: string;
    day?: string;
    flag?: string;
    order?: string;
    open?: string;
    people?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await userHasPermission(session.user, "PRESENCE_VIEW_ANY"))) redirect("/dashboard");

  const params = (await searchParams) ?? {};
  const sitesResult = await getOnSiteSites(undefined);
  if (!sitesResult.success) redirect("/dashboard");

  const { sites, defaultSiteId } = sitesResult.data;
  const siteId = sites.some((s) => s.id === params.site) ? params.site! : defaultSiteId;

  const boardResult = siteId ? await getOnSiteBoard({ siteId }) : null;
  const [canEditPhotos, canSchedule] = await Promise.all([
    userHasPermission(session.user, "PRESENCE_PHOTO_EDIT"),
    userHasPermission(session.user, "EMPLOYEE_MANAGE"),
  ]);
  // A failure here is a real fault, not an empty building: the error boundary
  // says so and offers a retry, rather than drawing a board of zeros.
  if (boardResult && !boardResult.success) throw new Error(boardResult.error);

  return (
    <OnSiteBoard
      sites={sites}
      initialSiteId={siteId}
      initialBoard={boardResult?.success ? boardResult.data : null}
      canEditPhotos={canEditPhotos}
      scheduling={canSchedule ? { live: gateReadsCloudTimeSchedule() } : null}
      initialFilters={{
        status: params.status ?? null,
        dept: params.dept ?? null,
        shift: params.shift ?? null,
        view: params.view === "list" ? "list" : params.view === "compact" ? "compact" : "photos",
        sort: params.sort ?? null,
        group: params.group ?? null,
        tab: params.tab ?? null,
        scans: params.scans ?? null,
        day: params.day ?? null,
        flag: params.flag ?? null,
        order: params.order ?? null,
        open: params.open ?? null,
        people: params.people ?? null,
      }}
    />
  );
}
