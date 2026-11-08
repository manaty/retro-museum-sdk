// Serverless WebRTC pairing over a local Wi-Fi (for example a phone hotspot).
// No STUN/TURN or signalling server: the organiser shows an offer QR code and
// scans the player's answer QR code. Data channels carry the host protocol.
const PREFIX={offer:'o1',answer:'a1'};
const b64url=bytes=>{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const unb64url=text=>{const s=atob(text.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,c=>c.charCodeAt(0));};
async function transform(bytes,stream){const out=new Response(new Blob([bytes]).stream().pipeThrough(stream));return new Uint8Array(await out.arrayBuffer());}

// Removes attributes that are unnecessary for a data channel to keep QR codes small.
export function compactSdp(sdp){
 return sdp.split(/\r?\n/).filter(line=>line&&!/^a=(extmap-allow-mixed|msid-semantic)/.test(line)&&!(line.startsWith('a=candidate:')&&/ tcp /i.test(line))).map(line=>line.startsWith('a=candidate:')?line.replace(/ (generation|network-id|network-cost|ufrag) \S+/g,''):line).join('\r\n')+'\r\n';
}
export async function encodeSignal(kind,data){
 const json=new TextEncoder().encode(JSON.stringify(data));
 if(typeof CompressionStream==='function')return PREFIX[kind]+'z'+b64url(await transform(json,new CompressionStream('deflate-raw')));
 return PREFIX[kind]+'j'+b64url(json);
}
export async function decodeSignal(kind,text){
 const value=String(text||'').trim();
 if(!value.startsWith(PREFIX[kind])||value.length>6000)throw Error('This is not a Retro Museum '+(kind==='offer'?'invitation':'player')+' code.');
 const body=unb64url(value.slice(PREFIX[kind].length+1)),mode=value[PREFIX[kind].length];
 const json=mode==='z'?await transform(body,new DecompressionStream('deflate-raw')):mode==='j'?body:null;
 if(!json)throw Error('Unsupported code version.');
 const data=JSON.parse(new TextDecoder().decode(json));if(!data||typeof data.s!=='string')throw Error('Incomplete code.');return data;
}
function gathered(pc,timeout=4000){
 if(pc.iceGatheringState==='complete')return Promise.resolve();
 return new Promise(resolve=>{const done=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);pc.removeEventListener('icecandidate',candidate);resolve();};const check=()=>{if(pc.iceGatheringState==='complete')done();};const candidate=e=>{if(!e.candidate)done();};const timer=setTimeout(done,timeout);pc.addEventListener('icegatheringstatechange',check);pc.addEventListener('icecandidate',candidate);});
}
// RTCDataChannel adapted to the raw link interface used by link.js.
export function channelLink(pc,channel){
 const listeners=[],closers=[];let closed=false;
 const close=()=>{if(closed)return;closed=true;try{channel.close();}catch{}try{pc.close();}catch{}for(const fn of closers)fn();};
 channel.onmessage=e=>{for(const fn of listeners)fn(e.data);};channel.onclose=close;channel.onerror=()=>{};
 pc.addEventListener('connectionstatechange',()=>{if(['failed','closed'].includes(pc.connectionState))close();});
 // Disconnected may recover briefly on a busy hotspot; give up after a grace period.
 let lost=null;pc.addEventListener('iceconnectionstatechange',()=>{clearTimeout(lost);if(pc.iceConnectionState==='disconnected')lost=setTimeout(close,15000);if(pc.iceConnectionState==='failed')close();});
 // Flow control: browsers close a channel whose send buffer overflows (large packages).
 const queue=[];channel.bufferedAmountLowThreshold=256*1024;
 const flush=()=>{while(queue.length&&!closed&&channel.readyState==='open'&&channel.bufferedAmount<1024*1024)channel.send(queue.shift());};
 channel.onbufferedamountlow=flush;
 return {send(text){if(closed||channel.readyState!=='open')return;if(queue.length||channel.bufferedAmount>=1024*1024)queue.push(text);else channel.send(text);flush();},onmessage(fn){listeners.push(fn);},onclose(fn){if(closed)fn();else closers.push(fn);},close,buffered(){return (channel.bufferedAmount||0)+queue.length*15000;}};
}
const opened=(channel,timeout)=>new Promise((resolve,reject)=>{if(channel.readyState==='open')return resolve();const timer=setTimeout(()=>reject(Error('The player could not connect. Check that both devices use the same Wi-Fi, then try again.')),timeout);channel.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});});

// Organiser side: one offer per invitation code.
export async function createOffer({room}){
 const id=Array.from(crypto.getRandomValues(new Uint8Array(4)),b=>b.toString(16).padStart(2,'0')).join('');
 const pc=new RTCPeerConnection({iceServers:[]}),channel=pc.createDataChannel('retro-museum',{ordered:true});
 await pc.setLocalDescription(await pc.createOffer());await gathered(pc);
 const code=await encodeSignal('offer',{v:1,r:room,o:id,s:compactSdp(pc.localDescription.sdp)});
 return {id,code,pc,
  async accept(answer){if(answer.o!==id)throw Error('This player code belongs to another invitation.');await pc.setRemoteDescription({type:'answer',sdp:answer.s});await opened(channel,20000);return channelLink(pc,channel);},
  cancel(){try{pc.close();}catch{}}};
}
// Player side: answer an organiser's offer and wait until the organiser scans it.
export async function answerOffer(offer){
 const pc=new RTCPeerConnection({iceServers:[]});
 const channel=new Promise(resolve=>pc.addEventListener('datachannel',e=>resolve(e.channel),{once:true}));
 await pc.setRemoteDescription({type:'offer',sdp:offer.s});await pc.setLocalDescription(await pc.createAnswer());await gathered(pc);
 const code=await encodeSignal('answer',{v:1,o:offer.o,s:compactSdp(pc.localDescription.sdp)});
 return {code,pc,async connected(timeout=180000){const ch=await Promise.race([channel,new Promise((_,reject)=>setTimeout(()=>reject(Error('Not connected yet. Ask the organiser to scan your code again.')),timeout))]);await opened(ch,timeout);return channelLink(pc,ch);},cancel(){try{pc.close();}catch{}}};
}
