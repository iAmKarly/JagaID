import { NextResponse } from "next/server";
import { dbGetStats, dbGetTopEntities } from "@/lib/db";

export async function GET() {
  try {
    const [stats, topEntities] = await Promise.all([dbGetStats(), dbGetTopEntities(5)]);
    return NextResponse.json({ stats, topEntities }, { status: 200 });
  } catch (err) {
    console.error("[/api/stats]", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
