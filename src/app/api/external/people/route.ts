import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, unauthorized, missingScope } from "@/lib/api/auth-external";
import { listPeople, peopleQuerySchema } from "@/lib/api/external-people";

/**
 * The company's employee directory, a page at a time, for a key with
 * "people:read". Filters combine: q searches names, usernames, emails, the
 * employee code and the badge ID; email, username, badge and employeeCode are
 * exact (emails and usernames ignoring capitals, badges in either form the
 * tablets accept). See lib/api/external-people for what is and is not sent.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return unauthorized();
  if (!auth.scopes.includes("people:read")) return missingScope("people:read");

  const parsed = peopleQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json(await listPeople(auth.tenantId, parsed.data), {
    headers: { "Cache-Control": "no-store" },
  });
}
