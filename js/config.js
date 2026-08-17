export const APP_NAME = 'CodeBridge';

// Вставьте сюда URL и anon public key вашего Supabase-проекта.
// Никогда не используйте service_role key во frontend.
export const SUPABASE_URL = 'https://ndymqlivolcuuqkcigzy.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_qp9exHqZehnOk1NYcRcElQ_jB2AhY7r';

export const isConfigured = () =>
  SUPABASE_URL.startsWith('https://') &&
  !SUPABASE_URL.includes('YOUR_') &&
  SUPABASE_ANON_KEY.length > 40 &&
  !SUPABASE_ANON_KEY.includes('YOUR_');
