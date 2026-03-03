import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { format } from "date-fns";
import { FileText, Download } from "lucide-react";
import Link from "next/link";
import {
  getAllDocuments,
  getMyDocuments,
  getEmployeesForDocumentUpload,
} from "@/actions/document.actions";
import { UploadDocumentForm } from "@/components/documents/upload-document-form";
import { AdminDocumentsTable } from "@/components/documents/admin-documents-table";
import { mimeToLabel } from "@/lib/validators/document.schema";

export default async function DocumentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const canViewAny = hasPermission(session.user.role, "DOCUMENT_VIEW_ANY");
  const canViewOwn = hasPermission(session.user.role, "DOCUMENT_VIEW_OWN");
  const canUpload = hasPermission(session.user.role, "DOCUMENT_UPLOAD");

  if (!canViewAny && !canViewOwn) redirect("/dashboard");

  if (canViewAny) {
    const [docsResult, employeesResult] = await Promise.all([
      getAllDocuments(),
      getEmployeesForDocumentUpload(),
    ]);

    if (!docsResult.success) redirect("/dashboard");
    const docs = docsResult.data;
    const employees = employeesResult.success ? employeesResult.data : [];

    return (
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Documents</h1>
          {canUpload && employees.length > 0 && (
            <UploadDocumentForm employees={employees} />
          )}
        </div>

        <div className="mt-6">
          {docs.length === 0 ? (
            <EmptyState message="No documents uploaded yet." />
          ) : (
            <AdminDocumentsTable docs={docs} canDelete={canUpload} />
          )}
        </div>
      </div>
    );
  }

  // Employee view — own documents only
  if (!session.user.employeeId) redirect("/dashboard");

  const docsResult = await getMyDocuments();
  if (!docsResult.success) redirect("/dashboard");
  const docs = docsResult.data;

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">My Documents</h1>

      <div className="mt-6">
        {docs.length === 0 ? (
          <EmptyState message="No documents have been uploaded for you yet." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/60">
                <tr>
                  <Th>Title</Th>
                  <Th>Type</Th>
                  <Th>Uploaded</Th>
                  <Th><span className="sr-only">Download</span></Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
                {docs.map((doc) => (
                  <tr key={doc.id}>
                    <Td>{doc.title}</Td>
                    <Td>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {mimeToLabel(doc.fileType)}
                      </span>
                    </Td>
                    <Td>{format(doc.uploadedAt, "MMM d, yyyy")}</Td>
                    <Td>
                      <Link
                        href={`/api/documents/${doc.id}`}
                        target="_blank"
                        className="flex items-center gap-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      >
                        <Download className="h-4 w-4" />
                        <span className="text-xs">Download</span>
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-4 py-3 text-zinc-900 dark:text-zinc-100 ${className ?? ""}`}>
      {children}
    </td>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <FileText className="h-10 w-10 text-zinc-300 dark:text-zinc-700" />
      <p className="mt-3 text-sm text-zinc-500">{message}</p>
    </div>
  );
}
