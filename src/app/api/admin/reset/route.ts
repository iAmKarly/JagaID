import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAuthorizedHeader } from "@/lib/auth";

export async function DELETE(request: NextRequest) {
  if (!isAuthorizedHeader(request, "x-admin-key", "ADMIN_UPLOAD_KEY")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const results: Record<string, number> = {};

  // Delete in FK-safe order
  for (const table of ["reports", "connections", "entities"] as const) {
    const { data, error } = await db
      .from(table)
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000")
      .select("id");

    if (error) {
      return NextResponse.json(
        { error: `Failed to delete ${table}: ${error.message}` },
        { status: 500 }
      );
    }
    results[table] = data?.length ?? 0;
  }

  return NextResponse.json({ success: true, deleted: results }, { status: 200 });
}
