"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createRole, updateRole, deleteRole, duplicateRole } from "@/actions/role.actions";
import { RESOURCES, ACTIONS, SCOPES, type PermissionEntry } from "@/lib/validators/role.schema";
import { LEGACY_MAP } from "@/lib/rbac/legacy-map";
import { Trash2, Copy, Save, X, CopyCheck, Info } from "lucide-react";

// Only these cells map to an enforced server-side permission check.
// All others are rendered but non-functional — disable them in the UI.
const ACTIVE_CELLS = new Set(
  Object.values(LEGACY_MAP).map((t) => `${t.resource}:${t.action}:${t.scope}`)
);

const RESOURCE_LABELS: Record<string, string> = {
  punch: "Punches",
  timesheet: "Timesheets",
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
      "execute:team": "Approve or reject timesheets submitted by your direct reports.",
      "execute:all":  "Approve or reject timesheets for any employee across all teams.",
    },
  },
  leave: {
    summary: "Controls leave requests and the approval workflow.",
    cells: {
      "write:own":    "Submit leave requests (PTO, sick, etc.) for yourself.",
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
      "write:all": "Open and close pay periods, access timecards, manage pay codes and payroll settings.",
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

const btnPrimary =
  "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const btnSecondary =
  "rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800";
const btnDanger =
  "rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30";

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
  allRoles,
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
          canViewAs,
          permissions,
        });
        if (!res.success) {
          setError(res.error);
          setSaving(false);
          return;
        }
      } else {
        const res = await createRole({ name, description, rank, canViewAs, permissions });
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[5vh]">
      <div className="w-full max-w-4xl rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            {isEditing ? `Edit Role: ${role.name}` : "Create New Role"}
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Basic fields */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSystem}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white disabled:opacity-50"
                placeholder="e.g. Shift Lead"
              />
              {isSystem && (
                <p className="mt-1 text-xs text-zinc-400">System roles cannot be renamed</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Rank
              </label>
              <input
                type="number"
                value={rank}
                onChange={(e) => setRank(Number(e.target.value))}
                min={0}
                max={100}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              />
              <p className="mt-1 text-xs text-zinc-400">Higher rank = more privileged</p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              placeholder="Brief description of this role"
            />
          </div>

          {/* View-as toggle */}
          <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Allow View As</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Users with this role can simulate other roles with a lower rank to preview their experience.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={canViewAs}
              onClick={() => setCanViewAs((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 ${
                canViewAs ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-700"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  canViewAs ? "translate-x-4" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* Mimic built-in role */}
          {builtinRoles.length > 0 && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/40">
              <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Load permissions from a built-in role
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={selectedBuiltinKey}
                  onChange={(e) => setSelectedBuiltinKey(e.target.value)}
                  className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="">— Select a built-in role —</option>
                  {builtinRoles.map((r) => (
                    <option key={r.key} value={r.key}>{r.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleMimicBuiltin}
                  disabled={!selectedBuiltinKey}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  <CopyCheck className="h-4 w-4" />
                  Apply
                </button>
              </div>
              <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                This will replace the current permission selection with the chosen built-in role&apos;s permissions.
              </p>
            </div>
          )}

          {/* Permission Matrix */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Permissions
            </h3>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50">
                    <th className="px-4 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">
                      Resource
                    </th>
                    {ACTIONS.map((action) => (
                      <th
                        key={action}
                        colSpan={3}
                        className="border-l border-zinc-200 px-2 py-2 text-center font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                      >
                        {ACTION_LABELS[action]}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-zinc-200 bg-zinc-50/50 dark:border-zinc-700 dark:bg-zinc-800/30">
                    <th />
                    {ACTIONS.map((action) =>
                      SCOPES.map((scope) => (
                        <th
                          key={`${action}-${scope}`}
                          className={`px-2 py-1 text-center text-xs font-normal text-zinc-500 dark:text-zinc-500 ${
                            scope === "own" ? "border-l border-zinc-200 dark:border-zinc-700" : ""
                          }`}
                        >
                          {SCOPE_LABELS[scope]}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {RESOURCES.map((resource) => {
                    const info = RESOURCE_INFO[resource];
                    const isExpanded = expandedResource === resource;
                    const totalCols = 1 + ACTIONS.length * SCOPES.length;
                    return (
                      <React.Fragment key={resource}>
                        <tr
                          className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                        >
                          <td className="px-4 py-2.5 font-medium text-zinc-700 dark:text-zinc-300">
                            <div className="flex items-center gap-1.5">
                              {RESOURCE_LABELS[resource]}
                              {info && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedResource(isExpanded ? null : resource)}
                                  className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                                  title="About this permission"
                                >
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                          {ACTIONS.map((action) =>
                            SCOPES.map((scope) => {
                              const key = permKey(resource, action, scope);
                              const checked = permSet.has(key);
                              const isActive = ACTIVE_CELLS.has(key);
                              return (
                                <td
                                  key={`${resource}-${action}-${scope}`}
                                  className={`px-2 py-2.5 text-center ${
                                    scope === "own"
                                      ? "border-l border-zinc-200 dark:border-zinc-700"
                                      : ""
                                  } ${!isActive ? "bg-zinc-50 dark:bg-zinc-800/40" : ""}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => handleToggle(resource, action, scope)}
                                    disabled={!isActive}
                                    title={!isActive ? "Not enforced — no server action checks this permission" : undefined}
                                    className={`h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 ${
                                      !isActive ? "cursor-not-allowed opacity-20" : ""
                                    }`}
                                  />
                                </td>
                              );
                            })
                          )}
                        </tr>
                        {isExpanded && info && (
                          <tr className="border-b border-zinc-100 bg-blue-50/60 dark:border-zinc-800 dark:bg-blue-950/20">
                            <td colSpan={totalCols} className="px-4 pb-3 pt-2">
                              <p className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">{info.summary}</p>
                              <ul className="space-y-1">
                                {Object.entries(info.cells).map(([cellKey, desc]) => {
                                  const [action, scope] = cellKey.split(":");
                                  return (
                                    <li key={cellKey} className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-500">
                                      <span className="mt-0.5 shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400">
                                        {ACTION_LABELS[action]} / {SCOPE_LABELS[scope]}
                                      </span>
                                      <span>{desc}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <div className="flex gap-2">
            {isEditing && !isSystem && (
              <button onClick={handleDelete} className={btnDanger + " flex items-center gap-1.5"}>
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}
            {isEditing && (
              <button onClick={handleDuplicate} className={btnSecondary + " flex items-center gap-1.5"}>
                <Copy className="h-4 w-4" /> Duplicate
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className={btnSecondary}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className={btnPrimary + " flex items-center gap-1.5"}
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : isEditing ? "Update Role" : "Create Role"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
