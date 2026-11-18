import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let adminAuthClient: SupabaseClient | null | undefined;

export function getAdminAuthClient(): SupabaseClient | null {
  if (adminAuthClient !== undefined) return adminAuthClient;

  const functionUrl = import.meta.env.VITE_SUPABASE_FUNCTION_URL;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    || functionUrl?.split('/functions/v1/')[0];
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    adminAuthClient = null;
    return adminAuthClient;
  }

  adminAuthClient = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
  return adminAuthClient;
}
