// scripts/build-scholar-lookup.js
// 一次性腳本：把 e-personid.csv 轉成 data/scholar_lookup.json
// 執行方式：node scripts/build-scholar-lookup.js

const fs   = require('fs');
const path = require('path');

const csvPath  = path.join(__dirname, '..', 'e-personid.csv');
const outPath  = path.join(__dirname, '..', 'data', 'scholar_lookup.json');

const csv   = fs.readFileSync(csvPath, 'utf-8');
const lines = csv.split('\n').filter(l => l.trim());

// 解析單行 CSV（處理帶引號欄位）
function parseCsvLine(line) {
  const fields = [];
  let field = '', inQuote = false;
  for (const ch of line) {
    if (ch === '"')      { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { fields.push(field); field = ''; }
    else                 { field += ch; }
  }
  fields.push(field);
  return fields;
}

const clean = v => { const t = (v || '').trim(); return (!t || t === '\\N') ? null : t; };

const result = {};
let skipped = 0;

for (let i = 1; i < lines.length; i++) {
  const [scholarId, name, dept, empId, orcid] = parseCsvLine(lines[i]);
  const cleanEmpId = clean(empId);
  if (!cleanEmpId) { skipped++; continue; }

  result[cleanEmpId] = {
    scholarId: clean(scholarId),
    orcid:     clean(orcid) || null,
    name:      clean(name)  || '',
    dept:      clean(dept)  || '',
  };
}

fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
