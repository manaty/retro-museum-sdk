// In-browser room host for offline play. It speaks the same HTTP and socket
// protocol as host.js so the standard client UI runs unchanged; requests arrive
// from this page, other tabs (BroadcastChannel) or players' phones (WebRTC).
// The organiser's device is the trusted authority: credentials stay in its
// IndexedDB and never leave it except to the player they belong to.
const LANGUAGES=['en','fr','tl'];
export const OFFLINE_ROOM_RETENTION_MS=24*3600000;
const validId=id=>typeof id==='string'&&/^[a-z0-9]{12}$/.test(id);
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const defaultRandom=n=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return a;};

// Avatars are omitted offline: snapshots travel over a local radio link.
export function offlineProfile(value){
 if(!value||typeof value.name!=='string'||value.name.length>32||/[\x00-\x1f\x7f]/.test(value.name))throw Error('Invalid player name (32 characters maximum).');
 const profile={name:value.name.trim(),avatar:null};
 if(value.chessElo!==undefined){if(!Number.isInteger(value.chessElo)||value.chessElo<0||value.chessElo>4000)throw Error('Invalid Chess Elo');profile.chessElo=value.chessElo;}
 return profile;
}

export function createLocalHost({Party,definitionForGame,definitionForHash,packageSource=async()=>null,store,clock=Date.now,random=defaultRandom,origin='',basePath='',playerCapacity=128,onChange=()=>{}}){
 const rooms=new Map(),sockets=new Set();let timer=null;
 const token=()=>hex(random(24)),newId=()=>hex(random(6));
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
 const serialize=room=>({id:room.id,game:room.game,packageHash:room.definition.hash,hostToken:room.hostToken,members:room.members,language:room.language,createdAt:room.createdAt,updatedAt:room.updatedAt,party:room.party.save()});
 function persist(room){const saved=serialize(room);room.saving=(room.saving||Promise.resolve()).catch(()=>{}).then(()=>store?.put(saved));room.saving.catch(error=>console.error('Offline room save failed',error));onChange();return room.saving;}
 const joinUrl=room=>origin+basePath+'/j/'+room.id+'?offline=1';
 const members=room=>Object.values(room.members);
 function syncProfiles(room){for(const member of members(room)){const player=room.party.players.find(p=>p.id===member.id);if(player)Object.assign(player,member.profile);}}

 async function restore(){
  if(!store)return;
  for(const saved of await store.list()){
   if(!validId(saved.id))continue;
   if(clock()-(saved.updatedAt||0)>OFFLINE_ROOM_RETENTION_MS){await store.delete(saved.id);continue;}
   try{const definition=await definitionForHash(saved.packageHash);if(!definition)throw Error('Game package is not on this device');
    const room={...saved,definition,party:new Party({definition,clock,saved:saved.party})};room.party.language=room.language;syncProfiles(room);rooms.set(room.id,room);}
   catch(error){console.error('Offline room restore failed',saved.id,error.message);}
  }
 }

 async function createRoom(input){
  if(rooms.size>=8)fail('Too many offline games on this device. Finish one first.',503);
  const definition=await definitionForGame(input.game);if(!definition)fail('This game is not available offline on this device. Download it while online.');
  const id=newId(),hostToken=token(),now=clock();
  const room={id,game:definition.pack.manifest.id,definition,hostToken,members:{},language:LANGUAGES.includes(input.language)?input.language:'en',createdAt:now,updatedAt:now,party:new Party({definition,clock})};
  try{room.party.language=room.language;if(input.options!==undefined||input.autoStartWhenFull!==undefined||input.bots!==undefined)room.party.configure(input);}catch(error){room.party.dispose();throw error;}
  rooms.set(id,room);await persist(room);
  return {id,hostToken,displayUrl:origin+basePath+'/r/'+id,joinUrl:joinUrl(room),offline:true};
 }

 // request({method,path,token,body}) → {status,body}
 async function request({method='GET',path,token:bearer,body}){
  try{
   if(path==='/api/rooms'&&method==='POST')return {status:201,body:await createRoom(body||{})};
   const pack=/^\/packages\/([a-f0-9]{64})\/package\.json$/.exec(path);
   if(pack&&method==='GET'){if(![...rooms.values()].some(room=>room.definition.hash===pack[1]))return {status:404,body:{error:'Unknown version'}};const text=await packageSource(pack[1]);return text===null?{status:404,body:{error:'Unknown version'}}:{status:200,text};}
   const api=/^\/api\/rooms\/([a-z0-9]{12})(?:\/(join|control|profile|qr|handoff|redeem))?$/.exec(path);
   if(!api)return {status:404,body:{error:'Not available offline'}};
   const room=rooms.get(api[1]);if(!room)return {status:404,body:{error:'This offline game is no longer on the organiser’s device.'}};
   if(method==='GET'&&!api[2])return {status:200,body:{id:room.id,game:room.definition.pack.manifest,hash:room.definition.hash,language:room.language,bots:room.party.players.filter(p=>p.bot).map(({id,difficulty})=>({id,difficulty})),joinUrl:joinUrl(room),offline:true}};
   if(['qr','handoff','redeem'].includes(api[2]))return {status:501,body:{error:'Not available offline. Pair the other device with the organiser instead.'}};
   if(method!=='POST')return {status:405,body:{error:'Method not allowed'}};
   if(api[2]==='join'){
    const input=body||{};let credential=input.token,member=typeof credential==='string'?room.members[credential]:null;
    if(credential&&!member)return {status:401,body:{error:'Invalid player session'}};
    if(!member){if(Object.keys(room.members).length>=(room.definition.pack.manifest.players.max===null?playerCapacity:32))return {status:409,body:{error:'Room is full'}};credential=token();member={id:hex(random(16)),profile:offlineProfile(input.profile||{name:''})};room.members[credential]=member;}
    else if(input.profile)member.profile=offlineProfile({...input.profile,...(member.profile.chessElo===undefined?{}:{chessElo:member.profile.chessElo})});
    room.updatedAt=clock();await persist(room);return {status:200,body:{token:credential,playerId:member.id,chessElo:member.profile.chessElo}};
   }
   if(api[2]==='profile'){
    const member=typeof bearer==='string'&&room.members[bearer];if(!member)return {status:401,body:{error:'Invalid player session'}};
    member.profile=offlineProfile({...body,...(member.profile.chessElo===undefined?{}:{chessElo:member.profile.chessElo})});syncProfiles(room);await persist(room);return {status:200,body:{ok:true}};
   }
   if(api[2]==='control'){
    if(typeof bearer!=='string'||bearer!==room.hostToken)return {status:403,body:{error:'Only the room organiser can do this.'}};
    const command=body||{};room.party.language=room.language;
    if(command.action==='language'){if(!LANGUAGES.includes(command.value))throw Error('Invalid language');room.language=command.value;}
    else if(command.action==='configure')room.party.configure(command);else room.party.admin(command.action,command.options);
    room.party.language=room.language;room.updatedAt=clock();await persist(room);return {status:200,body:{ok:true}};
   }
   return {status:405,body:{error:'Method not allowed'}};
  }catch(error){return {status:error.status||400,body:{error:String(error.message).slice(0,180)}};}
 }

 // connect(peer) where peer={send(text),close(code,reason),buffered()} → {receive(text),closed()}
 function connect(peer){
  let client=null;const entry={peer,client:null,lastSent:0,sequence:0,pending:null,ackAt:null};
  const send=value=>peer.send(JSON.stringify(value));
  const deadline=setTimeout(()=>{if(!client)peer.close(4001,'Authentication required');},7000);
  sockets.add(entry);
  return {
   receive(text){let message;try{
    message=JSON.parse(text);
    if(!client){
     if(message.type!=='hello'||!validId(message.room)||!['display','controller'].includes(message.role))throw Error('Invalid connection');
     const room=rooms.get(message.room);if(!room){send({type:'roomExpired'});peer.close(4004,'Room expired');return;}
     const member=message.role==='controller'&&typeof message.token==='string'?room.members[message.token]:null;if(message.role==='controller'&&!member)throw Error('Invalid player session');
     const organiser=message.role==='display'&&typeof message.hostToken==='string'&&message.hostToken===room.hostToken;
     if(member){room.party.language=room.language;room.party.join(member.id,member.profile);}
     client={room,organiser,role:message.role,id:member?.id,language:LANGUAGES.includes(message.language)?message.language:'en'};entry.client=client;clearTimeout(deadline);
     if(member)for(const other of sockets)if(other!==entry&&other.client?.room===room&&other.client.id===member.id){sockets.delete(other);other.peer.close(4003,'Opened on another tab');}
     if(member||organiser){room.updatedAt=clock();persist(room);}send({type:'welcome'});return;
    }
    if(message.type==='resync')return;
    if(message.type==='ack'){if(message.sequence===entry.pending){entry.pending=null;entry.ackAt=null;}return;}
    if(message.type==='language'){if(LANGUAGES.includes(message.value))client.language=message.value;return;}
    if(message.type!=='command'||client.role!=='controller'||typeof message.id!=='string'||message.id.length>100)throw Error('Invalid command');
    const party=client.room.party;
    if(message.action==='zxStart'&&client.room.game==='zx80'){party.language=client.room.language;party.admin('start');}
    else if(message.action==='playAgain'){party.admin('playAgain');if(party.canStart)party.admin('start',party.options);}
    else party.command(client.id,message);
    client.room.updatedAt=clock();send({type:'ack',id:message.id});
   }catch(error){send({type:'error',id:typeof message?.id==='string'?message.id.slice(0,100):undefined,code:String(error.message),message:String(error.message).slice(0,160)});if(!client)peer.close(4001,'Invalid connection');}},
   closed(){
    clearTimeout(deadline);if(!sockets.delete(entry)||!client)return;
    if(client.id&&![...sockets].some(s=>s.client?.room===client.room&&s.client.id===client.id))client.room.party.leave(client.id);
    persist(client.room);
   }
  };
 }

 function tick(){
  const now=clock();
  for(const room of rooms.values()){
   try{room.party.tick();}catch(error){console.error('Offline game tick failed',error);}
   if(room.game==='chess'&&['solved','ended'].includes(room.party.phase))for(const member of members(room)){const player=room.party.players.find(p=>p.id===member.id);if(player?.chessElo!==undefined)member.profile.chessElo=player.chessElo;}
  }
  for(const entry of sockets){
   const c=entry.client;if(!c)continue;
   if(entry.pending){if(now-entry.ackAt>5000){sockets.delete(entry);entry.peer.close(4000,'No acknowledgement');if(c.id&&![...sockets].some(s=>s.client?.room===c.room&&s.client.id===c.id))c.room.party.leave(c.id);}continue;}
   if(now-entry.lastSent<(c.room.definition.pack.manifest.players.max===null?500:c.role==='display'?50:100)||entry.peer.buffered()>65536)continue;
   try{const p=c.room.party.snapshot(c.id);const state={party:p,phase:p.phase,remainingMs:p.remainingMs,durationMs:c.room.definition.pack.manifest.durationMinutes*60000,introRemainingMs:p.introRemainingMs,language:c.role==='controller'?c.language:c.room.language,station:'1',room:'1',sessionId:p.id};entry.sequence++;entry.pending=entry.sequence;entry.ackAt=now;entry.lastSent=now;entry.peer.send(JSON.stringify({type:'state',sequence:entry.sequence,state}));}
   catch(error){entry.peer.send(JSON.stringify({type:'error',message:'This game could not render its state.'}));}
  }
 }
 let checkpoint=null;
 return {rooms,restore,request,connect,tick,
  start(){if(!timer){timer=setInterval(tick,25);checkpoint=setInterval(()=>{for(const room of rooms.values())persist(room);},15000);}},
  async stop(){clearInterval(timer);clearInterval(checkpoint);timer=null;for(const entry of sockets)entry.peer.close(1001,'Host closing');sockets.clear();await Promise.all([...rooms.values()].map(persist));for(const room of rooms.values())room.party.dispose();},
  async remove(id){const room=rooms.get(id);if(!room)return;rooms.delete(id);for(const entry of [...sockets])if(entry.client?.room===room){sockets.delete(entry);entry.peer.send(JSON.stringify({type:'roomExpired'}));entry.peer.close(4004,'Room expired');}room.party.dispose();await store?.delete(id);onChange();},
  summary(){return [...rooms.values()].map(room=>({id:room.id,game:room.game,title:room.definition.pack.manifest.title,phase:room.party.phase,players:room.party.players.filter(p=>p.connected&&!p.bot).length,updatedAt:room.updatedAt}));}
 };
}
