import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const NJ_HOURLY_RS = "cmtkbrjyv00096cpk7ty24rea"; // NJ Hourly - No Rounding (w40)
const NJ_EXEMPT_RS = "cmtkbsx8i000b6cpku2f1g5x4"; // NJ Exempt - Autopay
const NJ_TEMP_RS   = "cmtlu28fc0cb5o4pkz3hkkswg"; // NJ Temp - No Rounding (w40)

// Active 5903 NJ employees grouped by rule set (from Employee Profile Info .xls)
const HOURLY_WMS_IDS = [
  "100088","100090","100104","100112","100127","100213","100221","100240","100340","100366",
  "100526","100559","100621","100707","100773","100874","100959","101078","101101","101195",
  "101257","101308","101381","101422","101660","101749","101759","101789","101817","101819",
  "101844","101906","102139","102197","102361","102471","102558","102574","102579","102718",
  "102833","102840","102885","102918","102977","103033","103045","103058","103115","103139",
  "103150","103198","103235","103247","103275","103310","103435","103548","103645","103751",
  "103881","103882","103945","104011","104023","104084","104099","104298","104453","104490",
  "104508","104587","104797","104825","104834","104868","104894","104989","105022","105089",
  "105133","105227","105332","105358","105391","105447","105792","105859","105883","105927",
  "105939","106000","106058","106060","106185","106242","106380","106428","106437","106738",
  "106807","106941","106988","107064","107076","107096","107117","107140","107224","107273",
  "107352","107427","107596","107711","107857","107890","108026","108060","108079","108103",
  "108104","108231","108341","108425","108513","108588","108706","108719","108852","108931",
  "109013","109088","109317","109413","109459","109505","109515","109557","109679","109735",
  "109756","109903","109936","109939","110798","111518","112289","112620","112657","113446",
  "113453","113493","113528","113729","113954","113963","114001","114118","114440","114776",
  "115020","115298","115534","115833","116214","116262","116333","116854","116887","117069",
  "117209","117256","117596","117767","118030","118177","118216","118235","118662","118761",
  "118852","119105","119578","119847","119903","119928","121970","127624",
];

const EXEMPT_WMS_IDS = [
  "100499","103612","103845","104507","104976","105219","105324","106174","106202","106319",
  "106460","107101","107884","107980","108907","109321","109423","109767","110409","111982",
  "113501","114297","115367","118842","127061","127248","410517",
];

const TEMP_WMS_IDS = [
  "351698","352239","353950","357174","358331",
];

async function updateGroup(wmsIds: string[], ruleSetId: string, label: string, log: string[]) {
  const employees = await db.employee.findMany({
    where: { wmsId: { in: wmsIds } },
    select: { id: true, wmsId: true, ruleSetId: true, user: { select: { name: true } } },
  });

  log.push(`\n${label}: found ${employees.length} of ${wmsIds.length} employees in DB`);

  let updated = 0, alreadySet = 0, notFound = 0;

  const foundWmsIds = new Set(employees.map(e => e.wmsId));
  for (const wmsId of wmsIds) {
    if (!foundWmsIds.has(wmsId)) {
      log.push(`  ✗ not found: wmsId=${wmsId}`);
      notFound++;
    }
  }

  for (const emp of employees) {
    if (emp.ruleSetId === ruleSetId) {
      alreadySet++;
      continue;
    }
    await db.employee.update({
      where: { id: emp.id },
      data: { ruleSetId },
    });
    log.push(`  ✓ updated  ${emp.user?.name ?? emp.id} (wmsId=${emp.wmsId}) ruleSetId → ${ruleSetId}`);
    updated++;
  }

  log.push(`  → updated=${updated}, already correct=${alreadySet}, not found in DB=${notFound}`);
  return { updated, alreadySet, notFound };
}

export async function GET() {
  const log: string[] = [];

  const hourly = await updateGroup(HOURLY_WMS_IDS, NJ_HOURLY_RS, "NJ Hourly - No Rounding (w40)", log);
  const exempt = await updateGroup(EXEMPT_WMS_IDS, NJ_EXEMPT_RS, "NJ Exempt - Autopay", log);
  const temp   = await updateGroup(TEMP_WMS_IDS,   NJ_TEMP_RS,   "NJ Temp - No Rounding (w40)", log);

  const totals = {
    updated:    hourly.updated    + exempt.updated    + temp.updated,
    alreadySet: hourly.alreadySet + exempt.alreadySet + temp.alreadySet,
    notFound:   hourly.notFound   + exempt.notFound   + temp.notFound,
  };

  log.unshift(`Total: updated=${totals.updated}, already correct=${totals.alreadySet}, not found=${totals.notFound}`);

  return NextResponse.json({ ...totals, log });
}
