// Loaded on demand by offline.js when this page hosts or joins an offline room.
import {RoomParty} from '../../room-party.js';
import {initRuntime} from './browser-runtime.js';
import {createLocalHost} from './local-host.js';
import {framed,pipe,serveLink,tunnelClient} from './link.js';
import {createOffer,answerOffer,decodeSignal} from './rtc.js';
import {qrSvg,startScanner} from './qr.js';
import {createViewLoader} from './view-loader.js';
import {roomStore,packageDefinition,packageText,offlineGames,setPackageFallback} from './storage.js';
import {words} from './words.js';

const LOCK='retro-museum-offline-host',CHANNEL='retro-museum-offline';
let base='',hostApi=null,leader=false,pageClient=null,clientWaiters=[];
const text=(key,lang)=>(words[key]||[key])[{en:0,fr:1,tl:2}[lang]??0]||words[key]?.[0]||key;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setClient(client){pageClient=client;const waiters=clientWaiters;clientWaiters=[];for(const fn of waiters)fn(client);}
function currentClient(){return pageClient?.alive?Promise.resolve(pageClient):new Promise(resolve=>clientWaiters.push(resolve));}

// ---------- organiser device: one host per device, shared by its tabs ----------
async function startLeader(){
 await initRuntime(base+'/quickjs.wasm');
 const games=await offlineGames(base);
 const host=createLocalHost({Party:RoomParty,store:roomStore(),origin:location.origin,basePath:base,
  definitionForGame:async id=>{const game=games.find(g=>g.id===id&&g.offline!==false);return game?packageDefinition(base,game.hash):null;},
  definitionForHash:hash=>packageDefinition(base,hash),packageSource:hash=>packageText(base,hash),
  onChange:()=>rememberRooms(host.summary())});
 await host.restore();host.start();rememberRooms(host.summary());
 hostApi=host;leader=true;
 const [a,b]=pipe();serveLink(host,framed(a));setClient(tunnelClient(framed(b)));
 if(typeof BroadcastChannel==='function'){
  const channel=new BroadcastChannel(CHANNEL),links=new Map();
  channel.onmessage=({data})=>{
   if(!data||data.to!=='leader'||typeof data.from!=='string')return;
   let entry=links.get(data.from);
   if(data.k==='hi'&&!entry){
    const listeners=[],closers=[];entry={listeners,closers,seen:Date.now(),closed:false};
    entry.close=()=>{if(entry.closed)return;entry.closed=true;links.delete(data.from);channel.postMessage({to:data.from,k:'bye'});closers.forEach(fn=>fn());};
    links.set(data.from,entry);
    serveLink(host,framed({send:d=>channel.postMessage({to:data.from,k:'m',d}),onmessage:fn=>listeners.push(fn),onclose:fn=>closers.push(fn),close:entry.close,buffered:()=>0}));
    channel.postMessage({to:data.from,k:'welcome'});return;
   }
   if(!entry)return;entry.seen=Date.now();
   if(data.k==='m')entry.listeners.forEach(fn=>fn(data.d));else if(data.k==='bye')entry.close();
  };
  setInterval(()=>{for(const entry of links.values())if(Date.now()-entry.seen>8000)entry.close();},2000);
 }
 addEventListener('pagehide',()=>{host.stop();});
}
function startFollower(){
 const channel=new BroadcastChannel(CHANNEL),id=Math.random().toString(36).slice(2);
 const listeners=[],closers=[];let closed=false;
 const close=()=>{if(closed)return;closed=true;channel.postMessage({to:'leader',from:id,k:'bye'});closers.forEach(fn=>fn());};
 channel.onmessage=({data})=>{if(data?.to!==id)return;if(data.k==='m')listeners.forEach(fn=>fn(data.d));if(data.k==='bye')close();};
 channel.postMessage({to:'leader',from:id,k:'hi'});
 setInterval(()=>{if(!closed)channel.postMessage({to:'leader',from:id,k:'ping'});},2000);
 addEventListener('pagehide',close);
 setClient(tunnelClient(framed({send:d=>channel.postMessage({to:'leader',from:id,k:'m',d}),onmessage:fn=>listeners.push(fn),onclose:fn=>closers.push(fn),close,buffered:()=>0})));
}
function rememberRooms(rooms){try{localStorage.setItem('manaty-offline-rooms',JSON.stringify(rooms.map(r=>({id:r.id,game:r.game,title:r.title,phase:r.phase,players:r.players,updatedAt:r.updatedAt}))));}catch{}}

export async function startHost(options){
 base=options.base;
 if(!navigator.locks){await startLeader();return;}
 await new Promise(resolve=>{
  navigator.locks.request(LOCK,{ifAvailable:true},async lock=>{
   if(!lock){startFollower();resolve();
    // Take over when the hosting tab closes; reloading restores the saved rooms.
    navigator.locks.request(LOCK,()=>{location.reload();return new Promise(()=>{});});return;}
   await startLeader();resolve();return new Promise(()=>{});
  });
 });
}

// ---------- player device: connected to the organiser over WebRTC ----------
let guestOverlay=null;
export async function startGuest(options){
 base=options.base;const lang=options.language;
 const params=new URLSearchParams(location.hash.slice(1)),code=params.get('rtc');
 if(code)history.replaceState(null,'',location.pathname+location.search);
 const roomId=options.room;
 const overlay=guestOverlay=document.createElement('div');overlay.className='offline-overlay';document.body.append(overlay);
 async function connectWith(offerCode){
  overlay.innerHTML='<section class="offline-card"><p class="eyebrow">'+text('offlineTitle',lang())+'</p><h2>'+text('preparing',lang())+'</h2></section>';overlay.hidden=false;
  try{
   const offer=await decodeSignal('offer',offerCode);if(offer.r!==roomId){location.href=base+'/j/'+offer.r+'?offline=1#rtc='+encodeURIComponent(offerCode);return;}
   const answer=await answerOffer(offer);
   overlay.innerHTML='<section class="offline-card"><p class="eyebrow">'+text('offlineTitle',lang())+'</p><h2>'+text('showCode',lang())+'</h2><div class="offline-qr answer">'+await qrSvg(answer.code)+'</div><p>'+text('showCodeHelp',lang())+'</p><details><summary>'+text('manualCode',lang())+'</summary><textarea readonly data-answer-code>'+esc(answer.code)+'</textarea></details></section>';
   const link=await answer.connected();
   const client=tunnelClient(framed(link));setClient(client);overlay.hidden=true;overlay.innerHTML='';
   link.onclose(()=>scanAgain(text('lost',lang())));
  }catch(error){scanAgain(error.message);}
 }
 async function scanAgain(reason){
  overlay.hidden=false;overlay.innerHTML='<section class="offline-card"><p class="eyebrow">'+text('offlineTitle',lang())+'</p><h2>'+text('scanInvite',lang())+'</h2>'+(reason?'<p class="offline-error">'+esc(reason)+'</p>':'')+'<video class="offline-camera" muted playsinline></video><p>'+text('scanInviteHelp',lang())+'</p><details><summary>'+text('manualCode',lang())+'</summary><textarea data-offer-code></textarea><button data-use-code>'+text('connect',lang())+'</button></details></section>';
  let scanner=null;const use=async value=>{const offerCode=extractOffer(value);if(!offerCode)return;scanner?.stop();await connectWith(offerCode);};
  overlay.querySelector('[data-use-code]').onclick=()=>use(overlay.querySelector('[data-offer-code]').value);
  try{scanner=await startScanner(overlay.querySelector('video'),use);}catch{overlay.querySelector('video').hidden=true;}
 }
 if(code)connectWith(code);else scanAgain('');
}
export function extractOffer(value){
 const text=String(value||'').trim();if(text.startsWith('o1'))return text;
 try{const url=new URL(text);return new URLSearchParams(url.hash.slice(1)).get('rtc');}catch{return null;}
}

// ---------- organiser pairing: offer QR + camera reading the player's answer ----------
export function mountPairing(container,{room,language}){
 const lang=()=>language();
 if(!leader){container.innerHTML='<p class="offline-note">'+text('pairElsewhere',lang())+'</p>';return {destroy(){}};}
 let destroyed=false,scanner=null,current=null;const offers=[];
 container.classList.add('offline-pairing');
 container.innerHTML='<p class="eyebrow">'+text('offlineTitle',lang())+'</p><ol class="offline-steps"><li>'+text('stepWifi',lang())+'</li><li>'+text('stepScan',lang())+'</li><li>'+text('stepShow',lang())+'</li></ol><div class="offline-qr offer" aria-label="QR code"></div><p class="offline-status" role="status"></p><p class="offline-count" aria-live="polite"></p><video class="offline-camera" muted playsinline></video><div class="offline-tools"><button data-scan-player hidden>'+text('scanPlayer',lang())+'</button><button data-switch-camera>'+text('switchCamera',lang())+'</button></div><details><summary>'+text('manualCode',lang())+'</summary><textarea data-player-code placeholder="a1…"></textarea><button data-use-player-code>'+text('connect',lang())+'</button><textarea readonly data-offer-code></textarea></details>';
 const status=value=>{const el=container.querySelector('.offline-status');if(el)el.textContent=value;};
 let linked=0;const count=()=>{const el=container.querySelector('.offline-count');if(el)el.textContent=linked?text('linked',lang()).replace('{n}',linked):'';};
 async function nextOffer(){
  if(destroyed)return;status(text('preparing',lang()));
  try{current=await createOffer({room:room.id});offers.push(current);while(offers.length>4)offers.shift().cancel();
   if(destroyed)return current.cancel();
   const url=location.origin+base+'/j/'+room.id+'?offline=1#rtc='+current.code;
   container.querySelector('.offline-qr').innerHTML=await qrSvg(url);container.querySelector('[data-offer-code]').value=url;status(text('waitingPlayer',lang()));
  }catch(error){status(error.message);}
 }
 async function accept(value){
  const code=String(value||'').trim();if(!code.startsWith('a1'))return;
  let answer;try{answer=await decodeSignal('answer',code);}catch(error){status(error.message);return;}
  const offer=offers.find(o=>o.id===answer.o);if(!offer){status(text('oldCode',lang()));return;}
  offers.splice(offers.indexOf(offer),1);status(text('connecting',lang()));
  try{const link=await offer.accept(answer);serveLink(hostApi,framed(link));linked++;count();link.onclose(()=>{linked--;count();});status(text('playerConnected',lang()));}
  catch(error){status(error.message);}
  if(offer===current)nextOffer();
 }
 container.querySelector('[data-use-player-code]').onclick=()=>accept(container.querySelector('[data-player-code]').value);
 let facing='environment',idle=null;
 // The camera stops after two idle minutes; one tap restarts it for the next player.
 const awake=()=>{clearTimeout(idle);idle=setTimeout(()=>{scanner?.stop();scanner=null;container.querySelector('video').hidden=true;container.querySelector('[data-scan-player]').hidden=false;},120000);};
 async function camera(){scanner?.stop();scanner=null;const video=container.querySelector('video');try{scanner=await startScanner(video,value=>{awake();return accept(value);},{facingMode:facing});video.hidden=false;container.querySelector('[data-scan-player]').hidden=true;awake();}catch{video.hidden=true;status(text('noCamera',lang()));}}
 container.querySelector('[data-scan-player]').onclick=camera;
 container.querySelector('[data-switch-camera]').onclick=()=>{facing=facing==='environment'?'user':'environment';camera();};
 // Camera permission first: browsers then expose the real local address in the offer.
 camera().then(nextOffer);
 return {destroy(){destroyed=true;clearTimeout(idle);scanner?.stop();for(const o of offers)o.cancel();}};
}
export function openPairing({room,language}){
 const overlay=document.createElement('div');overlay.className='offline-overlay';overlay.innerHTML='<section class="offline-card"><button class="offline-close" aria-label="'+text('close',language())+'">×</button><div></div></section>';document.body.append(overlay);
 const pairing=mountPairing(overlay.querySelector('section > div'),{room,language});
 const close=()=>{pairing.destroy();overlay.remove();};overlay.querySelector('.offline-close').onclick=close;overlay.onclick=e=>{if(e.target===overlay)close();};
}

// ---------- page integration ----------
export const loadView=createViewLoader(hash=>packageDefinition(base,hash).then(d=>d.pack));
// Players without the game downloaded receive the package from the organiser.
setPackageFallback(async hash=>{if(!pageClient?.alive)return null;const response=await pageClient.fetch('/packages/'+hash+'/package.json');return response.ok?response.arrayBuffer():null;});
export function setBase(value){base=value;}
export async function fetchVia(path,init){const client=await currentClient();return client.fetch(path,init);}
export function socketVia(url){if(pageClient?.alive)return pageClient.socket(url);const dead=tunnelClient(framed({send(){},onmessage(){},onclose(fn){fn();},close(){},buffered:()=>0}));return dead.socket(url);}
export async function createRoom(input){const response=await fetchVia('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const value=await response.json();if(!response.ok)throw Error(value.error||'Offline room failed');return value;}
export function scanInvitation({language}){
 const overlay=document.createElement('div');overlay.className='offline-overlay';overlay.innerHTML='<section class="offline-card"><button class="offline-close" aria-label="'+text('close',language())+'">×</button><p class="eyebrow">'+text('offlineTitle',language())+'</p><h2>'+text('scanInvite',language())+'</h2><video class="offline-camera" muted playsinline></video><p>'+text('scanInviteHelp',language())+'</p><p class="offline-error" hidden></p></section>';document.body.append(overlay);
 let scanner=null;const close=()=>{scanner?.stop();overlay.remove();};overlay.querySelector('.offline-close').onclick=close;
 startScanner(overlay.querySelector('video'),value=>{const code=extractOffer(value);if(!code)return;decodeSignal('offer',code).then(offer=>{close();location.href=base+'/j/'+offer.r+'?offline=1#rtc='+encodeURIComponent(code);},error=>{const el=overlay.querySelector('.offline-error');el.hidden=false;el.textContent=error.message;});}).then(s=>scanner=s,()=>{const el=overlay.querySelector('.offline-error');el.hidden=false;el.textContent=text('noCamera',language());});
}
export {decodeSignal,encodeSignal} from './rtc.js';
