import { NextRequest, NextResponse } from "next/server";
import { timeclockKeyValid } from "@/lib/api/timeclock-auth";
import { db } from "@/lib/db";
import { deviceBadgeWhere } from "@/lib/utils/badge-lookup";
import { writeAuditLog } from "@/lib/audit/logger";
import { buildingLanguageCodes, tabletBuilding, tabletLanguages } from "@/lib/timeclock/tablet-languages";

/**
 * POST /api/timeclock/language: a person picked their language on a tablet
 * (TABLET-LANGUAGES-PLAN.md). Body: { badge, language, warehouse?, device? }.
 *
 * <p>Who: a tablet, with the time clock key, as every /api/timeclock route.
 * What it can do: set one person's Preferred language, and only to a
 * language the building the tablet is in offers, for an active person of a
 * company whose tablets are connected (the same badge match as the badge
 * check). Nothing else on the record can change through here. Every change
 * is written to the person's change history with the building and tablet.
 *
 * <p>Answers the person's language and the building's list, as the badge
 * check does, so the tablet can redraw at once. A refusal says why in a
 * fixed `code`; it is final, so the tablet should not retry it.
 */

export const dynamic = "force-dynamic";

const refuse = (status: number, code: string, error: string) => NextResponse.json({ success: false, code, error }, { status });

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!timeclockKeyValid(req)) return refuse(401, "UNAUTHORIZED", "Unauthorized");

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return refuse(400, "BAD_REQUEST", "Send JSON: { badge, language, warehouse, device }");
  }
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "") || null;
  const badge = text(body.badge, 40);
  const language = text(body.language, 10);
  const from = { warehouse: text(body.warehouse, 20), device: text(body.device, 100) };
  if (!badge || !language) return refuse(400, "BAD_REQUEST", "badge and language are required");

  const employee = await db.employee.findFirst({
    where: deviceBadgeWhere(badge),
    select: { id: true, tenantId: true, siteId: true, isActive: true, preferredLanguage: true },
  });
  if (!employee || !employee.isActive) return refuse(404, "NOT_FOUND", "No active person has this badge");

  const building = await tabletBuilding(employee.tenantId, from, employee.siteId);
  const codes = buildingLanguageCodes(building);
  if (!codes.includes(language)) return refuse(400, "NOT_OFFERED", "This building does not offer that language");

  if (employee.preferredLanguage !== language) {
    await db.employee.updateMany({ where: { id: employee.id, tenantId: employee.tenantId }, data: { preferredLanguage: language } });
    await writeAuditLog({
      tenantId: employee.tenantId,
      actorId: null,
      action: "PREFERRED_LANGUAGE_SET",
      entityType: "EMPLOYEE",
      entityId: employee.id,
      changes: {
        before: { preferredLanguage: employee.preferredLanguage },
        after: { preferredLanguage: language, via: "Time clock", siteId: building?.id ?? null, device: from.device },
      },
    });
  }

  return NextResponse.json({ success: true, ...tabletLanguages(language, codes) });
}
