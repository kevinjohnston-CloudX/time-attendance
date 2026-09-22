import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getAuditLogs } from "@/actions/admin.actions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Select,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  Toolbar,
  FilterBar,
  FilterChip,
} from "@/components/ui";
import { format } from "date-fns";
import { FileSearch } from "lucide-react";

const ENTITY_TYPES = [
  "USER",
  "EMPLOYEE",
  "PUNCH",
  "TIMESHEET",
  "PAY_PERIOD",
  "LEAVE_REQUEST",
  "LEAVE_BALANCE",
  "RULE_SET",
  "DOCUMENT",
];

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; entityType?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "AUDIT_VIEW")) redirect("/admin");

  const page = Number(sp.page ?? 1);
  const entityType = sp.entityType;

  const result = await getAuditLogs({ page, entityType });
  if (!result.success) redirect("/admin");

  const { logs, total, pages } = result.data;
  const pageHref = (n: number) => `/admin/audit?page=${n}${entityType ? `&entityType=${entityType}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit Log"
        subtitle={
          entityType
            ? `${total.toLocaleString()} ${entityType} entries`
            : `${total.toLocaleString()} entries · every configuration and timecard change`
        }
      />

      <div className="flex flex-col gap-2.5">
        {/* Plain GET form, so a filtered view is a URL somebody can send. */}
        <Toolbar count={total} countLabel="entry">
          <form method="GET" className="flex flex-wrap items-center gap-2">
            <Select name="entityType" defaultValue={entityType ?? ""}>
              <option value="">All types</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Button type="submit" hierarchy="secondary">
              Filter
            </Button>
          </form>
        </Toolbar>

        <FilterBar clearHref="/admin/audit">
          {entityType ? (
            <FilterChip key="entityType" label="Type" value={entityType} clearHref="/admin/audit" />
          ) : null}
        </FilterBar>
      </div>

      <Card padding={0}>
        {logs.length === 0 ? (
          <EmptyState
            icon={<FileSearch className="h-8 w-8" />}
            title={entityType ? `No ${entityType} entries` : "No audit entries"}
            body={
              entityType
                ? "Nothing of this type has been changed in the range held by the log."
                : "Nothing has been recorded yet."
            }
            action={entityType ? <LinkButton href="/admin/audit" size="sm">Show all types</LinkButton> : undefined}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Actor</TH>
                <TH>Action</TH>
                <TH>Entity</TH>
              </TR>
            </THead>
            <TBody>
              {logs.map((log) => (
                <TR key={log.id}>
                  {/* The timestamp is the column this table is read by, so it
                      gets tabular figures — the seconds have to line up. */}
                  <TD numeric align="left" style={{ color: "var(--text-secondary)" }}>
                    {format(log.createdAt, "MMM d, yyyy HH:mm:ss")}
                  </TD>
                  <TD>{log.actor?.user?.name ?? log.actorId ?? "System"}</TD>
                  <TD style={{ fontFamily: "var(--font-mono)", font: "var(--type-body2)" }}>{log.action}</TD>
                  <TD>
                    <span className="inline-flex items-center gap-2">
                      <Badge size="sm">{log.entityType}</Badge>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          font: "var(--type-caption1)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        {log.entityId.slice(0, 8)}…
                      </span>
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {pages > 1 && (
          <div
            className="flex items-center justify-between gap-3 px-4 py-2.5"
            style={{ borderTop: "1px solid var(--stroke-divider)" }}
          >
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
              Page {page} of {pages}
            </span>
            <div className="flex items-center gap-2">
              {page > 1 && (
                <LinkButton href={pageHref(page - 1)} size="sm">
                  ← Prev
                </LinkButton>
              )}
              {page < pages && (
                <LinkButton href={pageHref(page + 1)} size="sm">
                  Next →
                </LinkButton>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
