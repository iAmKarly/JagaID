import type { Metadata } from "next";
import { headers } from "next/headers";
import { Space_Mono } from "next/font/google";

// next/font self-hosts Space Mono at build time → no <link> to fonts.googleapis.com,
// no FOUT, no extra CSP entries for Google Fonts. Exposes the family as a CSS
// variable so existing inline styles (App.tsx, admin page) keep working unchanged
// after they reference `var(--font-mono)` instead of the literal "Space Mono".
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "JagaID — Anti-Fraud Indonesia",
  description:
    "Cek rekening penipu, laporkan penipuan, dan lindungi diri dari fraud online di Indonesia.",
  keywords: ["cek rekening", "penipuan", "fraud", "Indonesia", "anti scam"],
  metadataBase: new URL("https://jagaid.app"),
  openGraph: {
    title: "JagaID — Anti-Fraud Indonesia",
    description: "Platform deteksi fraud nasional Indonesia",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading headers() forces this layout into dynamic rendering. That's
  // required for the per-request CSP nonce (set in middleware.ts) to land
  // correctly in the HTML — a statically pre-rendered layout would freeze a
  // single nonce at build time, defeating the purpose.
  headers();

  return (
    <html lang="id" className={spaceMono.variable}>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
