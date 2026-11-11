"use client";

import { useState } from "react";
import { getRoleById } from "@/actions/role.actions";
import { RoleEditor } from "@/components/admin/role-editor";
import { Shield, Lock, Plus, Pencil } from "lucide-react";

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
  canViewAs: boolean;
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
  "rounded-lg bg-[var(--fill-accent)] px-4 py-2 text-sm font-medium text-[var(--text-on-accent)] hover:bg-[var(--fill-accent-hover)]";

// ─── Main client component ─────────────────────────────────────────────────────

export function RolesClient({ roles, builtinRoles }: { roles: RoleSummary[]; builtinRoles: BuiltinRoleSummary[] }) {
  const [editingRole, setEditingRole] = useState<RoleDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

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
          <Plus className="h-4 w-4" /> New role
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--stroke-secondary)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
              <th className="px-4 py-3 text-left font-medium text-[var(--text-secondary)]">Role</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--text-secondary)]">Description</th>
              <th className="px-4 py-3 text-center font-medium text-[var(--text-secondary)]">Rank</th>
              <th className="px-4 py-3 text-center font-medium text-[var(--text-secondary)]">Employees</th>
              <th className="px-4 py-3 text-center font-medium text-[var(--text-secondary)]">Type</th>
              <th className="px-4 py-3 text-right font-medium text-[var(--text-secondary)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* ── System + Custom roles ── */}
            <tr className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-800/40">
              <td colSpan={6} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                Roles
              </td>
            </tr>
            {roles.map((role) => (
              <tr key={role.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-zinc-400" />
                    <span className="font-medium text-[var(--text-primary)]">{role.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-[var(--text-tertiary)]">{role.description ?? "—"}</td>
                <td className="px-4 py-3 text-center text-[var(--text-secondary)]">{role.rank}</td>
                <td className="px-4 py-3 text-center text-[var(--text-secondary)]">{role._count.employees}</td>
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

      {/* Edit dialog */}
      {editingRole && (
        <RoleEditor
          role={editingRole}
          allRoles={roles.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem }))}
          builtinRoles={builtinRoles.filter((r) => r.key !== "SUPER_ADMIN")}
          onClose={() => setEditingRole(null)}
        />
      )}

      {/* Create dialog */}
      {showCreate && (
        <RoleEditor
          allRoles={roles.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem }))}
          builtinRoles={builtinRoles.filter((r) => r.key !== "SUPER_ADMIN")}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
