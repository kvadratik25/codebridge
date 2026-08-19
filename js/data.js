import { supabase } from './supabase.js?v=11';

const NETWORK_TIMEOUT=12000;
let lastSuccessfulRequest=Date.now();
let recoveryPromise=null;
async function request(query,label){
  let timer;
  try{const result=await Promise.race([
    Promise.resolve(query),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error(`${label}: timeout`),{code:'TIMEOUT'})),NETWORK_TIMEOUT)})
  ]);lastSuccessfulRequest=Date.now();return result}finally{clearTimeout(timer)}
}

async function authRequest(promise,label){
  let timer;
  try{return await Promise.race([
    promise,
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error(`${label}: timeout`),{code:'TIMEOUT'})),NETWORK_TIMEOUT)})
  ])}finally{clearTimeout(timer)}
}

// После сна компьютера или долгого простоя браузер может оставить устаревшую
// auth-сессию. Один общий recovery не позволяет нескольким кнопкам обновлять её параллельно.
export async function recoverConnection(force=false){
  if(recoveryPromise)return recoveryPromise;
  recoveryPromise=(async()=>{
    const {data:{session},error}=await authRequest(supabase.auth.getSession(),'get session');
    if(error)throw error;
    if(!session)throw Object.assign(new Error('Session expired'),{code:'AUTH_EXPIRED'});
    const expiresSoon=(session.expires_at||0)*1000<Date.now()+120000;
    const wasIdle=Date.now()-lastSuccessfulRequest>60000;
    if(force||expiresSoon||wasIdle){
      const {data,error:refreshError}=await authRequest(supabase.auth.refreshSession(),'refresh session');
      if(refreshError||!data.session)throw refreshError||Object.assign(new Error('Session refresh failed'),{code:'AUTH_EXPIRED'});
    }
    lastSuccessfulRequest=Date.now();
    return true;
  })().finally(()=>{recoveryPromise=null});
  return recoveryPromise;
}

export async function loadCards(includeDeleted=false,projectId=null){ let q=supabase.from('cards').select('*').order('updated_at',{ascending:false}); q=includeDeleted?q.not('deleted_at','is',null):q.is('deleted_at',null);if(projectId)q=q.eq('project_id',projectId);const {data,error}=await request(q,'load cards'); if(error)throw error; return data; }
export async function loadProjects(){const {data,error}=await request(supabase.from('projects').select('*').order('created_at',{ascending:true}),'load projects');if(error)throw error;return data;}
export async function createProject(name){await recoverConnection();const {data:{user}}=await authRequest(supabase.auth.getUser(),'get user');const payload={id:crypto.randomUUID(),user_id:user.id,name};const {error}=await request(supabase.from('projects').insert(payload),'create project');if(error)throw error;return {...payload,created_at:new Date().toISOString()};}
export async function createCard(card){
  await recoverConnection();
  const {data:{user}}=await authRequest(supabase.auth.getUser(),'get user');
  const now=new Date().toISOString();
  const payload={...card,id:crypto.randomUUID(),user_id:user.id,created_at:now,updated_at:now};
  // Не запрашиваем строку повторно через RETURNING: на некоторых соединениях
  // GitHub Pages → Supabase запись проходит, а representation долго ожидается.
  const {error}=await request(supabase.from('cards').insert(payload),'create card');
  if(error)throw error;
  return payload;
}
export async function updateCard(card, expectedUpdatedAt, force=false){
  await recoverConnection();
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
export async function patchCard(id,patch){await recoverConnection();const {error}=await request(supabase.from('cards').update(patch).eq('id',id),'patch card');if(error)throw error;return {...patch,id};}
export async function softDelete(id){return patchCard(id,{deleted_at:new Date().toISOString()});}
export async function restoreCard(id){return patchCard(id,{deleted_at:null});}
export async function purgeCard(id){await recoverConnection();const {error}=await request(supabase.from('cards').delete().eq('id',id),'delete card');if(error)throw error;}
export async function loadVersions(cardId){const {data,error}=await request(supabase.from('card_versions').select('*').eq('card_id',cardId).order('created_at',{ascending:false}),'load versions');if(error)throw error;return data;}
export async function loadSettings(){const {data,error}=await request(supabase.from('user_settings').select('theme,card_view,default_language,autosave').maybeSingle(),'load settings');if(error)throw error;return data;}
export async function saveSettings(settings){await recoverConnection();const {data:{user}}=await authRequest(supabase.auth.getUser(),'get user');const {error}=await request(supabase.from('user_settings').upsert({user_id:user.id,...settings},{onConflict:'user_id'}),'save settings');if(error)throw error;return settings;}
export function subscribeToCards(userId,onChange){return supabase.channel(`cards:${userId}`).on('postgres_changes',{event:'*',schema:'public',table:'cards',filter:`user_id=eq.${userId}`},onChange).subscribe();}
