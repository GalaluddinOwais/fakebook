import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
export async function createClient() {
  const jar = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase URL or public anon/publishable key.');
  return createServerClient(url, key, {
    cookies: { getAll: () => jar.getAll(), setAll: (items: { name: string; value: string; options: Parameters<typeof jar.set>[2] }[]) => { try { items.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch {} } },
  });
}
