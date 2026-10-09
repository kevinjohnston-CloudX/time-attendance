import { db } from "@/lib/db";

/**
 * The time zone a tablet's scan time is read in: the zone of the building the
 * tablet is in.
 *
 * <p>Time Clock tablets stamp local time with no offset. It used to be read in
 * the scanned person's own site zone, which is the same thing until someone
 * scans at a tablet in another zone: a Rey 11 person (an Eastern site) working
 * at the California warehouse had a 7:00 AM Pacific scan stored as 7:00 AM
 * Eastern, three hours early.
 *
 * <p>The building is the tablet's warehouse number (sites.wmsWarehouseId), else
 * the site on its device record. When neither is known, the person's site, as
 * before, and Eastern for a badge nobody matches.
 */
export async function tabletTimeZone(opts: {
  warehouse?: string | number | null;
  deviceName?: string | null;
  personTimeZone?: string | null;
}): Promise<string> {
  const number = opts.warehouse == null || opts.warehouse === "" ? NaN : Number(opts.warehouse);
  if (Number.isInteger(number)) {
    const site = await db.site.findFirst({ where: { wmsWarehouseId: number }, select: { timezone: true } });
    if (site?.timezone) return site.timezone;
  }
  if (opts.deviceName) {
    const device = await db.device.findFirst({
      where: { deviceName: opts.deviceName, siteId: { not: null } },
      orderBy: { lastSeenAt: "desc" },
      select: { site: { select: { timezone: true } } },
    });
    if (device?.site?.timezone) return device.site.timezone;
  }
  return opts.personTimeZone ?? "America/New_York";
}
