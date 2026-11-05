import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateApiKey, missingScope, unauthorized, badRequest, notFound } from "@/lib/api/auth-external";
import { daySelectionSchema } from "@/lib/validators/leave.schema";
import { createLeaveRequestCore, submitLeaveRequestCore } from "@/lib/services/leave.service";
import { writeAuditLog } from "@/lib/audit/logger";

const requestSchema = z.object({
  employeeCode: z.string().min(1).optional(),
  email: z.string().email().optional(),
  leaveTypeCode: z.number().int().positive(),
  selectedDays: z.array(daySelectionSchema).min(1, "At least one day is required"),
  note: z.string().optional(),
}).refine((d) => d.employeeCode || d.email, {
  message: "Either employeeCode or email is required",
});

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return unauthorized();
  if (!auth.scopes.includes("time-off:write")) return missingScope("time-off:write");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const { employeeCode, email, leaveTypeCode, selectedDays, note } = parsed.data;

  // Resolve employee
  const employee = await db.employee.findFirst({
    where: {
      tenantId: auth.tenantId,
      isActive: true,
      // Either email: the personal one as spelled, the work one is saved
      // lowercase. Exact on purpose: a case-insensitive match runs ILIKE, where
      // a sent % would match somebody else.
      ...(employeeCode ? { employeeCode } : { user: { OR: [{ email }, { workEmail: email?.toLowerCase() }] } }),
    },
    select: { id: true },
  });
  if (!employee) return notFound("Employee not found");

  // Resolve leave type by external code
  const leaveType = await db.leaveType.findFirst({
    where: { tenantId: auth.tenantId, externalCode: leaveTypeCode, isActive: true },
    select: { id: true },
  });
  if (!leaveType) return notFound(`Leave type with code ${leaveTypeCode} not found`);

  const request = await createLeaveRequestCore(employee.id, {
    leaveTypeId: leaveType.id,
    selectedDays,
    note,
  });

  // Auto-submit so the request reaches an approver (DRAFT → PENDING)
  const submitted = await submitLeaveRequestCore(employee.id, auth.tenantId, request.id);
  // Sent by a key, not a person: the activity log names the key and whoever
  // made it, so a request nobody remembers sending can be traced.
  await writeAuditLog({
    tenantId: auth.tenantId,
    actorId: auth.createdById,
    action: "API_TIME_OFF_SENT",
    entityType: "LEAVE_REQUEST",
    entityId: submitted.id,
    changes: { after: { apiKey: auth.keyName, keyId: auth.keyId, employee: employee.id } },
  });

  return NextResponse.json(
    { leaveRequestId: submitted.id, status: submitted.status, durationMinutes: submitted.durationMinutes },
    { status: 201 }
  );
}
