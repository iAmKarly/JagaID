import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Constant-time string equality. Use for comparing user-supplied secrets
 * (admin keys, e2e keys) against env values. A naive `a === b` short-circuits
 * on the first differing character, leaking the matched prefix length via
 * response timing. timingSafeEqual always reads both buffers to the end.
 *
 * Returns false on missing inputs so callers don't have to guard separately.
 */
export function safeEqual(a: string | null | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) {
    // Still touch a same-size buffer so the failing branch costs about the
    // same as the success branch. Cheap, makes timing analysis useless.
    timingSafeEqual(A, A);
    return false;
  }
  return timingSafeEqual(A, B);
}

/**
 * Verify an admin-style header against an env-configured secret.
 *
 *   isAuthorized(req, "x-admin-key", "ADMIN_UPLOAD_KEY")
 *
 * Returns false if either side is missing — including the "env var unset"
 * case, so a forgotten env var means denied-by-default rather than
 * permitted-by-default.
 */
export function isAuthorizedHeader(
  req: NextRequest,
  headerName: string,
  envVarName: string
): boolean {
  const expected = process.env[envVarName];
  if (!expected) return false;
  const provided = req.headers.get(headerName);
  return safeEqual(provided, expected);
}
