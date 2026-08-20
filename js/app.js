import { APP_NAME, isConfigured } from './config.js?v=16';
import { supabase } from './supabase.js?v=16';
import * as db from './data.js?v=16';
import { copyPlainText } from './clipboard.js?v=16';
import { LANGUAGES, escapeHtml, previewCode, relativeDate, debounce, downloadJson } from './utils.js?v=16';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={cards:[],projects:[],currentProjectId:null,view:'library',query:'',sort:localStorage.getItem('codebridge-sort')||'updated-desc',editing:null,dirty:false,channel:null,userId:null,selectionMode:false,selectedIds:new Set(),settings:{theme:'system',card_view:'grid',default_language:'vba',autosave:true}};
let saveInProgress=false;
let refreshGeneration=0;
let lastNetworkToast=0;
const pendingFavorites=new Set();
const els={setup:$('#setup'),auth:$('#auth'),app:$('#app'),cards:$('#cards'),status:$('#status'),editor:$('#editor-dialog'),form:$('#editor-form'),generic:$('#generic-dialog')};
document.title=`${APP_NAME} — Личная библиотека кода`; $$('[data-app-name]').forEach(x=>x.textContent=APP_NAME);
const toast=(message,type='ok')=>{const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;$('#toasts').append(el);setTimeout(()=>el.remove(),3200)};
const show=(name)=>{[els.setup,els.auth,els.app].forEach(x=>x.classList.add('hidden'));els[name].classList.remove('hidden')};
const clockDateFormat=new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const clockTimeFormat=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'});
const cardDateFormat=new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const exactDate=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'—':cardDateFormat.format(date)};
function updateClock(){const now=new Date();const time=$('#current-time'),date=$('#current-date');if(time)time.textContent=clockTimeFormat.format(now);if(date)date.textContent=clockDateFormat.format(now)}
updateClock();setInterval(updateClock,30000);

async function boot(){ if(!isConfigured()){show('setup');return} const {data:{session}}=await supabase.auth.getSession(); session?enter(session.user):show('auth'); supabase.auth.onAuthStateChange((_e,s)=>s?enter(s.user):show('auth')); }
async function enter(user){state.userId=user.id;show('app');$('#user-email').textContent=user.email;$('#user-avatar').textContent=user.email.slice(0,1).toUpperCase();try{const [cloud,projects]=await Promise.all([db.loadSettings(),db.loadProjects()]);if(cloud)Object.assign(state.settings,cloud);state.projects=projects;if(!state.projects.length)state.projects=[await db.createProject('Внематричные товары')];const remembered=localStorage.getItem('codebridge-project');state.currentProjectId=state.projects.some(p=>p.id===remembered)?remembered:state.projects[0].id;renderProjectTabs()}catch(e){console.error('Initial data load failed:',e);toast('Не удалось загрузить проекты','error')}applyTheme();await refresh();if(state.channel)supabase.removeChannel(state.channel);state.channel=db.subscribeToCards(user.id,handleRemote);}
async function refresh({silent=false}={}){const generation=++refreshGeneration;const showLoader=!silent&&!state.cards.length;if(showLoader){els.status.hidden=false;els.status.textContent='Загрузка библиотеки…'}try{const cards=await db.loadCards(state.view==='trash',state.currentProjectId);if(generation!==refreshGeneration)return;state.cards=cards;render()}catch(e){console.error('Load failed:',e);if(generation!==refreshGeneration)return;if(!state.cards.length){els.status.hidden=false;els.status.textContent='Не удалось загрузить библиотеку. Проверьте подключение.'}else{els.status.hidden=true}if(Date.now()-lastNetworkToast>5000){toast(e.code==='TIMEOUT'?'Supabase отвечает слишком долго':'Нет подключения к интернету','error');lastNetworkToast=Date.now()}}finally{if(generation===refreshGeneration&&state.cards.length)els.status.hidden=true}}
function renderProjectTabs(){const select=$('#project-select');select.innerHTML=state.projects.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');select.value=state.currentProjectId||'';const current=state.projects.find(p=>p.id===state.currentProjectId);if(current)$('#page-title').textContent=state.view==='library'?current.name:{favorites:`${current.name} · Избранное`,trash:`${current.name} · Корзина`}[state.view]}
function visibleCards(){let list=state.cards.filter(c=>state.view==='favorites'?c.is_favorite:true);const q=state.query.toLocaleLowerCase();if(q)list=list.filter(c=>[c.title,c.description,c.code,...(c.tags||[])].some(v=>String(v||'').toLocaleLowerCase().includes(q)));return [...list].sort((a,b)=>{if(state.sort==='title-asc')return a.title.localeCompare(b.title,'ru');if(state.sort==='title-desc')return b.title.localeCompare(a.title,'ru');if(state.sort==='updated-asc')return new Date(a.updated_at)-new Date(b.updated_at);if(state.sort==='created-desc')return new Date(b.created_at)-new Date(a.created_at);return new Date(b.updated_at)-new Date(a.updated_at)});}
function render(){if(state.view==='trash'&&state.selectionMode){state.selectionMode=false;state.selectedIds.clear()}const list=visibleCards();els.status.hidden=true;$('#card-count').textContent=state.cards.length;els.cards.className=`card-grid ${state.settings.card_view==='list'?'list':''} ${state.selectionMode?'selection-mode':''}`;if(!list.length){els.cards.innerHTML=`<div class="empty"><div>⌘</div><h2>${state.view==='trash'?'Корзина пуста':'Здесь пока нет сохранённого кода'}</h2><p>${state.view==='trash'?'Удалённые карточки появятся здесь.':'Создайте первую карточку, чтобы передавать код между Mac и Windows.'}</p>${state.view==='trash'?'':'<button class="button primary" data-action="new">＋ Создать карточку</button>'}</div>`;updateBatchBar();return}els.cards.innerHTML=list.map(cardHtml).join('');updateBatchBar()}
function cardHtml(c){const p=previewCode(c.code);const tags=(c.tags||[]).map(t=>`<button class="tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join('');if(state.view==='trash')return `<article class="code-card"><div class="card-top"><div><h2>${escapeHtml(c.title)}</h2></div></div><p class="muted">Удалено ${relativeDate(c.deleted_at)}</p><div class="card-actions"><button class="button" data-action="restore" data-id="${c.id}">Восстановить</button><button class="button danger" data-action="purge" data-id="${c.id}">Удалить навсегда</button></div></article>`;const selected=state.selectedIds.has(c.id);return `<article class="code-card ${selected?'batch-selected':''}" data-card-id="${c.id}"><button class="batch-check" data-action="toggle-select" data-id="${c.id}" aria-label="${selected?'Убрать из выбранных':'Выбрать карточку'}">${selected?'✓':''}</button><div class="card-info"><div class="card-top"><div><h2>${escapeHtml(c.title)}</h2></div></div><div class="modified"><span>Изменено</span><strong>${exactDate(c.updated_at)}</strong></div>${c.description?`<p class="description">${escapeHtml(c.description)}</p>`:''}<div class="tags">${tags}</div></div><pre><code>${escapeHtml(p.text)}${p.clipped?'\n…':''}</code></pre><div class="card-actions"><button class="button primary copy" data-action="copy" data-id="${c.id}">Копировать</button><button class="button" data-action="open" data-id="${c.id}">Открыть</button><div class="card-action-icons"><button class="star ${c.is_favorite?'active':''}" data-action="favorite" data-id="${c.id}" aria-label="Избранное" title="Избранное">${c.is_favorite?'★':'☆'}</button><button class="icon-button" data-action="menu-card" data-id="${c.id}" aria-label="Ещё" title="Ещё">•••</button></div></div></article>`}
function updateBatchBar(){const bar=$('#batch-bar'),button=$('[data-action="batch-select"]'),count=state.selectedIds.size;bar.classList.toggle('hidden',!state.selectionMode);button.hidden=state.view==='trash';button.classList.toggle('active',state.selectionMode);button.textContent=state.selectionMode?'Выбор включён':'Выбрать';$('#batch-count').textContent=`Выбрано: ${count}`;$('[data-action="batch-copy"]').disabled=count===0}
function stopBatchSelection(){state.selectionMode=false;state.selectedIds.clear();render()}
function openEditor(card=null){let source=card;const draft=sessionStorage.getItem('codebridge-draft');if(!card&&draft&&confirm('Найден несохранённый черновик. Восстановить его?')){try{source=JSON.parse(draft)}catch{sessionStorage.removeItem('codebridge-draft')}}state.editing=source?structuredClone(source):{title:'',description:'',language:state.settings.default_language,code:'',tags:[],is_favorite:false,project_id:state.currentProjectId};if(!state.editing.project_id)state.editing.project_id=state.currentProjectId;state.dirty=Boolean(source&&!card);$('#card-title').value=state.editing.title;$('#card-description').value=state.editing.description||'';$('#card-code').value=state.editing.code;$('#save-state').textContent=state.dirty?'● Восстановлен черновик':card?'✓ Сохранено':'Новая карточка';els.editor.showModal();setTimeout(()=>$('#card-title').focus(),50)}
function readEditor(){return {...state.editing,title:$('#card-title').value.trim(),description:$('#card-description').value,code:$('#card-code').value}}
async function saveEditor(force=false){if(saveInProgress)return;const card=readEditor();if(!card.title){toast('Введите название карточки','error');return}saveInProgress=true;$('#save-state').textContent='Сохранение…';try{const saved=card.id?await db.updateCard(card,state.editing.updated_at,force):await db.createCard(card);state.editing=structuredClone(saved);state.dirty=false;sessionStorage.removeItem('codebridge-draft');$('#save-state').textContent='✓ Сохранено';toast('Карточка сохранена');await refresh()}catch(e){console.error('Save failed:',e);$('#save-state').textContent='Не удалось сохранить';if(e.code==='CONFLICT')showConflict();else toast('Не удалось сохранить карточку','error')}finally{saveInProgress=false}}
function markDirty(){state.dirty=true;$('#save-state').textContent='● Есть несохранённые изменения';sessionStorage.setItem('codebridge-draft',JSON.stringify(readEditor()));autosave()}
const autosave=debounce(()=>{if(state.dirty&&state.settings.autosave)saveEditor()},950);
function closeEditor(){if(state.dirty&&!confirm('Есть несохранённые изменения. Закрыть редактор?'))return;state.dirty=false;els.editor.close()}
function showConflict(){showGeneric(`<h2>Карточка изменена на другом устройстве</h2><p>Серверная версия новее. Вы можете загрузить её или перезаписать своей.</p><div class="dialog-actions"><button class="button" data-action="load-remote">Загрузить новую</button><button class="button danger" data-action="force-save">Перезаписать моей</button><button class="button" data-action="close-generic">Отмена</button></div>`)}
function showGeneric(html){$('#generic-content').innerHTML=html;els.generic.showModal()}
const refreshAfterRemote=debounce(()=>refresh({silent:true}),300);
async function handleRemote(payload){if(state.editing?.id===(payload.new?.id||payload.old?.id)&&state.dirty){toast('Карточка изменена на другом устройстве','error');return}refreshAfterRemote()}
let reconnectPromise=null;
let lastReconnect=0;
async function reconnect(){if(reconnectPromise||!state.userId||Date.now()-lastReconnect<30000)return reconnectPromise;reconnectPromise=(async()=>{try{await db.recoverConnection(true);if(state.channel)await supabase.removeChannel(state.channel);state.channel=db.subscribeToCards(state.userId,handleRemote);const projects=await db.loadProjects();if(projects.length){state.projects=projects;if(!projects.some(p=>p.id===state.currentProjectId))state.currentProjectId=projects[0].id;renderProjectTabs()}lastReconnect=Date.now();await refresh({silent:true})}catch(error){console.error('Reconnect failed:',error);if(error.code==='AUTH_EXPIRED')toast('Сессия истекла. Войдите снова.','error')}finally{reconnectPromise=null}})();return reconnectPromise}
async function showHistory(){if(!state.editing?.id){toast('Сначала сохраните карточку','error');return}try{const versions=await db.loadVersions(state.editing.id);showGeneric(`<h2>История версий</h2><div class="version-list">${versions.length?versions.map(v=>`<div><div><strong>${relativeDate(v.created_at)}</strong><small>${escapeHtml(v.title)}</small></div><button class="button" data-action="copy-version" data-id="${v.id}">Копировать</button><button class="button" data-action="restore-version" data-id="${v.id}">Восстановить</button></div>`).join(''):'<p>Предыдущих версий пока нет.</p>'}</div><button class="button" data-action="close-generic">Закрыть</button>`);els.generic._versions=versions}catch(e){console.error(e);toast('Не удалось загрузить историю','error')}}
function settings(){showGeneric(`<h2>Настройки</h2><div class="settings"><label>Тема<select id="setting-theme"><option value="system">Системная</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label><label>Вид карточек<select id="setting-view"><option value="grid">Карточки</option><option value="list">Список</option></select></label><label>Сортировка<select id="setting-sort"><option value="updated-desc">Последние изменённые</option><option value="updated-asc">Сначала старые</option><option value="title-asc">Название A–Z</option><option value="title-desc">Название Z–A</option><option value="created-desc">Сначала новые</option></select></label><label>Язык по умолчанию<select id="setting-lang">${Object.entries(LANGUAGES).map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select></label><label class="check"><input id="setting-autosave" type="checkbox"> Автосохранение</label></div><div class="dialog-actions settings-actions"><button class="button refresh-app-button" data-action="refresh-app">↻ Обновить</button><button class="button mobile-hide" data-action="export">Экспорт JSON</button><button class="button mobile-hide" data-action="import">Импорт JSON</button><button class="button primary" data-action="save-settings">Готово</button></div>`);$('#setting-theme').value=state.settings.theme;$('#setting-view').value=state.settings.card_view;$('#setting-sort').value=state.sort;$('#setting-lang').value=state.settings.default_language;$('#setting-autosave').checked=state.settings.autosave;const selects=$$('#generic-dialog select');selects.forEach(select=>select.disabled=true);setTimeout(()=>selects.forEach(select=>select.disabled=false),350)}
function applyTheme(){document.documentElement.dataset.theme=state.settings.theme==='system'?'':state.settings.theme;localStorage.setItem('codebridge-settings',JSON.stringify(state.settings))}
Object.assign(state.settings,JSON.parse(localStorage.getItem('codebridge-settings')||'{}'));

$('#login-form').addEventListener('submit',async e=>{e.preventDefault();$('#auth-error').textContent='';const {error}=await supabase.auth.signInWithPassword({email:$('#email').value,password:$('#password').value});if(error)$('#auth-error').textContent='Не удалось войти. Проверьте email и пароль.'});
els.form.addEventListener('submit',e=>{e.preventDefault();saveEditor()});
els.form.addEventListener('input',markDirty);$('#card-code').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const a=e.target,s=a.selectionStart,n=a.selectionEnd;a.setRangeText('    ',n,n,'end');markDirty()}});
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'&&els.editor.open){e.preventDefault();saveEditor()}});window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue=''}});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&isConfigured())reconnect()});window.addEventListener('online',reconnect);window.addEventListener('focus',reconnect);
document.addEventListener('click',async e=>{const sidebar=$('.sidebar');const b=e.target.closest('[data-action], [data-view], [data-tag]');if(innerWidth<=900&&sidebar.classList.contains('open')&&!e.target.closest('.sidebar')&&!e.target.closest('[data-action="menu"]')){sidebar.classList.remove('open');return}if(!b)return;const action=b.dataset.action,id=b.dataset.id,card=state.cards.find(c=>c.id===id);if(b.dataset.view){state.view=b.dataset.view;$$('[data-view]').forEach(x=>x.classList.toggle('active',x===b));$('#page-title').textContent={library:'Моя библиотека',favorites:'Избранное',trash:'Корзина'}[state.view];sidebar.classList.remove('open');await refresh();return}if(b.dataset.tag){state.query=b.dataset.tag;$('#search').value=state.query;render();return}if(action==='new')openEditor();if(action==='open')openEditor(card);if(action==='close-editor')closeEditor();if(action==='copy'||action==='copy-editor'){const text=action==='copy'?card.code:$('#card-code').value;try{await copyPlainText(text);toast('✓ Код скопирован');if(action==='copy'){const old=b.textContent;b.textContent='✓ Скопировано';setTimeout(()=>b.textContent=old,1600)}}catch(err){console.error(err);toast('Не удалось скопировать код','error')}}if(action==='favorite'){await db.patchCard(id,{is_favorite:!card.is_favorite});toast(card.is_favorite?'Убрано из избранного':'Добавлено в избранное');await refresh()}if(action==='menu-card')showGeneric(`<h2>${escapeHtml(card.title)}</h2><div class="menu-list"><button class="button" data-action="duplicate" data-id="${id}">Дублировать</button><button class="button" data-action="history-card" data-id="${id}">История</button><button class="button danger" data-action="delete" data-id="${id}">Удалить</button><button class="button" data-action="close-generic">Закрыть</button></div>`);if(action==='duplicate'){await db.createCard({...card,id:undefined,title:`${card.title} — копия`,created_at:undefined,updated_at:undefined,deleted_at:null});els.generic.close();toast('Карточка дублирована');await refresh()}if(action==='delete'&&confirm(`Удалить карточку «${card.title}»? Её можно восстановить из Корзины.`)){await db.softDelete(id);els.generic.close();toast('Карточка перемещена в корзину');await refresh()}if(action==='restore'){await db.restoreCard(id);toast('Карточка восстановлена');await refresh()}if(action==='purge'&&confirm('Удалить карточку навсегда? Это действие нельзя отменить.')){await db.purgeCard(id);toast('Карточка удалена');await refresh()}if(action==='history')showHistory();if(action==='history-card'){state.editing=card;els.generic.close();showHistory()}if(action==='close-generic')els.generic.close();if(action==='load-remote'){els.generic.close();await refresh();openEditor(state.cards.find(c=>c.id===state.editing.id))}if(action==='force-save'){els.generic.close();saveEditor(true)}if(action==='copy-version'){const v=els.generic._versions.find(x=>x.id===id);await copyPlainText(v.code);toast('Версия скопирована')}if(action==='restore-version'){const v=els.generic._versions.find(x=>x.id===id);state.editing={...state.editing,title:v.title,description:v.description,language:v.language,code:v.code,tags:v.tags};els.generic.close();openEditor(state.editing);markDirty()}if(action==='settings'){sidebar.classList.remove('open');settings()}if(action==='save-settings'){state.settings={theme:$('#setting-theme').value,card_view:$('#setting-view').value,default_language:$('#setting-lang').value,autosave:$('#setting-autosave').checked};try{state.settings=await db.saveSettings(state.settings);toast('Настройки сохранены')}catch(err){console.error('Settings save failed:',err);toast('Настройки сохранены только на этом устройстве','error')}applyTheme();els.generic.close();render()}if(action==='export')downloadJson(state.cards.map(({id,user_id,created_at,updated_at,deleted_at,...c})=>c));if(action==='import')$('#import-file').click();if(action==='logout')await supabase.auth.signOut();if(action==='menu')sidebar.classList.toggle('open')});
$('#search').addEventListener('input',e=>{state.query=e.target.value;render()});$('#project-select').addEventListener('change',async e=>{state.currentProjectId=e.target.value;localStorage.setItem('codebridge-project',state.currentProjectId);state.query='';$('#search').value='';renderProjectTabs();await refresh()});document.addEventListener('change',e=>{if(e.target.id==='setting-sort'){state.sort=e.target.value;localStorage.setItem('codebridge-sort',state.sort)}});
document.addEventListener('click',e=>{if(e.target.closest('[data-action="refresh-app"]'))location.replace(`${location.pathname}?refresh=${Date.now()}`)});

document.addEventListener('click',async e=>{
  const projectButton=e.target.closest('[data-project-id]');
  const viewButton=e.target.closest('[data-view]');
  const actionButton=e.target.closest('[data-action="new-project"], [data-action="create-project"]');
  if(!projectButton&&!viewButton&&!actionButton)return;
  e.stopImmediatePropagation();
  if(projectButton){
    state.currentProjectId=projectButton.dataset.projectId;
    localStorage.setItem('codebridge-project',state.currentProjectId);
    state.query='';$('#search').value='';renderProjectTabs();await refresh();return;
  }
  if(viewButton){
    state.view=viewButton.dataset.view;
    $$('[data-view]').forEach(x=>x.classList.toggle('active',x===viewButton));
    $('.sidebar').classList.remove('open');renderProjectTabs();await refresh();return;
  }
  if(actionButton.dataset.action==='new-project'){
    showGeneric(`<h2>Новый проект</h2><label class="project-name-label">Название<input id="new-project-name" maxlength="80" placeholder="Например, Новинки"></label><div class="dialog-actions"><button class="button" data-action="close-generic">Отмена</button><button class="button primary" data-action="create-project">Создать проект</button></div>`);
    setTimeout(()=>$('#new-project-name').focus(),50);return;
  }
  const name=$('#new-project-name')?.value.trim();
  if(!name){toast('Введите название проекта','error');return}
  if(state.projects.some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase())){toast('Проект с таким названием уже есть','error');return}
  actionButton.disabled=true;
  try{const project=await db.createProject(name);state.projects.push(project);state.currentProjectId=project.id;localStorage.setItem('codebridge-project',project.id);els.generic.close();renderProjectTabs();await refresh();toast(`Проект «${name}» создан`)}catch(error){console.error('Project create failed:',error);actionButton.disabled=false;toast('Не удалось создать проект','error')}
},true);

// Быстрые действия не блокируют интерфейс ожиданием сети. При ошибке состояние откатывается.
document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-action="favorite"]');
  if(!button)return;
  e.stopImmediatePropagation();
  const card=state.cards.find(item=>item.id===button.dataset.id);
  if(!card||pendingFavorites.has(card.id))return;
  const previous=card.is_favorite;
  pendingFavorites.add(card.id);
  card.is_favorite=!previous;
  button.disabled=true;
  render();
  try{
    await db.patchCard(card.id,{is_favorite:card.is_favorite});
    toast(card.is_favorite?'Добавлено в избранное':'Убрано из избранного');
  }catch(error){
    console.error('Favorite update failed:',error);
    card.is_favorite=previous;
    render();
    toast('Не удалось изменить избранное','error');
  }finally{
    pendingFavorites.delete(card.id);
  }
},true);
$('#import-file').addEventListener('change',async e=>{try{const rows=JSON.parse(await e.target.files[0].text());if(!Array.isArray(rows))throw new Error('format');if(!confirm(`В проект «${state.projects.find(p=>p.id===state.currentProjectId)?.name}» будет добавлено: ${rows.length} карточек. Продолжить?`))return;for(const r of rows)await db.createCard({title:String(r.title||'Без названия'),description:String(r.description||''),language:LANGUAGES[r.language]?r.language:'other',code:String(r.code||''),tags:Array.isArray(r.tags)?r.tags.map(String):[],is_favorite:Boolean(r.is_favorite),project_id:state.currentProjectId});toast(`Добавлено карточек: ${rows.length}`);els.generic.close();await refresh()}catch(err){console.error(err);toast('Не удалось импортировать JSON','error')}finally{e.target.value=''}});
document.addEventListener('click',async e=>{
  const actionElement=e.target.closest('[data-action="batch-select"], [data-action="batch-cancel"], [data-action="batch-copy"], [data-action="toggle-select"]');
  const selectableCard=state.selectionMode?e.target.closest('.code-card[data-card-id]'):null;
  if(!actionElement&&!selectableCard)return;
  e.preventDefault();e.stopImmediatePropagation();
  const action=actionElement?.dataset.action;
  if(action==='batch-select'){
    state.selectionMode=!state.selectionMode;
    state.selectedIds.clear();
    render();return;
  }
  if(action==='batch-cancel'){stopBatchSelection();return}
  if(action==='batch-copy'){
    const selected=[...state.selectedIds].map(id=>state.cards.find(card=>card.id===id)).filter(Boolean);
    if(!selected.length){toast('Сначала выберите карточки','error');return}
    const combined=selected.map(card=>`${card.title}\n${String(card.code||'').replace(/[\r\n]+$/,'')}`).join('\n\n');
    try{await copyPlainText(combined);toast(`Скопировано карточек: ${selected.length}`);stopBatchSelection()}catch(error){console.error('Batch copy failed:',error);toast('Не удалось скопировать карточки','error')}
    return;
  }
  const id=actionElement?.dataset.id||selectableCard?.dataset.cardId;
  if(!id)return;
  state.selectedIds.has(id)?state.selectedIds.delete(id):state.selectedIds.add(id);
  render();
},true);
boot();
