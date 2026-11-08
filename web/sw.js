// Retro Museum Play service worker: installable app shell and offline games.
// Pages, scripts and the game list are network-first with a cached fallback;
// game packages are immutable (SHA-256 addressed) and served cache-first.
const SHELL_CACHE='retro-museum-shell-v1',DATA_CACHE='retro-museum-data-v1',PACKAGE_CACHE='retro-museum-packages-v1';
const scope=new URL(self.registration.scope).pathname.replace(/\/$/,'');
const SHELL=['/','/host.js','/host.css','/compat.js','/offline.js','/offline-runtime.js','/quickjs.wasm','/personal-screen.css','/manifest.webmanifest','/icons/icon.svg','/icons/icon-192.png','/icons/icon-512.png'].map(path=>scope+path);
const NETWORK_TIMEOUT=4000;

self.addEventListener('install',event=>{event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL.map(url=>new Request(url,{cache:'no-cache'})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('retro-museum-')&&![SHELL_CACHE,DATA_CACHE,PACKAGE_CACHE].includes(key)).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});

function withTimeout(promise){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout')),NETWORK_TIMEOUT);promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});}
async function networkFirst(request,cacheName,key=request){
 const cache=await caches.open(cacheName);
 try{const response=await withTimeout(fetch(request));if(response.ok)await cache.put(key,response.clone());return response;}
 catch(error){const cached=await cache.match(key);if(cached)return cached;throw error;}
}
async function packageResponse(hash){
 const cache=await caches.open(PACKAGE_CACHE),url=scope+'/packages/'+hash+'/package.json';
 let response=await cache.match(url);if(response)return response;
 response=await fetch(url);if(response.ok)await cache.put(url,response.clone());return response;
}
const decoded=new Map();
async function packageAsset(hash,path){
 if(!decoded.has(hash))decoded.set(hash,caches.open(PACKAGE_CACHE).then(cache=>cache.match(scope+'/packages/'+hash+'/package.json')).then(r=>r?r.json():null).catch(()=>null));
 const pack=await decoded.get(hash);if(!pack){decoded.delete(hash);return null;}
 const asset=pack.assets?.[path];if(!asset)return null;
 const binary=atob(asset.data),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return new Response(bytes,{headers:{'Content-Type':asset.type,'Cache-Control':'public,max-age=31536000,immutable'}});
}

self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==location.origin||!url.pathname.startsWith(scope+'/'))return;
 const path=url.pathname.slice(scope.length);
 if(path==='/socket'||path.startsWith('/api/rooms')||path==='/health'||path.startsWith('/avatars/'))return;
 if(request.mode==='navigate'){
  if(/^\/($|g\/[a-z0-9-]+$|[rj]\/[a-z0-9]{12}$)/.test(path))event.respondWith(networkFirst(request,SHELL_CACHE,scope+'/').catch(()=>caches.match(scope+'/')));
  return;
 }
 if(path==='/api/games'){event.respondWith(networkFirst(request,DATA_CACHE,scope+'/api/games'));return;}
 const pack=/^\/packages\/([a-f0-9]{64})\/(package\.json|assets\/(.+))$/.exec(path);
 if(pack){
  if(pack[2]==='package.json'){event.respondWith(packageResponse(pack[1]));return;}
  // Catalogue covers: the package's own copy works offline.
  event.respondWith(fetch(request).catch(async error=>{const response=await packageAsset(pack[1],decodeURIComponent(pack[3]));if(response)return response;throw error;}));
  return;
 }
 if(SHELL.includes(url.pathname))event.respondWith(networkFirst(request,SHELL_CACHE,url.pathname));
});
