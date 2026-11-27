import assert from 'node:assert/strict';
import {JSDOM} from './node_modules/jsdom/lib/api.js';
const dom=new JSDOM('<div id="freight-grid"></div>',{url:'https://example.test/team/'}),w=dom.window;
for(const key of ['document','localStorage','sessionStorage','Event','Option'])globalThis[key]=w[key];globalThis.window=w;
sessionStorage.setItem('fiber-team-session-v1',JSON.stringify({access_token:'test',expires_at:Date.now()/1000+3600}));
const {renderFreightGrid,clearFreightGrid,hasFreightDrafts,freightValues}=await import('../docs/team/freight-grid.mjs');
const {today}=await import('../docs/team/model.mjs');
const route={id:'r1',kind:'FCA',loading_point:'Ташкент',origin:'Ташкент',warehouse:'Екатеринбург',updated_at:'2026-01-01T10:00:00Z',active:true};
const baseRate={id:'f1',route_id:route.id,usd:2250,rub:0,note:'Old offer',quote_date:today(),created_at:'2026-01-01T11:00:00Z',created_by:'manager',status:'Предложение'};
const db={fa_routes:[route],fa_freight_rates:[baseRate]};let counter=1,batches=[],fail=false,loaded=0;
globalThis.fetch=async(url,init={})=>{const table=new URL(url).pathname.split('/').at(-1);assert.ok(db[table],table);if(!init.method||init.method==='GET')return Response.json(structuredClone(db[table]));
 const body=JSON.parse(init.body);if(table==='fa_routes'){assert.equal(init.headers.Prefer,'return=representation');const r={...body,id:`r${++counter}`,updated_at:`2026-01-01T12:00:0${counter}Z`,active:true};db.fa_routes.push(r);return Response.json([r]);}
 assert.ok(Array.isArray(body),'rates saved as one transactional batch');if(fail){fail=false;return Response.json({message:'Тест: сохранение недоступно'},{status:503});}
 batches.push(body);for(const v of body){const r=db.fa_routes.find(r=>r.id===v.route_id);assert.equal(v.card_version,r.updated_at);db.fa_freight_rates.push({...v,id:`f${++counter}`,created_at:`2026-11-27T12:00:${String(counter).padStart(2,'0')}Z`,created_by:'sales',snapshot:{...r}});}return new Response(null,{status:204});};
const opts={state:{routes:db.fa_routes,rates:db.fa_freight_rates,workflow:2,days:7},me:{email:'sales@fiberanalytics.invalid'},person:email=>email,onHistory:()=>{},onSaved:async()=>{loaded++;renderFreightGrid(opts);}};
const $=q=>document.querySelector(q),input=(label)=>[...document.querySelectorAll('input')].find(n=>n.getAttribute('aria-label')===label),type=(label,value)=>{const n=input(label);assert.ok(n,label);n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));};
const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+$('#freight-message')?.textContent);};
renderFreightGrid(opts);assert.equal(document.querySelectorAll('.freight-matrix tbody tr').length,5);assert.equal($('#freight-save').disabled,true);assert.equal(input('Ургут, Иваново: USD').value,'');
type('Ташкент, Екатеринбург: USD','2400');assert.ok(hasFreightDrafts());renderFreightGrid(opts);assert.equal(input('Ташкент, Екатеринбург: USD').value,'2400','manual refresh retains draft');
type('Ургут, Иваново: USD','3 750,50');$('#freight-save').click();await wait(()=>loaded===1);assert.equal(batches.length,1);assert.equal(batches[0].length,2);assert.equal(batches[0][1].usd,3750.5);assert.equal(db.fa_routes.length,2);assert.equal(db.fa_freight_rates.length,3);assert.equal(hasFreightDrafts(),false);assert.ok([...document.querySelectorAll('.freight-history')].length===2);
// Equal-to-original edits are not saved again.
type('Ташкент, Екатеринбург: USD','2500');type('Ташкент, Екатеринбург: USD','2400');assert.equal(hasFreightDrafts(),false);
// Empty cells and invalid numbers cannot silently become a zero-rate deletion.
type('Ташкент, Екатеринбург: USD','');type('Ташкент, Екатеринбург: RUB','');$('#freight-save').click();await wait(()=>$('#freight-message').textContent.includes('Пустая'));assert.equal(batches.length,1);assert.ok(hasFreightDrafts());$('#freight-cancel').click();
for(const patch of [{usd:'100\t200'},{usd:'-1'},{rub:'Infinity'},{usd:'1+2'},{date:'2026-02-30'},{date:'2999-01-01'}])assert.throws(()=>freightValues({usd:'100',rub:'',date:today(),status:'Факт',note:'',...patch}));
// A colleague's new rate is detected before writing; all own values remain.
type('Ташкент, Екатеринбург: USD','2600');db.fa_freight_rates.push({...baseRate,id:'colleague',created_at:'2099-01-01T12:00:00Z',usd:2550});$('#freight-save').click();await wait(()=>$('#freight-message').textContent.includes('другим сотрудником'));assert.equal(batches.length,1);assert.equal(input('Ташкент, Екатеринбург: USD').value,'2600');$('#freight-cancel').click();
// China supports independent USD and RUB and retains drafts across type tabs.
[...document.querySelectorAll('.freight-tabs button')][1].click();assert.equal(input('Шанхай · ДВ, Ратмирово: USD').value,'');type('Шанхай · ДВ, Ратмирово: USD','4 250');type('Шанхай · ДВ, Ратмирово: RUB','400 000');type('Шанхай · ДВ, Ратмирово: перевозчик и условия','Перевозчик <script>тест</script>');
[...document.querySelectorAll('.freight-tabs button')][0].click();assert.match($('#freight-count').textContent,/1/);[...document.querySelectorAll('.freight-tabs button')][1].click();assert.equal(input('Шанхай · ДВ, Ратмирово: RUB').value,'400 000');assert.equal(document.querySelector('script'),null);
fail=true;$('#freight-save').click();await wait(()=>$('#freight-message').textContent.includes('недоступно'));const routeCount=db.fa_routes.length;assert.ok(hasFreightDrafts());assert.equal(input('Шанхай · ДВ, Ратмирово: USD').value,'4 250');$('#freight-save').click();await wait(()=>loaded===2);assert.equal(db.fa_routes.length,routeCount,'retry reuses route created before failed batch');assert.equal(batches[1][0].usd,4250);assert.equal(batches[1][0].rub,400000);assert.equal(batches[1][0].note,'Перевозчик <script>тест</script>');
type('Шанхай · ДВ, Ратмирово: USD','4300');clearFreightGrid();assert.equal(hasFreightDrafts(),false);assert.equal($('#freight-grid').children.length,0);dom.window.close();
console.log('Passed freight matrix: empty cells, mixed currencies, shared sales editing, atomic rate batch, new routes, draft retention, version conflict, failed save retry, validation and logout cleanup');
