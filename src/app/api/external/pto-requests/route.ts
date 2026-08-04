import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateApiKey, unauthorized, badRequest, notFound } from "@/lib/api/auth-external";
import { daySelectionSchema } from "@/lib/validators/leave.schema";
import { createLeaveRequestCore } from "@/lib/services/leave.service";

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
      ...(employeeCode ? { employeeCode } : { user: { email } }),
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

  return NextResponse.json(
    { leaveRequestId: request.id, status: request.status, durationMinutes: request.durationMinutes },
    { status: 201 }
  );
}
