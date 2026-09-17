const xlsx = require('xlsx');

const HR_XLS  = 'C:/Users/john.raefski/Downloads/Employees List HR.xls';
const HR_XLS2 = 'C:/Users/john.raefski/Downloads/Employees List HR (1).xls';

const missing15 = [
  { badge: '102865', name: 'SALCEDO IZAGUIRRE, JOHAN A' },
  { badge: '112718', name: 'BAUTISTA, ROSANNA T' },
  { badge: '350023', name: 'LAFONTAINE, MELVIN' },
  { badge: '354698', name: 'RAMIREZ, ENRIQUE' },
  { badge: '355967', name: 'AYALA, LUIS' },
  { badge: '359759', name: 'DIAZ, DANYELIS' },
  { badge: '368013', name: 'VASQUEZ, MANOLO' },
  { badge: '630950', name: 'PORTUGAL, EVELYN' },
  { badge: '630997', name: 'DEB, PROMIT' },
  { badge: '631559', name: 'QUILES, ZORIMAR' },
  { badge: '631573', name: 'REYES, ALEJANDRO' },
  { badge: '644860', name: 'ELLZEY, MONTASIA' },
  { badge: '646513', name: 'RAPIER, DAVION' },
  { badge: '901537', name: 'GONZALEZ, MARIA' },
  { badge: '905196', name: 'QUIRINO, ARCELIA' },
];

function readRows(path) {
  try {
    const wb = xlsx.readFile(path);
    return xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } catch { return []; }
}

const hrRows = [...readRows(HR_XLS), ...readRows(HR_XLS2)];

// Build lookup by Employee ID and by normalised name
const byId   = new Map();
const byName = new Map();
for (const row of hrRows) {
  const id   = String(row['Employee ID'] ?? '').trim();
  const name = String(row['Full Name'] ?? '').trim();
  if (id)   byId.set(id, row);
  if (name) byName.set(name.toLowerCase().replace(/[^a-z0-9]/g, ''), row);
}

console.log(`HR rows loaded: ${hrRows.length}\n`);
console.log('Badge'.padEnd(10), 'Nova Name'.padEnd(36), 'In HR?', 'HR Status', 'HR Name');
console.log('-'.repeat(90));

for (const emp of missing15) {
  // Try by Employee ID = badge
  let row = byId.get(emp.badge);
  // Try by name (Nova is "LAST, FIRST" → try both orderings)
  if (!row) {
    const norm = emp.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    row = byName.get(norm);
  }
  if (!row) {
    // Try flipped: "FIRST LAST"
    const parts = emp.name.split(/,\s*/);
    if (parts.length === 2) {
      const flipped = `${parts[1].trim()} ${parts[0].trim()}`.toLowerCase().replace(/[^a-z0-9]/g, '');
      row = byName.get(flipped);
    }
  }

  const inHR   = row ? 'YES' : 'NO';
  const status = row ? String(row['Employee Status'] ?? '').trim() : '';
  const hrName = row ? String(row['Full Name'] ?? '').trim() : '';
  console.log(emp.badge.padEnd(10), emp.name.padEnd(36), inHR.padEnd(7), status.padEnd(10), hrName);
}
