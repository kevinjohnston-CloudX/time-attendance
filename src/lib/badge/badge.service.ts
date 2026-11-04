import QRCode from "qrcode";
import { db } from "@/lib/db";
import { photoUrls } from "@/lib/presence/photos";
import { isClientBadge } from "@/lib/utils/client-badge";

/**
 * A person's ID badge, as CloudTime draws it on a phone or a screen.
 *
 * <p><b>What the code carries.</b> The badge number and nothing else: the
 * Badge ID (wmsId), or the employee code when there is none, which is what
 * the employee record shows as "Badge ID" and what the WMS prints on a card.
 * The tablets pass the scanned text to the gate check, which finds the person
 * by either form, so a phone badge works at every reader with no tablet
 * change. That also means it is exactly as strong as the printed card: a copy
 * of the code admits whoever holds it. A signed code that changes every few
 * seconds needs the tablet to stop forwarding the raw scan to Oracle, so it
 * waits for that change (Juan, 2026-11-04: plain number for now).
 *
 * <p><b>Who gets a code.</b> Only someone active with no termination date.
 * The gate already turns away a terminated badge; not drawing one at all means
 * a stale screenshot is the only copy left, and the gate refuses that too.
 *
 * <p>Callers decide who may see whose badge. This reads by id alone.
 */

export type BadgeKind = "EMPLOYEE" | "VISITOR";

export interface IdBadge {
  kind: BadgeKind;
  name: string;
  jobTitle: string | null;
  site: string;
  number: string;
  photo: string | null;
  /** False when the badge may not be used: inactive or terminated. No code is drawn. */
  active: boolean;
  /** The QR's dark modules as one SVG path, on a grid `size` across, or null when not active. */
  qr: { size: number; path: string } | null;
}

export async function getIdBadge(employeeId: string): Promise<IdBadge | null> {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      tenantId: true,
      wmsId: true,
      barcode: true,
      employeeCode: true,
      wmsName: true,
      isActive: true,
      terminatedAt: true,
      jobTitle: true,
      jobTitleRef: { select: { name: true } },
      site: { select: { name: true } },
      user: { select: { name: true } },
    },
  });
  if (!e) return null;

  const number = (e.wmsId ?? e.employeeCode).trim();
  const active = e.isActive && e.terminatedAt === null;

  const photo = await photoUrls(e.tenantId, [e])
    .then((urls) => urls.get(e.id) ?? null)
    .catch(() => null); // no photo shows initials, never breaks the badge

  return {
    kind: isClientBadge(number) ? "VISITOR" : "EMPLOYEE",
    name: e.user?.name?.trim() || e.wmsName?.trim() || number,
    jobTitle: e.jobTitleRef?.name?.trim() || e.jobTitle?.trim() || null,
    site: e.site.name,
    number,
    photo,
    active,
    qr: active ? qrPath(number) : null,
  };
}

/**
 * The code as path data the page draws itself, so no generated markup is
 * ever injected. Level M survives a scuffed or glare-washed screen and keeps
 * the modules large: a six-digit number is version 1, 21 modules across.
 */
function qrPath(text: string): { size: number; path: string } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  let path = "";
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (modules.get(y, x)) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size: modules.size, path };
}
