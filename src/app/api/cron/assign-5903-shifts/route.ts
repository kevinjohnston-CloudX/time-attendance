import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const SHIFT: Record<number, string> = {
  2:   "cmtlutpwb0cbeo4pkbvc5vplu", // Part Time 30m Lunch
  405: "cmtluv6kd0cbfo4pkwok53w4y", // 0299 M-F 8:30a-5p 30m
  501: "cmtlqsy0p0c99o4pkk3uoq11h", // 5903 M-F 7a-3:30p 30m
  502: "cmtlqu47t0c9ao4pkshnkwi6x", // 5903 M-F 9a-5:30p 30m
  503: "cmtlquzfk0c9bo4pkb7womo70", // 5903 M-F 11a-7:30p 30m
  504: "cmtlqw14h0c9co4pkbq5y4ghk", // 5903 Mon-Thu. 7:00am to 5:30pm
  505: "cmtlrdyyk0c9fo4pke7pftzcl", // 5903 M-F 8:30a-5p 30m
  515: "cmtlrdz4q0c9go4pk3hifadqk", // 5903 M-F 7:00a-5:30p 30m (CSM/BO)
  517: "cmtlrdzc70c9io4pk51vdn6kw", // 5903 M-Th. 9-7:30pm 30m
  520: "cmtlrdzs70c9lo4pk08d2s58h", // 5903 Sun 7:3:30 / M-Thurs 11-7:30 PM
  522: "cmtlrj00x0c9po4pkodwndxuv", // 5903 Su 7-3:30pm Mon - Thurs 11-7:30pm
  523: "cmtlrj01o0c9qo4pkv0iq458j", // 5903 Su 7-3:30pm Mon - Thurs 9-5:30pm
  525: "cmtlrp16n0c9to4pkj6lnnmza", // 5903 Liz Viloria - Shipping Clerk Schedu
};

// Active 5903 NJ employees grouped by shift number (from Employee Profile Info .xls, col AA)
const ASSIGNMENTS: { shiftNum: number; wmsIds: string[] }[] = [
  { shiftNum: 2,   wmsIds: ["107857","108231"] },
  { shiftNum: 405, wmsIds: ["127061"] },
  { shiftNum: 501, wmsIds: ["100090","100104","100112","100240","100707","101078","101381","101660","101789","101819","101844","102558","102885","102918","103045","103115","103150","103198","103435","103548","103751","103881","104084","104587","104797","104834","105022","105332","105859","105939","106058","106428","106807","107076","107117","107427","107711","108060","108103","108104","108425","108706","108719","109013","109088","109317","109505","109756","109903","112620","113446","113528","113954","113963","114001","114776","115534","115833","116214","116854","117069","117256","117596","118852","119903","127624"] },
  { shiftNum: 502, wmsIds: ["100088","100127","100874","101101","101195","101422","101749","102471","102574","102718","103058","103139","103235","103310","103882","103945","104011","104023","104099","104298","104976","105133","105219","105227","105324","105391","105447","106380","106941","107140","107352","107596","107890","107980","108341","108588","108907","109321","109515","109679","109767","109936","110409","111518","112657","113453","113501","113729","115367","116333","118662","119105","119578","119928","121970","127248","352239","353950","357174","358331"] },
  { shiftNum: 503, wmsIds: ["100213","100366","100526","100621","101906","102197","102977","103275","103645","104453","104508","104825","104989","105089","105358","105792","105927","106242","106738","107096","107273","108931","109939","112289","113493","114297","115020","116262","118030","118177","118761"] },
  { shiftNum: 504, wmsIds: ["101257","101759","101817","103033","106437","108079","109459","118235","351698"] },
  { shiftNum: 505, wmsIds: ["100499","100959","102361","102840","103612","103845","104507","104894","106174","106202","106319","106460","107064","107101","107884","108026","109423","109557","110798","111982","118216","118842","410517"] },
  { shiftNum: 515, wmsIds: ["100340","100559","102139","102833","105883","106060","106185","106988","107224","108852","109413","114440","115298","117767"] },
  { shiftNum: 517, wmsIds: ["108513"] },
  { shiftNum: 520, wmsIds: ["102579","103247","109735"] },
  { shiftNum: 522, wmsIds: ["104868","116887"] },
  { shiftNum: 523, wmsIds: ["100221","100773","101308","104490","106000","114118","117209"] },
  { shiftNum: 525, wmsIds: ["119847"] },
];

export async function GET() {
  const log: string[] = [];
  let totalUpdated = 0, totalAlready = 0, totalNotFound = 0;

  for (const { shiftNum, wmsIds } of ASSIGNMENTS) {
    const shiftId = SHIFT[shiftNum];
    const employees = await db.employee.findMany({
      where: { wmsId: { in: wmsIds } },
      select: { id: true, wmsId: true, shiftId: true, user: { select: { name: true } } },
    });

    const foundIds = new Set(employees.map(e => e.wmsId));
    let updated = 0, already = 0, notFound = 0;

    for (const wmsId of wmsIds) {
      if (!foundIds.has(wmsId)) { notFound++; totalNotFound++; }
    }

    for (const emp of employees) {
      if (emp.shiftId === shiftId) { already++; totalAlready++; continue; }
      await db.employee.update({ where: { id: emp.id }, data: { shiftId } });
      updated++; totalUpdated++;
    }

    log.push(`  shift ${shiftNum}: updated=${updated}, already=${already}, notFound=${notFound}`);
  }

  log.unshift(`Total: updated=${totalUpdated}, already correct=${totalAlready}, not found=${totalNotFound}`);
  return NextResponse.json({ totalUpdated, totalAlready, totalNotFound, log });
}
