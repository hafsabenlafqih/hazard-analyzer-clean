// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

// Embeddings + vector store (your local modules)
const { embedOne, embedBatch } = require("./embed");
const { initDb, upsertMany, searchByVector } = require("./db");

// Excel upload
const multer = require("multer");
const XLSX = require("xlsx");

const app = express();

/* --------------------------- Config & middlewares -------------------------- */
const PORT = Number(process.env.PORT || 5000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";

// Auth config (user + bcrypt hash in .env)
const APP_USER = process.env.APP_USER || "ram";
const APP_PASS_HASH = process.env.APP_PASS_HASH || ""; // bcrypt hash du mot de passe

// JWT
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h";

// reCAPTCHA (optionnel)
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || null;

app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());

/* --------------------------- Hazard Log loading ---------------------------- */
const HAZARD_LOG_PATH = process.env.HAZARD_LOG_PATH || "hazard-log.json";
const hazardLogFile = path.isAbsolute(HAZARD_LOG_PATH)
  ? HAZARD_LOG_PATH
  : path.join(__dirname, HAZARD_LOG_PATH);

let hazardLog = [];
function loadHazardLogFromDisk() {
  try {
    const raw = fs.readFileSync(hazardLogFile, "utf8");
    const parsed = JSON.parse(raw);
    hazardLog = Array.isArray(parsed) ? parsed : [];
    console.log(`✅ Hazard Log chargé (${hazardLog.length} entrées).`);
  } catch (e) {
    console.error("❌ Impossible de lire hazard-log.json :", e.message);
    hazardLog = [];
  }
}
loadHazardLogFromDisk();

/* --------------------------- Utils (risk + match) -------------------------- */
function computeRiskIndex(riskStr) {
  // Accept either "3C" or prob/sev in meta
  if (!riskStr) return { probability: "?", severity: "?", riskIndex: "?" };
  const str = String(riskStr).toUpperCase();
  const prob = Number((str.match(/\d/) || [])[0] || NaN);
  const sevChar = (str.match(/[A-E]/) || [])[0];
  const sevMap = { A: 5, B: 4, C: 3, D: 2, E: 1 }; // letters back to 5..1 scale
  const severity = sevChar ? sevMap[sevChar] : NaN;
  if (Number.isFinite(prob) && Number.isFinite(severity)) {
    return { probability: prob, severity, riskIndex: prob * severity };
  }
  return { probability: "?", severity: "?", riskIndex: "?" };
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/i)
    .filter((t) => t && t.length > 2);
}

function scoreEntry(narrTokens, entry) {
  const ei = tokenize(entry.ei_label || entry.ei_ref || "");
  const ue = tokenize(entry.ue_label || entry.ue_ref || "");
  if (!ei.length && !ue.length) return 0;
  let score = 0;
  const narrSet = new Set(narrTokens);
  for (const t of ei) if (narrSet.has(t)) score += 2;
  for (const t of ue) if (narrSet.has(t)) score += 1;
  return score;
}

function findBestMatch(narrative) {
  const narrTokens = tokenize(narrative);
  let best = null;
  let bestScore = 0;
  for (const entry of hazardLog) {
    const s = scoreEntry(narrTokens, entry);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }
  return bestScore >= 2 ? best : null;
}

/* ------------------------------- Auth layer -------------------------------- */
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token manquant" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

/* --------------------------------- Health ---------------------------------- */
app.get("/health", (_req, res) => {
  res.json({ ok: true, hazards: hazardLog.length });
});

/* ------------------------------ Auth: /login -------------------------------- */
app.post("/auth/login", async (req, res) => {
  try {
    const { username, password, captchaToken } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: "Username et mot de passe requis" });
    }

    // Optional reCAPTCHA verify (works with v2 or v3 tokens)
    if (RECAPTCHA_SECRET_KEY) {
      if (!captchaToken) {
        return res.status(400).json({ error: "Captcha manquant" });
      }
      const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET_KEY}&response=${captchaToken}`;
      const captchaRes = await fetch(verifyUrl, { method: "POST" });
      const captchaData = await captchaRes.json();
      if (!captchaData.success || (typeof captchaData.score === "number" && captchaData.score < 0.5)) {
        return res.status(403).json({ error: "Captcha invalide" });
      }
    }

    if (username !== APP_USER) {
      return res.status(401).json({ error: "Identifiants invalides" });
    }

    const ok = await bcrypt.compare(password, APP_PASS_HASH);
    if (!ok) return res.status(401).json({ error: "Identifiants invalides" });

    const token = jwt.sign({ sub: username, role: "user" }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES,
    });

    return res.json({ token, user: { username } });
  } catch (err) {
    console.error("Erreur /auth/login:", err);
    return res.status(500).json({ error: "Erreur d'authentification" });
  }
});

/* ---------------------- Upload & reindex helpers (Excel) ------------------- */
const upload = multer({ dest: path.join(__dirname, "tmp") });

/**
 * Excel -> Hazard entries.
 * IMPORTANT: pulls the sheet-level "Ultimate events related to RAM EXPRESS risk matrix"
 * text and stores it in `consequence` for each EI row in that UE.
 */
function workbookToHazardEntries(wb) {
  const entries = [];
  const sheetNames = wb.SheetNames || [];
  const sheets = sheetNames.filter((n) =>
    /^UE\s*\d+/i.test(n.trim()) || /^UE\d+/i.test(n.trim()) || /^UE17/i.test(n.trim())
  );

  for (const name of sheets) {
    const ws = wb.Sheets[name];
    if (!ws) continue;

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // 1) Get the "Ultimate events…" text near the top of the sheet
    let ultimateText = "";
    const MAX_SCAN_ROWS = Math.min(rows.length, 30);
    outer: for (let r = 0; r < MAX_SCAN_ROWS; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const cell = String(rows[r][c] ?? "").toLowerCase();
        if (cell.includes("ultimate events related")) {
          // same row to the right
          const right = (rows[r].slice(c + 1) || [])
            .map((v) => String(v || "").trim())
            .filter(Boolean);
          if (right.length) {
            ultimateText = right.join(" ").replace(/\s+/g, " ").trim();
          }
          // or next row, one column to the right
          if (!ultimateText && rows[r + 1]) {
            const belowRight = String(rows[r + 1][c + 1] ?? "").trim();
            if (belowRight) ultimateText = belowRight.replace(/\s+/g, " ");
          }
          break outer;
        }
      }
    }

    // 2) Find EI table header
    const headerIdx = rows.findIndex(
      (r) =>
        r.some((c) => String(c).toLowerCase().includes("hazard no")) &&
        r.some((c) => String(c).toLowerCase().includes("description"))
    );
    if (headerIdx === -1) continue;

    const header = rows[headerIdx].map(String);
    const idxRef = header.findIndex((h) => /hazard no/i.test(h) || /^EI\s*$/i.test(h));
    const idxUpdated = header.findIndex((h) => /updated/i.test(h));
    const idxDesc = header.findIndex((h) => /description/i.test(h));
    const idxSpec = header.findIndex((h) => /specific/i.test(h) || /specificity/i.test(h));
    const idxProb = header.findIndex((h) => /^prob/i.test(h));
    const idxSev = header.findIndex((h) => /^sev/i.test(h));
    const idxPrev = header.findIndex((h) => /prevention/i.test(h) || /barrier/i.test(h));

    const ueSheetLabel = name.trim();

    // 3) Build entries row by row
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const ei_ref = String(r[idxRef] ?? "").trim();
      const ei_label = String(r[idxDesc] ?? "").trim();
      const ue_ref = ueSheetLabel;
      const ue_label = String(r[idxSpec] ?? "").trim() || ueSheetLabel;

      // Use sheet-level "Ultimate events…" as Worst Foreseeable Outcome (text)
      const consequence = (ultimateText || "").trim();

      const barriersRaw = String(r[idxPrev] ?? "").trim();
      const barriers = barriersRaw
        ? barriersRaw
            .split(/\r?\n|;|,|\u2022|-/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      const probability = Number(String(r[idxProb] ?? "").trim());
      const severityNum = Number(String(r[idxSev] ?? "").trim());

      // risk like "3C" (5->A, 4->B, 3->C, 2->D, 1->E)
      let risk = "";
      if (Number.isFinite(probability) && Number.isFinite(severityNum)) {
        const sevMap = { 5: "A", 4: "B", 3: "C", 2: "D", 1: "E" };
        const sevLetter = sevMap[severityNum] || "E";
        risk = `${probability}${sevLetter}`;
      }

      // Skip empty
      if (!ei_ref && !ei_label && !ue_label && !consequence) continue;

      entries.push({
        ue_ref,
        ue_label,
        ei_ref,
        ei_label,
        consequence, // <-- textual "Ultimate events…" now
        barriers,
        risk,
        probability: Number.isFinite(probability) ? probability : undefined,
        severity: Number.isFinite(severityNum) ? severityNum : undefined,
        updated_on: String(r[idxUpdated] ?? "").trim(),
      });
    }
  }

  return entries;
}

async function replaceHazardLogAndReindex(entries) {
  const outPath = hazardLogFile;
  // backup
  if (fs.existsSync(outPath)) {
    const bak = outPath.replace(/\.json$/, `.${Date.now()}.bak.json`);
    fs.copyFileSync(outPath, bak);
  }
  fs.writeFileSync(outPath, JSON.stringify(entries, null, 2), "utf8");
  hazardLog = entries;
  console.log(`✅ Hazard Log remplacé (${entries.length} entrées).`);

  // Build texts & vectors
  const texts = hazardLog.map((e) => {
    const parts = [
      e.ue_ref,
      e.ue_label,
      e.ei_ref,
      e.ei_label,
      e.consequence,
      Array.isArray(e.barriers) ? e.barriers.join(", ") : e.barriers || "",
    ].filter(Boolean);
    return parts.join(" | ");
  });

  const vectors = await embedBatch(texts);
  const docs = hazardLog.map((e, i) => ({
    id: String(e.id || e.ue_ref || e.ei_ref || `hl-${i}`),
    text: texts[i],
    vector: vectors[i],
    meta: {
      index: i,
      ue_ref: e.ue_ref || null,
      ue_label: e.ue_label || null,
      ei_ref: e.ei_ref || null,
      ei_label: e.ei_label || null,
      consequence: e.consequence || null,
      barriers: Array.isArray(e.barriers) ? e.barriers : e.barriers ? [e.barriers] : [],
      risk: e.risk || null,
    },
  }));

  await upsertMany(docs);
  console.log(`✅ Réindexation OK (${docs.length} vecteurs).`);
}

/* ------------------------- Vectors: index + search ------------------------- */
app.post("/vectors/reindex", requireAuth, async (_req, res) => {
  try {
    if (!hazardLog.length) return res.status(400).json({ error: "Hazard Log vide" });

    const texts = hazardLog.map((e) => {
      const parts = [
        e.ue_ref,
        e.ue_label,
        e.ei_ref,
        e.ei_label,
        e.consequence,
        Array.isArray(e.barriers) ? e.barriers.join(", ") : e.barriers || "",
      ].filter(Boolean);
      return parts.join(" | ");
    });

    const vectors = await embedBatch(texts);

    const docs = hazardLog.map((e, i) => {
      const id = String(e.id || e.ue_ref || e.ei_ref || `hl-${i}`);
      return {
        id,
        text: texts[i],
        vector: vectors[i],
        meta: {
          index: i,
          ue_ref: e.ue_ref || null,
          ue_label: e.ue_label || null,
          ei_ref: e.ei_ref || null,
          ei_label: e.ei_label || null,
          consequence: e.consequence || null,
          barriers: Array.isArray(e.barriers) ? e.barriers : e.barriers ? [e.barriers] : [],
          risk: e.risk || null,
        },
      };
    });

    await upsertMany(docs);
    return res.json({ ok: true, indexed: docs.length });
  } catch (err) {
    console.error("Erreur /vectors/reindex:", err);
    return res.status(500).json({ error: "Indexation échouée" });
  }
});

app.post("/vectors/search", requireAuth, async (req, res) => {
  try {
    const { query, k = 5 } = req.body || {};
    if (!query) return res.status(400).json({ error: "query requis" });

    const qvec = await embedOne(query);
    const hits = await searchByVector(qvec, Number(k) || 5);
    return res.json({ hits });
  } catch (err) {
    console.error("Erreur /vectors/search:", err);
    return res.status(500).json({ error: "Recherche échouée" });
  }
});

/* ---------------------- Admin: upload new HL Excel (+reindex) -------------- */
app.post("/admin/hl/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier" });
    if (req.user?.sub !== APP_USER) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const fp = req.file.path;
    const wb = XLSX.readFile(fp);
    const entries = workbookToHazardEntries(wb);
    fs.unlink(fp, () => {});

    if (!entries.length) {
      return res.status(400).json({ error: "Aucune entrée détectée dans ce fichier." });
    }

    await replaceHazardLogAndReindex(entries);
    return res.json({ ok: true, entries: entries.length });
  } catch (err) {
    console.error("upload error:", err);
    return res.status(500).json({ error: "Échec du traitement" });
  }
});

/* ----------------------------- Analyze (mix) ------------------------------- */
// On garde la logique mots-clés; si aucun match, on tente le vectoriel
app.post("/analyze", requireAuth, async (req, res) => {
  const { narrative } = req.body || {};
  if (!narrative || String(narrative).trim().length < 5) {
    return res.status(400).json({ error: "Narratif trop court ou invalide." });
  }

  // 1) keyword match
  const kw = findBestMatch(narrative);
  if (kw) {
    const riskInfo = computeRiskIndex(kw.risk);
    return res.json({
      classification: "À analyser",
      hazard: { label: kw.ue_label || kw.ue_ref || "UE", ref: kw.ue_ref || "UE" },
      threat: { label: kw.ei_label || kw.ei_ref || "EI", ref: kw.ei_ref || "EI" },
      consequence: kw.consequence || "À définir",
      barriers: Array.isArray(kw.barriers) ? kw.barriers : kw.barriers ? [kw.barriers] : [],
      probability: riskInfo.probability,
      severity: riskInfo.severity,
      riskIndex: riskInfo.riskIndex,
    });
  }

  // 2) fallback vectoriel (top-1)
  try {
    const qvec = await embedOne(narrative);
    const hits = await searchByVector(qvec, 1);
    if (hits && hits.length) {
      const m = hits[0].meta || {};
      const riskInfo = computeRiskIndex(m.risk);
      return res.json({
        classification: "À analyser",
        hazard: { label: m.ue_label || m.ue_ref || "UE", ref: m.ue_ref || "UE" },
        threat: { label: m.ei_label || m.ei_ref || "EI", ref: m.ei_ref || "EI" },
        consequence: m.consequence || "À définir",
        barriers: Array.isArray(m.barriers) ? m.barriers : [],
        probability: riskInfo.probability,
        severity: riskInfo.severity,
        riskIndex: riskInfo.riskIndex,
      });
    }
  } catch (err) {
    console.warn("Vector fallback error:", err?.message);
  }

  // 3) rien trouvé → Nouveau
  return res.json({
    classification: "À analyser",
    hazard: { label: "Nouveau", ref: "Nouveau" },
    threat: { label: "Nouveau", ref: "Nouveau" },
    consequence: "À définir",
    barriers: [],
    probability: "?",
    severity: "?",
    riskIndex: "?",
  });
});

/* --------------------------------- Start ---------------------------------- */
(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`✅ Backend running on port ${PORT} (CORS origin: ${CORS_ORIGIN})`);
    });
  } catch (e) {
    console.error("❌ initDb failed:", e);
    process.exit(1);
  }
})();