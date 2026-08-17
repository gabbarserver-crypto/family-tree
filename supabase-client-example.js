// Example only. In a real Next.js app, put this in a server/client utility
// according to your Next.js + Supabase SSR setup.
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
