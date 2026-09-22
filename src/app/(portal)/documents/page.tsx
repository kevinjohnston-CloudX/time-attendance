import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getEffectiveRole } from "@/lib/rbac/check-permission";
import {
  getAllDocuments,
  getMyDocuments,
  getEmployeesForDocumentUpload,
} from "@/actions/document.actions";
import { UploadDocumentForm } from "@/components/documents/upload-document-form";
import { DocumentsList } from "@/components/documents/documents-list";
import { PageHeader } from "@/components/ui";

/**
 * Documents, as the portal design's list screen.
 *
 * <p>Two audiences, one screen. What you can see is still decided entirely by
 * the permission check below — DOCUMENT_VIEW_ANY loads the tenant's files,
 * DOCUMENT_VIEW_OWN loads yours — and the filters narrow what that query
 * already returned. They never widen it.
 *
 * <p>Search, type and year live in the query string rather than in the table.
 * A narrowed list of documents is something one person sends another, and the
 * old client-side filter reset itself on every upload.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; year?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const effectiveRole = await getEffectiveRole(session.user);
  const canViewAny = hasPermission(effectiveRole, "DOCUMENT_VIEW_ANY");
  const canViewOwn = hasPermission(effectiveRole, "DOCUMENT_VIEW_OWN");
  const canUpload = hasPermission(effectiveRole, "DOCUMENT_UPLOAD");

  if (!canViewAny && !canViewOwn) redirect("/dashboard");

  const sp = (await searchParams) ?? {};
  const q = sp.q ?? "";
  const type = sp.type ?? "";
  const year = sp.year ?? "";
  const requestedPage = Number(sp.page ?? "1");
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;

  if (canViewAny) {
    const [docsResult, employeesResult] = await Promise.all([
      getAllDocuments(),
      getEmployeesForDocumentUpload(),
    ]);

    if (!docsResult.success) redirect("/dashboard");
    const docs = docsResult.data;
    const employees = employeesResult.success
      ? employeesResult.data.map((e) => ({ id: e.id, user: { name: e.user.name } }))
      : [];

    // How many people have a file, not how many people exist: the subtitle
    // used to count active employees, which reads as "everyone has documents"
    // on a tenant where six do.
    const withFiles = new Set(docs.map((d) => d.employeeId)).size;

    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Documents"
          subtitle={`Pay statements, policies and signed forms · on file for ${withFiles} ${withFiles === 1 ? "employee" : "employees"}`}
          actions={
            canUpload && employees.length > 0 ? <UploadDocumentForm employees={employees} /> : undefined
          }
        />

        <DocumentsList
          docs={docs}
          q={q}
          type={type}
          year={year}
          page={page}
          showEmployee
          canDelete={canUpload}
          searchPlaceholder="Employee or document name"
          emptyTitle="No documents yet"
          emptyBody="Pay statements, policies and signed forms uploaded here appear on the employee's own Documents page."
        />
      </div>
    );
  }

  // Employee view — own documents only
  if (!session.user.employeeId) redirect("/dashboard");

  const docsResult = await getMyDocuments();
  if (!docsResult.success) redirect("/dashboard");
  const docs = docsResult.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="My Documents" subtitle="Pay statements, policies and signed forms" />

      <DocumentsList
        docs={docs}
        q={q}
        type={type}
        year={year}
        page={page}
        searchPlaceholder="Document name"
        emptyTitle="Nothing here yet"
        emptyBody="No documents have been uploaded for you. Anything HR shares with you will show up on this page."
      />
    </div>
  );
}
