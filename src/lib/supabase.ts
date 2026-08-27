import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'

import type { Database } from '../types/database'

export interface SupabasePublicEnvironment {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
}

function requirePublicEnvironmentValue(
  environment: SupabasePublicEnvironment,
  key: keyof SupabasePublicEnvironment,
): string {
  const value = environment[key]?.trim()

  if (!value) {
    throw new Error(`Missing required public environment variable: ${key}`)
  }

  return value
}

/**
 * Creates the browser/client Supabase connection from public environment data.
 * The host application decides how its bundler exposes these two variables.
 */
export function createSupabaseClient(
  environment: SupabasePublicEnvironment,
): SupabaseClient<Database> {
  return createClient<Database>(
    requirePublicEnvironmentValue(environment, 'SUPABASE_URL'),
    requirePublicEnvironmentValue(environment, 'SUPABASE_ANON_KEY'),
    {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    },
  )
}
