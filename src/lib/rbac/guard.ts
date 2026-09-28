import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";
import { hasPermission, type Permission } from "./permissions";
import { hasPermissionByLegacy } from "./permission-resolver";
import { getEffectiveRole } from "./check-permission";
import type { Role } from "./roles";
import { INACTIVE_PERMISSIONS } from "./identity";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

/**
 * What the browser is told when an action fails.
 *
 * <p>Actions throw plain sentences on purpose ("Cannot modify a locked or
 * approved timesheet."), and those pass through. A database or internal
 * error never does: its text names tables, fields, queries and file paths,
 * which anyone can read in devtools. That is logged here with a short
 * reference, and the browser gets the reference only.
 */
function publicError(err: unknown): string {
  if (err instanceof ZodError) return err.issues[0]?.message ?? "Some of the details are not valid";
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return "Not found";
  const internal =
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientValidationError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError ||
    !(err instanceof Error) ||
    /[Pp]risma|invocation|\n|\bat \/|\bSELECT\b|\bINSERT INTO\b|\bUPDATE "|\bDELETE FROM\b|violates|ECONNREFUSED|ETIMEDOUT/.test(err.message) ||
    err.message.length > 200;
  if (!internal) return (err as Error).message;
  const ref = randomBytes(4).toString("hex").toUpperCase();
  console.error(`[action error ${ref}]`, err);
  return `Something went wrong. Reference ${ref}`;
}

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Wraps a Server Action with RBAC enforcement.
 * When the employee has a customRoleId, permissions are resolved from the DB.
 * Otherwise falls back to the static role-permission map.
 */
export function withRBAC<TInput, TOutput>(
  permission: Permission | Permission[],
  handler: (
    ctx: { employeeId: string; role: Role; tenantId: string | null },
    input: TInput
  ) => Promise<TOutput>
) {
  return async (input: TInput): Promise<ActionResult<TOutput>> => {
    const session = await auth();

    if (!session?.user) {
      return { success: false, error: "UNAUTHENTICATED" };
    }

    // Somebody who must replace a temporary password can do nothing else
    // until they have. The page layout sends them to the form; this is the
    // same rule for a direct call.
    if (session.user.mustChangePassword) return { success: false, error: "FORBIDDEN" };

    // An inactive employee keeps only their own documents, balances and
    // last timesheet, whatever their role was. The menu already shows only
    // those; this is what makes it true for a direct call.
    const perms = Array.isArray(permission) ? permission : [permission];
    if (session.user.isActive === false && !perms.some((p) => (INACTIVE_PERMISSIONS as readonly string[]).includes(p))) {
      return { success: false, error: "FORBIDDEN" };
    }

    const realRole = session.user.role ?? "EMPLOYEE";
    const effectiveRole = await getEffectiveRole(session.user);
    const isPrivilegedAdmin = ["SUPER_ADMIN", "SYSTEM_ADMIN"].includes(realRole);

    if (!isPrivilegedAdmin) {
      const customRoleId = (session.user as { customRoleId?: string | null }).customRoleId ?? null;
      const allowed = customRoleId
        ? await Promise.all(perms.map((p) => hasPermissionByLegacy(customRoleId, p))).then((r) => r.some(Boolean))
        : perms.some((p) => hasPermission(effectiveRole, p));
      if (!allowed) return { success: false, error: "FORBIDDEN" };
    }

    try {
      let tenantId = session.user.tenantId ?? null;
      // Only a super admin works inside another company. A company's own
      // System Admin stays in theirs, whatever the cookie says.
      if (realRole === "SUPER_ADMIN") {
        const cookieStore = await cookies();
        const override = cookieStore.get(SUPER_ADMIN_TENANT_COOKIE)?.value;
        if (override) tenantId = override;
      }

      const data = await handler(
        {
          employeeId: session.user.employeeId ?? "",
          role: effectiveRole as Role,
          tenantId,
        },
        input
      );
      return { success: true, data };
    } catch (err) {
      return { success: false, error: publicError(err) };
    }
  };
}
