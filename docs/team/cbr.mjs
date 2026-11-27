// Public snapshot of official rates; one RUB value per unit, including nominal adjustment.
export function validateCbr(data){
 const date=data?.date;
 if(data?.version!==1||data.source!=='Банк России'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Некорректные данные ЦБ РФ');
 for(const code of ['USD','CNY'])if(!Number.isFinite(data.rates?.[code])||data.rates[code]<=0||data.rates[code]>1000000)throw Error(`Нет курса ЦБ для ${code}`);
 return data;
}
export function quoteAtCbr(quote,fx){if(!quote||!fx)return null;validateCbr(fx);return {...quote,usd_rate:fx.rates.USD,cny_rate:quote.snapshot.currency==='CNY'?fx.rates.CNY:null};}
