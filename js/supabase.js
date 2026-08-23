// ============================================================================
// SUPABASE CLIENT — single shared client instance for the whole app.
// Uses the official Supabase ESM build from a CDN — no build step, no npm.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
