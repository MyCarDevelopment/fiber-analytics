import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const sourceUrl='https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU';
export function aggregateOil(csv,asOf=new Date()){
 const lines=csv.replace(/^\uFEFF/,'').trim().split(/\r?\n/),head=lines.shift().split(',');if(head[0]!=='observation_date'||head[1]!=='DCOILBRENTEU')throw Error('Unexpected FRED schema');
 const monday=d=>{const x=new Date(d);x.setUTCHours(0,0,0,0);x.setUTCDate(x.getUTCDate()-(x.getUTCDay()+6)%7);return x.toISOString().slice(0,10);},cutoff=monday(asOf),weeks=new Map(),seen=new Set();
 for(const line of lines){const [date,text]=line.split(',');if(text==='.'||!text)continue;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||(!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw Error('Invalid FRED date');if(seen.has(date))throw Error('Duplicate FRED observation');seen.add(date);const value=Number(text);if(!(value>0)||!Number.isFinite(value))throw Error('Invalid Brent observation');const key=monday(date);if(key>=cutoff)continue;const row=weeks.get(key)||{date:key,sum:0,count:0,lastObservation:date};row.sum+=value;row.count++;row.lastObservation=date;weeks.set(key,row);}
 const observations=[...weeks.values()].filter(w=>w.count>=3).sort((a,b)=>a.date.localeCompare(b.date)).slice(-156).map(w=>({date:w.date,value:Number((w.sum/w.count).toFixed(4)),count:w.count,lastObservation:w.lastObservation}));if(observations.length<20)throw Error('Insufficient Brent observations');
 return {version:1,series:'BRENT_WEEKLY_MEAN',name:'Brent · среднее недели',unit:'USD/barrel',source:'U.S. EIA via FRED · DCOILBRENTEU',sourceUrl:'https://fred.stlouisfed.org/series/DCOILBRENTEU',downloadUrl:sourceUrl,aggregation:'Среднее доступных дневных наблюдений завершённой календарной недели, минимум 3 дня. Дата — понедельник.',fetchedAt:asOf.toISOString(),latestObservation:observations.at(-1).lastObservation,observations};
}
export async function updateOil({input,output='docs/market/oil.json'}={}){
 let csv;if(input)csv=await readFile(input,'utf8');else{const r=await fetch(sourceUrl,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`FRED HTTP ${r.status}`);csv=await r.text();}
 const data=aggregateOil(csv);try{const old=JSON.parse(await readFile(output,'utf8'));if(old.latestObservation>data.latestObservation)throw Error('Source is older than saved data');}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
 await mkdir(fileURLToPath(new URL('../docs/market/',import.meta.url)),{recursive:true});await writeFile(output+'.tmp',JSON.stringify(data,null,2)+'\n');await rename(output+'.tmp',output);console.log(`Brent: ${data.observations.length} weeks; latest observation ${data.latestObservation}`);return data;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await updateOil({input:process.argv[2]});
