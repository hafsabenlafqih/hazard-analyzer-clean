"use client";
import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Script from "next/script";
import { setToken } from "@/lib/auth";

// ---- Typage minimal de grecaptcha (v2) ----
declare global {
  interface Window {
    grecaptcha?: {
      getResponse(widgetId?: number): string;
      reset(widgetId?: number): void;
      render(
        container: HTMLElement | string,
        parameters: { sitekey: string }
      ): number;
    };
  }
}

export default function LoginPage() {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";
  const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "";

  // ref du conteneur + id du widget rendu
  const captchaDivRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<number | null>(null);

  // Rendu manuel du widget reCAPTCHA v2 (checkbox)
  useEffect(() => {
    const tryRender = () => {
      if (!SITE_KEY) return; // évite l'erreur "missing sitekey"
      if (!captchaDivRef.current) return;
      if (!window.grecaptcha) return;
      if (widgetIdRef.current !== null) return; // déjà rendu

      widgetIdRef.current = window.grecaptcha.render(captchaDivRef.current, {
        sitekey: SITE_KEY,
      });
    };

    // 1) tentative immédiate si le script est déjà chargé
    tryRender();
    // 2) légère attente (certains navigateurs chargent le script un poil après)
    const t = setTimeout(tryRender, 300);
    return () => clearTimeout(t);
  }, [SITE_KEY]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const captchaToken = window.grecaptcha?.getResponse(widgetIdRef.current ?? undefined);
    if (!captchaToken) {
      setError("Captcha manquant — veuillez cocher la case.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass, captchaToken }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Identifiants invalides");
      }

      const data = await res.json();
      if (!data.token) throw new Error("Réponse invalide du serveur");

      setToken(data.token);
      window.location.href = "/";
    } catch (err: any) {
      setError(err?.message || "Impossible de joindre le serveur");
    } finally {
      setLoading(false);
      window.grecaptcha?.reset(widgetIdRef.current ?? undefined);
    }
  };

  return (
    <>
      {/* Script v2 en mode rendu explicite */}
      <Script
        src="https://www.google.com/recaptcha/api.js?render=explicit"
        strategy="afterInteractive"
        onError={() => setError("Impossible de charger reCAPTCHA. Rechargez la page.")}
      />

      <div className="relative min-h-screen overflow-hidden">
        {/* Fond */}
        <div className="absolute inset-0 -z-20">
          <Image src="/login.png" alt="Background" fill priority className="object-cover" />
        </div>
        <div className="absolute inset-0 -z-10 backdrop-blur-[2px] brightness-95" />
        <div className="absolute inset-0 -z-10 bg-black/15" />

        {/* Carte de connexion */}
        <div className="relative min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/20 bg-white/85 backdrop-blur-md shadow-xl p-6 sm:p-8">
            <div className="text-center mb-6">
              <Image src="/ram-logo.svg.png" alt="Logo" width={120} height={40} className="mx-auto h-auto w-[120px]" priority />
              <h1 className="mt-4 text-lg font-semibold text-neutral-800">Connexion</h1>
              <p className="text-xs text-neutral-600">Accès réservé au personnel</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-800">Utilisateur</label>
                <input
                  type="text"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 bg-white/90 p-2.5 outline-none focus:ring-2 focus:ring-[#BE1E2D]"
                  autoComplete="username"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-800">Mot de passe</label>
                <input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 bg-white/90 p-2.5 outline-none focus:ring-2 focus:ring-[#BE1E2D]"
                  autoComplete="current-password"
                  required
                />
              </div>

              {/* Emplacement du widget (pas de classe g-recaptcha en mode manuel) */}
              <div className="mt-2">
                <div ref={captchaDivRef} />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#BE1E2D] py-2.5 font-medium text-white shadow hover:bg-[#9D1826] transition disabled:opacity-60"
              >
                {loading ? "Connexion…" : "Se connecter"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
