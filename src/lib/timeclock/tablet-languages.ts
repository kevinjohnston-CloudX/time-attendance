import { db } from "@/lib/db";
import { cleanLanguages, isLanguageCode, nativeLanguageName } from "@/lib/languages";

/**
 * Which language a time clock or gate tablet shows a person in, and which
 * languages it offers them (TABLET-LANGUAGES-PLAN.md, Nov 6 2026).
 *
 * <p>A person with a language saved (Preferred language on their record)
 * sees every tablet in it, at any building. A person with none is offered
 * the languages of the building the tablet is in, its main one first; one
 * tap saves it (POST /api/timeclock/language). A building with one language
 * or none never asks, and a building with none set offers nothing, so it
 * works exactly as before.
 *
 * <p>The tablet app owns every word on its screens; CloudTime only says
 * which language. A tablet build that does not read these fields is
 * unaffected.
 */

export interface TabletLanguage {
  code: string;
  /** The language's name in itself, for the button: "Español". */
  name: string;
}

export interface TabletLanguages {
  /** The person's saved language, or null. */
  language: string | null;
  /** The building's languages in order, the main one first. Empty when none are set. */
  languages: TabletLanguage[];
  /** True when the tablet should offer the choice: nothing saved, and more than one to choose from. */
  askLanguage: boolean;
}

type BuildingRow = { id: string; wmsWarehouseId: number | null; primaryLanguage: string | null; additionalLanguages: string[] };
type Company = { sites: BuildingRow[]; devices: Map<string, string> };

/**
 * A company's buildings and tablets, kept a minute per server: the badge
 * check runs on every scan, and these change a few times a year.
 */
const KEEP_MS = 60_000;
const companies = new Map<string, { at: number; value: Promise<Company> }>();

function company(tenantId: string): Promise<Company> {
  const hit = companies.get(tenantId);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;
  const entry = {
    at: Date.now(),
    value: Promise.all([
      db.site.findMany({
        where: { tenantId },
        select: { id: true, wmsWarehouseId: true, primaryLanguage: true, additionalLanguages: true },
      }),
      db.device.findMany({ where: { tenantId, siteId: { not: null } }, select: { deviceName: true, siteId: true } }),
    ]).then(([sites, devices]) => ({
      sites,
      devices: new Map(devices.filter((d) => d.deviceName && d.siteId).map((d) => [d.deviceName!.toLowerCase(), d.siteId!])),
    })),
  };
  companies.set(tenantId, entry);
  entry.value.catch(() => {
    if (companies.get(tenantId) === entry) companies.delete(tenantId);
  });
  return entry.value;
}

/** Forgets a company's buildings, so a change made on this server shows at once. */
export function forgetTabletLanguages(tenantId: string): void {
  companies.delete(tenantId);
}

/**
 * The building a tablet is in: the warehouse number it sends, else the
 * building its name is registered at, else the person's own site.
 */
export async function tabletBuilding(
  tenantId: string,
  from: { warehouse: string | null; device: string | null },
  homeSiteId: string | null,
): Promise<BuildingRow | null> {
  const { sites, devices } = await company(tenantId);
  const byId = (id: string | null | undefined) => (id ? (sites.find((s) => s.id === id) ?? null) : null);
  if (from.warehouse && /^\d{1,9}$/.test(from.warehouse)) {
    const n = Number(from.warehouse);
    const site = sites.find((s) => s.wmsWarehouseId === n);
    if (site) return site;
  }
  if (from.device) {
    const site = byId(devices.get(from.device.toLowerCase()));
    if (site) return site;
  }
  return byId(homeSiteId);
}

/** A building's languages in order, the main one first, each code on the list once. */
export function buildingLanguageCodes(site: Pick<BuildingRow, "primaryLanguage" | "additionalLanguages"> | null): string[] {
  if (!site) return [];
  const primary = site.primaryLanguage && isLanguageCode(site.primaryLanguage) ? site.primaryLanguage : null;
  return [...(primary ? [primary] : []), ...cleanLanguages(primary, site.additionalLanguages)];
}

/** What the tablet is told, from the person's saved language and the building's list. */
export function tabletLanguages(saved: string | null | undefined, codes: string[]): TabletLanguages {
  const language = saved && isLanguageCode(saved) ? saved : null;
  return {
    language,
    languages: codes.map((code) => ({ code, name: nativeLanguageName(code) })),
    askLanguage: language === null && codes.length > 1,
  };
}
