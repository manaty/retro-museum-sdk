import {PACKAGE_CACHE,DATA_CACHE,packageUrl} from './constants.js';
const hex=buffer=>Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
const definitions=new Map();let fallback=null;
export function setPackageFallback(fn){fallback=fn;}

// Packages are immutable and addressed by SHA-256; integrity is checked before use.
export function packageDefinition(base,hash){
 if(!/^[a-f0-9]{64}$/.test(hash||''))return Promise.reject(Error('Invalid package'));
 if(!definitions.has(hash))definitions.set(hash,(async()=>{
  const url=packageUrl(base,hash),cache=await caches.open(PACKAGE_CACHE);let response=await cache.match(url);
  let bytes=response?await response.arrayBuffer():null;
  if(!bytes&&fallback)bytes=await fallback(hash).catch(()=>null);
  if(!bytes){const fetched=await fetch(url).catch(()=>null);if(!fetched?.ok)throw Error('This game is not downloaded on this device.');bytes=await fetched.arrayBuffer();}
  if(hex(await crypto.subtle.digest('SHA-256',bytes))!==hash){await cache.delete(url);throw Error('Package integrity mismatch');}
  if(!response)await cache.put(url,new Response(bytes,{headers:{'Content-Type':'application/json'}}));
  return {pack:JSON.parse(new TextDecoder().decode(bytes)),hash,playerCapacity:128};
 })().catch(error=>{definitions.delete(hash);throw error;}));
 return definitions.get(hash);
}
// Exact package text for players connected to this organiser (verified first).
export async function packageText(base,hash){try{await packageDefinition(base,hash);}catch{return null;}const response=await (await caches.open(PACKAGE_CACHE)).match(packageUrl(base,hash));return response?response.text():null;}
export async function offlineGames(base){
 try{const response=await fetch(base+'/api/games');if(response.ok)return await response.json();}catch{}
 const cached=await (await caches.open(DATA_CACHE)).match(base+'/api/games');if(cached)return cached.json();
 return [];
}
export function roomStore(){
 const db=new Promise((resolve,reject)=>{const request=indexedDB.open('retro-museum-offline',1);request.onupgradeneeded=()=>request.result.createObjectStore('rooms',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 const run=(mode,fn)=>db.then(database=>new Promise((resolve,reject)=>{const tx=database.transaction('rooms',mode),request=fn(tx.objectStore('rooms'));tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(tx.error);}));
 return {list:()=>run('readonly',s=>s.getAll()).then(x=>x||[]),put:room=>run('readwrite',s=>s.put(room)),delete:id=>run('readwrite',s=>s.delete(id))};
}
