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

const byRuleset = {};

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  const status = row[idx['Employee Status']];
  if (status !== 'A') continue;

  const policy = parseBracket(row[idx['Pay Policy']]);
  if (!MISSING_RULESETS.has(policy)) continue;

  if (!byRuleset[policy]) byRuleset[policy] = [];
  byRuleset[policy].push({
    empId: row[idx['Employee ID']],
    name: row[idx['Full Name']],
  });
}

for (const [ruleset, emps] of Object.entries(byRuleset)) {
  console.log(`\n${ruleset} (${emps.length} active):`);
  emps.forEach(e => console.log(`  ${String(e.empId).padEnd(10)} ${e.name}`));
}
