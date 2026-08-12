import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "";

// ── CORS preflight headers (only used when ALLOWED_ORIGIN is set) ─────────────
function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key, x-e2e-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// ── CSP builder ───────────────────────────────────────────────────────────────
// Built per-request so each response gets a fresh nonce. The nonce is also
// attached to the request via `x-nonce` so Server Components and Next's own
// inline-script emitter can read it.
function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' tells the browser: trust scripts that are loaded by
    // already-trusted scripts (i.e., Next's hydration entry). Combined with
    // the nonce on the entry script, this is the modern recommended CSP.
    // 'unsafe-eval' is required in dev for React Fast Refresh / HMR.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline styles can't execute code; allowing them is much lower-risk than
    // allowing inline scripts. React's style={{...}} props inline as <style>.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    // next/font self-hosts so font-src needs only 'self'. data: covers any
    // base64-embedded fallback fonts the framework may emit.
    "font-src 'self' data:",
    // Browser only ever fetches /api/* (same-origin). Supabase calls happen
    // server-side, so the previous https://*.supabase.co allowance is dropped.
    `connect-src 'self'${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith("/api");

  // ── CORS preflight (API only) ──────────────────────────────────────────────
  // Same-origin requests skip preflight, so this only fires when ALLOWED_ORIGIN
  // is set and a cross-origin client asks. Without ALLOWED_ORIGIN we 405 the
  // OPTIONS verb so the API stays strictly same-origin.
  if (req.method === "OPTIONS" && isApi) {
    if (!ALLOWED_ORIGIN) return new NextResponse(null, { status: 405 });
    const origin = req.headers.get("origin") ?? "";
    if (origin !== ALLOWED_ORIGIN) return new NextResponse(null, { status: 403 });
    return new NextResponse(null, { status: 204, headers: corsHeaders() });
  }

  // API responses are JSON — no CSP needed.
  if (isApi) return NextResponse.next();

  // ── CSP nonce injection (HTML pages) ───────────────────────────────────────
  // crypto.randomUUID is available in the Edge runtime; base64-encode for
  // shorter representation.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";

  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set("Content-Security-Policy", buildCsp(nonce, isDev));
  return res;
}

export const config = {
  // Run on everything except static assets and the favicon. _next/static and
  // _next/image are pre-built/cached files that don't need CSP or CORS.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
