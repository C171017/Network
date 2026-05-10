import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/**
 * Only construct a client when both values exist — avoids
 * `supabaseUrl is required` crashing the whole app before React mounts.
 */
export const supabase: SupabaseClient | null =
  url && anon
    ? createClient(url, anon, {
        auth: {
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null

export const isSupabaseConfigured = supabase !== null
