"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Download, Search, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { DeleteDocumentButton } from "./delete-document-button";
import { mimeToLabel } from "@/lib/validators/document.schema";

interface Doc {
  id: string;
  title: string;
  fileType: string;
  uploadedAt: Date;
  uploadedBy: string;
  employeeId: string;
  employee: { user: { name: string | null } };
}

interface Props {
  docs: Doc[];
  canDelete: boolean;
}

const PAGE_SIZE = 20;

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "application/pdf", label: "PDF" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/png", label: "PNG" },
  { value: "application/msword", label: "Word (.doc)" },
  { value: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word (.docx)" },
];

export function AdminDocumentsTable({ docs, canDelete }: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);

  const filtered = docs.filter((doc) => {
    const name = (doc.employee.user.name ?? "").toLowerCase();
    const title = doc.title.toLowerCase();
    const q = search.toLowerCase();
    const matchSearch = !q || name.includes(q) || title.includes(q);
    const matchType = !typeFilter || doc.fileType === typeFilter;
    return matchSearch && matchType;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageDocs = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  function handleSearch(v: string) { setSearch(v); setPage(1); }
  function handleType(v: string) { setTypeFilter(v); setPage(1); }

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search employee or title…"
            className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => handleType(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="ml-auto text-xs text-zinc-400">
          {filtered.length === 0
            ? "No results"
            : `${startIdx + 1}–${Math.min(startIdx + PAGE_SIZE, filtered.length)} of ${filtered.length}`}
        </p>
      </div>

      {/* Table / empty state */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileText className="h-10 w-10 text-zinc-300 dark:text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-400">No documents match your filters.</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/60">
                <tr>
                  <Th>Employee</Th>
                  <Th>Title</Th>
                  <Th>Type</Th>
                  <Th>Uploaded</Th>
                  <Th>Uploaded By</Th>
                  <Th><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
                {pageDocs.map((doc) => (
                  <tr key={doc.id}>
                    <Td>{doc.employee.user.name ?? "—"}</Td>
                    <Td>{doc.title}</Td>
                    <Td>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {mimeToLabel(doc.fileType)}
                      </span>
                    </Td>
                    <Td>{format(doc.uploadedAt, "MMM d, yyyy")}</Td>
                    <Td className="text-zinc-500">{doc.uploadedBy}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/api/documents/${doc.id}`}
                          target="_blank"
                          title="Download"
                          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                        >
                          <Download className="h-4 w-4" />
                        </Link>
                        {canDelete && <DeleteDocumentButton documentId={doc.id} />}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="rounded-lg border border-zinc-200 p-2 text-zinc-500 hover:text-zinc-900 disabled:opacity-40 dark:border-zinc-700 dark:hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm text-zinc-500">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="rounded-lg border border-zinc-200 p-2 text-zinc-500 hover:text-zinc-900 disabled:opacity-40 dark:border-zinc-700 dark:hover:text-white"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
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
