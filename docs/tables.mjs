import {schemas,cleanRow,parseReferenceFile,supplierValues,freightValues} from './reference-data.mjs';
const root=document.querySelector('#reference-data'),form=document.querySelector('#form'),storageKey='fiber-reference-data-v1';
let data={suppliers:[],freights:[]};
const status=document.querySelector('#reference-status');
const element=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
function say(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
try{const raw=localStorage.getItem(storageKey);if(raw)data=parseReferenceFile(JSON.parse(raw));}catch{say('Не удалось прочитать справочники браузера. Импортируйте резервный файл.',true);}
function save(next){try{localStorage.setItem(storageKey,JSON.stringify({type:'fiber-reference-data',version:1,...next}));data=next;}catch{throw Error('Браузер не сохранил изменения. Проверьте доступное место и разрешение на хранение данных.');}}
function dirty(){const b=document.querySelector('#save');if(b){b.disabled=true;b.textContent='Данные изменены — рассчитайте заново';}form.elements.confirmed.checked=false;}
function apply(kind,row){
 try{
  const values=kind==='suppliers'?supplierValues(row):freightValues(row,form.elements.warehouse.value,form.elements.basis.value);
  if(kind==='suppliers'){
   form.elements.country.value=values.country;
   form.elements.country.dispatchEvent(new Event('change',{bubbles:true}));
  }
  for(const [key,value]of Object.entries(values))form.elements[key].value=value;
  form.elements.basis.dispatchEvent(new Event('change',{bubbles:true}));
  form.dispatchEvent(new Event('input',{bubbles:true}));dirty();
  const info=kind==='suppliers'?`Поставщик: ${row.supplier}, котировка ${row.date}. Доставка сброшена: выберите ставку до нужного склада. Для CPT проверьте включённый пункт назначения.`:`Фрахт: ${row.origin} → ${row.warehouse}, ${row.date}, ${row.status}. Проверьте загрузку, пункт отправления и состав услуг; выбранная ставка должна покрывать весь маршрут.`;
  document.querySelector('#reference-selection').textContent=info;say(info);
  document.querySelector('#calculator').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(e){say(e.message,true);}
}
function rowEditor(kind,row,index){
 const tr=element('tr');const controls={};
 for(const [key,label,type]of schemas[kind]){
  const td=element('td'),input=element(Array.isArray(type)?'select':'input');
  if(Array.isArray(type)){for(const v of type){const o=element('option',v);o.value=v;input.append(o);}}
  else {input.type=type==='date'?'date':'text';if(type==='number')input.inputMode='decimal';input.maxLength=200;}
  input.setAttribute('aria-label',label);input.value=row[key]??(Array.isArray(type)?type[0]:'');
  input.addEventListener('input',()=>{tr.dataset.dirty='true';say('Есть несохранённые изменения: нажмите «Сохранить» в строке. Экспорт включает только сохранённые строки.');});
  controls[key]=input;td.append(input);tr.append(td);
 }
 const td=element('td'),buttons=element('div');buttons.className='row-actions';
 const commit=element('button','Сохранить'),use=element('button','В расчёт ↗'),remove=element('button','Удалить');
 function read(){return cleanRow(kind,Object.fromEntries(Object.entries(controls).map(([k,el])=>[k,el.value])));}
 commit.addEventListener('click',()=>{try{const v=read();if(!discardOthers(kind,tr))return;const next=structuredClone(data);if(index===null){if(next[kind].length>=500)throw Error('Лимит 500 строк в таблице');next[kind].push(v);}else next[kind][index]=v;save(next);render(kind);say('Строка сохранена в этом браузере.');}catch(e){say(e.message,true);}});
 use.disabled=index===null;
 use.addEventListener('click',()=>{if(tr.dataset.dirty==='true'){say('Сначала сохраните изменения строки.',true);return;}apply(kind,row);});
 remove.addEventListener('click',()=>{if(index===null){tr.remove();return;}try{if(!discardOthers(kind,tr))return;const next=structuredClone(data);next[kind].splice(index,1);save(next);render(kind);say('Строка удалена.');}catch(e){say(e.message,true);}});
 buttons.append(commit,use,remove);td.append(buttons);tr.append(td);return tr;
}
function discardOthers(kind,tr){const other=[...document.querySelectorAll(`#${kind}-body tr[data-dirty="true"],#${kind}-body tr[data-new]`)].some(r=>r!==tr);return !other||confirm('В других строках этой таблицы есть несохранённые изменения. Продолжить и сбросить их?');}
function render(kind){const body=document.querySelector(`#${kind}-body`);body.replaceChildren();data[kind].forEach((r,i)=>body.append(rowEditor(kind,r,i)));document.querySelector(`#${kind}-count`).textContent=data[kind].length;if(!data[kind].length){const tr=element('tr'),td=element('td','Пока нет строк. Нажмите «Добавить строку» и введите данные.');td.colSpan=schemas[kind].length+1;td.className='empty-row';tr.append(td);body.append(tr);}}
for(const kind of Object.keys(schemas)){
 const head=document.querySelector(`#${kind}-head`);for(const [,label]of schemas[kind])head.append(element('th',label));head.append(element('th','Действия'));
 document.querySelector(`#add-${kind}`).addEventListener('click',()=>{const body=document.querySelector(`#${kind}-body`);if(body.querySelector('[data-new]')){say('Сначала сохраните или удалите новую строку.',true);return;}const row={};const now=new Date();row.date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;if(kind==='freights'){row.usd='0';row.rub='0';}const tr=rowEditor(kind,row,null);tr.dataset.new='true';body.prepend(tr);tr.querySelector('input,select')?.focus();});render(kind);
}
document.querySelector('#reference-export').addEventListener('click',()=>{const file=new Blob([JSON.stringify({type:'fiber-reference-data',version:1,...data},null,2)],{type:'application/json'}),url=URL.createObjectURL(file),a=element('a');a.href=url;a.download=`fiber-prices-freight-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say('Экспортированы сохранённые строки обеих таблиц.');});
document.querySelector('#reference-import').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2000000)throw Error('Максимальный размер файла — 2 МБ');const incoming=parseReferenceFile(JSON.parse(await file.text()));if(root.querySelector('[data-dirty="true"],[data-new]')&&!confirm('Импорт сбросит несохранённые строки. Продолжить?'))return;const next=structuredClone(data);let count=0;for(const kind of Object.keys(schemas)){const known=new Set(next[kind].map(v=>JSON.stringify(v)));for(const v of incoming[kind]){const id=JSON.stringify(v);if(!known.has(id)){next[kind].push(v);known.add(id);count++;}}if(next[kind].length>500)throw Error('После импорта превышен лимит 500 строк в таблице');}save(next);for(const kind of Object.keys(schemas))render(kind);say(`Добавлено строк: ${count}. Совпадающие строки пропущены.`);}catch(err){say(err.message,true);}e.target.value='';});
window.addEventListener('beforeunload',e=>{if(root.querySelector('[data-dirty="true"]')){e.preventDefault();e.returnValue='';}});
