// backend/scripts/inspect-xlsx.js
const path = require("path");
const XLSX = require("xlsx");

const input = process.argv[2] || "HL et Exemple Traitement SMS.xlsx";
const file = path.isAbsolute(input) ? input : path.join(__dirname, "..", input);

const wb = XLSX.readFile(file, { cellDates: false, cellNF: false, cellText: false });
console.log("Feuilles:", wb.SheetNames);

const name = wb.SheetNames[0]; // on commence par la 1re feuille
const ws = wb.Sheets[name];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }); // tableau brut

console.log("\nFeuille lue:", name);
console.log("Premières lignes (3):");
console.log(rows.slice(0, 3));
