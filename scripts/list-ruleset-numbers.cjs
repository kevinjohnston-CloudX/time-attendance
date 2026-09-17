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

const seen = new Map();

for (let i = 1; i < rows.length; i++) {
  const raw = rows[i][idx['Pay Policy']];
  if (!raw || typeof raw !== 'string') continue;
  const m = raw.match(/^(\d+)\s*\[(.+)\]$/);
  if (!m) continue;
  const name = m[2].trim();
  if (MISSING_RULESETS.has(name) && !seen.has(name)) {
    seen.set(name, { number: m[1], raw });
  }
}

console.log('\nMissing Rule Sets — number and name from XLS:\n');
for (const [name, { number, raw }] of seen) {
  console.log(`  ${number.padEnd(6)} ${name}`);
}
