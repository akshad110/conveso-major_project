import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function addLawCompanion() {
  const { data, error } = await supabase
    .from('companions')
    .insert([
      {
        name: "Law AI - Courtroom Simulator",
        topic: "Legal Case Simulation & IPC Sections",
        subject: "law",
        duration: 60,
        user_id: "system",
        voice: "male",
        style: "formal",
      },
    ])
    .select();

  if (error) {
    console.error("Error adding Law companion:", error);
  } else {
    console.log("Law companion added:", data);
  }
}

