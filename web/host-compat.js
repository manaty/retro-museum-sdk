// Keep this file ES5-compatible: it runs before the application on TV browsers.
(function () {
  if(typeof window.globalThis==='undefined')window.globalThis=window;
  if(window.museumCompatibilityLoaded)return;window.museumCompatibilityLoaded=true;
  function method(object, name, value) { if (!object[name]) Object.defineProperty(object,name,{value:value,configurable:true,writable:true}); }
  method(Array.prototype,'at',function(index){index=Math.trunc(index)||0;return this[index<0?this.length+index:index];});
  method(Array.prototype,'flat',function(depth){depth=depth===undefined?1:Number(depth);return depth>0?this.reduce(function(out,item){return out.concat(Array.isArray(item)?item.flat(depth-1):item);},[]):this.slice();});
  method(Array.prototype,'flatMap',function(fn,thisArg){return this.map(fn,thisArg).flat();});
  method(Object,'fromEntries',function(entries){var result={};Array.from(entries).forEach(function(entry){Object.defineProperty(result,entry[0],{value:entry[1],enumerable:true,configurable:true,writable:true});});return result;});
  method(Object,'hasOwn',function(object,key){return Object.prototype.hasOwnProperty.call(object,key);});
  if(!window.structuredClone)window.structuredClone=function(value){return JSON.parse(JSON.stringify(value));};
  var app;
  function report(message){
    app=document.getElementById('app');
    if(app && app.querySelector('.loading')) {app.textContent='Le navigateur n’a pas pu démarrer le musée : '+message;app.style.padding='30px';}
    try{var request=new XMLHttpRequest();request.open('POST','/api/browser/report');request.setRequestHeader('Content-Type','application/json');request.send(JSON.stringify({message:String(message).slice(0,500),agent:navigator.userAgent,path:location.pathname}));}catch(ignore){}
  }
  window.museumReport=report;
  try{var startup=new XMLHttpRequest();startup.open('POST','/api/browser/report');startup.setRequestHeader('Content-Type','application/json');startup.send(JSON.stringify({message:'Page ouverte',agent:navigator.userAgent,path:location.pathname}));}catch(ignore){}
  window.addEventListener('error',function(event){report(event.message||'Chargement d’un fichier impossible.');});
  window.addEventListener('unhandledrejection',function(event){report(String(event.reason&&event.reason.message||event.reason||'Erreur au démarrage.'));});
  setTimeout(function(){app=document.getElementById('app');if(app&&app.querySelector('.loading'))report('Connexion trop longue. Rechargez cette page.');},15000);
})();
