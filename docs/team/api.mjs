import {config} from './config.mjs';
import {endpoint,loginToEmail} from './model.mjs';
const sessionKey='fiber-team-session-v1',connectionKey='fiber-team-connection-v1';
let connection=config,session=null,refreshing=null;
try{const saved=localStorage.getItem(connectionKey);if(!config.url&&saved)connection=JSON.parse(saved);session=JSON.parse(sessionStorage.getItem(sessionKey)||'null');}catch{}
export function configured(){try{return !!(endpoint(connection.url)&&connection.key);}catch{return false;}}
export function configure(url,key){
 url=endpoint(url);key=key.trim();
 if(!key||key.length>4096||(!key.startsWith('eyJ')&&!key.startsWith('sb_publishable_')))throw Error('Нужен publishable/anon key, а не секретный ключ');
 if(key.startsWith('eyJ')){try{const payload=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(payload.role!=='anon')throw Error();}catch{throw Error('JWT-ключ должен иметь роль anon. service_role запрещён.');}}
 connection={url,key};localStorage.setItem(connectionKey,JSON.stringify(connection));
}
function remember(value){session=value;try{if(value)sessionStorage.setItem(sessionKey,JSON.stringify(value));else sessionStorage.removeItem(sessionKey);}catch{}}
async function raw(path,{method='GET',body,auth=false}={}){
 if(!configured())throw Error('Общая база пока не подключена');
 const headers={apikey:connection.key,'Content-Type':'application/json'};
 if(auth){await refresh();if(!session?.access_token)throw Error('Войдите по почте');headers.Authorization=`Bearer ${session.access_token}`;}
 const r=await fetch(`${connection.url}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const text=await r.text();let result;try{result=text?JSON.parse(text):null;}catch{throw Error('Сервис вернул неожиданный ответ');}
 if(!r.ok){if(auth&&r.status===401){remember(null);window.dispatchEvent(new Event('team-session-ended'));}const code=result?.error_code||result?.code;if(code==='invalid_credentials'||(path.includes('grant_type=password')&&r.status===400))throw Error('Неверный логин или пароль, либо аккаунт ещё не создан');throw Error(result?.message||result?.msg||result?.error_description||`Ошибка сервиса (${r.status})`);}
 return result;
}
async function refresh(){if(!session)return;if(session.expires_at>Date.now()/1000+60)return;if(!refreshing)refreshing=(async()=>{try{const s=await raw('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});remember({...s,expires_at:s.expires_at||Date.now()/1000+s.expires_in});}catch(e){remember(null);window.dispatchEvent(new Event('team-session-ended'));throw e;}finally{refreshing=null;}})();return refreshing;}
export const signedIn=()=>!!session?.access_token;
export async function signIn(login,password){const s=await raw('/auth/v1/token?grant_type=password',{method:'POST',body:{email:loginToEmail(login),password}});remember({...s,expires_at:s.expires_at||Date.now()/1000+s.expires_in});}
export async function changePassword(login,currentPassword,newPassword){if(newPassword.length<12)throw Error('Новый пароль должен содержать минимум 12 символов');await signIn(login,currentPassword);await raw('/auth/v1/user',{method:'PUT',body:{password:newPassword},auth:true});}
export async function signOut(){const token=session?.access_token;remember(null);if(token&&configured())await fetch(`${connection.url}/auth/v1/logout`,{method:'POST',headers:{apikey:connection.key,Authorization:`Bearer ${token}`}});}
export const who=()=>raw('/auth/v1/user',{auth:true});
export async function rows(table){const result=[];for(let offset=0;offset<100000;offset+=500){const page=await raw(`/rest/v1/${table}?select=*&order=id.asc&limit=500&offset=${offset}`,{auth:true});result.push(...page);if(page.length<500)return result;}throw Error('Слишком большая история: требуется серверная пагинация');}
export const members=()=>raw('/rest/v1/fa_members?select=*&order=name',{auth:true});
export const settings=()=>raw('/rest/v1/fa_settings?select=*',{auth:true});
export const insert=(table,body)=>raw(`/rest/v1/${table}`,{method:'POST',body,auth:true});
export const update=(table,id,body)=>raw(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body,auth:true});
export const rpc=(name,body)=>raw(`/rest/v1/rpc/${name}`,{method:'POST',body,auth:true});
