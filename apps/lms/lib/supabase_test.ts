import { createSupabaseClient } from "./supabase.ts";

const supabase = createSupabaseClient();


async function testSupabaseConnection() {
  try {
    const { data, error } = await supabase.from('companions').select().limit(1);
    if (error) {
      console.error("Error querying Supabase:", error.message);
      process.exit(1);
    }
    console.log("Supabase query successful. Data:", data);
  } catch (err) {
    console.error("Unexpected error:", err);
    process.exit(1);
  }
}

testSupabaseConnection();
