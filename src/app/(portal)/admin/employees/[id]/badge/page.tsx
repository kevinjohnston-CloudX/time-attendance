import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getEmployeeById } from "@/actions/admin.actions";
import { getIdBadge } from "@/lib/badge/badge.service";
import { IdBadge } from "@/components/badge/id-badge";
import { ArrowLeft } from "lucide-react";
import { LinkButton, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Somebody's badge, for whoever manages their employee record: the same
 * permission and the same company and site scope as the record itself, since
 * the record lookup below is what decides. Outside that scope it is a 404.
 */
export default async function EmployeeBadgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "EMPLOYEE_MANAGE")) redirect("/admin");

  const record = await getEmployeeById({ employeeId: id });
  if (!record.success) notFound();

  const badge = await getIdBadge(id);
  if (!badge) notFound();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        pinned
        title="Badge"
        subtitle={badge.name}
        actions={
          <LinkButton
            href={`/admin/employees/${id}`}
            hierarchy="tertiary"
            className="ta-phone-hide"
            leadingIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
          >
            Employee record
          </LinkButton>
        }
      />
      <IdBadge badge={badge} />
    </div>
  );
}
