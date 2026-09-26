"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "@/components/layout/navigation-progress";
import { CalendarClock, Plus } from "lucide-react";
import { Badge, Button, EmptyState, LinkButton, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { AreaPanel, FactTiles, StatusBadge, countLine, matches, useFacts, useStatusView } from "./setup/setup-ui";
import { FREQ_LABEL, MONTHS, type PolicyRow } from "./leave-policy-editor";

/**
 * The leave policies list on the shared panel. A row opens the policy on
 * its own page (see LeavePolicyEditor). The Overrides column read a count
 * the server never sent, so it was always blank; the list says instead
 * how many sites and pay categories use each policy, the figures that say
 * whether a change to it reaches a few people or the whole company.
 */

function earning(p: PolicyRow): { main: string; note?: string } {
  const main = FREQ_LABEL[p.posting1Freq] ?? p.posting1Freq;
  const notes = [
    p.dualPosting && p.posting2Freq ? `Also ${(FREQ_LABEL[p.posting2Freq] ?? p.posting2Freq).toLowerCase()}` : "",
    p.balanceReset && p.resetMonth && p.resetDay ? `Resets ${MONTHS[p.resetMonth - 1]} ${p.resetDay}` : "",
  ].filter(Boolean);
  return { main, note: notes.join(" · ") || undefined };
}

export function PtoPoliciesManager({ policies }: { policies: PolicyRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { view, setView, counts, kept } = useStatusView(policies);
  const facts = useFacts(kept, [
    { key: "types", label: "Leave types", note: "Covered by these policies", value: new Set(kept.map((p) => p.leaveTypeId).filter(Boolean)).size },
    { key: "tiers", label: "Tiered", note: "More time with longer service", match: (p) => p.rules.length > 1 },
    { key: "sites", label: "Used by sites", note: "Picked on at least one site", match: (p) => (p._count?.siteLinks ?? 0) > 0 },
    { key: "cats", label: "Used by pay categories", note: "Picked on a pay category", match: (p) => (p._count?.categoryLinks ?? 0) > 0 },
    { key: "unused", label: "Not used", note: "No site or pay category", match: (p) => !(p._count?.siteLinks ?? 0) && !(p._count?.categoryLinks ?? 0) },
  ]);
  const shown = facts.kept
    .filter((p) => matches(query, p.name, p.leaveType?.name, p.description))
    // By leave type, then name, so policies for one leave type read together.
    .sort((a, b) => {
      const al = a.leaveType?.name ?? "￿";
      const bl = b.leaveType?.name ?? "￿";
      return al === bl ? a.name.localeCompare(b.name) : al.localeCompare(bl);
    });

  const addButton = (
    <LinkButton href="/admin/rules-setup/leave-policies/new" hierarchy="primary" leadingIcon={<Plus className="h-4 w-4" />}>
      Add leave policy
    </LinkButton>
  );

  return (
    <AreaPanel
      title="Leave policies"
      hint="Time off earned by tenure, per leave type. Sites and pay categories pick which one applies."
      action={addButton}
      summary={policies.length ? <FactTiles tiles={facts.tiles} onToggle={facts.toggle} /> : undefined}
      status={{ view, onChange: setView, counts }}
      search={policies.length ? { value: query, onChange: setQuery, placeholder: "Policy or leave type" } : undefined}
      count={countLine(shown.length, policies.length, "leave policy", "leave policies")}
    >
      {policies.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-8 w-8" />}
          title="No leave policies yet"
          body="Add the first one, then pick it on a site or a pay category."
          action={addButton}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-8 w-8" />}
          title="No leave policies match"
          body="Nothing matches the search, status or figure picked above."
          action={
            facts.focused || query ? (
              <Button hierarchy="secondary" size="sm" onClick={() => { facts.clear(); setQuery(""); }}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Leave policy</TH>
              <TH>Time is added</TH>
              <TH numeric>Tiers</TH>
              <TH>Used by</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((p) => {
              const e = earning(p);
              const sites = p._count?.siteLinks ?? 0;
              const cats = p._count?.categoryLinks ?? 0;
              const used = [sites ? `${sites} ${sites === 1 ? "site" : "sites"}` : "", cats ? `${cats} pay ${cats === 1 ? "category" : "categories"}` : ""].filter(Boolean);
              return (
                <TR key={p.id} onClick={() => router.push(`/admin/rules-setup/leave-policies/${p.id}`)}>
                  <TD>
                    <span className="flex flex-col" style={{ maxWidth: 300, whiteSpace: "normal" }}>
                      <span className="flex items-baseline gap-2">
                        <Link
                          href={`/admin/rules-setup/leave-policies/${p.id}`}
                          onClick={(ev) => ev.stopPropagation()}
                          style={{ fontWeight: "var(--weight-medium)", color: "var(--text-primary)", textDecoration: "none" }}
                        >
                          {p.name}
                        </Link>
                        {p.isDefault && (
                          <Badge tone="info" size="sm">
                            Default
                          </Badge>
                        )}
                      </span>
                      <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{p.leaveType?.name ?? "Several leave types"}</span>
                    </span>
                  </TD>
                  <TD>
                    <span className="flex flex-col">
                      <span style={{ color: "var(--text-primary)" }}>{e.main}</span>
                      <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                        {[p.rateMode === "PER_POSTING" ? "Hours each posting" : "Hours a year", e.note].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </TD>
                  <TD numeric style={{ color: "var(--text-secondary)" }}>
                    {p.rules.length}
                  </TD>
                  <TD style={{ color: used.length ? "var(--text-secondary)" : "var(--text-tertiary)" }}>{used.length ? used.join(", ") : "Nothing yet"}</TD>
                  <TD>
                    <StatusBadge active={p.isActive} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </AreaPanel>
  );
}
