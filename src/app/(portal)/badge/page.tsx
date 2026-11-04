import { redirect } from "next/navigation";
import { IdCard } from "lucide-react";
import { auth } from "@/lib/auth";
import { getIdBadge } from "@/lib/badge/badge.service";
import { IdBadge } from "@/components/badge/id-badge";
import { KeepScreenOn } from "@/components/badge/keep-screen-on";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The signed in person's own badge, and nobody else's: the employee id comes
 * from the session, never from the address.
 */
export default async function MyBadgePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const badge = session.user.employeeId ? await getIdBadge(session.user.employeeId) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader pinned title="My Badge" subtitle="Hold the code up to the scanner at the door" />
      {badge ? (
        <>
          {badge.active && <KeepScreenOn />}
          <IdBadge badge={badge} />
        </>
      ) : (
        <EmptyState
          icon={<IdCard className="h-6 w-6" aria-hidden="true" />}
          title="No badge on this account"
          body="Badges belong to employee records. HR can link one to your sign in."
        />
      )}
    </div>
  );
}
