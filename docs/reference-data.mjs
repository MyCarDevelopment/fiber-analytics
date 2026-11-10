export const groups=['LM / БИК','Конжугейт HCS / HC','Регуляр','Вискоза','Другое'];
export const countries=['Китай','Иран','Узбекистан','Туркменистан','Турция','Другая'];
export const warehouses=['Екатеринбург','Новосибирск','Ратмирово','Краснодар','Иваново'];
export const schemas={
 suppliers:[['supplier','Поставщик'],['material','Марка / характеристики'],['group','Группа',groups],['country','Страна',countries],['basis','Базис',['FOB','CPT','FCA']],['point','Пункт FOB/FCA/CPT'],['price','Цена за кг','number'],['currency','Валюта',['CNY','USD']],['weight','Загрузка, кг','number'],['date','Дата котировки','date']],
 freights:[['origin','Откуда / маршрут'],['warehouse','Склад',warehouses],['usd','Ставка USD','number'],['rub','Ставка RUB','number'],['date','Дата ставки','date'],['status','Тип ставки',['Ориентир','Предложение','Факт']],['note','Перевозчик / состав услуг']],
};
export function cleanRow(kind,row){
 if(!schemas[kind]||!row||typeof row!=='object'||Array.isArray(row))throw Error('Неверный формат строки');
 const out={};
 for(const [key,label,type]of schemas[kind]){
  const value=String(row[key]??'').trim();
  if(value.length>200)throw Error(`${label}: максимум 200 символов`);
  if(!value && key!=='note')throw Error(`Заполните «${label}»`);
  if(Array.isArray(type)&&!type.includes(value))throw Error(`${label}: выберите значение из списка`);
  if(type==='number'){
   if(!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value))throw Error(`${label}: введите неотрицательное число`);
   const number=Number(value.replace(',','.'));
   if(!Number.isFinite(number)||number>1e9||(['price','weight'].includes(key)&&number<=0))throw Error(`${label}: некорректное число`);
   out[key]=String(number);
  }else if(type==='date'){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw Error(`${label}: неверная дата`);
   out[key]=value;
  }else out[key]=value;
 }
 return out;
}
export function parseReferenceFile(data){
 if(data?.type!=='fiber-reference-data'||data.version!==1)throw Error('Нужен файл справочников Fiber Analytics v1');
 const out={};
 for(const kind of Object.keys(schemas)){
  if(!Array.isArray(data[kind])||data[kind].length>500)throw Error('Максимум 500 строк в каждой таблице');
  out[kind]=data[kind].map(row=>cleanRow(kind,row));
 }
 return out;
}
export function supplierValues(row){
 const v=cleanRow('suppliers',row);
 return {material:`${v.supplier} · ${v.material}`.slice(0,160),group:v.group,country:v.country,basis:v.basis,point:v.point.slice(0,160),price:v.price,currency:v.currency,weight:v.weight,date:v.date,freightUsd:'0',freightRub:'0',...(v.basis==='CPT'&&warehouses.includes(v.point)?{warehouse:v.point}:{})};
}
export function freightValues(row,warehouse,basis){
 const v=cleanRow('freights',row);
 if(basis==='CPT')throw Error('CPT уже включает доставку. Дополнительный фрахт не добавлен.');
 if(v.warehouse!==warehouse)throw Error(`Ставка до склада «${v.warehouse}», а в калькуляторе выбран «${warehouse}». Выберите соответствующий склад.`);
 return {freightUsd:v.usd,freightRub:v.rub};
}
