import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const HOLIDAY: Record<number, string> = {
  1: "cmtkff4tv000ho4pkb647a6i8", // NJ Hourly
  3: "cmtkfftpr000io4pkqjadyel9", // NJ Exempt
  6: "cmtluodqc0cbdo4pk207wat8y", // No Holiday
  9: "cmtkfe5qe000go4pkjgs5qfu6", // NJ Hourly 10hr
};

// Active 5903 NJ employees grouped by holiday rule number (from Employee Profile Info .xls, col AF)
const ASSIGNMENTS: { ruleNum: number; wmsIds: string[] }[] = [
  { ruleNum: 1, wmsIds: ["100088","100090","100104","100112","100127","100213","100221","100240","100340","100366","100526","100559","100621","100707","100773","100874","100959","101101","101195","101308","101381","101422","101660","101749","101789","101819","101844","101906","102139","102197","102361","102471","102558","102574","102579","102718","102833","102840","102885","102918","102977","103045","103058","103115","103139","103150","103198","103235","103247","103310","103435","103548","103645","103751","103881","103882","103945","104011","104023","104084","104099","104453","104490","104508","104587","104797","104825","104834","104868","104894","104989","105022","105089","105133","105227","105332","105358","105391","105447","105792","105859","105883","105927","105939","106000","106058","106060","106185","106242","106380","106428","106738","106807","106941","106988","107064","107076","107096","107117","107140","107224","107273","107352","107596","107711","107890","108026","108103","108104","108341","108425","108588","108706","108719","108852","108931","109013","109088","109317","109413","109505","109515","109557","109679","109756","109903","109936","109939","110798","111518","112289","112620","112657","113446","113453","113528","113729","113954","113963","114001","114118","114440","115020","115298","115534","115833","116214","116262","116333","116854","116887","117069","117209","117256","117596","117767","118030","118177","118216","118662","118852","119105","119578","119847","119903","119928","121970","127624"] },
  { ruleNum: 3, wmsIds: ["100499","103612","103845","104507","104976","105219","105324","106174","106202","106319","106460","107101","107884","107980","108907","109321","109423","109767","110409","111982","113501","114297","115367","118842","127061","127248","410517"] },
  { ruleNum: 6, wmsIds: ["103275","104298","107427","107857","108060","108231","109735","113493","114776","118761","351698","352239","353950","357174","358331"] },
  { ruleNum: 9, wmsIds: ["101078","101257","101759","101817","103033","106437","108079","108513","109459","118235"] },
];

export async function GET() {
  const log: string[] = [];
  let totalUpdated = 0, totalAlready = 0, totalNotFound = 0;

  for (const { ruleNum, wmsIds } of ASSIGNMENTS) {
    const holidayRuleId = HOLIDAY[ruleNum];
    const employees = await db.employee.findMany({
      where: { wmsId: { in: wmsIds } },
      select: { id: true, wmsId: true, holidayRuleId: true, user: { select: { name: true } } },
    });

    const foundIds = new Set(employees.map(e => e.wmsId));
    let updated = 0, already = 0, notFound = 0;

    for (const wmsId of wmsIds) {
      if (!foundIds.has(wmsId)) { notFound++; totalNotFound++; }
    }

    for (const emp of employees) {
      if (emp.holidayRuleId === holidayRuleId) { already++; totalAlready++; continue; }
      await db.employee.update({ where: { id: emp.id }, data: { holidayRuleId } });
      updated++; totalUpdated++;
    }

    log.push(`  rule ${ruleNum}: updated=${updated}, already=${already}, notFound=${notFound}`);
  }

  log.unshift(`Total: updated=${totalUpdated}, already correct=${totalAlready}, not found=${totalNotFound}`);
  return NextResponse.json({ totalUpdated, totalAlready, totalNotFound, log });
}
