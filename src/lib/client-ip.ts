/**
 * src/lib/client-ip.ts
 *
 * Resolves the client IP for rate-limiting and report-dedup. Returns a
 * stable hash, never the raw IP — we don't want IPs in our DB or logs.
 *
 * Order of preference:
 *   1. NextRequest.ip          (Vercel sets this; the most reliable)
 *   2. x-forwarded-for         (first IP in the chain; behind a proxy)
 *   3. x-real-ip               (some hosts; e.g. nginx)
 *   4. "unknown"               (dev / missing headers; collapses to one bucket)
 *
 * The hash is SHA-256 of `salt + ip`. Salt comes from IP_HASH_SALT env var
 * with a fallback so missing config doesn't crash dev. In prod, set the salt
 * — without it, the same IPs across deploys would hash to the same bucket
 * forever (still privacy-friendly, but easier to correlate).
 */

import { createHash } from "crypto";
import type { NextRequest } from "next/server";

export function getClientIp(req: NextRequest): string {
  const direct = (req as unknown as { ip?: string }).ip;
  if (direct) return direct;

  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();

  const real = req.headers.get("x-real-ip");
  if (real) return real;

  return "unknown";
}

export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? "jagaid-dev-salt-please-set-in-env";
  return createHash("sha256")
    .update(salt + ":" + ip)
    .digest("hex")
    .slice(0, 32);
}

/** Convenience: getClientIp + hashIp in one call. */
export function getClientIpHash(req: NextRequest): string {
  return hashIp(getClientIp(req));
}
