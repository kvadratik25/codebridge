import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Сессия хранится библиотекой Supabase; все данные защищает RLS в PostgreSQL.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
