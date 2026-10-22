import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";
import { hasPermission, type Permission } from "./permissions";
import { hasPermissionByLegacy } from "./permission-resolver";
import { checkViewAsPermission, getEffectiveRole, validViewAsId, viewAsRank } from "./check-permission";
import type { Role } from "./roles";
import { INACTIVE_PERMISSIONS } from "./identity";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ACTION_ERROR_TEXT, codeOfMessage, textOfCode, type ActionErrorCode } from "@/lib/action-errors";
import { zodMessage } from "@/lib/zod-message";

/**
 * What the browser is told when an action fails.
 *
 * <p>Actions throw plain sentences on purpose ("This timecard is locked or
 * approved by payroll, so it can't be changed."), and those pass through. A database or internal
 * error never does: its text names tables, fields, queries and file paths,
 * which anyone can read in devtools. That is logged here with a short
 * reference, and the browser gets the reference only.
 */
/** What a unique field is called on screen. Keys and company ids are left out of the sentence. */
const UNIQUE_FIELD_LABEL: Record<string, string> = {
  email: "email",
  workEmail: "work email",
  employeeCode: "Badge ID",
  wmsId: "Badge ID",
  barcode: "badge barcode",
  adpWorkerId: "ADP Worker ID",
  name: "name",
  code: "code",
  number: "number",
};

/**
 * A save refused because a value is already on another record (Postgres
 * 23505, Prisma P2002), said by which field: "That Badge ID is already in
 * use." The fields come from the driver's report; nothing else of the error
 * reaches the browser. It used to read "Something went wrong" with a
 * reference only the server log could explain.
 */
export function alreadyInUse(err: Prisma.PrismaClientKnownRequestError): string {
  const meta = (err.meta ?? {}) as {
    target?: string | string[];
    driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } };
  };
  const raw = [
    ...(Array.isArray(meta.target) ? meta.target : meta.target ? [meta.target] : []),
    ...(meta.driverAdapterError?.cause?.constraint?.fields ?? []),
  ].map((f) => f.replace(/"/g, "").trim());
  const label = raw.map((f) => UNIQUE_FIELD_LABEL[f]).find(Boolean);
  return label ? `That ${label} is already in use.` : "One of these details is already in use on another record.";
}

export type Failure = { success: false; error: string; code?: ActionErrorCode };

/** A failure as a sentence, with its code when it stands for one (see action-errors). */
export function failure(code: ActionErrorCode, text: string = textOfCode(code)): Failure {
  return { success: false, error: text, code };
}

/** A thrown error as the browser may see it; for actions that check permissions themselves. */
export function publicError(err: unknown): Failure {
  if (err instanceof ZodError) return { success: false, error: zodMessage(err) };
  // The record is gone: changed or removed by someone else since the page loaded.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return failure("NOT_FOUND");
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { success: false, error: alreadyInUse(err) };
  // The database's one address, one person rule (users_login_email_unique),
  // for a save that reached it without the action's own check first.
  // Only a database error: the actions' own sentences (which name who has it) pass through.
  if (
    (err instanceof Prisma.PrismaClientKnownRequestError || err instanceof Prisma.PrismaClientUnknownRequestError) &&
    /already used by another person|work email and the personal email are the same address/.test(err.message)
  ) {
    return { success: false, error: "That email is already in use." };
  }
  // A code thrown as a message ("FORBIDDEN", "Tenant context required") is said in words.
  const code = err instanceof Error ? codeOfMessage(err.message) : null;
  if (code) return failure(code);
  // An out-of-scope record keeps its own sentence ("Employee not found"), and its code.
  if (err instanceof Error && err.name === "NotFoundError") return { success: false, error: err.message, code: "NOT_FOUND" };
  return { success: false, error: internalOrMessage(err) };
}

function internalOrMessage(err: unknown): string {
  const internal =
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientValidationError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError ||
    !(err instanceof Error) ||
    /[Pp]risma|invocation|\n|\bat \/|\bSELECT\b|\bINSERT INTO\b|\bUPDATE "|\bDELETE FROM\b|violates|ECONNREFUSED|ETIMEDOUT/.test(err.message) ||
    // A sentence or two of our own; anything longer is a dump. Two missing ADP code notes run past 200.
    err.message.length > 400;
  if (!internal) return (err as Error).message;
  const ref = randomBytes(4).toString("hex").toUpperCase();
  console.error(`[action error ${ref}]`, err);
  return `Something went wrong. Reference ${ref}`;
}

type ActionResult<T> =
  | { success: true; data: T }
  | Failure;

/**
 * Wraps a Server Action with RBAC enforcement.
 * When the employee has a customRoleId, permissions are resolved from the DB.
 * Otherwise falls back to the static role-permission map.
 */
export function withRBAC<TInput, TOutput>(
  permission: Permission | Permission[],
  handler: (
    ctx: { employeeId: string; role: Role; tenantId: string | null; viewAsRank?: number },
    input: TInput
  ) => Promise<TOutput>
) {
  return async (input: TInput): Promise<ActionResult<TOutput>> => {
    const session = await auth();

    if (!session?.user) {
      return failure("UNAUTHENTICATED");
    }

    // Somebody who must replace a temporary password can do nothing else
    // until they have. The page layout sends them to the form; this is the
    // same rule for a direct call.
    if (session.user.mustChangePassword) return failure("FORBIDDEN", ACTION_ERROR_TEXT.MUST_CHANGE_PASSWORD);

    // An inactive employee keeps only their own documents, balances and
    // last timesheet, whatever their role was. The menu already shows only
    // those; this is what makes it true for a direct call.
    const perms = Array.isArray(permission) ? permission : [permission];
    if (session.user.isActive === false && !perms.some((p) => (INACTIVE_PERMISSIONS as readonly string[]).includes(p))) {
      return failure("FORBIDDEN", ACTION_ERROR_TEXT.INACTIVE);
    }

    const realRole = session.user.role ?? "EMPLOYEE";
    const effectiveRole = await getEffectiveRole(session.user);
    // While viewing as a role, actions get that role's permissions and rank,
    // so View as shows what the role can do and not only what it can see.
    const viewAsId = await validViewAsId(session.user);
    const isPrivilegedAdmin = !viewAsId && ["SUPER_ADMIN", "SYSTEM_ADMIN"].includes(realRole);

    if (!isPrivilegedAdmin) {
      const customRoleId = (session.user as { customRoleId?: string | null }).customRoleId ?? null;
      const allowed = viewAsId
        ? await Promise.all(perms.map((p) => checkViewAsPermission(viewAsId, p))).then((r) => r.some(Boolean))
        : customRoleId
          ? await Promise.all(perms.map((p) => hasPermissionByLegacy(customRoleId, p))).then((r) => r.some(Boolean))
          : perms.some((p) => hasPermission(effectiveRole, p));
      if (!allowed) return failure("FORBIDDEN");
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
          viewAsRank: viewAsId ? await viewAsRank(viewAsId) : undefined,
        },
        input
      );
      return { success: true, data };
    } catch (err) {
      return publicError(err);
    }
  };
}
