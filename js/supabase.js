import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=19';

// Не даём библиотеке аварийно остановить весь сайт, если config.js случайно
// заменили шаблонным файлом. boot() покажет понятный экран настройки.
const clientUrl=SUPABASE_URL.startsWith('https://')?SUPABASE_URL:'https://placeholder.supabase.co';
const clientKey=SUPABASE_ANON_KEY.length>40?SUPABASE_ANON_KEY:'placeholder-public-key-for-configuration-screen';

// Загрузка скриншотов может занимать дольше обычного запроса к таблице.
// Операции с таблицами по-прежнему ограничены более коротким таймаутом в data.js.
const FETCH_TIMEOUT_MS=35000;
const fetchWithTimeout=(input,init={})=>{
  const controller=new AbortController();
  const upstream=init.signal;
  const abort=()=>controller.abort(upstream?.reason);
  if(upstream)upstream.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('Supabase request timeout','TimeoutError')),FETCH_TIMEOUT_MS);
  return fetch(input,{...init,signal:controller.signal}).finally(()=>{
    clearTimeout(timer);
    if(upstream)upstream.removeEventListener('abort',abort);
  });
};

// Сессия хранится библиотекой Supabase; все данные защищает RLS в PostgreSQL.
export const supabase = createClient(clientUrl, clientKey, {
  global: { fetch: fetchWithTimeout },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lockAcquireTimeout: 5000
  }
});
