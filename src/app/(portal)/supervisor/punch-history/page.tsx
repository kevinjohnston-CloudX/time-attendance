import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { loadTeamPunchHistory, type PunchHistoryParams } from "@/lib/punch-history/punch-history-data";
import { PunchHistoryScreen } from "@/components/supervisor/punch-history-screen";

/**
 * Team Punch History.
 *
 * <p>The permission check is here; who may be seen, the date range and every
 * number on the screen are in the loader, which the export reads too.
 */
export default async function TeamPunchHistoryPage({
  searchParams,
}: {
  searchParams: Promise<PunchHistoryParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "PUNCH_VIEW_TEAM")) redirect("/dashboard");

  const data = await loadTeamPunchHistory(session.user, await searchParams);
  return <PunchHistoryScreen data={data} />;
}
