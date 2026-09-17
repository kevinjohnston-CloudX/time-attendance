const xlsx = require('xlsx');
const wb = xlsx.readFile('C:/Users/john.raefski/Downloads/Employees List HR.xls');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
const headers = rows[0];
const idx = {};
headers.forEach((h, i) => idx[h] = i);

let zero = 0, blank = 0, valid = 0;
const dupes = new Map();

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (row[idx['Employee Status']] !== 'A') continue;

  const badge = row[idx['Badge Number']];
  const badgeStr = String(badge).trim();

  if (badgeStr === '0' || badge === 0) zero++;
  else if (badgeStr === '' || badge === '') blank++;
  else {
    valid++;
    dupes.set(badgeStr, (dupes.get(badgeStr) || 0) + 1);
  }
}

const actualDupes = [...dupes.entries()].filter(([, count]) => count > 1);

console.log(`\nBadge Number breakdown (active employees):`);
console.log(`  Valid (non-zero):  ${valid}`);
console.log(`  Zero (0):          ${zero}`);
console.log(`  Blank:             ${blank}`);

if (actualDupes.length > 0) {
  console.log(`\n  Duplicate badge numbers:`);
  actualDupes.forEach(([badge, count]) => console.log(`    ${badge} — ${count} employees`));
} else {
  console.log(`\n  No duplicate badge numbers among valid entries.`);
}

console.log(`\nConclusion: ${zero + blank} employees will need wmsId set to null (skip 0 and blank).`);
