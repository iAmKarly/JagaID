import { NextRequest, NextResponse } from "next/server";
import { dbLookup } from "@/lib/db";
import { LookupQuerySchema } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";

// 60 lookups per minute per IP. Generous enough that a normal user copy-
// pasting different numbers won't notice; tight enough to deter scraping.
const LOOKUP_MAX = 60;
const LOOKUP_WINDOW_MS = 60_000;

export async function GET(request: NextRequest) {
  // Rate limit before parsing — keeps malformed-spam cheap to reject.
  const ip = getClientIp(request);
  const rl = rateLimit(`check:${ip}`, LOOKUP_MAX, LOOKUP_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan. Coba lagi dalam beberapa detik." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.resetIn),
          "X-RateLimit-Limit": String(LOOKUP_MAX),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rl.resetIn),
        },
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  const parsed = LookupQuerySchema.safeParse({ q });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors.q?.[0] ?? "Query tidak valid" },
      { status: 400 }
    );
  }

  try {
    const result = await dbLookup(parsed.data.q);
    return NextResponse.json(result, {
      status: 200,
      headers: {
        "X-RateLimit-Limit": String(LOOKUP_MAX),
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.resetIn),
      },
    });
  } catch (err) {
    console.error("[/api/check]", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
