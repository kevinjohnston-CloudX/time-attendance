import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Pay category IDs (from pay_categories table)
const CAT: Record<number, string> = {
  21:  "cmtltd3xp0cauo4pkjlzbg0a2", // NJ Non Exempt 8
  22:  "cmtlt6v1h0calo4pktul24z9c", // NJ-PA Supervisor Non Exempt 8
  24:  "cmtltjuhh0cb4o4pkw9ovgfv4", // NJ-PA Exempt
  26:  "cmtluaa5d0cb7o4pkwprr1eqe", // NJ-PA Part Time
  27:  "cmtlub1pp0cb8o4pkq9r51g4a", // NJ Temp
  30:  "cmtlucuhf0cb9o4pkwiu20dp4", // NJ Non Exempt 10
  40:  "cmtluirbg0cbco4pksh9t92ea", // PTO 120
  41:  "cmtluehwz0cbao4pke1yynk4o", // PTO 160
  590: "cmtlugeon0cbbo4pkoe6ntqwi", // New Jersey - 5903
};

// Active 5903 NJ employees grouped by pay category number (from Employee Profile Info .xls, col AD)
const ASSIGNMENTS: { catNum: number; wmsIds: string[] }[] = [
  { catNum: 21, wmsIds: ["100088","100104","100112","100127","100221","100240","100366","100526","100621","100707","100773","100874","100959","101078","101195","101308","101381","101422","101660","101749","101819","101844","101906","102197","102471","102558","102574","102579","102718","102840","102885","102918","102977","103045","103058","103115","103139","103150","103235","103275","103310","103751","103881","103882","103945","104011","104023","104084","104099","104298","104453","104490","104508","104587","104797","104825","104834","104868","104989","105022","105133","105227","105332","105358","105391","105447","105792","105927","105939","106000","106058","106242","106380","106428","106807","107076","107096","107117","107140","107273","107352","107427","107596","107711","107890","108026","108060","108103","108104","108341","108425","108588","108706","108719","108931","109013","109088","109317","109505","109515","109679","109735","109756","109903","109936","109939","111518","112289","112620","112657","113446","113493","113528","113729","113954","113963","114001","114118","114776","115534","115833","116214","116262","116333","116854","116887","117069","117209","117256","117596","118177","118662","118761","118852","119105","119578","119847","119903","119928","121970","127624"] },
  { catNum: 22, wmsIds: ["107064"] },
  { catNum: 24, wmsIds: ["100499","104507","104894","104976","105219","105324","106174","106319","106460","107101","107884","107980","108907","109321","109423","109767","110409","111982","113501","114297","115367","118842","127061","127248","410517"] },
  { catNum: 26, wmsIds: ["107857","108231"] },
  { catNum: 27, wmsIds: ["351698","352239","353950","357174","358331"] },
  { catNum: 30, wmsIds: ["101257","101759","101817","103033","106437","108079","108513","109459","118235"] },
  { catNum: 40, wmsIds: ["106202"] },
  { catNum: 41, wmsIds: ["101101","103612","103845","105859"] },
  { catNum: 590, wmsIds: ["100090","100213","100340","100559","101789","102139","102361","102833","103198","103247","103435","103548","103645","105089","105883","106060","106185","106738","106941","106988","107224","108852","109413","109557","110798","113453","114440","115020","115298","117767","118030","118216"] },
];

export async function GET() {
  const log: string[] = [];
  let totalUpdated = 0, totalAlready = 0, totalNotFound = 0;

  for (const { catNum, wmsIds } of ASSIGNMENTS) {
    const payCategoryId = CAT[catNum];
    const employees = await db.employee.findMany({
      where: { wmsId: { in: wmsIds } },
      select: { id: true, wmsId: true, payCategoryId: true, user: { select: { name: true } } },
    });

    const foundIds = new Set(employees.map(e => e.wmsId));
    let updated = 0, already = 0, notFound = 0;

    for (const wmsId of wmsIds) {
      if (!foundIds.has(wmsId)) { notFound++; totalNotFound++; }
    }

    for (const emp of employees) {
      if (emp.payCategoryId === payCategoryId) { already++; totalAlready++; continue; }
      await db.employee.update({ where: { id: emp.id }, data: { payCategoryId } });
      updated++; totalUpdated++;
    }

    log.push(`  cat ${catNum}: updated=${updated}, already=${already}, notFound=${notFound}`);
  }

  log.unshift(`Total: updated=${totalUpdated}, already correct=${totalAlready}, not found=${totalNotFound}`);
  return NextResponse.json({ totalUpdated, totalAlready, totalNotFound, log });
}
