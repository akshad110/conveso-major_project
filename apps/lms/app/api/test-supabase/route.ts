import { createSupabaseClient } from "../../../lib/supabase";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase.from('companions').select().limit(1);
    if (error) {
      console.error("Supabase query error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
