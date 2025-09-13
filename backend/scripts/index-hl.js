// backend/scripts/index-hl.js
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { embedText } = require("../embed"); // <= important: embedText

(async () => {
  try {
    const inFile = process.argv[2] || "hazard-log.json";
    const outFile = process.argv[3] || "hazard-index.json";

    const inPath = path.join(__dirname, "..", inFile);
    const outPath = path.join(__dirname, "..", outFile);

    const rows = JSON.parse(fs.readFileSync(inPath, "utf8"));
    if (!Array.isArray(rows)) {
      throw new Error("hazard-log.json doit contenir un tableau");
    }

    const index = [];
    for (const row of rows) {
      const parts = [
        row.ue_label,
        row.ue_ref,
        row.ei_label,
        row.ei_ref,
        row.consequence,
        Array.isArray(row.barriers) ? row.barriers.join(" ") : row.barriers,
      ].filter(Boolean);

      const text = parts.join(" | ");
      const vector = await embedText(text);

      index.push({
        id: row.id || `${row.ue_ref || ""}-${row.ei_ref || ""}-${row.row || ""}`,
        text,
        vector,
        meta: row,
      });
    }

    fs.writeFileSync(outPath, JSON.stringify(index));
    console.log(`✅ Index créé: ${index.length} vecteurs -> ${outFile}`);
  } catch (err) {
    console.error("❌ index-hl.js error:", err);
    process.exit(1);
  }
})();
