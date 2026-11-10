export const roles={manager:'Менеджер',lead:'Руководитель',sales:'Отдел продаж'};
export const warehouses=['Екатеринбург','Новосибирск','Ратмирово','Краснодар','Иваново'];
export const groups=['LM / БИК','Конжугейт HCS / HC','Регуляр','Вискоза','Другое'];
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const ordered=rows=>[...rows].sort((a,b)=>b.quote_date.localeCompare(a.quote_date)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
export const latest=(rows,key,id)=>ordered(rows.filter(r=>r[key]===id))[0]||null;
export function sameTerms(a,b){return ['material','fiber_group','country','basis','currency','weight','point','warehouse','route_id'].every(k=>String(a?.[k]??'')===String(b?.[k]??''));}
export function priceChange(quote,previous){if(!quote||!previous||!sameTerms(quote.snapshot,previous.snapshot))return null;return (Number(quote.price)/Number(previous.price)-1)*100;}
export function age(date,now=today()){return Math.max(0,Math.floor((Date.parse(now)-Date.parse(date))/86400000));}
export function landed(quote,rate){
 if(!quote)return null;const s=quote.snapshot;
 if(!['CPT','FCA','FOB'].includes(s?.basis)||!['USD','CNY'].includes(s?.currency)||!(Number(s.weight)>0))return null;
 if(s.basis!=='CPT'&&(!rate||rate.route_id!==s.route_id||rate.snapshot?.warehouse!==s.warehouse))return null;
 const goods=Number(quote.price)*Number(s.currency==='USD'?quote.usd_rate:quote.cny_rate);
 const freight=s.basis==='CPT'?0:(Number(rate.usd)*Number(quote.usd_rate)+Number(rate.rub))/Number(s.weight);
 const net=goods+freight,vat=net*Number(quote.vat_rate)/100;
 if(![goods,freight,net,vat].every(Number.isFinite))return null;
 return {goods,freight,net,vat,gross:net+vat};
}
export function numeric(value,label,{zero=false,max=1e9}={}){const n=Number(String(value).trim().replace(',','.'));if(String(value).trim()===''||!Number.isFinite(n)||n<0||(!zero&&n===0)||n>max)throw Error(`Проверьте поле «${label}»`);return n;}
export function endpoint(value){const u=new URL(value);if(u.protocol!=='https:'||!/^([a-z0-9-]+)\.supabase\.co$/.test(u.hostname)||u.port||u.username||u.password)throw Error('Укажите Project URL вида https://….supabase.co');return u.origin;}
