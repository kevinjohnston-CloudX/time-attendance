"use client";

import { format, parseISO } from "date-fns";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Users } from "lucide-react";
import { useRouter } from "@/components/layout/navigation-progress";
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  SearchInput,
  SegmentedLinks,
  Table,
  TBody,
  TD,
  TH,
  THead,
  ToolsBar,
  TR,
  type BadgeTone,
} from "@/components/ui";
import type { TeamMembersData } from "@/lib/team-members/team-members-data";

const STATUS_TONE: Record<string, BadgeTone> = { Active: "success", "On leave": "warning", Inactive: "neutral" };

/**
 * Team Members: the people the viewer may see, read only. Each row opens the
 * person's timecard when the viewer may see timecards; nothing here changes.
 */
export function TeamMembersScreen({ data, canViewTimecards }: { data: TeamMembersData; canViewTimecards: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(data.search);
  const typed = useRef(false);

  const navigate = useCallback(
    (patch: { q?: string; show?: string }) => {
      const next = { q: data.search || undefined, show: data.showInactive ? "all" : undefined, ...patch };
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
      const qs = params.toString();
      startTransition(() => router.push(`/supervisor/team${qs ? `?${qs}` : ""}`, { scroll: false }));
    },
    [router, data.search, data.showInactive],
  );

  const onType = useCallback((v: string) => {
    typed.current = true;
    setQuery(v);
  }, []);
  useEffect(() => {
    if (!typed.current) return;
    const q = query.trim();
    if (q === data.search) return;
    const t = setTimeout(() => {
      typed.current = false;
      navigate({ q: q || undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [query, data.search, navigate]);

  const showHref = (show?: string) => {
    const params = new URLSearchParams();
    if (data.search) params.set("q", data.search);
    if (show) params.set("show", show);
    const qs = params.toString();
    return `/supervisor/team${qs ? `?${qs}` : ""}`;
  };

  const shown = data.members.length;
  const countLine =
    data.total > shown
      ? `Showing the first ${shown} of ${data.total}. Search by name or badge ID to find someone.`
      : `${data.total} ${data.total === 1 ? "person" : "people"}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Team Members" subtitle="Your people's details, read only" />
      <ToolsBar
        search={<SearchInput value={query} onValueChange={onType} placeholder="Name or badge ID" />}
        end={
          <SegmentedLinks
            ariaLabel="Who to show"
            size="sm"
            active={data.showInactive ? "all" : "active"}
            items={[
              { value: "active", label: "Active", href: showHref() },
              { value: "all", label: "Include inactive", href: showHref("all") },
            ]}
          />
        }
      />
      <Card padding={0} subtitle={countLine}>
        {shown === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={data.search ? "No one matches that search" : "No one to show"}
            body={data.search ? "Check the spelling, or search by badge ID." : "No employees are assigned to you yet."}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Badge ID</TH>
                <TH>Status</TH>
                <TH>Site</TH>
                <TH>Department</TH>
                <TH>Job title</TH>
                <TH>Agency</TH>
                <TH>Supervisor</TH>
                <TH>Shift</TH>
                <TH>Hire date</TH>
                {canViewTimecards && <TH aria-label="Timecard" />}
              </TR>
            </THead>
            <TBody>
              {data.members.map((m) => (
                <TR key={m.id}>
                  <TD style={{ fontWeight: "var(--weight-medium)" as never }}>{m.name}</TD>
                  <TD className="tabular">{m.badge}</TD>
                  <TD>
                    <Badge tone={STATUS_TONE[m.status]} size="sm">{m.status}</Badge>
                  </TD>
                  <TD>{m.site}</TD>
                  <TD>{m.department}</TD>
                  <TD>{m.jobTitle ?? "—"}</TD>
                  <TD>{m.agency ?? "—"}</TD>
                  <TD>{m.supervisor ?? "—"}</TD>
                  <TD>{m.shift ?? "—"}</TD>
                  <TD className="tabular">{format(parseISO(m.hireDate), "MMM d, yyyy")}</TD>
                  {canViewTimecards && (
                    <TD align="right">
                      <LinkButton href={`/payroll/timecards?employeeId=${m.id}`} hierarchy="tertiary" size="sm">
                        Timecard
                      </LinkButton>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
