import { supabase } from './supabase.js?v=6';

const NETWORK_TIMEOUT=12000;
async function request(query,label){
  let timer;
  try{return await Promise.race([
    Promise.resolve(query),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error(`${label}: timeout`),{code:'TIMEOUT'})),NETWORK_TIMEOUT)})
  ])}finally{clearTimeout(timer)}
}

export async function loadCards(includeDeleted=false){ let q=supabase.from('cards').select('*').order('updated_at',{ascending:false}); q=includeDeleted?q.not('deleted_at','is',null):q.is('deleted_at',null); const {data,error}=await request(q,'load cards'); if(error)throw error; return data; }
export async function createCard(card){
  const {data:{user}}=await supabase.auth.getUser();
  const now=new Date().toISOString();
  const payload={...card,id:crypto.randomUUID(),user_id:user.id,created_at:now,updated_at:now};
  // Не запрашиваем строку повторно через RETURNING: на некоторых соединениях
  // GitHub Pages → Supabase запись проходит, а representation долго ожидается.
  const {error}=await request(supabase.from('cards').insert(payload),'create card');
  if(error)throw error;
  return payload;
}
export async function updateCard(card, expectedUpdatedAt, force=false){
  if(!force){
    const {data:current,error:readError}=await request(supabase.from('cards').select('updated_at').eq('id',card.id).single(),'check card');
    if(readError)throw readError;
    if(current.updated_at!==expectedUpdatedAt)throw Object.assign(new Error('conflict'),{code:'CONFLICT'});
  }
  const payload={title:card.title,description:card.description,language:card.language,code:card.code,tags:card.tags,is_favorite:card.is_favorite};
  const {error}=await request(supabase.from('cards').update(payload).eq('id',card.id),'update card');
  if(error)throw error;
  const {data:fresh,error:refreshError}=await request(supabase.from('cards').select('*').eq('id',card.id).single(),'reload card');
  if(refreshError)throw refreshError;
  return fresh;
}
export async function patchCard(id,patch){const {error}=await request(supabase.from('cards').update(patch).eq('id',id),'patch card');if(error)throw error;return {...patch,id};}
export async function softDelete(id){return patchCard(id,{deleted_at:new Date().toISOString()});}
export async function restoreCard(id){return patchCard(id,{deleted_at:null});}
export async function purgeCard(id){const {error}=await request(supabase.from('cards').delete().eq('id',id),'delete card');if(error)throw error;}
export async function loadVersions(cardId){const {data,error}=await request(supabase.from('card_versions').select('*').eq('card_id',cardId).order('created_at',{ascending:false}),'load versions');if(error)throw error;return data;}
export async function loadSettings(){const {data,error}=await request(supabase.from('user_settings').select('theme,card_view,default_language,autosave').maybeSingle(),'load settings');if(error)throw error;return data;}
export async function saveSettings(settings){const {data:{user}}=await supabase.auth.getUser();const {error}=await request(supabase.from('user_settings').upsert({user_id:user.id,...settings},{onConflict:'user_id'}),'save settings');if(error)throw error;return settings;}
export function subscribeToCards(userId,onChange){return supabase.channel(`cards:${userId}`).on('postgres_changes',{event:'*',schema:'public',table:'cards',filter:`user_id=eq.${userId}`},onChange).subscribe();}
