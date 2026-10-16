import { createClient } from '@supabase/supabase-js';
export const admin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing server Supabase URL or secret/service role key.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
};
