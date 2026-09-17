/**
 * Check which of the 310 "missing both in+out" Sept 15 employees
 * had their wmsId set before today's backfill vs just now.
 * The 159 we just backfilled have wmsId === employeeCode.
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

// The 310 badge IDs missing both in+out on Sept 15 (from compare output)
const missing310 = [
  '100088','100183','100221','100248','100299','100403','100405','100428','100549','100557',
  '100600','100699','100773','100984','100992','101000','101308','101390','101464','101592',
  '101720','101831','101844','102014','102471','102948','102977','103039','103099','103201',
  '103275','103435','103445','103474','103583','103621','103629','103656','103709','103981',
  '104086','104259','104348','104445','104540','104649','104740','104772','104916','104952',
  '105061','105152','105245','105312','105338','105495','105569','105668','105703','105882',
  '106050','106251','106369','106640','106845','107337','107437','107472','107532','107595',
  '107784','108037','108117','108260','108413','108697','108782','108956','109051','109193',
  '109735','109931','110333','110411','111817','111952','112031','112197','112539','112706',
  '113493','113603','113896','114167','114440','114681','115466','115553','115612','115758',
  '115866','116053','116510','116598','117420','117602','118900','119614','119708','119823',
  '128103','128237','350280','351526','351698','351987','352161','352416','352725','353173',
  '353359','354495','354634','354707','354737','355446','356421','356499','357174','357659',
  '357982','358331','358380','358422','358995','359382','359569','359909','360871','361861',
  '362006','363808','364160','365328','367594','367940','367941','368473','368522','489137',
  '602272','604461','606518','630044','630240','630259','630287','630524','630622','630835',
  '630972','631045','631203','631546','631649','631735','631797','631856','632044','632138',
  '632643','632705','632877','632990','633061','633200','633795','634146','634439','634501',
  '634557','634854','634858','634938','634958','634995','635108','635290','635411','635590',
  '636003','636346','636554','636566','636576','636580','636678','636913','637003','637189',
  '637331','637446','637469','637638','637751','637767','638080','638547','638647','638862',
  '639243','639529','639608','639726','639824','649578','700902','708595','901957','902143',
  '902584','904313','907631','908671','3608231',
];

async function main() {
  const emps = await db.employee.findMany({
    where: { wmsId: { in: missing310 } },
    select: { wmsId: true, employeeCode: true, user: { select: { name: true } } },
  });

  // "just backfilled" = wmsId === employeeCode (set today)
  const justBackfilled = emps.filter(e => e.wmsId === e.employeeCode);
  const hadWmsIdBefore = emps.filter(e => e.wmsId !== e.employeeCode);
  const notFoundAtAll  = missing310.filter(id => !emps.find(e => e.wmsId === id));

  console.log(`\nOf the ${missing310.length} employees missing Sept 15 punches in Cloud Time:\n`);
  console.log(`  Had wmsId set BEFORE today's backfill: ${hadWmsIdBefore.length}`);
  console.log(`  Just backfilled today (wmsId was null): ${justBackfilled.length}`);
  console.log(`  Not found in DB at all: ${notFoundAtAll.length}`);

  console.log(`\n--- Had wmsId before (genuine Sept 15 import gap) ---`);
  hadWmsIdBefore.forEach(e => console.log(`  wmsId=${e.wmsId}  code=${e.employeeCode}  "${e.user.name}"`));

  if (justBackfilled.length) {
    console.log(`\n--- Just backfilled today (wmsId was null on Sept 15) ---`);
    justBackfilled.forEach(e => console.log(`  wmsId=${e.wmsId}  "${e.user.name}"`));
  }
}

main().finally(() => { db.$disconnect(); pool.end(); });
