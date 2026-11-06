export const warehouses = ['Екатеринбург','Новосибирск','Ратмирово','Краснодар','Иваново'];
export function validate(v) {
  if (!v || typeof v !== 'object') throw Error('Неверный формат предложения');
  for (const k of ['material','group','country','point']) if (typeof v[k] !== 'string' || !v[k].trim() || v[k].length > 160) throw Error('Заполните материал, группу, страну и пункт поставки');
  if (!warehouses.includes(v.warehouse) || !['CPT','FCA','FOB'].includes(v.basis) || !['USD','CNY'].includes(v.currency)) throw Error('Неверный склад, базис или валюта');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || Number.isNaN(Date.parse(v.date))) throw Error('Укажите дату котировки');
  for (const k of ['price','weight','usd','cny','freightUsd','freightRub']) {
    if ((typeof v[k] !== 'string' && typeof v[k] !== 'number') || String(v[k]).trim() === '') throw Error('Заполните числовые поля');
    const n = Number(v[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9 || (['price','weight','usd','cny'].includes(k) && n === 0)) throw Error('Проверьте цену, загрузку и курсы: значения должны быть положительными');
  }
  return v;
}
export function calculate(v, freightChange = 0, fxChange = 0) {
  validate(v);
  const fx = 1 + fxChange / 100, fc = 1 + freightChange / 100;
  const goods = Number(v.price) * Number(v.currency === 'USD' ? v.usd : v.cny) * fx;
  const freight = v.basis === 'CPT' ? 0 : (Number(v.freightUsd) * Number(v.usd) * fx + Number(v.freightRub)) * fc / Number(v.weight);
  return {goods,freight,total:goods+freight};
}
