import * as api from './api.mjs';
import {roles,warehouses,groups,today,ordered,latest,sameTerms,priceChange,age,landed,numeric} from './model.mjs';
const $=s=>document.querySelector(s);
const E=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const money=n=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
let state={suppliers:[],routes:[],quotes:[],rates:[],members:[],days:7},me=null,view='summary',refreshing=false,editAction=null,authGeneration=0;
const canEdit=()=>['manager','lead'].includes(me?.role);
const owns=row=>me?.role==='lead'||row.owner_email===me?.email;
const person=email=>state.members.find(m=>m.email===email)?.name||email;
function status(text,error=false){$('#status').textContent=text;$('#status').className=error?'error':'';}
function error(e){status(e.message||'Не удалось выполнить действие',true);}
function button(text,fn){const b=E('button',text);b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){error(e);}finally{b.disabled=false;}});return b;}
function hidePrivate(){authGeneration++;me=null;state={suppliers:[],routes:[],quotes:[],rates:[],members:[],days:7};$('#workspace').hidden=true;$('#auth').hidden=false;$('#logout').hidden=true;$('#account').textContent='';for(const id of ['#summary-body','#supplier-cards','#route-cards','#member-list','#edit-form'])$(id).replaceChildren();if($('#editor').open)$('#editor').close();}
window.addEventListener('team-session-ended',()=>{hidePrivate();status('Сессия завершена. Войдите снова.',true);});
function connectionUI(){const ready=api.configured();$('#not-configured').hidden=ready;$('#email-form button').disabled=!ready;$('#connection').open=!ready;}
$('#connection-form').addEventListener('submit',e=>{e.preventDefault();try{const f=new FormData(e.target);api.configure(f.get('url'),f.get('key'));connectionUI();status('Подключение сохранено. Теперь запросите код на почту.');}catch(err){error(err);}});
let pendingEmail='';
$('#email-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{pendingEmail=e.target.elements.email.value.trim().toLowerCase();await api.requestCode(pendingEmail);$('#code-form').hidden=false;$('#email-form').hidden=true;status('Если отправка настроена, код придёт на указанную почту. Проверьте также папку «Спам».');$('#code-form input').focus();}catch(err){error(err);}finally{b.disabled=false;}});
$('#another-email').addEventListener('click',()=>{$('#code-form').hidden=true;$('#email-form').hidden=false;$('#code-form').reset();});
$('#code-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button[type=submit]');b.disabled=true;try{await api.verifyCode(pendingEmail,e.target.elements.code.value.trim());e.target.reset();await load();}catch(err){error(err);}finally{b.disabled=false;}});
$('#logout').addEventListener('click',async()=>{hidePrivate();try{await api.signOut();}catch{}$('#code-form').hidden=true;$('#email-form').hidden=false;status('Вы вышли из общей базы.');});
async function load(){
 if(refreshing)return;refreshing=true;const generation=authGeneration;
 try{
  const user=await api.who();const members=await api.members();if(generation!==authGeneration)return;const member=members.find(m=>m.email===user.email?.toLowerCase()&&m.active);
  if(!member){await api.signOut();hidePrivate();throw Error('Для этой почты доступ не открыт. Попросите руководителя добавить адрес в список сотрудников.');}
  const result=await Promise.all([api.rows('fa_suppliers'),api.rows('fa_routes'),api.rows('fa_quotes'),api.rows('fa_freight_rates'),api.settings()]);
  if(generation!==authGeneration)return;me=member;state={members,suppliers:result[0],routes:result[1],quotes:result[2],rates:result[3],days:result[4][0]?.stale_days||7};
  $('#auth').hidden=true;$('#workspace').hidden=false;$('#logout').hidden=false;$('#account').textContent=`${me.name} · ${roles[me.role]}`;
  $('#admin-tab').hidden=me.role!=='lead';$('#new-supplier').hidden=!canEdit();$('#new-route').hidden=!canEdit();
  $('#supplier-title').textContent=me.role==='lead'?'Все поставщики':me.role==='sales'?'Поставщики':'Мои поставщики';
  if(view==='admin'&&me.role!=='lead')view='summary';
  fillOwnerFilter();render();showView(view);$('#loaded-at').textContent=`Данные обновлены ${new Date().toLocaleTimeString('ru-RU')}. Автообновление раз в минуту, пока открыта вкладка.`;
 }finally{refreshing=false;}
}
async function reload(){const generation=authGeneration;await load();if(me&&generation===authGeneration)status('Общая сводка обновлена.');}
$('#reload').addEventListener('click',()=>reload().catch(error));
setInterval(()=>{if(me&&!document.hidden&&!$('#editor').open)load().catch(error);},60000);
function showView(name){view=name;for(const e of document.querySelectorAll('.view'))e.hidden=e.id!==name;for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-current',String(b.dataset.view===name));}
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>showView(b.dataset.view));
for(const v of warehouses){const o=E('option',v);o.value=v;$('#filter-warehouse').append(o);}for(const v of groups){const o=E('option',v);o.value=v;$('#filter-group').append(o);}
for(const id of ['#filter-warehouse','#filter-group','#filter-search','#filter-owner'])$(id).addEventListener('input',renderSummary);
function fillOwnerFilter(){const value=$('#filter-owner').value;$('#filter-owner').replaceChildren(new Option('Все сотрудники',''));for(const m of state.members.filter(m=>m.role!=='sales'))$('#filter-owner').append(new Option(m.name,m.email));$('#filter-owner').value=value;}
function latestRate(routeId){return latest(state.rates.filter(r=>r.quote_date<=today()),'route_id',routeId);}
function summaryRows(){
 const needle=$('#filter-search').value.trim().toLowerCase();return state.suppliers.filter(s=>s.active).map(s=>{const history=ordered(state.quotes.filter(q=>q.supplier_id===s.id));const q=history[0],rate=q?latestRate(q.snapshot.route_id):null;return {s,q,previous:history[1],rate,cost:landed(q,rate)};}).filter(({s,q})=>{
  const terms=q?.snapshot||s;return (!$('#filter-warehouse').value||terms.warehouse===$('#filter-warehouse').value)&&(!$('#filter-group').value||terms.fiber_group===$('#filter-group').value)&&(!$('#filter-owner').value||s.owner_email===$('#filter-owner').value)&&(!needle||`${terms.name} ${terms.material}`.toLowerCase().includes(needle));
 });
}
function freshness(date){return `${date}${age(date)>state.days?' · устарело':''}`;}
function renderSummary(){
 const body=$('#summary-body');body.replaceChildren();
 for(const {s,q,previous,rate,cost}of summaryRows()){
  const t=q?.snapshot||s,tr=E('tr'),name=E('td');name.append(E('strong',t.name),E('small',t.material),E('small',person(s.owner_email)));const terms=E('td',`${t.warehouse} · ${t.basis}`);terms.append(E('small',t.point));const price=E('td',q?`${money(q.price)} ${t.currency}/кг`:'Нет котировки');const delta=priceChange(q,previous);
  price.append(E('small',delta===null?'Нет сопоставимой предыдущей цены':`${delta>0?'+':''}${money(delta)}% к предыдущей`,delta>0?'delta-up':delta<0?'delta-down':''));
  const total=E('td',cost?`${money(cost.net)} / ${money(cost.gross)} ₽/кг`:'Нужна котировка и ставка маршрута');if(q)total.append(E('small',`НДС ${q.vat_rate}% · USD ${q.usd_rate} / CNY ${q.cny_rate}`));
  const dates=E('td');if(q)dates.append(E('span',freshness(q.quote_date),age(q.quote_date)>state.days?'stale':'fresh'));else dates.append(E('span','Нет цены','stale'));
  if(t.basis!=='CPT')dates.append(E('small',rate?`Фрахт ${freshness(rate.quote_date)} · ${rate.status}`:'Нет ставки: доставка не рассчитана',!rate||age(rate.quote_date)>state.days?'stale':''));else dates.append(E('small','Доставка включена CPT'));
  const actions=E('td');actions.append(button('История',()=>historyDialog(s)));
  tr.append(name,terms,price,total,dates,actions);body.append(tr);
 }
 if(!body.children.length){const td=E('td','Нет предложений по выбранным условиям.');td.colSpan=6;const tr=E('tr');tr.append(td);body.append(tr);}
}
function renderSuppliers(){
 const box=$('#supplier-cards');box.replaceChildren();
 for(const s of state.suppliers.filter(s=>s.active)){
  const q=latest(state.quotes,'supplier_id',s.id),card=E('article',undefined,'card');card.append(E('h3',s.name),E('p',`${s.material} · ${s.fiber_group}\n${s.country} · ${s.basis} · ${s.warehouse}\n${s.point} · загрузка ${s.weight} кг\nОтветственный: ${person(s.owner_email)}`),E('div',q?`${money(q.price)} ${q.snapshot.currency}/кг`:'Нет цены','price'),E('p',q?`Проверено: ${freshness(q.quote_date)}`:'Добавьте первую котировку',q&&age(q.quote_date)>state.days?'stale':''));
  const actions=E('div',undefined,'actions');if(canEdit()&&owns(s)){
   actions.append(button('Обновить цену',()=>quoteDialog(s)),button('Без изменений',()=>confirmQuote(s)),button('Условия',()=>supplierDialog(s)));
   if(s.route_id){const route=state.routes.find(r=>r.id===s.route_id);if(route&&owns(route))actions.append(button('Обновить фрахт',()=>rateDialog(route)));}
  }actions.append(button('История',()=>historyDialog(s)));card.append(actions);box.append(card);
 }if(!box.children.length)box.append(E('p','Поставщиков пока нет. Добавьте карточку материала или попросите руководителя назначить её вам.','note'));
}
function renderRoutes(){
 const box=$('#route-cards');box.replaceChildren();for(const r of state.routes.filter(r=>r.active)){
  const rate=latestRate(r.id),related=state.suppliers.filter(s=>s.active&&s.route_id===r.id),card=E('article',undefined,'card');
  card.append(E('h3',`${r.origin} → ${r.warehouse}`),E('p',`Ответственный: ${person(r.owner_email)}`),E('div',rate?`${money(rate.usd)} USD + ${money(rate.rub)} RUB`:'Нет ставки','price'),E('p',rate?`${freshness(rate.quote_date)} · ${rate.status}\n${rate.note}`:'Внесите ставку за машину или контейнер'),E('p',`Связанных видимых карточек: ${related.length}. Изменение влияет на все предложения этого маршрута.`,rate&&age(rate.quote_date)>state.days?'stale':'note'));
  const actions=E('div',undefined,'actions');if(canEdit()&&owns(r))actions.append(button('Обновить ставку',()=>rateDialog(r)),button('Условия',()=>routeDialog(r)));actions.append(button('История',()=>rateHistory(r)));card.append(actions);box.append(card);
 }if(!box.children.length)box.append(E('p','Маршрутов пока нет. Для CPT отдельный фрахт не требуется.','note'));
}
function renderAdmin(){if(me.role!=='lead')return;const box=$('#member-list');box.replaceChildren();for(const m of state.members){const div=E('div');div.append(E('span',`${m.name} · ${m.email} · ${roles[m.role]}${m.active?'':' · отключён'}`),button('Изменить',()=>{const f=$('#member-form');for(const k of ['email','name','role'])f.elements[k].value=m[k];f.elements.active.value=String(m.active);}));box.append(div);}$('#settings-form').elements.days.value=state.days;}
function render(){renderSummary();renderSuppliers();renderRoutes();renderAdmin();}
function openDialog(title){$('#dialog-title').textContent=title;$('#dialog-status').textContent='';$('#edit-form').replaceChildren();$('#editor').showModal();}
$('#close-dialog').addEventListener('click',()=>$('#editor').close());
function field(key,label,{type='text',value='',options,required=true,maxLength=200,full=false,min,step='any',max}={}){
 const wrap=E('label',label);if(full)wrap.className='full';let input;
 if(options){input=E('select');for(const option of options){const [val,text]=Array.isArray(option)?option:[option,option];input.append(new Option(text,val));}}
 else {input=E(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.maxLength=maxLength;if(type==='number'){input.step=step;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;}}
 if(type==='date'&&max)input.max=max;input.name=key;input.required=required;input.value=value??'';wrap.append(input);$('#edit-form').append(wrap);return input;
}
function submitDialog(fn){editAction=fn;const b=E('button','Сохранить новую запись');b.type='submit';b.className='full';$('#edit-form').append(b);}
$('#edit-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('[type=submit]');b.disabled=true;try{await editAction(Object.fromEntries(new FormData(e.target)));$('#editor').close();await load();status('Сохранено в общей базе.');}catch(err){$('#dialog-status').textContent=err.message;}finally{b.disabled=false;}});
function ownerField(owner){field('owner_email','Ответственный',{value:owner||me.email,options:state.members.filter(m=>m.active&&['manager','lead'].includes(m.role)&&(me.role==='lead'||m.email===me.email)).map(m=>[m.email,m.name])});}
function supplierDialog(s){
 openDialog(s?'Условия поставщика':'Новый поставщик и материал');ownerField(s?.owner_email);field('name','Поставщик',{value:s?.name,maxLength:100});field('material','Марка и характеристики',{value:s?.material,maxLength:160});field('fiber_group','Группа',{value:s?.fiber_group||groups[0],options:groups});field('country','Страна',{value:s?.country||'Китай',maxLength:80});const basis=field('basis','Базис',{value:s?.basis||'FOB',options:['FOB','CPT','FCA']});field('currency','Валюта цены за кг',{value:s?.currency||'CNY',options:['CNY','USD']});field('weight','Загрузка, кг',{value:s?.weight||20000,type:'number',min:1,max:100000});field('point','Согласованный пункт FOB/FCA/CPT',{value:s?.point,full:true});const warehouse=field('warehouse','Склад',{value:s?.warehouse||warehouses[0],options:warehouses});const route=field('route_id','Полный маршрут доставки до склада',{options:[['','Без маршрута'],...state.routes.filter(r=>r.active).map(r=>[r.id,`${r.origin} → ${r.warehouse}`])],value:s?.route_id||'',required:false});
 function routesUI(){route.disabled=basis.value==='CPT';if(route.disabled)route.value='';}basis.addEventListener('change',routesUI);routesUI();
 const note=E('p','Указывайте цены без НДС. Для CPT пункт доставки должен соответствовать выбранному складу. Изменение условий фиксируется в следующей котировке; старые записи сохраняют прежние условия.','note full');$('#edit-form').append(note);
 submitDialog(async v=>{v.weight=numeric(v.weight,'Загрузка',{max:100000});v.route_id=v.basis==='CPT'?null:(v.route_id||null);if(v.route_id&&state.routes.find(r=>r.id===v.route_id)?.warehouse!==warehouse.value)throw Error('Выбранный маршрут ведёт на другой склад');if(s)await api.update('fa_suppliers',s.id,v);else await api.insert('fa_suppliers',v);});
}
$('#new-supplier').addEventListener('click',()=>supplierDialog());
function routeDialog(r){openDialog(r?'Условия маршрута':'Новый маршрут');ownerField(r?.owner_email);field('origin','Пункт отправления и полный маршрут',{value:r?.origin,full:true});field('warehouse','Склад назначения',{value:r?.warehouse||warehouses[0],options:warehouses});$('#edit-form').append(E('p','Если меняется пункт отправления или склад, создайте новый маршрут: старые ставки относятся к прежним условиям.','note full'));submitDialog(v=>r?api.update('fa_routes',r.id,v):api.insert('fa_routes',v));}
$('#new-route').addEventListener('click',()=>routeDialog());
function quoteDialog(s){
 const q=latest(state.quotes,'supplier_id',s.id);openDialog(`Новая цена · ${s.name}`);
 field('price',`Цена без НДС, ${s.currency}/кг`,{value:q?.price,type:'number',min:0.0001,max:1000000});field('quote_date','Дата актуальности',{type:'date',value:today(),max:today()});
 field('usd_rate','Курс USD → RUB',{value:q?.usd_rate,type:'number',min:0.0001,max:1000000});field('cny_rate','Курс CNY → RUB',{value:q?.cny_rate,type:'number',min:0.0001,max:1000000});field('vat_rate','Расчётная ставка НДС, %',{value:q?.vat_rate??0,type:'number',min:0,max:100});field('note','Комментарий / источник предложения',{type:'textarea',value:'',required:false,maxLength:1000,full:true});
 $('#edit-form').append(E('p',s.basis==='CPT'?'Доставка CPT включена до согласованного пункта; отдельно не прибавляется.':'Фрахт обновляется отдельно в карточке маршрута. При расчёте сводки используется последняя ставка этого маршрута. Проверьте, что маршрут покрывает доставку полностью.','note full'));
 submitDialog(async v=>{for(const k of ['price','usd_rate','cny_rate','vat_rate'])v[k]=numeric(v[k],k,{zero:k==='vat_rate',max:k==='vat_rate'?100:1000000});await api.insert('fa_quotes',{...v,supplier_id:s.id,card_version:s.updated_at});});
}
async function confirmQuote(s){const q=latest(state.quotes,'supplier_id',s.id);if(!q)throw Error('Сначала внесите первую котировку');if(!sameTerms(s,q.snapshot))throw Error('Условия карточки изменились. Внесите новую котировку обычным способом.');if(!confirm(`Подтвердить ${q.price} ${q.snapshot.currency}/кг и прежние курсы на сегодня? USD ${q.usd_rate}, CNY ${q.cny_rate}. Фрахт обновляется отдельно.`))return;await api.insert('fa_quotes',{supplier_id:s.id,card_version:s.updated_at,quote_date:today(),price:q.price,usd_rate:q.usd_rate,cny_rate:q.cny_rate,vat_rate:q.vat_rate,source_quote_id:q.id,note:'Цена и курсы подтверждены без изменений'});await reload();}
function rateDialog(route){
 const r=latestRate(route.id);openDialog(`Фрахт · ${route.origin} → ${route.warehouse}`);field('usd','USD за машину / контейнер',{type:'number',value:r?.usd??0,min:0,max:10000000});field('rub','RUB — отдельная часть ставки',{type:'number',value:r?.rub??0,min:0,max:1000000000});field('quote_date','Дата актуальности',{type:'date',value:today(),max:today()});field('status','Тип ставки',{options:['Ориентир','Предложение','Факт'],value:r?.status||'Предложение'});field('note','Перевозчик, загрузка и состав услуг',{type:'textarea',value:r?.note||'',required:false,maxLength:1000,full:true});$('#edit-form').append(E('p','Ставка применяется ко всем связанным предложениям. Укажите полный маршрут и проверьте, что USD и RUB не дублируют друг друга. Старые значения останутся в истории.','note full'));submitDialog(async v=>{v.usd=numeric(v.usd,'USD',{zero:true,max:10000000});v.rub=numeric(v.rub,'RUB',{zero:true,max:1000000000});await api.insert('fa_freight_rates',{...v,route_id:route.id,card_version:route.updated_at});});
}
function historyDialog(s){
 openDialog(`История · ${s.name}`);editAction=null;const box=$('#edit-form');box.style.display='block';$('#editor').addEventListener('close',()=>{box.style.display='';},{once:true});const quotes=ordered(state.quotes.filter(q=>q.supplier_id===s.id));
 const comparable=quotes.filter(q=>sameTerms(q.snapshot,quotes[0]?.snapshot)).slice(0,30).reverse();if(comparable.length>1){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 600 140');svg.classList.add('history-chart');svg.setAttribute('role','img');svg.setAttribute('aria-label','Изменение сопоставимой цены поставщика; значения и даты перечислены ниже');const vals=comparable.map(q=>Number(q.price)),min=Math.min(...vals),max=Math.max(...vals),line=document.createElementNS(ns,'polyline');line.setAttribute('points',vals.map((v,i)=>`${20+i*560/(vals.length-1)},${max===min?70:120-(v-min)*100/(max-min)}`).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#638050');line.setAttribute('stroke-width','3');svg.append(line);box.append(svg,E('p',`График: до 30 последних котировок с условиями последней записи, ${quotes[0].snapshot.currency}/кг.`,'note'));}
 for(const q of quotes){const rate=state.rates.find(r=>r.id===q.freight_rate_id),cost=landed(q,rate);box.append(E('div',`${q.quote_date} · ${money(q.price)} ${q.snapshot.currency}/кг${q.source_quote_id?' · без изменений':''}\n${q.snapshot.material} · ${q.snapshot.basis} · ${q.snapshot.warehouse} · ${q.snapshot.point}\nКурсы: USD ${q.usd_rate}, CNY ${q.cny_rate}; НДС ${q.vat_rate}%. ${cost?`По ставке, сохранённой при внесении: ${money(cost.net)} ₽/кг без НДС, ${money(cost.gross)} с НДС.`:'Доставка до склада не рассчитана: нет исторической ставки.'}\n${person(q.created_by)} · внесено ${new Date(q.created_at).toLocaleString('ru-RU')}\n${q.note}`,'history-item'));}if(!quotes.length)box.append(E('p','История пока пустая.'));
}
function rateHistory(r){openDialog(`История фрахта · ${r.origin}`);editAction=null;const box=$('#edit-form');for(const v of ordered(state.rates.filter(v=>v.route_id===r.id)))box.append(E('div',`${v.quote_date} · ${money(v.usd)} USD + ${money(v.rub)} RUB · ${v.status}\n${v.snapshot.origin} → ${v.snapshot.warehouse}\n${person(v.created_by)} · ${new Date(v.created_at).toLocaleString('ru-RU')}\n${v.note}`,'history-item full'));if(!box.children.length)box.append(E('p','История пока пустая.'));}
$('#member-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{const v=Object.fromEntries(new FormData(e.target));await api.rpc('fa_set_member',{p_email:v.email,p_name:v.name,p_role:v.role,p_active:v.active==='true'});e.target.reset();await reload();}catch(err){error(err);}finally{b.disabled=false;}});
$('#settings-form').addEventListener('submit',async e=>{e.preventDefault();try{await api.update('fa_settings','true',{stale_days:numeric(e.target.elements.days.value,'Срок',{max:90})});await reload();}catch(err){error(err);}});
$('#export-summary').addEventListener('click',()=>{
 const rows=[['Поставщик','Материал','Страна','Склад','Базис','Дата цены','Цена/кг','Валюта','Изменение %','Цена без НДС RUB/кг','Цена с НДС RUB/кг','Дата фрахта','USD/RUB','CNY/RUB','Ответственный'],...summaryRows().map(({s,q,previous,rate,cost})=>{const t=q?.snapshot||s;return [t.name,t.material,t.country,t.warehouse,t.basis,q?.quote_date,q?.price,t.currency,priceChange(q,previous),cost?.net,cost?.gross,rate?.quote_date,q?.usd_rate,q?.cny_rate,person(s.owner_email)];})];
 const cell=v=>{let s=String(v??'');if(/^(?:\s*[=+@\-]|[\t\r])/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=E('a');a.href=url;a.download=`fiber-team-${today()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
connectionUI();if(api.signedIn())load().catch(error);
