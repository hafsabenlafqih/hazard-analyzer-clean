// backend/scripts/inspect-sheet.js
// Usage:
//   npm run inspect:sheet -- "UE 01"
//   (package.json passes the file name as argv[2]; your extra arg becomes argv[3])

const path = require("path");
const XLSX = require("xlsx");

// argv[2] comes from package.json ("HL et Exemple Traitement SMS.xlsx")
// argv[3] is the sheet name you type after `--`
const file = process.argv[2] || "HL et Exemple Traitement SMS.xlsx";
let sheetName = process.argv[3];

if (!sheetName) {
  console.error('❌ Donne un nom de feuille, ex: npm run inspect:sheet -- "UE 01"');
  process.exit(1);
}

const wb = XLSX.readFile(path.join(__dirname, "..", file));

// handle stray spaces in sheet names (e.g., 'UE 08 ')
const available = wb.SheetNames;
const normalized = available.map((n) => n.trim());
const wantedNorm = sheetName.trim();

let actualName = available[normalized.indexOf(wantedNorm)];
if (!actualName) {
  console.error(`❌ Feuille introuvable: ${sheetName}`);
  console.log("Feuilles dispo:", available);
  process.exit(1);
}

const ws = wb.Sheets[actualName];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

console.log("✅ Fichier:", file);
console.log("✅ Feuille:", actualName);
console.log("Nombre de lignes:", rows.length);

console.log("\n--- Premières 15 lignes ---");
rows.slice(0, 15).forEach((r, i) => {
  console.log(String(i + 1).padStart(2, "0"), r);
});
