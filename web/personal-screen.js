const labels={
 mode:['Screen + controls','Écran + commandes','Screen + controls'],
 screen:['Game screen','Écran de jeu','Screen ng laro'],
 connecting:['Connecting to the game screen…','Connexion à l’écran de jeu…','Kumokonekta sa screen ng laro…'],
 waiting:['Waiting for an activity','En attente d’une activité','Naghihintay ng laro']
};
const preference='museum-personal-screen';
export function personalScreenEnabled(storage,search=''){
 const value=new URLSearchParams(search).get('view');
 if(value==='combined'||value==='controller')return value==='combined';
 try{return storage.getItem(preference)==='1';}catch{return false;}
}

// The personal display uses the existing read-only display connection. It never
// joins another player or receives the controller's private snapshot or token.
export function createPersonalScreen({toolbar,language,protocol,hello,project=s=>s,source,socketPath='/socket',onToggle=()=>{}}){
 let enabled=personalScreenEnabled(localStorage,location.search),container,panel,frame,frameUrl,
  socket,retryTimer,watchdog,attempt=0,lastMessage=0,latest,previous,ready=false,inFlight=0,
  renderAck=false,renderId=0,lastSent,draw,online=false;
 const text=key=>labels[key][{en:0,fr:1,tl:2}[language()]??0];
 const button=document.createElement('button');button.type='button';button.className='personal-screen-toggle';toolbar.append(button);
 const read=(key,fallback)=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
 const preferences=()=>({
  'museum-sound-muted-display':read('museum-personal-sound-muted','1'),
  'museum-music-muted-display':read('museum-personal-music-muted','1')
 });
 function resize(){if(!panel||!frame)return;const width=1024,height=640,scale=Math.min(panel.clientWidth/width,panel.clientHeight/height);frame.style.width=width+'px';frame.style.height=height+'px';frame.style.transform='translate(-50%, -50%) scale('+Math.max(0,scale)+')';}
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;
 addEventListener('resize',resize);
 function status(){if(!panel)return;const el=panel.querySelector('.personal-screen-status');el.textContent=text(frame?'connecting':'waiting');el.hidden=Boolean(frame&&online&&ready);}
 function sendFrame(){
  if(!enabled||!frame||!ready||!latest||inFlight)return;
  const id=++renderId;if(renderAck)inFlight=id;lastSent=latest;
  frame.contentWindow.postMessage({retroMuseum:1,type:'state',renderId:id,role:'display',state:latest,online,preferences:preferences()},'*');
 }
 function schedule(){if(draw)return;draw=requestAnimationFrame(()=>{draw=null;sendFrame();});}
 function show(state){
  const url=source(state);latest=project(state);
  if(url!==frameUrl){frame?.remove();frame=null;frameUrl=url;ready=false;inFlight=0;renderAck=false;
   if(url){frame=document.createElement('iframe');frame.title=text('screen');frame.className='personal-screen-frame';frame.setAttribute('sandbox','allow-scripts allow-modals');frame.setAttribute('allow','autoplay');frame.src=url;panel.append(frame);resize();}}
  status();schedule();
 }
 function open(){
  if(!enabled||!panel||socket&&socket.readyState<=1)return;
  clearTimeout(retryTimer);const current=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+socketPath);socket=current;previous=null;lastMessage=Date.now();
  current.onopen=()=>current.send(JSON.stringify({...hello(),type:'hello',role:'display',stream:2}));
  current.onmessage=event=>{if(socket!==current)return;lastMessage=Date.now();let m;try{m=JSON.parse(event.data);}catch{return;}
   if(m.type==='welcome'){online=true;attempt=0;status();}
   if(m.type==='state'){
    let next=m.state;const game=next.party?.tanks,old=previous?.party?.tanks;
    if(game&&!game.walls&&old?.walls&&previous.party.id===next.party.id&&old.round===game.round&&old.layoutRevision===game.layoutRevision)next={...next,party:{...next.party,tanks:{...game,walls:old.walls}}};
    previous=next;show(next);
    if(m.sequence!==undefined)current.send(JSON.stringify({type:protocol==='museum'?'stateAck':'ack',sequence:m.sequence}));
   }
  };
  current.onclose=()=>{if(socket!==current)return;online=false;status();schedule();if(enabled)retryTimer=setTimeout(open,Math.min(4000,250*2**attempt++));};current.onerror=()=>{};
 }
 function stop(){clearTimeout(retryTimer);clearInterval(watchdog);const old=socket;socket=null;old?.close();online=false;previous=null;latest=null;inFlight=0;lastSent=null;if(draw)cancelAnimationFrame(draw);draw=null;}
 function remove(){observer?.disconnect();panel?.remove();panel=null;frame=null;frameUrl=null;ready=false;container?.classList.remove('personal-screen-layout');}
 function attach(next){
  if(container===next&&Boolean(panel)===enabled)return;
  stop();remove();container=next;
  if(!enabled||!container)return;
  container.classList.add('personal-screen-layout');panel=document.createElement('section');panel.className='personal-screen-panel';panel.setAttribute('aria-label',text('screen'));
  const indicator=document.createElement('p');indicator.className='personal-screen-status';indicator.setAttribute('role','status');panel.append(indicator);container.prepend(panel);status();observer?.observe(panel);open();
  watchdog=setInterval(()=>{if(!enabled)return;if(socket?.readyState===1&&Date.now()-lastMessage>12000){const old=socket;socket=null;old.close();online=false;open();}else if(!socket||socket.readyState>1)open();},5000);
 }
 function update(){button.textContent=text('mode');button.setAttribute('aria-pressed',String(enabled));button.title=text('mode');if(frame)frame.title=text('screen');status();}
 button.onclick=()=>{enabled=!enabled;try{localStorage.setItem(preference,enabled?'1':'0');}catch{}
  const url=new URL(location.href);url.searchParams.set('view',enabled?'combined':'controller');history.replaceState(null,'',url.pathname+url.search+url.hash);
  onToggle(enabled);attach(container);update();};
 function message(event){
  if(event.source!==frame?.contentWindow||event.data?.retroMuseum!==1)return;const m=event.data;
  if(m.type==='ready'){ready=true;renderAck=m.renderAck===true;inFlight=0;status();sendFrame();}
  if(m.type==='rendered'&&m.renderId===inFlight){inFlight=0;if(latest!==lastSent)schedule();}
  if(m.type==='preference'&&['0','1'].includes(m.value)){
   const key={'museum-sound-muted-display':'museum-personal-sound-muted','museum-music-muted-display':'museum-personal-music-muted'}[m.key];if(key)try{localStorage.setItem(key,m.value);}catch{}
  }
  // Deliberately ignore actions from the public display iframe.
 }
 addEventListener('message',message);
 const wake=()=>{if(!document.hidden&&enabled){open();resize();schedule();}};document.addEventListener('visibilitychange',wake);
 update();return {attach,update,get enabled(){return enabled;},dispose(){stop();remove();button.remove();removeEventListener('message',message);removeEventListener('resize',resize);document.removeEventListener('visibilitychange',wake);}};
}
