// backend/scripts/convert-hl.js
// Usage:
//   node scripts/convert-hl.js "HL et Exemple Traitement SMS.xlsx" hazard-log.json
// or via npm script: npm run convert:hl

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const INPUT = process.argv[2] || "HL et Exemple Traitement SMS.xlsx";
const OUTPUT = process.argv[3] || "hazard-log.json";

function sevNumberToLetter(n) {
  // 1..5 -> A..E
  const i = Number(n);
  if (!Number.isFinite(i) || i < 1) return null;
  const letters = ["A", "B", "C", "D", "E"];
  return letters[i - 1] || letters[letters.length - 1]; // clamp
}

function normalize(text) {
  return String(text || "").trim();
}

function splitLines(s) {
  return normalize(s)
    .split(/\r?\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function findHeaderRow(rows) {
  // cherche une ligne qui contient "Hazard No." (case-insensible)
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const row = rows[i] || [];
    const has = row.some(
      (c) => String(c || "").toLowerCase().includes("hazard no")
    );
    if (has) return i;
  }
  return -1;
}

function buildHeaderIndex(headerRow) {
  // crée un mapping nom_de_colonne_normalisé -> index
  const map = {};
  headerRow.forEach((h, idx) => {
    const key = String(h || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (key) map[key] = idx;
  });
  return map;
}

function getCell(row, headerMap, names) {
  // cherche la 1ère clé qui existe dans headerMap
  for (const n of names) {
    const k = n.toLowerCase().replace(/\s+/g, " ").trim();
    if (k in headerMap) {
      return normalize(row[headerMap[k]]);
    }
  }
  return "";
}

function extractUELabelFromTop(rows) {
  // essaie de trouver une phrase descriptive en haut (ex: ligne 2 col 2)
  // Heuristique: dans les ~8 premières lignes, prendre la plus longue chaîne lisible (hors "Updated on")
  let best = "";
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    for (const c of rows[i] || []) {
      const v = normalize(c);
      if (!v) continue;
      if (/updated on|issued on/i.test(v)) continue;
      if (v.length > best.length) best = v;
    }
  }
  return best || "UE";
}

function extractUltimateEvents(rows) {
  // Cherche la zone "Ultimate events related to ..." (comme vu à la ligne 6)
  // Heuristique: on prend la ligne où une cellule contient "Ultimate events" et on récupère la cellule à droite (liste multilignes)
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i] || [];
    const idx = row.findIndex((c) =>
      String(c || "").toLowerCase().includes("ultimate events")
    );
    if (idx !== -1) {
      // la/les conséquences listées semblent dans une cellule plus à droite
      for (let j = idx + 1; j < row.length; j++) {
        const v = normalize(row[j]);
        if (v) return splitLines(v).join(", ");
      }
    }
  }
  return ""; // facultatif
}

function processSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

  const headerRowIdx = findHeaderRow(rows);
  if (headerRowIdx === -1) {
    return []; // pas de table EI sur cette feuille
  }

  const header = rows[headerRowIdx] || [];
  const H = buildHeaderIndex(header);
  const ueLabel = extractUELabelFromTop(rows);
  const ultimate = extractUltimateEvents(rows);

  const out = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const ei_ref = getCell(row, H, ["Hazard No.", "Hazard No", "EI"]);
    const desc = getCell(row, H, ["Hazard specificity", "Hazard Specificity"]);
    const descrAlt = getCell(row, H, ["Description"]);

    const probStr = getCell(row, H, ["Probability"]); // 1ère occurrence: proba initiale
    const sevStr = getCell(row, H, ["Severity"]);     // 1ère occurrence: sévérité initiale

    // Arrêt sur ligne vide
    if (!ei_ref && !desc && !descrAlt) continue;
    if (!ei_ref && !desc && !descrAlt && !probStr && !sevStr) continue;

    const probability = Number(probStr || NaN);
    const severityNum = Number(sevStr || NaN);
    const sevLetter = sevNumberToLetter(severityNum);
    const riskIndex = (Number.isFinite(probability) && Number.isFinite(severityNum))
      ? probability * severityNum
      : "?";
    const riskCode = (Number.isFinite(probability) && sevLetter)
      ? `${probability}${sevLetter}`
      : "";

    // Barrières
    const prevention = getCell(row, H, ["Prevention"]);
    const addMeasures = getCell(row, H, ["Additional measures or comments", "Additional measures", "Comments"]);
    const barriers = [...splitLines(prevention), ...splitLines(addMeasures)];

    out.push({
      ue_ref: sheetName.trim(),              // ex: "UE 01"
      ue_label: ueLabel,                     // ex: "Evènements liés aux conditions..."
      ei_ref: ei_ref || "EI",
      ei_label: desc || descrAlt || "EI",
      consequence: ultimate || "",
      barriers,
      risk: riskCode || undefined,           // ex: "2D"
      probability: Number.isFinite(probability) ? probability : "?",
      severity: Number.isFinite(severityNum) ? severityNum : "?",
      riskIndex
    });
  }

  return out;
}

function isUESheet(name) {
  return /^UE\s*\d+/i.test(name.trim());
}

function main() {
  const inPath = path.join(__dirname, "..", INPUT);
  if (!fs.existsSync(inPath)) {
    console.error("❌ Fichier introuvable:", INPUT);
    process.exit(1);
  }

  const wb = XLSX.readFile(inPath);
  const sheets = wb.SheetNames;

  let all = [];
  for (const name of sheets) {
    if (!isUESheet(name)) continue;
    const entries = processSheet(wb, name);
    all = all.concat(entries);
  }

  const outPath = path.join(__dirname, "..", OUTPUT);
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2), "utf8");
  console.log(`✅ Converti: ${INPUT}\n→ ${OUTPUT} avec ${all.length} entrées.`);
}

main();
