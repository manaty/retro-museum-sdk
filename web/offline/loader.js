// Small script loaded before host.js on every page: installable app, offline
// downloads, and routing of an offline room's requests to the in-browser host.
import {PACKAGE_CACHE,DATA_CACHE,packageUrl} from './constants.js';
(function(){
const base=document.querySelector('meta[name=museum-base]')?.content||'';
const route=location.pathname.slice(base.length).split('/');
const roomId=['r','j'].includes(route[1])&&/^[a-z0-9]{12}$/.test(route[2]||'')?route[2]:null;
const localRooms=()=>{try{const value=JSON.parse(localStorage.getItem('manaty-offline-rooms'));return Array.isArray(value)?value:[];}catch{return [];}};
const isLocalRoom=id=>localRooms().some(room=>room.id===id);
const supported=typeof RTCPeerConnection==='function'&&'caches' in window&&'indexedDB' in window&&!!window.crypto?.subtle;
let mode=null;
if(roomId&&supported){if(isLocalRoom(roomId))mode='host';else if(new URLSearchParams(location.search).get('offline')==='1')mode='guest';}

if('serviceWorker' in navigator&&window.isSecureContext)addEventListener('load',()=>navigator.serviceWorker.register(base+'/sw.js',{scope:base+'/'}).catch(error=>console.warn('Offline support unavailable',error)));
let installPrompt=null;const installListeners=[];
addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;installListeners.forEach(fn=>fn());});
addEventListener('appinstalled',()=>{installPrompt=null;installListeners.forEach(fn=>fn());});

let runtime=null,started=null;
function loadRuntime(){
 if(!runtime)runtime=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=base+'/offline-runtime.js';script.onload=()=>{const api=window.RetroMuseumOfflineRuntime;api.setBase(base);resolve(api);};script.onerror=()=>reject(Error('Offline mode could not load. Open Retro Museum Play once while online.'));document.head.append(script);});
 return runtime;
}
const language=()=>document.querySelector('#language')?.value||'en';
function start(kind){
 if(!started)started=loadRuntime().then(api=>kind==='guest'?(api.startGuest({base,room:roomId,language}),api):api.startHost({base}).then(()=>api));
 return started;
}

if(mode){
 const nativeFetch=window.fetch.bind(window),NativeSocket=window.WebSocket;
 window.fetch=function(input,init){
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin===location.origin&&url.pathname.startsWith(base+'/api/rooms'))return start(mode).then(api=>api.fetchVia(url.pathname.slice(base.length)+url.search,init||{}));
  return nativeFetch(input,init);
 };
 const Socket=function(url,protocols){
  const parsed=new URL(url,location.href);
  if(parsed.pathname!==base+'/socket')return protocols===undefined?new NativeSocket(url):new NativeSocket(url,protocols);
  return window.RetroMuseumOfflineRuntime?window.RetroMuseumOfflineRuntime.socketVia(url):closedSocket(url);
 };
 for(const key of ['CONNECTING','OPEN','CLOSING','CLOSED'])Socket[key]=NativeSocket[key];Socket.prototype=NativeSocket.prototype;
 window.WebSocket=Socket;
 start(mode).catch(error=>{const main=document.querySelector('#main');if(main)main.innerHTML='<section class="landing"><h1>'+String(error.message).replace(/[<&>]/g,'')+'</h1></section>';});
}
function closedSocket(url){const socket={url,readyState:3,send(){},close(){},addEventListener(){},removeEventListener(){}};setTimeout(()=>socket.onclose?.({code:1006,reason:''}),0);return socket;}

const offlineCapable=game=>game.offline!==false&&/^[a-f0-9]{64}$/.test(game.hash||'');
async function readyHashes(games){
 const ready=new Set();if(!('caches' in window))return ready;
 const cache=await caches.open(PACKAGE_CACHE);
 await Promise.all(games.filter(offlineCapable).map(async game=>{if(await cache.match(packageUrl(base,game.hash)))ready.add(game.hash);}));
 return ready;
}
async function download(games,progress=()=>{}){
 if(!('caches' in window))throw Error('This browser cannot store games for offline play.');
 try{await navigator.storage?.persist?.();}catch{}
 const cache=await caches.open(PACKAGE_CACHE),list=games.filter(offlineCapable);let done=0;
 try{const response=await fetch(base+'/api/games');if(response.ok)await (await caches.open(DATA_CACHE)).put(base+'/api/games',response);}catch{}
 for(const game of list){
  const url=packageUrl(base,game.hash);
  if(!await cache.match(url)){const response=await fetch(url);if(!response.ok)throw Error('Download failed: '+(game.title?.en||game.id));await cache.put(url,response);}
  progress(++done,list.length);
 }
 // Drop packages no longer listed so storage does not grow with each release.
 const keep=new Set(list.map(g=>new URL(packageUrl(base,g.hash),location.href).href));
 for(const request of await cache.keys())if(!keep.has(request.url))await cache.delete(request);
 return done;
}
const prefKey='manaty-play-offline';
window.RetroMuseumOffline={
 supported,mode,base,
 get active(){return Boolean(mode);},
 get preferred(){try{return localStorage.getItem(prefKey)==='1';}catch{return false;}},
 setPreferred(value){try{localStorage.setItem(prefKey,value?'1':'0');}catch{}},
 isLocalRoom,localRooms,offlineCapable,readyHashes,download,
 get canInstall(){return Boolean(installPrompt);},
 get installed(){return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;},
 onInstallChange(fn){installListeners.push(fn);},
 async install(){if(!installPrompt)return false;installPrompt.prompt();const choice=await installPrompt.userChoice;installPrompt=null;installListeners.forEach(fn=>fn());return choice.outcome==='accepted';},
 async createRoom(input){const api=await start('host');const room=await api.createRoom(input);const rooms=localRooms().filter(r=>r.id!==room.id);rooms.push({id:room.id,game:input.game,updatedAt:Date.now()});try{localStorage.setItem('manaty-offline-rooms',JSON.stringify(rooms));}catch{}return room;},
 loadView(frame,url){if(!mode){frame.src=url;return;}start(mode).then(api=>api.loadView(frame,url));},
 mountPairing(container,options){let pairing=null,gone=false;start('host').then(api=>{if(!gone)pairing=api.mountPairing(container,options);});return {destroy(){gone=true;pairing?.destroy();}};},
 openPairing(options){start('host').then(api=>api.openPairing(options));},
 scanInvitation(options){loadRuntime().then(api=>api.scanInvitation(options),error=>alert(error.message));}
};
})();
