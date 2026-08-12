import { NextRequest, NextResponse } from "next/server";
import { ReportPayloadSchema } from "@/lib/validators";
import { dbSubmitReport, DuplicateReportError } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp, hashIp } from "@/lib/client-ip";

// 5 reports per hour per (IP, normalised entity value). Two layers of
// defence:
//   - This in-memory rate limit catches casual button-mashing and trivial
//     loops within a single instance, returning 429 fast and cheap.
//   - The DB-side partial unique index (migration 003) catches the same
//     IP+entity+day across instances, returning 429 with a clearer message.
const REPORT_MAX = 5;
const REPORT_WINDOW_MS = 60 * 60_000; // 1 hour

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ReportPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  // Per-IP-per-entity rate limit. Use the *normalised* value so different
  // formats of the same number all collapse into one bucket.
  const ip = getClientIp(request);
  const rl = rateLimit(
    `report:${ip}:${parsed.data.value}`,
    REPORT_MAX,
    REPORT_WINDOW_MS
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Terlalu banyak laporan untuk entitas ini dari IP Anda. Coba lagi nanti." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.resetIn),
          "X-RateLimit-Limit": String(REPORT_MAX),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rl.resetIn),
        },
      }
    );
  }

  try {
    const result = await dbSubmitReport(parsed.data, { ipHash: hashIp(ip) });
    return NextResponse.json(
      { success: true, entity_id: result.entity_id },
      {
        status: 201,
        headers: {
          "X-RateLimit-Limit": String(REPORT_MAX),
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.resetIn),
        },
      }
    );
  } catch (err) {
    if (err instanceof DuplicateReportError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    console.error("[/api/report]", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
