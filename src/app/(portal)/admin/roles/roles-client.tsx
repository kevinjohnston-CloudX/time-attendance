"use client";

import { useState } from "react";
import { getRoleById } from "@/actions/role.actions";
import { RoleEditor } from "@/components/admin/role-editor";
import { RESOURCES, ACTIONS, SCOPES } from "@/lib/validators/role.schema";
import { Shield, Lock, Plus, Pencil, X, Eye } from "lucide-react";

type RoleSummary = {
  id: string;
  name: string;
  description: string | null;
  rank: number;
  isSystem: boolean;
  isActive: boolean;
  _count: { employees: number };
};

type RoleDetail = {
  id: string;
  name: string;
  description: string | null;
  rank: number;
  isSystem: boolean;
  permissions: { resource: string; action: string; scope: string }[];
  _count: { employees: number };
};

type BuiltinRoleSummary = {
  key: string;
  name: string;
  description: string | null;
  rank: number;
  permissions: { resource: string; action: string; scope: string }[];
  employeeCount: number;
};

const btnPrimary =
  "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

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

function permKey(resource: string, action: string, scope: string) {
  return `${resource}:${action}:${scope}`;
}

// ─── Read-only permission matrix modal ────────────────────────────────────────

function PermissionModal({ role, onClose }: { role: BuiltinRoleSummary; onClose: () => void }) {
  const permSet = new Set(role.permissions.map((p) => permKey(p.resource, p.action, p.scope)));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[5vh]">
      <div className="w-full max-w-4xl rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
              {role.name}
            </h2>
            {role.description && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{role.description}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              <Lock className="h-3 w-3" /> Built-in · Read only
            </span>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {role.key === "SUPER_ADMIN" ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Super Admin bypasses all permission checks — unrestricted access to every resource and action.
            </p>
          ) : (
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
                            const checked = permSet.has(permKey(resource, action, scope));
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
                                  readOnly
                                  className="h-4 w-4 cursor-default rounded border-zinc-300 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800"
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
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <p className="text-xs text-zinc-400">
            Built-in roles cannot be edited. Create a custom role to define custom permissions.
          </p>
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main client component ─────────────────────────────────────────────────────

export function RolesClient({ roles, builtinRoles }: { roles: RoleSummary[]; builtinRoles: BuiltinRoleSummary[] }) {
  const [editingRole, setEditingRole] = useState<RoleDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [viewingBuiltin, setViewingBuiltin] = useState<BuiltinRoleSummary | null>(null);

  async function handleEdit(roleId: string) {
    setLoading(roleId);
    const res = await getRoleById({ id: roleId });
    setLoading(null);
    if (res.success) {
      setEditingRole(res.data as RoleDetail);
    }
  }

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-end">
        <button onClick={() => setShowCreate(true)} className={btnPrimary + " flex items-center gap-1.5"}>
          <Plus className="h-4 w-4" /> New Role
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Role</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Description</th>
              <th className="px-4 py-3 text-center font-medium text-zinc-600 dark:text-zinc-400">Rank</th>
              <th className="px-4 py-3 text-center font-medium text-zinc-600 dark:text-zinc-400">Employees</th>
              <th className="px-4 py-3 text-center font-medium text-zinc-600 dark:text-zinc-400">Type</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* ── Built-in roles ── */}
            <tr className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-800/40">
              <td colSpan={6} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Built-in Roles
              </td>
            </tr>
            {builtinRoles.map((role) => (
              <tr key={role.key} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-zinc-400" />
                    <span className="font-medium text-zinc-900 dark:text-white">{role.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                  {role.description ?? "—"}
                </td>
                <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">{role.rank}</td>
                <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">{role.employeeCount}</td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    <Lock className="h-3 w-3" /> Built-in
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setViewingBuiltin(role)}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {role.permissions.length} permissions
                  </button>
                </td>
              </tr>
            ))}

            {/* ── Custom roles ── */}
            <tr className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-800/40">
              <td colSpan={6} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Custom Roles
              </td>
            </tr>
            {roles.map((role) => (
              <tr key={role.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-zinc-400" />
                    <span className="font-medium text-zinc-900 dark:text-white">{role.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{role.description ?? "—"}</td>
                <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">{role.rank}</td>
                <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">{role._count.employees}</td>
                <td className="px-4 py-3 text-center">
                  {role.isSystem ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      <Lock className="h-3 w-3" /> System
                    </span>
                  ) : (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      Custom
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleEdit(role.id)}
                    disabled={loading === role.id}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {loading === role.id ? "Loading..." : "Edit"}
                  </button>
                </td>
              </tr>
            ))}
            {roles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  No custom roles yet. Create one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Permission viewer */}
      {viewingBuiltin && (
        <PermissionModal role={viewingBuiltin} onClose={() => setViewingBuiltin(null)} />
      )}

      {/* Edit dialog */}
      {editingRole && (
        <RoleEditor
          role={editingRole}
          allRoles={roles.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem }))}
          onClose={() => setEditingRole(null)}
        />
      )}

      {/* Create dialog */}
      {showCreate && (
        <RoleEditor
          allRoles={roles.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem }))}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
