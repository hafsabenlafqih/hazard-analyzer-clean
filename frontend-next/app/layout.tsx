import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Hazard Analyzer",
  description: "Analyse narrative basée sur le Hazard Log",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

  return (
    <html lang="fr">
      <head>
        {siteKey ? (
          <Script
            src={`https://www.google.com/recaptcha/api.js?render=${siteKey}`}
            strategy="afterInteractive"
          />
        ) : null}
      </head>
      <body className={`${inter.className} bg-neutral-50 text-neutral-900`}>
        {children}
      </body>
    </html>
  );
}
