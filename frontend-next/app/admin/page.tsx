"use client";
import { useEffect, useState } from "react";
import { getToken } from "@/lib/auth";

export default function AdminUploadPage() {
  const [token, setToken] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    const t = getToken();
    if (!t) {
      // pas connecté → login
      window.location.href = "/login";
      return;
    }
    setToken(t);
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!file) {
      setStatus("Choisis d’abord un fichier Excel (.xlsx).");
      return;
    }

    setStatus("Envoi en cours…");
    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000"}/admin/hl/upload`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Échec de l’upload");
      }
      setStatus(`✅ Upload OK — ${data.entries} entrées importées & réindexées.`);
    } catch (err: any) {
      setStatus(`❌ ${err?.message || "Erreur inconnue"}`);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto max-w-xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Admin — Import Hazard Log</h1>
        <p className="text-sm text-neutral-600 mt-2">
          Charge un fichier Excel (ex: <code>HL et Exemple Traitement SMS.xlsx</code>). Le backend
          remplacera <code>hazard-log.json</code> et réindexera automatiquement les vecteurs.
        </p>

        <form onSubmit={handleUpload} className="mt-6 space-y-4 rounded-xl border bg-white p-5 shadow-sm">
          <div>
            <label className="block text-sm font-medium mb-1">Fichier Excel (.xlsx)</label>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-neutral-100 file:px-3 file:py-1.5"
            />
          </div>

          <button
            type="submit"
            disabled={!file}
            className="rounded-md bg-[#BE1E2D] px-4 py-2 text-white disabled:opacity-60"
          >
            Envoyer & Réindexer
          </button>

          {status && <p className="text-sm mt-2">{status}</p>}
        </form>

        <div className="mt-6 text-xs text-neutral-500">
          Astuce : garde le même format d’onglets UE dans l’Excel (UE 01, UE 02, …). Les nouvelles lignes
          seront prises en compte automatiquement.
        </div>
      </div>
    </main>
  );
}
