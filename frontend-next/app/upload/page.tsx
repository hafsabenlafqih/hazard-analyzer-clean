"use client";
import { useEffect, useState } from "react";
import { getToken, authHeader } from "@/lib/auth";

export default function UploadHLPage() {
  const [file, setFile] = useState<File | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";

  useEffect(() => {
    const t = getToken();
    if (!t) window.location.href = "/login";
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOut(null);
    setErr(null);
    if (!file) {
      setErr("Choisissez un fichier .xlsx");
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/upload-hl`, {
        method: "POST",
        headers: { ...authHeader() }, // Bearer <token>
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Upload échoué");
      setOut(`✅ Import réussi — ${data.entries} lignes, ${data.indexed} indexées.`);
    } catch (e: any) {
      setErr(e?.message || "Erreur d’upload");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Mettre à jour le Hazard Log</h1>
      <p className="text-sm text-neutral-600">
        Sélectionnez un fichier Excel (.xlsx) au même format (feuilles « UE XX »).
      </p>

      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border p-4 bg-white">
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full"
        />
        <button
          type="submit"
          disabled={loading || !file}
          className="rounded-md bg-[#BE1E2D] px-4 py-2 text-white disabled:opacity-60"
        >
          {loading ? "Téléversement…" : "Uploader & Réindexer"}
        </button>
      </form>

      {out && <div className="rounded-md bg-emerald-50 text-emerald-700 p-3">{out}</div>}
      {err && <div className="rounded-md bg-red-50 text-red-700 p-3">{err}</div>}
    </div>
  );
}
