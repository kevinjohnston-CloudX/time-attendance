"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createRole, updateRole, deleteRole, duplicateRole } from "@/actions/role.actions";
import { RESOURCES, ACTIONS, SCOPES, type PermissionEntry } from "@/lib/validators/role.schema";
import { LEGACY_MAP } from "@/lib/rbac/legacy-map";
import { Trash2, Copy, Save, X, CopyCheck, Info } from "lucide-react";
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Input,
  Select,
  Switch,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

/**
 * The role editor, as the portal design's document template lays it out:
 * labelled sections stacked in one column, the permission matrix as a real
 * table, and the destructive action kept apart from the save.
 *
 * <p>The matrix is the whole screen. Every cell it draws exists in the schema,
 * but only the ones in {@link ACTIVE_CELLS} are read by a server check, so the
 * rest are disabled rather than hidden — a permission that is simply absent
 * reads as "we forgot it", and someone grants a role something the server
 * will never honour.
 */

// Only these cells map to an enforced server-side permission check.
// All others are rendered but non-functional — disable them in the UI.
const ACTIVE_CELLS = new Set(
  Object.values(LEGACY_MAP).map((t) => `${t.resource}:${t.action}:${t.scope}`)
);

const RESOURCE_LABELS: Record<string, string> = {
  punch: "Punches",
  timesheet: "Timesheets",
  timecard: "Timecards",
  leave: "Leave",
  accrual: "Accruals",
  payroll: "Payroll",
  employee: "Employees",
  rules: "Rule Sets",
  site: "Sites",
  document: "Documents",
  report: "Reports",
  audit: "Audit Log",
  role: "Roles",
  presence: "Live Attendance",
};

const ACTION_LABELS: Record<string, string> = {
  read: "Read",
  write: "Write",
  execute: "Execute",
};

const SCOPE_LABELS: Record<string, string> = {
  own: "Own",
  team: "Team",
  all: "All",
};

type PermInfo = { summary: string; cells: Record<string, string> };

const RESOURCE_INFO: Record<string, PermInfo> = {
  punch: {
    summary: "Controls who can clock in/out and who can view or modify punch records.",
    cells: {
      "write:own":  "Clock in and out for yourself via the Punch Clock.",
      "read:team":  "View your team's current punch status and punch history.",
      "write:team": "Manually add, edit, or delete punch records for your team members.",
      "write:all":  "Manually add, edit, or delete punch records for any employee.",
    },
  },
  timesheet: {
    summary: "Controls timesheet submission and the approval workflow.",
    cells: {
      "write:own":    "Submit your own timesheet for approval at the end of a pay period.",
      "execute:team": "Resolve exceptions and authorize overtime for your direct reports.",
      "execute:all":  "Resolve exceptions and authorize overtime for any employee across all teams.",
    },
  },
  timecard: {
    summary: "Controls who can view and edit detailed timecards (punches, segments, pay codes).",
    cells: {
      "read:team":  "View timecards for your direct reports in read-only mode.",
      "read:all":   "View timecards for any employee in read-only mode.",
      "write:team": "Edit timecards, adjust punches, and assign pay codes for your direct reports.",
      "write:all":  "Edit timecards, adjust punches, and assign pay codes for any employee.",
    },
  },
  leave: {
    summary: "Controls leave requests and the approval workflow.",
    cells: {
      "write:own":    "Submit leave requests (PTO, sick, etc.) for yourself.",
      "write:team":   "Submit leave requests on behalf of your direct reports.",
      "write:all":    "Submit leave requests on behalf of any employee.",
      "execute:team": "Approve or reject leave requests submitted by your team.",
      "execute:all":  "Approve or reject leave requests from any employee.",
    },
  },
  accrual: {
    summary: "Controls who can view PTO/sick balances and who can manually adjust them.",
    cells: {
      "read:own":   "View your own leave balances, accrual history, and forecasted hours.",
      "read:team":  "View leave balances for your assigned team members.",
      "read:all":   "View leave balances for any employee across all locations.",
      "write:all":  "Manually adjust accrual balances, carryovers, and assign policy exceptions. Restricted to HR Super Admin.",
    },
  },
  payroll: {
    summary: "Controls pay period management and payroll operations.",
    cells: {
      "write:all": "View pay periods, manage pay codes and payroll settings, and make payroll changes on open timecards. Timecard access is controlled separately under Timecards.",
      "execute:all": "Run payroll: lock and unlock pay periods, unlock and re-lock a single timecard, and export or push to ADP.",
    },
  },
  employee: {
    summary: "Controls access to employee records.",
    cells: {
      "write:all": "Add new employees, edit profiles, change roles, and deactivate or terminate employees.",
    },
  },
  rules: {
    summary: "Controls configuration of rule sets, overtime rules, and scheduling.",
    cells: {
      "write:all": "Create and edit rule sets, OT rules, shift schedules, and holiday rules.",
    },
  },
  site: {
    summary: "Controls company site and location management.",
    cells: {
      "write:all": "Add and edit sites, departments, and company location settings.",
    },
  },
  document: {
    summary: "Controls document upload and access.",
    cells: {
      "write:own": "Upload documents to your own employee profile.",
      "read:own":  "View documents attached to your own profile.",
      "read:all":  "View documents for any employee.",
    },
  },
  report: {
    summary: "Controls report creation and execution.",
    cells: {
      "write:all":   "Create, configure, and save custom reports.",
      "execute:all": "Run reports and schedule automated exports.",
    },
  },
  audit: {
    summary: "Controls access to the system audit trail.",
    cells: {
      "read:all": "View the full audit log showing all changes made across the system.",
    },
  },
  presence: {
    summary: "Controls who can see which employees are in the building right now, who can update their photos, and who is alerted when the gate turns somebody away.",
    cells: {
      "read:all": "See everyone at a site on Live Attendance, with their gate and time clock scans.",
      "write:all": "Update an employee's photo from Live Attendance. The photo it replaces is kept.",
      "execute:all": "Get an alert on Live Attendance when the gate turns away somebody with no shift today, and add them to today's schedule. Only while gate alerts are on in Company Settings.",
    },
  },
  role: {
    summary: "Controls role and permission management.",
    cells: {
      "write:all": "Create, edit, and delete custom roles and assign their permissions.",
    },
  },
};

type RoleData = {
  id: string;
  name: string;
  description: string | null;
  rank: number;
  isSystem: boolean;
  canViewAs: boolean;
  liveAttendanceOnly?: boolean;
  permissions: { resource: string; action: string; scope: string }[];
  _count: { employees: number };
};

type AllRole = {
  id: string;
  name: string;
  isSystem: boolean;
};

type BuiltinRoleOption = {
  key: string;
  name: string;
  permissions: { resource: string; action: string; scope: string }[];
};

/** The design's field grid: two per row, one per row once a column drops under 200px. */
const FIELD_GRID =
  "grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,48%)),1fr))]";

/** Matrix cells are on a 9-column grid, so they take less side padding than a list table's. */
const MATRIX_CELL = { padding: "0 8px" } as const;

function permKey(resource: string, action: string, scope: string) {
  return `${resource}:${action}:${scope}`;
}

function buildPermSet(permissions: PermissionEntry[]): Set<string> {
  const set = new Set<string>();
  for (const p of permissions) {
    set.add(permKey(p.resource, p.action, p.scope));
  }
  return set;
}

function permSetToArray(set: Set<string>): PermissionEntry[] {
  return Array.from(set).map((key) => {
    const [resource, action, scope] = key.split(":");
    return { resource, action, scope } as PermissionEntry;
  });
}

// When checking "all", also check "team" and "own"; when checking "team", also check "own"
const SCOPE_ORDER = ["own", "team", "all"] as const;

function autoCheckHigherScopes(
  set: Set<string>,
  resource: string,
  action: string,
  scope: string,
  checked: boolean
): Set<string> {
  const next = new Set(set);
  const scopeIdx = SCOPE_ORDER.indexOf(scope as (typeof SCOPE_ORDER)[number]);

  if (checked) {
    // Check this and all lower scopes — only if the cell is active
    for (let i = 0; i <= scopeIdx; i++) {
      const k = permKey(resource, action, SCOPE_ORDER[i]);
      if (ACTIVE_CELLS.has(k)) next.add(k);
    }
  } else {
    // Uncheck this and all higher scopes
    for (let i = scopeIdx; i < SCOPE_ORDER.length; i++) {
      next.delete(permKey(resource, action, SCOPE_ORDER[i]));
    }
  }

  return next;
}

export function RoleEditor({
  role,
  builtinRoles = [],
  onClose,
}: {
  role?: RoleData;
  allRoles: AllRole[];
  builtinRoles?: BuiltinRoleOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const isEditing = !!role;
  const isSystem = role?.isSystem ?? false;

  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [rank, setRank] = useState(role?.rank ?? 0);
  const [canViewAs, setCanViewAs] = useState(role?.canViewAs ?? false);
  const [liveAttendanceOnly, setLiveAttendanceOnly] = useState(role?.liveAttendanceOnly ?? false);
  const [permSet, setPermSet] = useState<Set<string>>(
    buildPermSet((role?.permissions ?? []) as PermissionEntry[])
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBuiltinKey, setSelectedBuiltinKey] = useState("");
  const [expandedResource, setExpandedResource] = useState<string | null>(null);

  function handleMimicBuiltin() {
    const source = builtinRoles.find((r) => r.key === selectedBuiltinKey);
    if (!source) return;
    if (permSet.size > 0 && !confirm(`Replace all current permissions with those from "${source.name}"?`)) return;
    setPermSet(buildPermSet(source.permissions as PermissionEntry[]));
  }

  function handleToggle(resource: string, action: string, scope: string) {
    const key = permKey(resource, action, scope);
    if (!ACTIVE_CELLS.has(key)) return;
    const checked = !permSet.has(key);
    setPermSet(autoCheckHigherScopes(permSet, resource, action, scope, checked));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const permissions = permSetToArray(permSet);

    try {
      if (isEditing) {
        const res = await updateRole({
          id: role!.id,
          name: isSystem ? undefined : name,
          description: description || null,
          rank,
          canViewAs: liveAttendanceOnly ? false : canViewAs,
          liveAttendanceOnly: isSystem ? undefined : liveAttendanceOnly,
          permissions,
        });
        if (!res.success) {
          setError(res.error);
          setSaving(false);
          return;
        }
      } else {
        const res = await createRole({
          name,
          description,
          rank,
          canViewAs: liveAttendanceOnly ? false : canViewAs,
          liveAttendanceOnly,
          permissions,
        });
        if (!res.success) {
          setError(res.error);
          setSaving(false);
          return;
        }
      }
      router.refresh();
      onClose();
    } catch {
      setError("An unexpected error occurred");
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!role) return;
    if (!confirm(`Delete "${role.name}"? This cannot be undone.`)) return;

    const res = await deleteRole({ id: role.id });
    if (!res.success) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  async function handleDuplicate() {
    if (!role) return;
    const newName = prompt("Name for the copy:", `${role.name} (Copy)`);
    if (!newName) return;

    const res = await duplicateRole({ id: role.id, name: newName });
    if (!res.success) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    // The scrim stays a literal black wash in both themes: it is the absence
    // of the page rather than a surface, and a token that lightened in dark
    // mode would stop the dialog reading as modal.
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[5vh]">
      <div className="ta-modal w-full max-w-4xl rounded-xl">
        <header
          className="flex items-center justify-between gap-3 px-6 py-4"
          style={{ borderBottom: "1px solid var(--stroke-divider)" }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="wms-card-title truncate">
              {isEditing ? `Edit Role: ${role.name}` : "Create New Role"}
            </h2>
            {isSystem && (
              <Badge tone="info" size="sm">
                System
              </Badge>
            )}
          </div>
          <Button hierarchy="tertiary" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </header>

        <div className="flex flex-col gap-5 px-6 py-5">
          <div className={FIELD_GRID}>
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSystem}
              hint={isSystem ? "System roles cannot be renamed" : undefined}
              placeholder="e.g. Shift Lead"
            />
            <Input
              label="Rank"
              type="number"
              value={rank}
              onChange={(e) => setRank(Number(e.target.value))}
              min={0}
              max={100}
              hint="Higher rank = more privileged"
            />
          </div>

          <Input
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this role"
          />

          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3"
            style={{ border: "1px solid var(--stroke-secondary)" }}
          >
            <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
              <span className="wms-label">Allow View As</span>
              <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
                Users with this role can simulate other roles with a lower rank to preview their
                experience.
              </span>
            </div>
            <Switch checked={canViewAs && !liveAttendanceOnly} onChange={setCanViewAs} disabled={liveAttendanceOnly} />
          </div>

          {!isSystem && (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3"
              style={{
                border: `1px solid ${liveAttendanceOnly ? "var(--stroke-warning)" : "var(--stroke-secondary)"}`,
                background: liveAttendanceOnly ? "var(--surface-warning)" : undefined,
              }}
            >
              <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
                <span className="wms-label">Limit to Live Attendance</span>
                <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
                  {liveAttendanceOnly
                    ? "People with this role can only open Live Attendance. Every other page, their own timesheet and punch clock included, is blocked, and downloads are off. Of the permissions below, only Live Attendance Write (photos) and Execute (gate alerts) still apply."
                    : "For a shared screen or a team that only watches the building. People with this role can open Live Attendance and nothing else."}
                </span>
              </div>
              <Switch checked={liveAttendanceOnly} onChange={setLiveAttendanceOnly} />
            </div>
          )}

          {builtinRoles.length > 0 && (
            <div
              className="flex flex-col gap-2 rounded-lg px-4 py-3"
              style={{
                border: "1px solid var(--stroke-secondary)",
                background: "var(--surface-secondary)",
              }}
            >
              <span className="wms-label">Load permissions from a built-in role</span>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={selectedBuiltinKey}
                  onChange={(e) => setSelectedBuiltinKey(e.target.value)}
                  style={{ flex: "1 1 220px" }}
                >
                  <option value="">Select a built-in role</option>
                  {builtinRoles.map((r) => (
                    <option key={r.key} value={r.key}>{r.name}</option>
                  ))}
                </Select>
                <Button
                  hierarchy="secondary"
                  onClick={handleMimicBuiltin}
                  disabled={!selectedBuiltinKey}
                  leadingIcon={<CopyCheck className="h-4 w-4" />}
                >
                  Apply
                </Button>
              </div>
              <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                This will replace the current permission selection with the chosen built-in
                role&apos;s permissions.
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="wms-label">Permissions</span>
            <div
              className="rounded-lg"
              style={{ border: "1px solid var(--stroke-secondary)", overflow: "hidden" }}
            >
              <Table>
                <THead>
                  <TR>
                    <TH>Resource</TH>
                    {ACTIONS.map((action) => (
                      <TH
                        key={action}
                        colSpan={SCOPES.length}
                        align="center"
                        style={{ ...MATRIX_CELL, borderLeft: "1px solid var(--stroke-secondary)" }}
                      >
                        {ACTION_LABELS[action]}
                      </TH>
                    ))}
                  </TR>
                  <TR>
                    {/* The scope row repeats under every action, so it carries no
                        uppercase weight of its own — it labels the column below,
                        not a second header. */}
                    <TH />
                    {ACTIONS.map((action) =>
                      SCOPES.map((scope) => (
                        <TH
                          key={`${action}-${scope}`}
                          align="center"
                          style={{
                            ...MATRIX_CELL,
                            textTransform: "none",
                            letterSpacing: "normal",
                            font: "var(--type-body2)",
                            color: "var(--text-tertiary)",
                            borderLeft:
                              scope === "own" ? "1px solid var(--stroke-secondary)" : undefined,
                          }}
                        >
                          {SCOPE_LABELS[scope]}
                        </TH>
                      ))
                    )}
                  </TR>
                </THead>
                <TBody>
                  {RESOURCES.map((resource) => {
                    const info = RESOURCE_INFO[resource];
                    const isExpanded = expandedResource === resource;
                    const totalCols = 1 + ACTIONS.length * SCOPES.length;
                    return (
                      <React.Fragment key={resource}>
                        <TR>
                          <TD style={{ fontWeight: "var(--weight-medium)" }}>
                            <span className="flex items-center gap-1.5">
                              {RESOURCE_LABELS[resource]}
                              {info && (
                                <Button
                                  hierarchy="tertiary"
                                  size="sm"
                                  iconOnly
                                  aria-expanded={isExpanded}
                                  onClick={() => setExpandedResource(isExpanded ? null : resource)}
                                  title="About this permission"
                                >
                                  <Info
                                    className="h-3.5 w-3.5"
                                    style={{ color: "var(--icon-tertiary)" }}
                                  />
                                </Button>
                              )}
                            </span>
                          </TD>
                          {ACTIONS.map((action) =>
                            SCOPES.map((scope) => {
                              const key = permKey(resource, action, scope);
                              const checked = permSet.has(key);
                              const isActive = ACTIVE_CELLS.has(key);
                              return (
                                <TD
                                  key={`${resource}-${action}-${scope}`}
                                  align="center"
                                  style={{
                                    ...MATRIX_CELL,
                                    borderLeft:
                                      scope === "own"
                                        ? "1px solid var(--stroke-secondary)"
                                        : undefined,
                                    background: isActive ? undefined : "var(--surface-secondary)",
                                  }}
                                >
                                  <span
                                    className="inline-flex"
                                    title={
                                      isActive
                                        ? undefined
                                        : "Not enforced yet. Nothing in the system checks this permission."
                                    }
                                  >
                                    <Checkbox
                                      checked={checked}
                                      disabled={!isActive}
                                      onChange={() => handleToggle(resource, action, scope)}
                                    />
                                  </span>
                                </TD>
                              );
                            })
                          )}
                        </TR>
                        {isExpanded && info && (
                          <TR>
                            <TD
                              colSpan={totalCols}
                              style={{
                                height: "auto",
                                padding: "10px 14px 12px",
                                background: "var(--surface-info)",
                              }}
                            >
                              <p
                                className="mb-2"
                                style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}
                              >
                                {info.summary}
                              </p>
                              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                                {Object.entries(info.cells).map(([cellKey, desc]) => {
                                  const [action, scope] = cellKey.split(":");
                                  return (
                                    <li key={cellKey} className="flex items-start gap-2">
                                      <Badge tone="neutral" size="sm">
                                        {ACTION_LABELS[action]} / {SCOPE_LABELS[scope]}
                                      </Badge>
                                      <span
                                        style={{
                                          font: "var(--type-body2)",
                                          color: "var(--text-secondary)",
                                          textWrap: "pretty",
                                        }}
                                      >
                                        {desc}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </TD>
                          </TR>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          </div>

          {error && <Banner tone="error" body={error} />}
        </div>

        <footer
          className="flex flex-wrap items-center justify-between gap-2 px-6 py-4"
          style={{ borderTop: "1px solid var(--stroke-divider)" }}
        >
          <div className="flex gap-2">
            {isEditing && !isSystem && (
              <Button
                hierarchy="secondary"
                tone="error"
                onClick={handleDelete}
                leadingIcon={<Trash2 className="h-4 w-4" />}
              >
                Delete
              </Button>
            )}
            {isEditing && (
              <Button
                hierarchy="secondary"
                onClick={handleDuplicate}
                leadingIcon={<Copy className="h-4 w-4" />}
              >
                Duplicate
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button hierarchy="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              leadingIcon={<Save className="h-4 w-4" />}
            >
              {saving ? "Saving…" : isEditing ? "Update Role" : "Create Role"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
