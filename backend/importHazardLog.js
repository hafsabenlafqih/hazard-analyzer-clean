// backend/importHazardLog.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { addHazard } = require("./embed");

async function main() {
  const filePath = path.join(__dirname, "hazard-log.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const hazards = JSON.parse(raw);

  if (!Array.isArray(hazards)) {
    console.error("❌ hazard-log.json n'est pas un tableau");
    process.exit(1);
  }

  console.log(`📥 Import de ${hazards.length} hazards...`);

  for (const h of hazards) {
    await addHazard(h);
    console.log(`✅ Ajouté: ${h.ue_label || h.ue_ref}`);
  }

  console.log("🎉 Import terminé !");
}

main().catch((err) => {
  console.error("Erreur d'import:", err);
});
