import {readFile,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {validateCbr} from '../docs/team/cbr.mjs';
export function parseCbr(xml,requestedDate){
 const date=xml.match(/<ValCurs\b[^>]*\bDate="(\d{2})\.(\d{2})\.(\d{4})"/)?.slice(1);
 if(!date)throw Error('CBR response has no effective date');const effective=`${date[2]}-${date[1]}-${date[0]}`,rates={};
 for(const code of ['USD','CNY']){const block=[...xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g)].map(m=>m[1]).find(s=>s.includes(`<CharCode>${code}</CharCode>`));if(!block)throw Error(`Missing ${code}`);const nominal=Number(block.match(/<Nominal>([^<]+)<\/Nominal>/)?.[1]),value=Number(block.match(/<Value>([^<]+)<\/Value>/)?.[1]?.replace(',','.'));if(!(nominal>0))throw Error('Invalid nominal');rates[code]=value/nominal;}
 const data=validateCbr({version:1,date:effective,requestedDate,source:'Банк России',sourceUrl:'https://www.cbr.ru/currency_base/daily/',rates});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)||effective>requestedDate)throw Error('CBR effective date is in the future');return data;
}
export async function updateFx({input,output='docs/market/fx.json',asOf=new Date()}={}){
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(asOf),[y,m,d]=date.split('-');
 let xml;if(input)xml=await readFile(input,'utf8');else{const response=await fetch(`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${d}/${m}/${y}`,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`CBR HTTP ${response.status}`);xml=new TextDecoder('windows-1251').decode(await response.arrayBuffer());}
 const data=parseCbr(xml,date);try{const old=JSON.parse(await readFile(output,'utf8'));if(old.date>data.date)throw Error('CBR response is older than saved snapshot');if(old.date===data.date&&JSON.stringify(old.rates)===JSON.stringify(data.rates))return old;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
 await writeFile(output+'.tmp',JSON.stringify({...data,fetchedAt:asOf.toISOString()},null,2)+'\n');await rename(output+'.tmp',output);console.log(`CBR ${data.date}: USD ${data.rates.USD}, CNY ${data.rates.CNY}`);return data;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await updateFx({input:process.argv[2]});
