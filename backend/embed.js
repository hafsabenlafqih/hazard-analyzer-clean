// embed.js
const { pipeline } = require("@xenova/transformers");

// Singleton (lazy-loaded)
let embedder = null;

async function loadEmbedder() {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return embedder;
}

// Backup mean pooling (in case pooling not supported)
function meanPool(tensor) {
  const arr = Array.from(tensor.data);
  const seqLen = tensor.dims[1];
  const dim = tensor.dims[2];
  const out = new Array(dim).fill(0);
  for (let i = 0; i < seqLen; i++) {
    for (let j = 0; j < dim; j++) {
      out[j] += arr[i * dim + j];
    }
  }
  for (let j = 0; j < dim; j++) {
    out[j] /= seqLen;
  }
  return out;
}

async function embedOne(text) {
  const embedder = await loadEmbedder();

  try {
    const result = await embedder(text, {
      pooling: "mean",
      normalize: true,
    });

    // Si nouvelle version de transformers
    if (Array.isArray(result)) return result;

    // Si ancienne version sans pooling/normalize
    if (result?.data && result?.dims) return meanPool(result);

    throw new Error("Format d'embedding non reconnu");
  } catch (err) {
    console.error("Erreur dans embedOne:", err);
    throw err;
  }
}

async function embedBatch(texts) {
  return Promise.all(texts.map(embedOne));
}

module.exports = {
  embedOne,
  embedBatch,
};