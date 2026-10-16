'use client';
import { createBrowserClient } from '@supabase/ssr';
export function createClient(){
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC Supabase URL or anon/publishable key.');
  return createBrowserClient(url, key);
}
