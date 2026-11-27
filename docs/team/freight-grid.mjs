import * as api from './api.mjs';
import {warehouses,today,latest,normalizedPoint,numeric,age} from './model.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const drafts=new Map();let kind='FCA',context=null,busy=false,generation=0;
const norm=normalizedPoint;
const latestRate=(rates,id)=>latest(rates.filter(r=>r.quote_date<=today()),'route_id',id);
const columnKey=c=>JSON.stringify([norm(c.loading_point),norm(c.origin)]);
const emptyKey=(c,warehouse)=>JSON.stringify([c.kind,c.loading_point,c.origin,warehouse]);
const defaultColumns={FCA:['Ташкент','Ургут'].map(p=>({kind:'FCA',loading_point:p,origin:p})),sea:['Шанхай','Нинбо'].flatMap(p=>['ДВ','Новороссийск','Санкт-Петербург'].map(v=>({kind:'sea',loading_point:p,origin:`${p} · ${v}`})))};
export const hasFreightDrafts=()=>busy||drafts.size>0;
export function clearFreightGrid(){generation++;drafts.clear();context=null;busy=false;kind='FCA';document.querySelector('#freight-grid')?.replaceChildren();}
export function renderFreightGrid(options){context=options;paint();}
function control(tag,label){const n=el(tag);n.setAttribute('aria-label',label);return n;}
function paint(){
 if(!context)return;const {state,person,onHistory}=context,root=document.querySelector('#freight-grid');root.replaceChildren();
 if(state.workflow<2){root.append(el('p','Для таблицы обновите базу по ссылке выше.','callout'));return;}
 const tabs=el('div',undefined,'freight-tabs');for(const [value,text] of [['FCA','За машину · Узбекистан'],['sea','Из Китая · море + ЖД + авто']]){const b=el('button',text);b.type='button';b.setAttribute('aria-pressed',String(kind===value));b.disabled=busy;b.onclick=()=>{kind=value;paint();};tabs.append(b);}root.append(tabs);
 const active=state.routes.filter(r=>r.active&&r.kind===kind&&r.loading_point),columns=new Map(defaultColumns[kind].map(c=>[columnKey(c),c]));
 for(const r of active)columns.set(columnKey(r),{kind:r.kind,loading_point:r.loading_point,origin:r.origin});
 const scroll=el('div',undefined,'table-scroll freight-scroll');scroll.tabIndex=0;scroll.setAttribute('aria-label','Таблица ставок, прокрутите вправо для остальных направлений');const table=el('table',undefined,'freight-matrix'),caption=el('caption',kind==='FCA'?'Ставка за машину до склада':'Ставка за контейнер по всей цепочке до склада');table.append(caption);
 const head=el('tr');head.append(el('th','Склад назначения'));for(const c of columns.values()){const th=el('th',c.origin);th.scope='col';if(norm(c.origin)!==norm(c.loading_point))th.append(el('small',`Отгрузка: ${c.loading_point}`));head.append(th);}const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');
 for(const warehouse of warehouses){const row=el('tr'),dest=el('th',warehouse==='Ратмирово'?'Ратмирово (Москва)':warehouse);dest.scope='row';row.append(dest);
  for(const c of columns.values()){const td=el('td'),routes=active.filter(r=>columnKey(r)===columnKey(c)&&r.warehouse===warehouse);for(const route of routes.length?routes:[null]){const rate=route?latestRate(state.rates,route.id):null,key=route?route.id:emptyKey(c,warehouse);let d=drafts.get(key);const cell=el('div',undefined,'freight-cell');if(d)cell.classList.add('is-dirty');const label=`${c.origin}, ${warehouse}`,values={usd:d?.usd??(rate&&(Number(rate.usd)!==0||Number(rate.rub)===0)?String(rate.usd):''),rub:d?.rub??(rate&&Number(rate.rub)!==0?String(rate.rub):''),note:d?.note??rate?.note??'',date:d?.date??rate?.quote_date??today(),status:d?.status??rate?.status??'Предложение'};
   const fields={};const price=el('div',undefined,'freight-price');for(const [field,currency]of [['usd','USD'],['rub','RUB']]){const wrap=el('label',currency),input=control('input',`${label}: ${currency}`);input.type='text';input.inputMode='decimal';input.placeholder='—';input.value=values[field];input.disabled=busy;input.dataset.currency=currency;fields[field]=input;wrap.append(input);price.append(wrap);}cell.append(price);
   const detail=el('details'),summary=el('summary','Дата, перевозчик, условия');detail.append(summary);const date=control('input',`${label}: дата`);date.type='date';date.max=today();date.value=values.date;const status=control('select',`${label}: тип ставки`);for(const text of ['Ориентир','Предложение','Факт'])status.append(new Option(text,text));status.value=values.status;const note=control('input',`${label}: перевозчик и условия`);note.type='text';note.maxLength=1000;note.placeholder='Перевозчик и состав услуг';note.value=values.note;fields.date=date;fields.status=status;fields.note=note;for(const [input,title]of [[date,'Дата ставки'],[status,'Тип ставки'],[note,'Перевозчик / условия']]){const wrap=el('label',title);input.disabled=busy;wrap.append(input);detail.append(wrap);}cell.append(detail);
   const update=e=>{if(!d&&e.target!==fields.date)fields.date.value=today();const current=Object.fromEntries(Object.entries(fields).map(([k,n])=>[k,n.value]));const initial=d?.initial??values,changed=Object.keys(current).some(k=>current[k]!==initial[k]);if(!changed){drafts.delete(key);d=null;cell.classList.remove('is-dirty');updateCount();return;}
    // Capture the version originally displayed, including across automatic refreshes.
    if(!d)d={...current,initial:{...values},key,route,column:c,warehouse,baselineId:rate?.id??null,cardVersion:route?.updated_at??null};else Object.assign(d,current);
    drafts.set(key,d);cell.classList.add('is-dirty');updateCount();};for(const input of Object.values(fields))input.addEventListener('input',update);
   if(rate){const meta=el('small',`${rate.quote_date} · ${person(rate.created_by)}${age(rate.quote_date)>state.days?' · устарело':''}`,'freight-meta');cell.append(meta);const history=el('button','История');history.type='button';history.className='freight-history';history.disabled=busy;history.onclick=()=>onHistory(route);cell.append(history);}else cell.append(el('small','Нет ставки','freight-meta'));
   td.append(cell);
  }row.append(td);}body.append(row);
 }table.append(body);scroll.append(table);root.append(scroll);
 const footer=el('div',undefined,'freight-footer'),count=el('span',undefined,'freight-count');count.id='freight-count';count.setAttribute('aria-live','polite');const save=el('button','Сохранить изменения');save.type='button';save.id='freight-save';save.className='primary';save.onclick=saveDrafts;const cancel=el('button','Отменить изменения');cancel.type='button';cancel.id='freight-cancel';cancel.disabled=busy;cancel.onclick=()=>{drafts.clear();paint();};footer.append(count,cancel,save);root.append(footer);const message=el('p',undefined,'freight-message');message.id='freight-message';message.setAttribute('role','status');root.append(message);updateCount();
}
function updateCount(){const n=document.querySelector('#freight-count'),b=document.querySelector('#freight-save');if(n)n.textContent=busy?'Сохранение…':drafts.size?`Изменено ставок: ${drafts.size}`:'Изменений нет';if(b)b.disabled=busy||!drafts.size;}
export function freightValues(d){
 if(/[\t\r\n]/.test(d.usd+d.rub))throw Error('Вставляйте одну сумму в ячейку, без табуляции и переносов строк.');
 const usd=d.usd.trim()===''?0:numeric(d.usd.replace(/\s/g,''),'USD',{zero:true,max:10000000}),rub=d.rub.trim()===''?0:numeric(d.rub.replace(/\s/g,''),'RUB',{zero:true,max:1000000000});
 if(!d.usd.trim()&&!d.rub.trim())throw Error('Пустая ячейка не удаляет ставку. Укажите сумму или отмените изменение.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isFinite(Date.parse(d.date))||new Date(d.date).toISOString().slice(0,10)!==d.date||d.date>today())throw Error('Укажите корректную дату ставки, не позже сегодняшней.');
 if(!['Ориентир','Предложение','Факт'].includes(d.status))throw Error('Проверьте тип ставки');if(d.note.length>1000)throw Error('Условия: не больше 1000 символов');
 return {usd,rub,quote_date:d.date,status:d.status,note:d.note};
}
async function saveDrafts(){
 if(busy||!drafts.size||!context)return;const epoch=generation,ctx=context,pending=[...drafts.values()];busy=true;paint();const message=document.querySelector('#freight-message');
 try{
  const values=pending.map(freightValues);const [routes,rates]=await Promise.all([api.rows('fa_routes'),api.rows('fa_freight_rates')]);if(epoch!==generation)return;
  // Check all cells before any write; do not silently replace another employee's update.
  const targets=pending.map(d=>{const route=d.route?routes.find(r=>r.id===d.route.id):routes.find(r=>r.active&&r.kind===d.column.kind&&columnKey(r)===columnKey(d.column)&&r.warehouse===d.warehouse);if(d.route&&(!route?.active||route.updated_at!==d.cardVersion))throw Error('Направление изменено другим сотрудником. Отмените правки и обновите таблицу.');if((route?latestRate(rates,route.id)?.id??null:null)!==d.baselineId)throw Error('Ставка уже обновлена другим сотрудником. Скопируйте свои значения, отмените правки и нажмите «Обновить».');return route;});
  for(let i=0;i<pending.length;i++){if(epoch!==generation)return;if(!targets[i]){const d=pending[i];const created=await api.insertReturning('fa_routes',{...d.column,warehouse:d.warehouse,owner_email:ctx.me.email});targets[i]=created[0];if(!targets[i]?.id)throw Error('Не удалось получить созданное направление');d.route=targets[i];d.cardVersion=targets[i].updated_at;}}
  if(epoch!==generation)return;await api.insert('fa_freight_rates',values.map((v,i)=>({...v,route_id:targets[i].id,card_version:targets[i].updated_at})));if(epoch!==generation)return;drafts.clear();busy=false;await ctx.onSaved();const m=document.querySelector('#freight-message');if(m)m.textContent=`Сохранено ставок: ${values.length}. Они доступны всем сотрудникам.`;
 }catch(e){if(epoch===generation){message.textContent=e.message||'Не удалось сохранить. Значения оставлены в таблице.';message.classList.add('error');}}finally{if(epoch===generation){busy=false;for(const n of document.querySelectorAll('#freight-grid input,#freight-grid select,#freight-grid button'))n.disabled=false;updateCount();}}
}
