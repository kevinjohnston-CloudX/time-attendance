import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getEmployeeById, getAdminRefData, getEmployeeAuditLogs, getHrSiteAccess } from "@/actions/admin.actions";
import { EditEmployeeForm } from "@/components/admin/edit-employee-form";
import { photoUrls } from "@/lib/presence/photos";

/**
 * One employee. The record opens to read, with Edit in the pinned header;
 * editing turns every section into fields at once and one Save changes
 * writes only what changed. The header lives in the record component, since
 * its buttons change with the mode.
 */
export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "EMPLOYEE_MANAGE")) redirect("/admin");

  const canManageRules = await userHasPermission(session.user, "RULES_MANAGE");

  const [empResult, refResult, logsResult, siteAccessResult] = await Promise.all([
    getEmployeeById({ employeeId: id }),
    getAdminRefData(),
    getEmployeeAuditLogs({ employeeId: id }),
    getHrSiteAccess({ employeeId: id }),
  ]);

  if (!empResult.success) notFound();
  if (!refResult.success) redirect("/admin/employees");

  const logs = logsResult.success ? logsResult.data : [];
  const employee = empResult.data;
  const hrSiteAccess = siteAccessResult.success ? siteAccessResult.data : [];
  const actorRole = session.user.role;
  const { sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories, payTypes, jobTitles, agencies } = refResult.data;

  // The time clock tablet's photo, found and signed the way Live Attendance
  // does it. Only for the one record this viewer was already allowed to open
  // above; null (initials) when there is none or the photo store is off.
  const photo =
    (
      await photoUrls(employee.tenantId, [
        { id: employee.id, barcode: employee.barcode, wmsId: employee.wmsId, employeeCode: employee.employeeCode },
      ])
    ).get(employee.id) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <EditEmployeeForm
        employee={employee}
        photo={photo}
        // Replacing the photo is Live Attendance's own permission, checked
        // again by the save itself; this only decides whether to offer it.
        canEditPhoto={await userHasPermission(session.user, "PRESENCE_PHOTO_EDIT")}
        sites={sites}
        departments={departments}
        ruleSets={ruleSets}
        employees={employees}
        customRoles={customRoles}
        shifts={shifts}
        holidayRules={holidayRules}
        payCategories={payCategories ?? []}
        payTypes={payTypes ?? []}
        jobTitles={jobTitles ?? []}
        agencies={agencies ?? []}
        logs={logs}
        hrSiteAccess={hrSiteAccess}
        actorRole={actorRole ?? "EMPLOYEE"}
        canManageRules={canManageRules}
      />
    </div>
  );
}
