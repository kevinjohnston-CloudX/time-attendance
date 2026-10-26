"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Users, X } from "lucide-react";
import { useRouter } from "@/components/layout/navigation-progress";
import { useSearchBox } from "@/hooks/use-search-box";
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
import { usePhoneLayout } from "@/lib/phone";
import styles from "./team-members.module.css";

const STATUS_TONE: Record<string, BadgeTone> = { Active: "success", "On leave": "warning", Inactive: "neutral" };

/**
 * Team Members: the people the viewer may see, read only. Each row opens the
 * person's timecard when the viewer may see timecards; nothing here changes.
 */
export function TeamMembersScreen({ data, canViewTimecards }: { data: TeamMembersData; canViewTimecards: boolean }) {
  const router = useRouter();
  const phone = usePhoneLayout();
  /** On a phone, the person whose details are open in a sheet. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Search runs on the server. What is typed stays typed while results
  // arrive, Back brings its search in, and a search replaces the address
  // rather than adding to the history (useSearchBox).
  const searchBox = useSearchBox(
    data.search,
    (value) => {
      const params = new URLSearchParams();
      if (value.trim()) params.set("q", value.trim());
      if (data.showInactive) params.set("show", "all");
      const qs = params.toString();
      startTransition(() => router.replace(`/supervisor/team${qs ? `?${qs}` : ""}`, { scroll: false }));
    },
    { delayMs: 300, normalize: (s) => s.trim() },
  );

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
        search={<SearchInput value={searchBox.value} onValueChange={searchBox.onChange} placeholder="Name or badge ID" />}
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
        ) : phone ? (
          // A phone's list: one row per person, the rest of their details in
          // a sheet when tapped, rather than ten columns to swipe across.
          <ul className={styles.list}>
            {data.members.map((m) => (
              <li key={m.id}>
                <button type="button" className="ta-list-row" onClick={() => setOpenId(m.id)}>
                  <span className="ta-list-text">
                    <span className="ta-list-title">{m.name}</span>
                    <span className="ta-list-sub">{[m.department, m.badge].filter(Boolean).join(", ")}</span>
                  </span>
                  {m.status !== "Active" && (
                    <Badge tone={STATUS_TONE[m.status]} size="sm">
                      {m.status}
                    </Badge>
                  )}
                  <ChevronRight className="ta-list-chevron" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
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
      {phone && openId && <MemberSheet member={data.members.find((m) => m.id === openId)!} canViewTimecards={canViewTimecards} onClose={() => setOpenId(null)} />}
    </div>
  );
}

type Member = TeamMembersData["members"][number];

/** One person's details on a phone, a line per fact, from the bottom edge. */
function MemberSheet({ member: m, canViewTimecards, onClose }: { member: Member; canViewTimecards: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const facts: [string, string][] = [
    ["Badge ID", m.badge],
    ["Status", m.status],
    ["Site", m.site],
    ["Department", m.department],
    ["Job title", m.jobTitle ?? "None"],
    ["Agency", m.agency ?? "None"],
    ["Supervisor", m.supervisor ?? "None"],
    ["Shift", m.shift ?? "None"],
    ["Hire date", format(parseISO(m.hireDate), "MMM d, yyyy")],
  ];
  return createPortal(
    <div
      className="ta-sheet-scrim fixed inset-0 z-[60] flex"
      style={{ background: "var(--wms-overlay-modal)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`ta-sheet ${styles.sheet}`} role="dialog" aria-modal="true" aria-label={m.name}>
        <div className={styles.sheetHead}>
          <h2>{m.name}</h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <dl className={styles.facts}>
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {canViewTimecards && (
          <div className="ta-sheet-actions flex">
            <LinkButton href={`/payroll/timecards?employeeId=${m.id}`} hierarchy="primary">
              Open timecard
            </LinkButton>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
