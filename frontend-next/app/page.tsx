"use client";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { getToken, clearToken, authHeader } from "@/lib/auth";

/* -------- Types alignés avec la spec -------- */
type APIResult = {
  classification: string;                   // Event Classification
  hazard: { label: string; ref: string };   // Hazard - UE + Réf UE
  threat: { label: string; ref: string };   // EI + Réf EI
  consequence: string;                      // Worst Foreseeable Outcome
  barriers: string[];                       // Barrières existantes
  probability: number | string;             // Probabilité estimée (1..5 ou "?")
  severity: number | string;                // Sévérité estimée (1..5 ou "?")
  riskIndex: number | string;               // Indice de risque (= P × S ou "?")
};

export default function Home() {
  const [narrative, setNarrative] = useState("");
  const [result, setResult] = useState<APIResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [token, setTokenState] = useState<string | null>(null);

  // upload state
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";
  const chars = narrative.length;
  const max = 1600;
  const nearLimit = chars > max * 0.9;

  /* -------- Redirige vers /login si pas de token -------- */
  useEffect(() => {
    const t = getToken();
    if (!t) {
      window.location.href = "/login";
    } else {
      setTokenState(t);
    }
  }, []);

  /* -------- Niveau global (texte + couleur) -------- */
  const riskLevel = useMemo(() => {
    if (!result?.riskIndex || result.riskIndex === "?") return "unknown";
    const v = Number(result.riskIndex);
    if (Number.isNaN(v)) return "unknown";
    if (v >= 15) return "high";
    if (v >= 8) return "medium";
    return "low";
  }, [result]);

  /* -------- Appel /analyze -------- */
  const analyze = async () => {
    if (!narrative.trim()) return showToast("Le narratif est vide.");
    if (!token) {
      showToast("Session expirée. Veuillez vous reconnecter.");
      window.location.href = "/login";
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader(),
        },
        body: JSON.stringify({ narrative }),
      });

      if (res.status === 401) {
        showToast("Session expirée. Veuillez vous reconnecter.");
        clearToken();
        window.location.href = "/login";
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Erreur serveur");
      }

      const data = (await res.json()) as APIResult;
      setResult(data);
    } catch (e: any) {
      showToast(e?.message ?? "Erreur lors de l’analyse");
    } finally {
      setLoading(false);
    }
  };

  /* -------- Upload Excel HL + réindexation (backend: /admin/hl/upload) -------- */
  const handleUpload = async () => {
    if (!file) return showToast("Choisissez un fichier Excel d’abord.");
    if (!token) {
      showToast("Session expirée. Veuillez vous reconnecter.");
      window.location.href = "/login";
      return;
    }
    try {
      setUploading(true);
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(`${API_BASE}/admin/hl/upload`, {
        method: "POST",
        headers: {
          // IMPORTANT: ne pas fixer Content-Type ici (FormData le gère)
          ...authHeader(),
        },
        body: fd,
      });

      if (res.status === 401) {
        showToast("Session expirée. Veuillez vous reconnecter.");
        clearToken();
        window.location.href = "/login";
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Échec de l’upload");
      }

      showToast(`HL importé et réindexé (${data.entries} entrées)`);
      setFile(null);
      const input = document.getElementById("hl-file") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (e: any) {
      showToast(e?.message || "Erreur lors de l’upload");
    } finally {
      setUploading(false);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  /* -------------------- UI -------------------- */
  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(ellipse_at_top,rgba(190,30,45,0.06),transparent_50%)]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#BE1E2D] text-white shadow-sm">
        <div className="mx-auto max-w-6xl h-14 px-6 flex items-center gap-3">
          <Image src="/ram-logo.svg.png" alt="RAM" width={56} height={18} priority />
          <div className="font-semibold tracking-tight">Hazard Analyzer</div>
          <nav className="ml-auto hidden sm:flex items-center gap-6 text-sm/none opacity-90">
            <a className="hover:opacity-100 transition" href="/">Accueil</a>
            {/* History + Aide removed */}
            <button
              onClick={() => { clearToken(); window.location.href = "/login"; }}
              className="rounded-md border border-white/30 px-3 py-1 text-white/90 hover:text-white hover:bg-white/10"
            >
              Déconnexion
            </button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b border-neutral-200">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <h1 className="text-2xl md:text-3xl font-semibold">Analyse du narratif basée sur le Hazard Log</h1>
          <p className="text-sm text-neutral-600 mt-2">
            Collez le narratif d’un événement. Ou importez un nouveau Hazard Log Excel pour mettre à jour la base.
          </p>
        </div>
      </section>

      {/* Main */}
      <main className="mx-auto w-full max-w-6xl px-6 py-8 flex-1 space-y-8">
        {/* Upload HL */}
        <section className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-6">
          <h2 className="text-base font-semibold">Mettre à jour le Hazard Log (Excel)</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Fichier attendu : votre classeur HL (ex. <i>HL et Exemple Traitement SMS.xlsx</i>).
          </p>
          <div className="mt-3 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <input
              id="hl-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full sm:w-auto text-sm file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-neutral-50 file:px-3 file:py-1.5 file:text-sm file:text-neutral-700 hover:file:bg-neutral-100"
            />
            <button
              onClick={handleUpload}
              disabled={uploading || !file}
              className="inline-flex items-center gap-2 rounded-lg bg-neutral-800 px-4 py-2 text-white hover:bg-neutral-900 disabled:opacity-60"
            >
              {uploading && (
                <span className="h-4 w-4 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
              )}
              {uploading ? "Import en cours…" : "Uploader & Réindexer"}
            </button>
            {file && (
              <span className="text-xs text-neutral-600">
                Fichier sélectionné : <b>{file.name}</b>
              </span>
            )}
          </div>
        </section>

        {/* Form card */}
        <section className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-6">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="narrative" className="block text-sm font-medium">Narratif de l’événement</label>
            <span className={`text-xs ${nearLimit ? "text-[#BE1E2D] font-medium" : "text-neutral-500"}`}>
              {chars}/{max}
            </span>
          </div>

          <textarea
            id="narrative"
            rows={8}
            maxLength={max}
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            className="mt-2 w-full rounded-xl border border-neutral-300 bg-white p-3 shadow-sm
                       focus:outline-none focus:ring-2 focus:ring-[#BE1E2D]"
          />

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={analyze}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-[#BE1E2D] px-5 py-2.5
                         font-medium text-white shadow-sm transition hover:bg-[#9D1826]
                         disabled:opacity-60"
            >
              {loading && <span className="h-4 w-4 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />}
              {loading ? "Analyse en cours…" : "Analyser"}
            </button>

            <button
              onClick={() => { setNarrative(""); setResult(null); }}
              disabled={loading}
              className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              Nouveau
            </button>
          </div>
        </section>

        {/* Loading skeleton */}
        {loading && (
          <section className="grid gap-6 md:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-6">
                <div className="h-5 w-40 bg-neutral-200 rounded mb-4 animate-pulse" />
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, k) => (
                    <div key={k} className="h-4 w-full bg-neutral-100 rounded animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Results */}
        {result && !loading && (
          <section className="grid gap-6 md:grid-cols-2">
            {/* Bloc gauche : Détails */}
            <div className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Résultats</h2>
                <Pill color="#E11D48">{result.classification || "À analyser"}</Pill>
              </div>

              <div className="mt-4 space-y-4">
                <Row k="Danger générique (UE)">
                  <span className="font-medium">{fallback(result.hazard?.label, "Nouveau")}</span>
                  <Badge>{fallback(result.hazard?.ref, "Nouveau")}</Badge>
                </Row>

                <Row k="Composante/menace (EI)">
                  <span className="font-medium">{fallback(result.threat?.label, "Nouveau")}</span>
                  <Badge>{fallback(result.threat?.ref, "Nouveau")}</Badge>
                </Row>

                <Row k="Conséquence potentielle la plus grave">
                  <span className="font-medium">{fallback(result.consequence, "À définir")}</span>
                </Row>

                <Row k="Barrières existantes">
                  {Array.isArray(result.barriers) && result.barriers.length ? (
                    <div className="flex flex-wrap gap-2">
                      {result.barriers.map((b, i) => (
                        <span key={i} className="inline-block rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-700 border border-neutral-200">
                          {b}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-neutral-500">—</span>
                  )}
                </Row>
              </div>
            </div>

            {/* Bloc droit : Risque */}
            <div className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-6">
              <h2 className="text-lg font-semibold">Indice de risque</h2>

              <div className="mt-4 grid grid-cols-3 gap-4">
                <Stat label="Probabilité" value={String(result.probability ?? "?")} />
                <Stat label="Sévérité" value={String(result.severity ?? "?")} />
                <Stat label="Index" value={String(result.riskIndex ?? "?")} />
              </div>

              <div className="mt-6 flex items-center gap-4">
                <RiskMeter
                  prob={toNum(result.probability)}
                  sev={toNum(result.severity)}
                  index={toNum(result.riskIndex)}
                />
                <div>
                  <div className="text-sm text-neutral-600">Niveau</div>
                  <div className={`text-lg font-semibold ${riskLevelColor(riskLevel)}`}>
                    {riskLevelLabel(riskLevel)}
                  </div>
                  <div className="mt-1 text-[11px] text-neutral-500">
                    (couleur selon la matrice RAM : P 1–5 × S 1–5)
                  </div>
                </div>
              </div>

              <p className="mt-4 text-xs text-neutral-500">Indice = Probabilité × Sévérité</p>
            </div>
          </section>
        )}
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-lg bg-[#BE1E2D] text-white px-4 py-2 shadow-lg animate-in fade-in slide-in-from-bottom-2">
            {toast}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="text-center text-xs text-neutral-500 py-8">
        ©️ {new Date().getFullYear()} RAM Express — Safety / SMS
      </footer>
    </div>
  );
}

/* -------------------- UI bits -------------------- */

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-5 md:col-span-4 text-neutral-600">{k}</div>
      <div className="col-span-7 md:col-span-8 flex items-center gap-2">{children}</div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-[#BE1E2D]">
      {children}
    </span>
  );
}

function Pill({ children, color = "#BE1E2D" }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
      style={{ background: `${hexToRGBA(color, 0.1)}`, color, border: `1px solid ${hexToRGBA(color, 0.25)}` }}
    >
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center shadow-sm">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

/* -------------------- Risk meter + helpers -------------------- */

/**
 * Map RAM matrix (comme dans votre Excel) vers 3 zones.
 * Conversion S (1..5) -> lettre: 5=A, 4=B, 3=C, 2=D, 1=E.
 * High (rouge)   : 5A,5B,5C ; 4A,4B ; 3A
 * Low (vert)     : 2D,2E ; 1B,1C,1D,1E
 * Medium (orange): tout le reste.
 */
function riskZone(prob: number, sevNum: number): "low" | "medium" | "high" {
  if (!Number.isFinite(prob) || !Number.isFinite(sevNum)) return "low";

  const sevLetterMap: Record<number, "A" | "B" | "C" | "D" | "E"> = {
    5: "A", // Catastrophic
    4: "B", // Hazardous
    3: "C", // Major
    2: "D", // Minor
    1: "E", // Negligible
  };
  const sev = sevLetterMap[sevNum as 1 | 2 | 3 | 4 | 5] || "E";
  const cell = `${prob}${sev}`;

  const HIGH = new Set(["5A", "5B", "5C", "4A", "4B", "3A"]);
  const LOW = new Set(["2D", "2E", "1B", "1C", "1D", "1E"]);
  if (HIGH.has(cell)) return "high";
  if (LOW.has(cell)) return "low";
  return "medium";
}

function RiskMeter({ prob, sev, index }: { prob: number; sev: number; index: number }) {
  const zone = riskZone(prob, sev);

  const segments = [
    { key: "low", label: "Acceptable", width: 45, className: "bg-emerald-500" },
    { key: "medium", label: "Tolérable", width: 35, className: "bg-amber-500" },
    { key: "high", label: "Inacceptable", width: 20, className: "bg-red-500" },
  ] as const;

  // Index 0..25 → position 0..100%
  const idx = Number.isFinite(index) ? Math.max(0, Math.min(25, index)) : 0;
  const markerLeft = `${(idx / 25) * 100}%`;

  return (
    <div className="w-64">
      <div className="relative h-3 w-full rounded-full overflow-hidden border border-neutral-300 bg-neutral-200">
        {segments.map((s) => (
          <div
            key={s.key}
            className={`${s.className} h-full inline-block`}
            style={{ width: `${s.width}%`, opacity: zone === s.key ? 1 : 0.55 }}
            title={s.label}
          />
        ))}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-[2px] bg-neutral-900"
          style={{ left: markerLeft }}
          aria-hidden
        />
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-neutral-600">
        <span>Acceptable</span>
        <span>Tolérable</span>
        <span>Inacceptable</span>
      </div>
    </div>
  );
}

/* -------------------- Misc helpers -------------------- */

function toNum(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function riskLevelLabel(level: string) {
  if (level === "high") return "Élevé";
  if (level === "medium") return "Modéré";
  if (level === "low") return "Faible";
  return "—";
}
function riskLevelColor(level: string) {
  if (level === "high") return "text-red-600";
  if (level === "medium") return "text-amber-600";
  if (level === "low") return "text-emerald-600";
  return "text-neutral-500";
}
function hexToRGBA(hex: string, alpha = 1) {
  const m = hex.replace("#", "");
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function fallback<T>(val: T | undefined | null, fb: T): T {
  return (val === undefined || val === null || val === "" ? fb : val) as T;
}