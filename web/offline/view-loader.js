// Game views run in an opaque-origin sandbox, which service workers never serve.
// Offline, a tiny loader document receives the view and its assets by message,
// turns assets into blob URLs inside the sandbox and then writes the view.
const LOADER=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; media-src blob: data:; font-src blob: data:; connect-src blob: data:; form-action 'none'; base-uri 'none'"><script>
(function(){addEventListener('message',function boot(e){
 if(e.source!==parent||!e.data||e.data.retroMuseumBoot!==1)return;removeEventListener('message',boot);
 var urls={};Object.keys(e.data.assets).forEach(function(k){var a=e.data.assets[k];urls[k]=URL.createObjectURL(new Blob([a.bytes],{type:a.type}));});
 function map(v){if(typeof v!=='string')return v;var m=/^(?:\\.\\/|\\/packages\\/[a-f0-9]{64}\\/)?assets\\/([^?#]+)/.exec(v);return m&&urls[m[1]]||v;}
 function wrap(proto,prop){var d=Object.getOwnPropertyDescriptor(proto,prop);if(d&&d.set)Object.defineProperty(proto,prop,{get:d.get,set:function(v){d.set.call(this,map(v));},configurable:true});}
 wrap(HTMLImageElement.prototype,'src');wrap(HTMLMediaElement.prototype,'src');wrap(HTMLSourceElement.prototype,'src');
 var setAttribute=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){return setAttribute.call(this,n,/^(src|href|poster)$/i.test(n)?map(v):v);};
 var NativeAudio=window.Audio;if(NativeAudio){window.Audio=function(src){return src===undefined?new NativeAudio():new NativeAudio(map(src));};window.Audio.prototype=NativeAudio.prototype;}
 var nativeFetch=window.fetch;if(nativeFetch)window.fetch=function(input,init){return nativeFetch.call(this,typeof input==='string'?map(input):input,init);};
 var open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){arguments[1]=map(url);return open.apply(this,arguments);};
 if(window.FontFace){var NativeFont=window.FontFace;window.FontFace=function(family,source,descriptors){return new NativeFont(family,typeof source==='string'?source.replace(/url\\((['"]?)([^'")]+)\\1\\)/g,function(all,q,u){return 'url('+map(u)+')';}):source,descriptors);};window.FontFace.prototype=NativeFont.prototype;}
 var html=e.data.html.replace(/(?:\\.\\/)?assets\\/([A-Za-z0-9_.\\/-]+)/g,function(all,k){return urls[k]||all;});
 document.open();document.write(html);document.close();
});parent.postMessage({retroMuseumLoader:1},'*');})();
<\/script></head><body></body></html>`;

// loadPackage(hash) resolves to the parsed package ({view,assets}).
export function createViewLoader(loadPackage){
 const decoded=new Map();
 async function payload(hash){
  if(!decoded.has(hash))decoded.set(hash,loadPackage(hash).then(pack=>{const assets={};for(const [path,asset] of Object.entries(pack.assets||{})){const binary=atob(asset.data),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);assets[path]={type:asset.type,bytes};}return {html:pack.view,assets};}).catch(error=>{decoded.delete(hash);throw error;}));
  return decoded.get(hash);
 }
 return function load(frame,url){
  const match=/\/packages\/([a-f0-9]{64})\/view$/.exec(url||'');
  if(!match){frame.src=url||'about:blank';return;}
  const data=payload(match[1]);
  const onMessage=async event=>{
   if(event.source!==frame.contentWindow||event.data?.retroMuseumLoader!==1)return;
   window.removeEventListener('message',onMessage);
   try{const {html,assets}=await data;const copy={};for(const [k,v] of Object.entries(assets))copy[k]={type:v.type,bytes:v.bytes.slice()};frame.contentWindow.postMessage({retroMuseumBoot:1,html,assets:copy},'*',Object.values(copy).map(v=>v.bytes.buffer));}
   catch(error){console.error('Offline view unavailable',error);}
  };
  window.addEventListener('message',onMessage);
  frame.removeAttribute('src');frame.srcdoc=LOADER;
 };
}
