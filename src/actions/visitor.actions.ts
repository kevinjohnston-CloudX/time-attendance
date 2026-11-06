"use server";

import { z } from "zod";
import { withRBAC } from "@/lib/rbac/guard";
import { getViewableSites } from "@/lib/presence/on-site.service";
import { isVisitorKind, termFitsKind } from "@/lib/visitors/visitor-pass";
import {
  addVisitor,
  endVisitorAccess,
  findHosts,
  listSiteVisitors,
  findVisitors,
  nextVisitorBadge,
  recentCompanies,
  renewVisitor,
  visitorSetup,
} from "@/lib/visitors/visitors.service";

/**
 * Visitors on Live Attendance (src/lib/visitors). Every action needs the
 * Visitors permission (VISITOR_MANAGE), which a Live Attendance only role may
 * hold, and works only at a building the viewer may open there: a building
 * they cannot see is answered as not found.
 */

async function assertSite(tenantId: string, viewer: { employeeId: string; role: string }, siteId: string) {
  const sites = await getViewableSites(tenantId, viewer);
  if (!sites.some((s) => s.id === siteId)) throw new Error("NOT_FOUND");
}

const siteInput = z.object({ siteId: z.string().min(1).max(64) });
const searchInput = siteInput.extend({ q: z.string().max(80) });

/** What the New Visitor window needs: the next badge, earlier companies, and whether the company is set up for visitors. */
export const getNewVisitorData = withRBAC("VISITOR_MANAGE", async ({ tenantId, employeeId, role }, input: { siteId: string }) => {
  if (!tenantId) throw new Error("NOT_FOUND");
  const { siteId } = siteInput.parse(input);
  await assertSite(tenantId, { employeeId, role }, siteId);
  const [setup, badge, companies] = await Promise.all([visitorSetup(tenantId), nextVisitorBadge(), recentCompanies(tenantId)]);
  return { missing: setup.ok ? null : setup.missing, nextBadge: badge, companies };
});

/** Earlier visitors whose name or badge holds the text. */
export const searchVisitors = withRBAC("VISITOR_MANAGE", async ({ tenantId, employeeId, role }, input: { siteId: string; q: string }) => {
  if (!tenantId) throw new Error("NOT_FOUND");
  const { siteId, q } = searchInput.parse(input);
  await assertSite(tenantId, { employeeId, role }, siteId);
  return findVisitors(tenantId, siteId, q);
});

/** Staff a visitor may be visiting, by name. Names and departments only. */
export const searchVisitorHosts = withRBAC("VISITOR_MANAGE", async ({ tenantId, employeeId, role }, input: { siteId: string; q: string }) => {
  if (!tenantId) throw new Error("NOT_FOUND");
  const { siteId, q } = searchInput.parse(input);
  await assertSite(tenantId, { employeeId, role }, siteId);
  return findHosts(tenantId, siteId, q);
});

const passFields = z
  .object({
    kind: z.string().refine(isVisitorKind, "Choose frequent visitor or day pass."),
    term: z.string(),
  })
  .refine((v) => isVisitorKind(v.kind) && termFitsKind(v.kind, v.term), { message: "Choose how long the pass lasts.", path: ["term"] });

const newVisitorInput = z
  .object({
    siteId: z.string().min(1).max(64),
    name: z.string().trim().min(2, "Enter the visitor's full name.").max(100),
    company: z.string().trim().min(1, "Enter the company they come from.").max(100),
    hostEmployeeId: z.string().max(64).nullable(),
    hostName: z.string().trim().max(100).nullable(),
  })
  .and(passFields)
  .refine((v) => !!v.hostEmployeeId || !!v.hostName, { message: "Enter who they are visiting.", path: ["hostName"] });

/** Adds a visitor at this building, with a pass, and returns their badge. */
export const createVisitor = withRBAC(
  "VISITOR_MANAGE",
  async (
    { tenantId, employeeId, role },
    input: { siteId: string; name: string; company: string; hostEmployeeId: string | null; hostName: string | null; kind: string; term: string },
  ) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const parsed = newVisitorInput.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    const v = parsed.data;
    await assertSite(tenantId, { employeeId, role }, v.siteId);
    if (!isVisitorKind(v.kind) || !termFitsKind(v.kind, v.term)) throw new Error("Choose how long the pass lasts.");
    return addVisitor(tenantId, employeeId, {
      siteId: v.siteId,
      name: v.name,
      company: v.company,
      hostEmployeeId: v.hostEmployeeId,
      hostName: v.hostEmployeeId ? null : v.hostName,
      kind: v.kind,
      term: v.term,
    });
  },
);

const renewInput = z.object({ siteId: z.string().min(1).max(64), employeeId: z.string().min(1).max(64) }).and(passFields);

/** Renews a visitor's pass at this building (visitors.service.ts renewVisitor). */
export const renewVisitorPass = withRBAC(
  "VISITOR_MANAGE",
  async ({ tenantId, employeeId, role }, input: { siteId: string; employeeId: string; kind: string; term: string }) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const parsed = renewInput.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    const v = parsed.data;
    await assertSite(tenantId, { employeeId, role }, v.siteId);
    if (!isVisitorKind(v.kind) || !termFitsKind(v.kind, v.term)) throw new Error("Choose how long the pass lasts.");
    return renewVisitor(tenantId, employeeId, { employeeId: v.employeeId, siteId: v.siteId, kind: v.kind, term: v.term });
  },
);

/** The building's visitors for the Visitors tab on Live Attendance. */
export const getSiteVisitors = withRBAC("VISITOR_MANAGE", async ({ tenantId, employeeId, role }, input: { siteId: string }) => {
  if (!tenantId) throw new Error("NOT_FOUND");
  const { siteId } = siteInput.parse(input);
  await assertSite(tenantId, { employeeId, role }, siteId);
  return listSiteVisitors(tenantId, siteId);
});

/** End access now: the badge stops opening this building's gate at once. */
export const endVisitor = withRBAC("VISITOR_MANAGE", async ({ tenantId, employeeId, role }, input: { siteId: string; employeeId: string }) => {
  if (!tenantId) throw new Error("NOT_FOUND");
  const v = z.object({ siteId: z.string().min(1).max(64), employeeId: z.string().min(1).max(64) }).parse(input);
  await assertSite(tenantId, { employeeId, role }, v.siteId);
  return endVisitorAccess(tenantId, employeeId, { siteId: v.siteId, employeeId: v.employeeId });
});
