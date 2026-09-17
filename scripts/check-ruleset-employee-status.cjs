const xlsx = require('xlsx');
const wb = xlsx.readFile('C:/Users/john.raefski/Downloads/Employees List HR.xls');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
const headers = rows[0];
const idx = {};
headers.forEach((h, i) => idx[h] = i);

const MISSING_RULESETS = new Set([
  "Canada Temps", "Nl Hourly", "Canada Hourly", "Nl Temps",
  "Nl Exempt", "Nl Hrly (Sat Sun =2x)", "Canada Exempt"
]);

function parseBracket(val) {
  if (!val || typeof val !== 'string') return null;
  const m = val.match(/^(\d+)\s*\[(.+)\]$/);
  return m ? m[2].trim() : val.trim();
}

const summary = {};

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  const policy = parseBracket(row[idx['Pay Policy']]);
  if (!MISSING_RULESETS.has(policy)) continue;

  const status = row[idx['Employee Status']];
  if (!summary[policy]) summary[policy] = { A: 0, I: 0, other: 0 };
  if (status === 'A') summary[policy].A++;
  else if (status === 'I') summary[policy].I++;
  else summary[policy].other++;
}

console.log('\nEmployee Status Breakdown for Missing Rule Sets:\n');
for (const [policy, counts] of Object.entries(summary)) {
  const total = counts.A + counts.I + counts.other;
  console.log(`${policy}`);
  console.log(`  Active (A): ${counts.A}  |  Inactive (I): ${counts.I}  |  Total: ${total}`);
}
