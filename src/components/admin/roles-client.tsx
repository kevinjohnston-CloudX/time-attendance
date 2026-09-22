"use client";

import { useState } from "react";
import { getRoleById } from "@/actions/role.actions";
import { RoleEditor } from "@/components/admin/role-editor";
import { Lock, Pencil, Plus, Shield } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  SearchInput,
  Table,
  TableFooter,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Toolbar,
  statusTone,
} from "@/components/ui";

/**
 * Roles &amp; Permissions, as the portal design's list template lays it out:
 * header and actions, a toolbar carrying the search box and the record count,
 * then one card holding the table.
 *
 * <p>The page header lives in here rather than in the server component above
 * because "New Role" opens the editor, and the editor is client state. Putting
 * the title in the page and the button in the body would have been the one
 * screen in the product whose primary action is not in the header.
 *
 * <p>Search filters the rows already in the browser. The list is a handful of
 * roles fetched in one query, so a query-string filter would mean a server
 * round trip to hide rows the page is already holding.
 */

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

export function RolesClient({
  roles,
  builtinRoles,
}: {
  roles: RoleSummary[];
  builtinRoles: BuiltinRoleSummary[];
}) {
  const [editingRole, setEditingRole] = useState<RoleDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const visible = q
    ? roles.filter(
        (r) =>
          r.name.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q),
      )
    : roles;

  /**
   * The list query does not carry permissions, so the editor has to fetch the
   * role it is about to open. The row is disabled while that is in flight —
   * a second click would open the editor twice on the same role.
   */
  async function handleEdit(roleId: string) {
    setLoading(roleId);
    const res = await getRoleById({ id: roleId });
    setLoading(null);
    if (res.success) setEditingRole(res.data as RoleDetail);
  }

  /** Templates the editor can copy permissions from; Super Admin bypasses every check. */
  const editorTemplates = builtinRoles.filter((r) => r.key !== "SUPER_ADMIN");
  const editorRoles = roles.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Roles & Permissions"
        subtitle="Who can see and approve what"
        actions={
          <>
            <LinkButton href="/admin" hierarchy="tertiary">
              ← Administration
            </LinkButton>
            <Button
              onClick={() => setShowCreate(true)}
              leadingIcon={<Plus className="h-4 w-4" />}
            >
              New Role
            </Button>
          </>
        }
      />

      <Toolbar count={visible.length} countLabel="role">
        <SearchInput value={search} onValueChange={setSearch} placeholder="Role or description" />
      </Toolbar>

      <Card padding={0}>
        {visible.length === 0 ? (
          /* "No roles" and "no roles matching this search" are different
             answers, and only the first one means create one. */
          <EmptyState
            icon={<Shield className="h-8 w-8" />}
            title={roles.length === 0 ? "No roles yet" : "No roles match that search"}
            body={
              roles.length === 0
                ? "Roles decide what each person can see and approve. Create one to get started."
                : `Nothing in this list matches "${search}". Clear the search to see all ${roles.length} roles.`
            }
            action={
              roles.length === 0 ? (
                <Button
                  size="sm"
                  onClick={() => setShowCreate(true)}
                  leadingIcon={<Plus className="h-3.5 w-3.5" />}
                >
                  New Role
                </Button>
              ) : (
                <Button hierarchy="secondary" size="sm" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Role</TH>
                  <TH>Description</TH>
                  <TH numeric>Rank</TH>
                  <TH numeric>Employees</TH>
                  <TH align="center">Type</TH>
                  <TH align="center">Status</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((role) => (
                  <TR key={role.id}>
                    <TD>
                      <span className="flex items-center gap-2">
                        <Shield
                          className="h-4 w-4 flex-none"
                          style={{ color: "var(--icon-secondary)" }}
                        />
                        <span style={{ fontWeight: "var(--weight-medium)" }}>{role.name}</span>
                      </span>
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }}>{role.description ?? "—"}</TD>
                    {/* Rank is the hierarchy check: a role may only act on roles
                        below its own number, so it is read down the column. */}
                    <TD numeric style={{ color: "var(--text-secondary)" }}>{role.rank}</TD>
                    <TD numeric style={{ color: "var(--text-secondary)" }}>
                      {role._count.employees}
                    </TD>
                    <TD align="center">
                      {role.isSystem ? (
                        <Badge tone="info" size="sm">
                          <Lock className="h-3 w-3" /> System
                        </Badge>
                      ) : (
                        <Badge size="sm">Custom</Badge>
                      )}
                    </TD>
                    <TD align="center">
                      <Badge tone={statusTone(role.isActive ? "ACTIVE" : "INACTIVE")} size="sm">
                        {role.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    <TD align="right">
                      <Button
                        size="sm"
                        hierarchy="secondary"
                        onClick={() => handleEdit(role.id)}
                        disabled={loading === role.id}
                        leadingIcon={<Pencil className="h-3.5 w-3.5" />}
                      >
                        {loading === role.id ? "Loading…" : "Edit"}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter shown={visible.length} total={roles.length} label="roles" />
          </>
        )}
      </Card>

      {editingRole && (
        <RoleEditor
          role={editingRole}
          allRoles={editorRoles}
          builtinRoles={editorTemplates}
          onClose={() => setEditingRole(null)}
        />
      )}
      {showCreate && (
        <RoleEditor
          allRoles={editorRoles}
          builtinRoles={editorTemplates}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
