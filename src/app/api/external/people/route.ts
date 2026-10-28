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

  const result = await listPeople(auth.tenantId, parsed.data);
  // The same request one page on, as a path, or null on the last page. A
  // path because behind the proxy this server does not know its public host.
  let nextPage: string | null = null;
  if (result.page * result.pageSize < result.total) {
    const next = new URLSearchParams(req.nextUrl.searchParams);
    next.set("page", String(result.page + 1));
    nextPage = `/api/external/people?${next.toString()}`;
  }
  return NextResponse.json({ ...result, nextPage }, {
    headers: { "Cache-Control": "no-store" },
  });
}
