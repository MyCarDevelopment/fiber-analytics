import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const {JSDOM}=await import(process.env.JSDOM_MODULE||new URL('./node_modules/jsdom/lib/api.js',import.meta.url).href);
const role=process.env.TEAM_TEST_ROLE||'manager',html=await readFile(new URL('../docs/team/index.html',import.meta.url),'utf8');
const dom=new JSDOM(html,{url:'https://example.test/team/'}),w=dom.window;
for(const k of ['document','localStorage','sessionStorage','Event','Option','FormData'])globalThis[k]=w[k];globalThis.window=w;globalThis.confirm=()=>true;globalThis.setInterval=()=>0;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
localStorage.setItem('fiber-team-connection-v1',JSON.stringify({url:'https://test.supabase.co',key:'sb_publishable_test'}));
const cardVersion='2026-11-10T09:00:00Z';
const member={email:'user@fiberanalytics.invalid',name:'Test User',role,active:true},snapshot={id:'s1',name:'Test Supplier',material:'6D',fiber_group:'Регуляр',country:'Узбекистан',basis:'FCA',currency:'USD',weight:22000,point:'Ташкент',warehouse:'Екатеринбург',route_id:'r1'};
const tables={fa_members:[member],fa_settings:[{id:true,stale_days:7}],fa_suppliers:[{...snapshot,updated_at:cardVersion,owner_email:member.email,active:true}],fa_routes:[{id:'r1',updated_at:cardVersion,origin:'Ташкент',warehouse:'Екатеринбург',owner_email:member.email,active:true}],fa_quotes:[{id:'q1',supplier_id:'s1',quote_date:'2026-11-10',created_at:'2026-11-10T10:00:00Z',created_by:member.email,price:.85,usd_rate:100,cny_rate:14,vat_rate:22,snapshot,freight_rate_id:'f1',note:''}],fa_freight_rates:[{id:'f1',route_id:'r1',quote_date:'2026-11-10',created_at:'2026-11-10T10:00:00Z',usd:2250,rub:0,status:'Предложение',note:'Full route',snapshot:{origin:'Ташкент',warehouse:'Екатеринбург'},created_by:member.email}]};
let logins=0,writes=0;
globalThis.fetch=async(url,init={})=>{const path=new URL(url).pathname,method=init.method||'GET';let result=null;
 if(path==='/auth/v1/token'){logins++;assert.equal(JSON.parse(init.body).email,'user@fiberanalytics.invalid');result={access_token:'test',refresh_token:'refresh',expires_at:Date.now()/1000+3600};}
 else if(path==='/auth/v1/user')result={email:member.email};
 else if(path==='/auth/v1/logout')result={};
 else {const table=path.split('/').at(-1);if(!tables[table])throw Error(`Unexpected endpoint ${path}`);if(method==='POST'){assert.notEqual(role,'sales');assert.equal(JSON.parse(init.body).card_version,cardVersion);writes++;tables[table].push({...JSON.parse(init.body),id:'q'+(writes+1),created_at:'2026-11-10T12:00:00Z',created_by:member.email,snapshot,freight_rate_id:'f1'});}else result=tables[table];}
 return new Response(result===null?null:JSON.stringify(result),{status:result===null?204:200,headers:{'Content-Type':'application/json'}});
};
const $=s=>document.querySelector(s);const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('UI condition timed out: '+$('#status').textContent+' / '+$('#dialog-status').textContent);};
await import('../docs/team/app.mjs');
$('#login-form').elements.login.value='user';$('#login-form').elements.password.value='Test-only-password-123';$('#login-form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));await wait(()=>!$('#workspace').hidden);assert.equal(logins,1);assert.equal($('#login-form').elements.password.value,'');assert.equal(sessionStorage.getItem('fiber-team-session-v1').includes('Test-only-password'),false);
assert.match($('#summary-body').textContent,/Test Supplier/);assert.match($('#summary-body').textContent,/НДС 22%/);
assert.equal($('#admin-tab').hidden,role!=='lead');assert.equal($('#new-supplier').hidden,role==='sales');
const update=[...document.querySelectorAll('#supplier-cards button')].find(b=>b.textContent==='Обновить цену');
if(role==='sales'){assert.equal(update,undefined);assert.equal([...document.querySelectorAll('#route-cards button')].some(b=>b.textContent==='Обновить ставку'),false);}else{
 update.click();assert.equal($('#editor').open,true);$('#edit-form').elements.price.value='0.90';$('#edit-form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));await wait(()=>!$('#editor').open);await wait(()=>$('#summary-body').textContent.includes('0,90'));assert.equal(writes,1);assert.equal(tables.fa_quotes.length,2);
 const history=[...document.querySelectorAll('#supplier-cards button')].find(b=>b.textContent==='История');history.click();assert.equal($('#editor').open,true);assert.ok($('#edit-form svg'));assert.match($('#edit-form').textContent,/0,90/);$('#close-dialog').click();
}
$('#change-password').click();$('#edit-form').elements.current.value='Old-test-password-123';$('#edit-form').elements.password.value='New-test-password-456';$('#edit-form').elements.repeat.value='different';$('#edit-form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));await wait(()=>$('#dialog-status').textContent.includes('не совпадают'));$('#edit-form').elements.repeat.value='New-test-password-456';$('#edit-form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));await wait(()=>!$('#editor').open);assert.equal(logins,2);
$('#logout').click();await wait(()=>$('#workspace').hidden&&$('#status').textContent==='Вы вышли из общей базы.');assert.equal($('#summary-body').children.length,0);assert.equal(sessionStorage.getItem('fiber-team-session-v1'),null);console.log(`Passed DOM integration: ${role} password login, role interface, summary, ${role==='sales'?'read-only actions':'quote entry and history chart'}, sign-out cleanup`);
dom.window.close();
