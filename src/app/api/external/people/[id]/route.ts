import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, unauthorized, missingScope, notFound } from "@/lib/api/auth-external";
import { getPerson } from "@/lib/api/external-people";

/** One person, by the id the list returns. Another company's id is a 404. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(req);
  if (!auth) return unauthorized();
  if (!auth.scopes.includes("people:read")) return missingScope("people:read");

  const { id } = await params;
  const person = id && id.length <= 64 ? await getPerson(auth.tenantId, id) : null;
  if (!person) return notFound("Person not found");

  return NextResponse.json({ person }, { headers: { "Cache-Control": "no-store" } });
}
