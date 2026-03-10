"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRole, updateRole, deleteRole, duplicateRole } from "@/actions/role.actions";
import { RESOURCES, ACTIONS, SCOPES, type PermissionEntry } from "@/lib/validators/role.schema";
import { Trash2, Copy, Save, X } from "lucide-react";

const RESOURCE_LABELS: Record<string, string> = {
  punch: "Punches",
  timesheet: "Timesheets",
  leave: "Leave",
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

type RoleData = {
  id: string;
  name: string;
  description: string | null;
  rank: number;
  isSystem: boolean;
  permissions: { resource: string; action: string; scope: string }[];
  _count: { employees: number };
};

type AllRole = {
  id: string;
  name: string;
  isSystem: boolean;
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
    // Check this and all lower scopes
    for (let i = 0; i <= scopeIdx; i++) {
      next.add(permKey(resource, action, SCOPE_ORDER[i]));
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
  onClose,
}: {
  role?: RoleData;
  allRoles: AllRole[];
  onClose: () => void;
}) {
  const router = useRouter();
  const isEditing = !!role;
  const isSystem = role?.isSystem ?? false;

  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [rank, setRank] = useState(role?.rank ?? 0);
  const [permSet, setPermSet] = useState<Set<string>>(
    buildPermSet((role?.permissions ?? []) as PermissionEntry[])
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleToggle(resource: string, action: string, scope: string) {
    const key = permKey(resource, action, scope);
    const checked = !permSet.has(key);
    setPermSet(autoCheckHigherScopes(permSet, resource, action, scope, checked));
  }

  function handleCloneFrom(sourceId: string) {
    const source = allRoles.find((r) => r.id === sourceId);
    if (!source) return;
    // We need to fetch the role's permissions — for now just do nothing if it's the same
    // Actually, we should pass permissions data with allRoles. For simplicity, we'll keep this as a server action.
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
          permissions,
        });
        if (!res.success) {
          setError(res.error);
          setSaving(false);
          return;
        }
      } else {
        const res = await createRole({ name, description, rank, permissions });
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
                  {RESOURCES.map((resource) => (
                    <tr
                      key={resource}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                    >
                      <td className="px-4 py-2.5 font-medium text-zinc-700 dark:text-zinc-300">
                        {RESOURCE_LABELS[resource]}
                      </td>
                      {ACTIONS.map((action) =>
                        SCOPES.map((scope) => {
                          const key = permKey(resource, action, scope);
                          const checked = permSet.has(key);
                          return (
                            <td
                              key={`${resource}-${action}-${scope}`}
                              className={`px-2 py-2.5 text-center ${
                                scope === "own"
                                  ? "border-l border-zinc-200 dark:border-zinc-700"
                                  : ""
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggle(resource, action, scope)}
                                className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800"
                              />
                            </td>
                          );
                        })
                      )}
                    </tr>
                  ))}
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
