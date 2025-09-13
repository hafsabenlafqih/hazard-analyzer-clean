// db.js
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.VECTOR_DB_PATH || path.join(__dirname, "vectorstore.sqlite");
const TABLE = "vectors";
const DIM = 384; // all-MiniLM-L6-v2 output size

let db;

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function initDb() {
  ensureDir(DB_PATH);
  db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id TEXT PRIMARY KEY,
      text TEXT,
      vector BLOB,
      meta  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_text ON ${TABLE}(text);
  `);

  console.log(`✅ Vector store initialisé (${count()} vecteurs).`);
}

function serializeVector(vec) {
  const buf = Buffer.alloc(Float32Array.BYTES_PER_ELEMENT * vec.length);
  const view = new Float32Array(buf.buffer, buf.byteOffset, vec.length);
  for (let i = 0; i < vec.length; i++) view[i] = vec[i];
  return buf;
}

function deserializeVector(buf) {
  const view = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  return Array.from(view);
}

function upsertMany(docs) {
  const insert = db.prepare(
    `INSERT INTO ${TABLE} (id, text, vector, meta)
     VALUES (@id, @text, @vector, @meta)
     ON CONFLICT(id) DO UPDATE SET text=excluded.text, vector=excluded.vector, meta=excluded.meta`
  );
  const trx = db.transaction((rows) => {
    for (const d of rows) {
      if (!Array.isArray(d.vector) || !d.vector.length) continue;
      if (d.vector.length !== DIM) {
        // not fatal — but skip wrong dims to avoid corrupt store
        continue;
      }
      insert.run({
        id: String(d.id),
        text: d.text || "",
        vector: serializeVector(d.vector),
        meta: JSON.stringify(d.meta || {}),
      });
    }
  });
  trx(docs);
}

function count() {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`).get();
  return r.n;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
  return dot / denom;
}

function searchByVector(queryVec, k = 5) {
  const rows = db.prepare(`SELECT id, text, vector, meta FROM ${TABLE}`).all();
  const scored = rows.map((r) => {
    const vec = deserializeVector(r.vector);
    const score = cosine(queryVec, vec);
    return { id: r.id, text: r.text, meta: JSON.parse(r.meta || "{}"), score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

module.exports = { initDb, upsertMany, searchByVector, count };