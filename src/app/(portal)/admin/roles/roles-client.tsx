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
  permissions: { resource: string; action: string; scope: string }[];
  _count: { employees: number };
};

const btnPrimary =
  "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

export function RolesClient({ roles }: { roles: RoleSummary[] }) {
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
            {roles.map((role) => (
              <tr
                key={role.id}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-zinc-400" />
                    <span className="font-medium text-zinc-900 dark:text-white">{role.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                  {role.description ?? "—"}
                </td>
                <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">
                  {role.rank}
                </td>
                <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">
                  {role._count.employees}
                </td>
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
                  No roles found. Create one to get started.
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
