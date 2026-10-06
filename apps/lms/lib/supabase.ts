import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase URL or ANON key is missing!");
}

// For client-side or public operations
export const createSupabaseClient = () => {
  return createClient(supabaseUrl, supabaseAnonKey);
};

// For server-side operations that need to bypass RLS
// (Since we're using Clerk auth, not Supabase auth, RLS doesn't work properly)
export const createSupabaseAdminClient = () => {
  if (!supabaseServiceKey) {
    console.warn("Service role key not found, using anon key (RLS will apply)");
    return createClient(supabaseUrl, supabaseAnonKey);
  }
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};
