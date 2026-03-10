"use client";

import { useState } from "react";
import { FolderTree } from "./report-list/folder-tree";
import { ReportCard } from "./report-list/report-card";
import { FileText } from "lucide-react";
import Link from "next/link";
import { Plus } from "lucide-react";

interface Report {
  id: string;
  name: string;
  description?: string | null;
  dataSource: string;
  updatedAt: Date | string;
  folderId?: string | null;
  owner?: { name: string | null } | null;
  _count?: { runs: number };
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  _count: { reports: number };
  children: { id: string; name: string }[];
}

interface ReportsDashboardProps {
  reports: {
    owned: Report[];
    shared: (Report & { canEdit?: boolean })[];
    tenantWide: Report[];
  };
  folders: Folder[];
}

export function ReportsDashboard({ reports, folders }: ReportsDashboardProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const allReports = [
    ...reports.owned.map((r) => ({ ...r, section: "My Reports" as const })),
    ...reports.shared.map((r) => ({ ...r, section: "Shared with Me" as const })),
    ...reports.tenantWide.map((r) => ({ ...r, section: "Organization" as const })),
  ];

  // Filter by folder if one is selected
  const filteredReports = selectedFolderId
    ? allReports.filter((r) => r.folderId === selectedFolderId)
    : allReports;

  const sections = ["My Reports", "Shared with Me", "Organization"] as const;

  return (
    <div className="flex gap-6">
      {/* Sidebar folder tree */}
      {folders.length > 0 || reports.owned.length > 0 ? (
        <div className="w-56 flex-shrink-0">
          <FolderTree
            folders={folders}
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
          />
        </div>
      ) : null}

      {/* Report grid */}
      <div className="min-w-0 flex-1">
        {filteredReports.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
            <FileText className="mx-auto mb-3 h-10 w-10 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {selectedFolderId
                ? "No reports in this folder."
                : "No reports yet. Create your first report to get started."}
            </p>
            {!selectedFolderId && (
              <Link
                href="/reports/new"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
              >
                <Plus className="h-4 w-4" />
                New Report
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {sections.map((section) => {
              const sectionReports = filteredReports.filter(
                (r) => r.section === section
              );
              if (sectionReports.length === 0) return null;
              return (
                <div key={section}>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {section}
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {sectionReports.map((report) => (
                      <ReportCard key={report.id} report={report} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
