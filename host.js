import{StateEncoder}from'./state-delta.js';
import http from 'node:http';
import {readFile,mkdir,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import QRCode from 'qrcode';
import {parsePackage,digest} from './manifest.js';
import {RoomParty} from './room-party.js';
import {validateProfile} from './profile.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const matches=(value,expected)=>typeof value==='string'&&typeof expected==='string'&&timingSafeEqual(Buffer.from(hash(value)),Buffer.from(expected));
const validId=id=>typeof id==='string'&&/^[a-z0-9]{12}$/.test(id);
const here=dirname(fileURLToPath(import.meta.url));
const mime={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8'};

export async function loadGame(path,{createEngine}={}){const bytes=await readFile(path);return {pack:parsePackage(bytes,{allowNative:typeof createEngine==='function'}),source:bytes.toString('utf8'),hash:digest(bytes),createEngine};}
export function fileRoomStore(directory){
 const packagePath=id=>{if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid package hash');return resolve(directory,'packages',id+'.json');};
 return {
 async list(){await mkdir(directory,{recursive:true});const result=[];for(const name of await readdir(directory)){if(!/^[a-z0-9]{12}\.json$/.test(name))continue;try{result.push(JSON.parse(await readFile(resolve(directory,name),'utf8')));}catch{}}return result;},
 async put(room){if(!validId(room.id))throw Error('Invalid room ID');await mkdir(directory,{recursive:true});const path=resolve(directory,room.id+'.json');await writeFile(path+'.tmp',JSON.stringify(room),{mode:0o600});await rename(path+'.tmp',path);},
 async putPackage(id,source){const path=packagePath(id);if(digest(source)!==id)throw Error('Package integrity mismatch');await mkdir(dirname(path),{recursive:true});try{await writeFile(path,source,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}},
 async getPackage(id){return readFile(packagePath(id),'utf8');},
 async delete(id){if(!validId(id))throw Error('Invalid room ID');try{await unlink(resolve(directory,id+'.json'));}catch(error){if(error.code!=='ENOENT')throw error;}} 
 };}

export async function createGameHost({definitions,store,publicOrigin,allowedOrigins=[],basePath='',invitationOrigin,refreshGames,clock=Date.now,maxRooms=32,playerCapacity=128}={}){
 if(basePath&&!/^\/[a-z][a-z0-9-]*$/.test(basePath))throw Error('Invalid host base path');
 if(!Number.isInteger(playerCapacity)||playerCapacity<1||playerCapacity>1000)throw Error('Invalid host player capacity');for(const d of definitions)d.playerCapacity=playerCapacity;
 const games=new Map(definitions.map(d=>[d.pack.manifest.id,d])),packages=new Map(definitions.map(d=>[d.hash,d])),rooms=new Map(),clients=new Map(),avatars=new Map(),limits=new Map();let closing=false;
 const EMPTY_RELEASE_MS=30000,EMPTY_RETENTION_MS=600000;
 const pendingDeletes=new Set();
 const activeCount=()=>[...rooms.values()].filter(room=>room.party).length;
 const connectedPlayers=room=>[...clients.values()].filter(c=>c.room===room&&c.role==='controller').length;
 const pruneAvatars=()=>{const used=new Set();for(const room of rooms.values())for(const member of Object.values(room.members))if(member.profile?.avatar)used.add(hash(member.profile.avatar));for(const id of avatars.keys())if(!used.has(id))avatars.delete(id);};
 const prunePackages=()=>{const used=new Set([...games.values(),...[...rooms.values()].map(room=>room.definition)].map(d=>d.hash));for(const id of packages.keys())if(!used.has(id))packages.delete(id);};
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const rate=(key,max=30,period=60000)=>{const now=clock(),old=limits.get(key);const value=!old||old.until<now?{n:0,until:now+period}:old;value.n++;limits.set(key,value);return value.n<=max;};
 const serialize=room=>({id:room.id,game:room.game,packageHash:room.definition.hash,hostHash:room.hostHash,members:room.members,language:room.language,updatedAt:room.updatedAt,emptySince:room.emptySince,party:room.party?room.party.save():room.savedParty});
 const persist=room=>{if(room.expired)return room.saving;const saved=serialize(room);room.saving=(room.saving||Promise.resolve()).catch(()=>{}).then(()=>store?.put(saved));return room.saving;};
 function archive(room){
  if(!room.party)return;
  if(['playing','intro'].includes(room.party.phase)){room.party.admin('pause');room.party.reason='roomEmpty';}
  room.savedParty=room.party.save();room.party.dispose();room.party=null;
  for(const c of clients.values())if(c.room===room){c.lastSent=-Infinity;c.pending=null;c.ackAt=null;}
  persist(room)?.catch(console.error);
 }
 function expire(room){
  room.expired=true;rooms.delete(room.id);room.party?.dispose();room.party=null;room.savedParty=null;pruneAvatars();
  for(const [ws,c] of clients)if(c.room===room){clients.delete(ws);send(ws,{type:'roomExpired'});ws.close(4004,'Room expired');}
  room.saving=(room.saving||Promise.resolve()).catch(()=>{}).then(()=>store?.delete?.(room.id));pendingDeletes.add(room.saving);room.saving.then(()=>pendingDeletes.delete(room.saving),error=>{pendingDeletes.delete(room.saving);console.error(error);});
 }
 function maintainRooms(){
  for(const room of rooms.values()){
   if(room.emptySince===null)continue;
   const age=clock()-room.emptySince;
   if(age>=EMPTY_RETENTION_MS)expire(room);else if(age>=EMPTY_RELEASE_MS)archive(room);
  }
 }
 function activate(room){
  if(room.party)return;
  if(activeCount()>=maxRooms)throw Error('roomsBusy');
  room.party=new RoomParty({definition:room.definition,clock,saved:room.savedParty});room.savedParty=null;
  // Only a successfully authenticated controller cancels the absence deadline.
 }

 function publicProfile(value){const p=validateProfile(value);if(!p.avatar)return p;const id=hash(p.avatar);avatars.set(id,Buffer.from(p.avatar.split(',')[1],'base64'));return {...p,avatar:basePath+'/avatars/'+id+'.jpg'};}
 if(store?.putPackage)await Promise.all(definitions.map(d=>store.putPackage(d.hash,d.source||JSON.stringify(d.pack))));
 if(store)for(const saved of await store.list()){
  if(!validId(saved.id))continue;
  const emptySince=Number.isFinite(saved.emptySince)?saved.emptySince:saved.emptySince===null||saved.party?.players?.some(p=>p.connected)?clock():saved.updatedAt;
  if(!Number.isFinite(emptySince)||clock()-emptySince>=EMPTY_RETENTION_MS){await store.delete?.(saved.id);continue;}
  let definition=packages.get(saved.packageHash);const current=games.get(saved.game);
  if(!definition&&store.getPackage){try{const source=await store.getPackage(saved.packageHash);if(digest(source)!==saved.packageHash)throw Error('Package integrity mismatch');definition={pack:parsePackage(source,{allowNative:Boolean(current?.createEngine)}),source,hash:saved.packageHash,playerCapacity,createEngine:current?.createEngine};packages.set(definition.hash,definition);}catch(error){console.error('Pinned package restore failed',saved.id,error.message);}}
  if(!definition)continue;
  try{const archived=clock()-emptySince>=EMPTY_RELEASE_MS||activeCount()>=maxRooms;const room={...saved,emptySince,definition,party:archived?null:new RoomParty({definition,clock,saved:saved.party}),savedParty:archived?saved.party:null};for(const member of Object.values(room.members)){const player=(room.party?.players||room.savedParty.players).find(p=>p.id===member.id);if(player)Object.assign(player,publicProfile(member.profile));}rooms.set(room.id,room);}catch(error){console.error('Room restore failed',saved.id,error.message);}
 }
 const origins=[publicOrigin,...allowedOrigins].filter(Boolean).map(value=>new URL(value).origin);
 // Keep invitations on the visitor's recognised hostname during a domain migration.
 const origin=req=>origins.find(value=>new URL(value).host===req.headers.host)||publicOrigin||`http://${req.headers.host}`;
 const inviteOrigin=req=>invitationOrigin?new URL(invitationOrigin).origin:origin(req);
 function permitted(req){return !req.headers.origin||req.headers.origin===origin(req);}
 const body=async req=>{let size=0,text='';for await(const chunk of req){size+=chunk.length;if(size>40000)throw Error('Request too large');text+=chunk;}return JSON.parse(text||'{}');};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const url=new URL(req.url,'http://host');if(basePath&&url.pathname!==basePath&&!url.pathname.startsWith(basePath+'/'))return json(res,404,{error:'Not found'});const path=url.pathname.slice(basePath.length)||'/';maintainRooms();
   if(req.method==='POST'&&!permitted(req))return json(res,403,{error:'Invalid origin'});
   if(path==='/health')return json(res,200,{ok:true,rooms:activeCount(),savedRooms:rooms.size-activeCount(),connectedPlayers:[...clients.values()].filter(c=>c.role==='controller').length,playingRooms:[...rooms.values()].filter(r=>r.party&&['playing','intro'].includes(r.party.phase)).length,games:[...games.keys()]});
   if(path==='/api/games'){const requested=url.searchParams.get('game');if(requested&&!games.has(requested))await refreshGames?.();else Promise.resolve(refreshGames?.()).catch(()=>{});return json(res,200,[...games.values()].map(d=>({...d.pack.manifest,hash:d.hash})));}
   if(path==='/api/rooms'&&req.method==='POST'){
    if(!rate('create:'+req.socket.remoteAddress,10))return json(res,429,{error:'Please wait before creating another room.'});
    if(activeCount()>=maxRooms)return json(res,503,{error:'All rooms are busy. Please try again shortly.'});
    const input=await body(req);if(!games.has(input.game))await refreshGames?.();const definition=games.get(input.game);if(!definition)return json(res,400,{error:'Unknown game'});
    maintainRooms();if(activeCount()>=maxRooms)return json(res,503,{error:'All rooms are busy. Please try again shortly.'});
    const id=randomBytes(6).toString('hex'),hostToken=token(),room={id,game:input.game,definition,hostHash:hash(hostToken),members:{},language:['en','fr','tl'].includes(input.language)?input.language:'en',updatedAt:clock(),emptySince:clock(),party:new RoomParty({definition,clock})};
    room.party.language=room.language;if(input.options!==undefined||input.autoStartWhenFull!==undefined)room.party.configure(input);rooms.set(id,room);await persist(room);return json(res,201,{id,hostToken,displayUrl:inviteOrigin(req)+basePath+'/r/'+id,joinUrl:inviteOrigin(req)+basePath+'/j/'+id});
   }
   const api=/^\/api\/rooms\/([a-z0-9]{12})(?:\/(join|control|profile|qr))?$/.exec(path);
   if(api){
    const room=rooms.get(api[1]);if(!room)return json(res,404,{error:'This room is no longer available. Create a new room.'});
    if(req.method==='GET'&&!api[2])return json(res,200,{id:room.id,game:room.definition.pack.manifest,hash:room.definition.hash,language:room.language,joinUrl:inviteOrigin(req)+basePath+'/j/'+room.id});
    if(req.method==='GET'&&api[2]==='qr'){res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private,max-age=60'});return res.end(await QRCode.toBuffer(inviteOrigin(req)+basePath+'/j/'+room.id,{width:220,margin:2}));}
    if(req.method==='POST'&&api[2]==='join'){
     if(!rate('join:'+room.id+':'+req.socket.remoteAddress,room.definition.pack.manifest.players.max===null?playerCapacity*2:40))return json(res,429,{error:'Please wait and retry.'});
     const input=await body(req);let credential=input.token,member=credential&&room.members[hash(credential)];
     if(credential&&!member)return json(res,401,{error:'Invalid player session'});
     if(!member){if(Object.keys(room.members).length>=(room.definition.pack.manifest.players.max===null?playerCapacity:32))return json(res,409,{error:'Room is full'});credential=token();member={id:randomBytes(16).toString('hex'),profile:validateProfile(input.profile||{name:'',avatar:null})};room.members[hash(credential)]=member;}
     else if(input.profile)member.profile=validateProfile({...input.profile,...(member.profile.chessElo===undefined?{}:{chessElo:member.profile.chessElo})});
     // Joining is completed by the authenticated socket so abandoned forms don't occupy seats.
     room.updatedAt=clock();await persist(room);return json(res,200,{token:credential,playerId:member.id,chessElo:member.profile.chessElo});
    }
    const bearer=req.headers.authorization?.replace(/^Bearer /,'');
    if(req.method==='POST'&&api[2]==='profile'){
     const member=bearer&&room.members[hash(bearer)];if(!member)return json(res,401,{error:'Invalid player session'});member.profile=validateProfile({...await body(req),...(member.profile.chessElo===undefined?{}:{chessElo:member.profile.chessElo})});const player=(room.party?.players||room.savedParty.players).find(p=>p.id===member.id);if(player)Object.assign(player,publicProfile(member.profile));await persist(room);return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&api[2]==='control'){
     if(!matches(bearer,room.hostHash))return json(res,403,{error:'Only the room organiser can do this.'});
     const command=await body(req);if(!room.party)return json(res,409,{error:'A player must reconnect before this room can resume.'});room.party.language=room.language;if(command.action==='language'){if(!['en','fr','tl'].includes(command.value))throw Error('Invalid language');room.language=command.value;}else if(command.action==='configure')room.party.configure(command);else room.party.admin(command.action,command.options);
    room.party.language=room.language;room.updatedAt=clock();await persist(room);return json(res,200,{ok:true});
    }
    return json(res,405,{error:'Method not allowed'});
   }
   const packPath=/^\/packages\/([a-f0-9]{64})\/(view|assets\/(.+))$/.exec(path);
   if(packPath){const definition=packages.get(packPath[1]);if(!definition)return json(res,404,{error:'Unknown version'});
    res.setHeader('Cache-Control','public,max-age=31536000,immutable');
    if(packPath[2]==='view'){
     const csp="sandbox allow-scripts allow-modals; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'";
     res.setHeader('Content-Security-Policy',csp);res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(definition.pack.view);
    }
    const asset=definition.pack.assets[packPath[3]];if(!asset)return json(res,404,{error:'Unknown asset'});res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type',asset.type);return res.end(Buffer.from(asset.data,'base64'));
   }
   const avatar=/^\/avatars\/([a-f0-9]{64})\.jpg$/.exec(path);if(avatar){if(!avatars.has(avatar[1]))return json(res,404,{error:'Unknown avatar'});res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'public,max-age=31536000,immutable'});return res.end(avatars.get(avatar[1]));}
   const staticFile={'/host.js':'host-client.js','/host.css':'host.css','/compat.js':'host-compat.js','/personal-screen.css':'personal-screen.css'}[path];
   if(staticFile){const ext=path.slice(path.lastIndexOf('.'));res.writeHead(200,{'Content-Type':mime[ext],'Cache-Control':'no-cache'});return res.end(await readFile(resolve(here,'web',staticFile)));}
   if(req.method==='GET'&&(path==='/'||/^\/(g\/[a-z0-9-]+|[rj]\/[a-z0-9]{12})$/.test(path))){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});const html=await readFile(resolve(here,'web/index.html'),'utf8');return res.end(html.replace('<head>','<head><meta name="museum-base" content="'+basePath+'">').replace(/(href|src)="\//g,'$1="'+basePath+'/'));}
   return json(res,404,{error:'Not found'});
  }catch(error){return json(res,400,{error:String(error.message).slice(0,180)});}
 });
 const wss=new WebSocketServer({noServer:true,maxPayload:40000});
 server.on('upgrade',(req,socket,head)=>{if(req.url!==basePath+'/socket'||!permitted(req)||clients.size>=1000){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));});
 const send=(ws,value)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value));};
 wss.on('connection',(ws,req)=>{
  let client;const deadline=setTimeout(()=>{if(!client)ws.close(4001,'Authentication required');},7000);ws.on('error',()=>{});
  ws.on('message',async bytes=>{try{
   const message=JSON.parse(bytes.toString());
   if(!client){if(message.type!=='hello'||!validId(message.room)||!['display','controller'].includes(message.role))throw Error('Invalid connection');maintainRooms();const room=rooms.get(message.room);if(!room){send(ws,{type:'roomExpired'});ws.close(4004,'Room expired');return;}
    const member=message.role==='controller'&&typeof message.token==='string'?room.members[hash(message.token)]:null;if(message.role==='controller'&&!member)throw Error('Invalid player session');
    if(member){activate(room);room.party.language=room.language;room.party.join(member.id,publicProfile(member.profile));room.emptySince=null;}
    client={room,role:message.role,id:member?.id,language:['en','fr','tl'].includes(message.language)?message.language:'en',lastSent:0,sequence:0,alive:true,encoder:message.stateDeltas===1&&room.game==='serpents'?new StateEncoder:null};clients.set(ws,client);clearTimeout(deadline);
    if(member){for(const [other,c] of clients)if(other!==ws&&c.room===room&&c.id===member.id){clients.delete(other);other.close(4003,'Opened on another tab');}}
    if(member){room.updatedAt=clock();persist(room)?.catch(console.error);}send(ws,{type:'welcome'});return;
   }
   if(message.type==='resync'&&client.encoder){if(!rate('resync:'+client.id+':'+client.room.id,4,1000))return;client.encoder.reset();client.pending=null;client.ackAt=null;client.lastSent=-Infinity;return;}
   if(message.type==='ack'){if(message.sequence===client.pending){client.encoder?.acknowledge(message.sequence);client.pending=null;client.ackAt=null;}return;}
   if(message.type==='language'){if(['en','fr','tl'].includes(message.value))client.language=message.value;return;}
   if(message.type!=='command'||client.role!=='controller'||typeof message.id!=='string'||message.id.length>100||!rate('command:'+client.id,160,1000))throw Error('Invalid command');
   if(message.action==='zxStart'&&client.room.game==='zx80'){client.room.party.language=client.room.language;client.room.party.admin('start');}
   else if(message.action==='playAgain'){client.room.party.admin('playAgain');if(client.room.party.canStart)client.room.party.admin('start',client.room.party.options);}
   else client.room.party.command(client.id,message);
   client.room.updatedAt=clock();send(ws,{type:'ack',id:message.id});
  }catch(error){send(ws,{type:'error',id:safeMessageId(bytes),code:String(error.message),message:String(error.message).slice(0,160)});if(!client)ws.close(4001,'Invalid connection');}});
  ws.on('pong',()=>{if(client){client.alive=true;if(client.role==='controller')client.room.updatedAt=clock();};});
  ws.on('close',()=>{clearTimeout(deadline);if(!clients.has(ws))return;clients.delete(ws);if(client.id&&!Array.from(clients.values()).some(c=>c.room===client.room&&c.id===client.id))client.room.party?.leave(client.id);if(client.role==='controller'&&!connectedPlayers(client.room)&&client.room.emptySince===null)client.room.emptySince=clock();if(!closing)persist(client.room)?.catch(console.error);});
 });
 const ticker=setInterval(()=>{
  maintainRooms();for(const room of rooms.values()){room.party?.tick();if(room.game==='chess'&&room.party&&['solved','ended'].includes(room.party.phase))for(const member of Object.values(room.members)){const player=room.party.players.find(p=>p.id===member.id);if(player?.chessElo!==undefined)member.profile.chessElo=player.chessElo;}}const now=clock();
  for(const [ws,c] of clients){
   if(!c.room.party){if(now-c.lastSent>=1000){c.pending=null;c.ackAt=null;c.lastSent=now;send(ws,{type:'roomSleeping',expiresAt:c.room.emptySince+EMPTY_RETENTION_MS});}continue;}
   if(c.pending){if(now-c.ackAt>5000)ws.terminate();continue;}
   if(now-c.lastSent<(c.room.definition.pack.manifest.players.max===null?500:c.role==='display'?50:100)||ws.bufferedAmount>65536)continue;
   try{const p=c.room.party.snapshot(c.id);const state={party:p,phase:p.phase,remainingMs:p.remainingMs,durationMs:c.room.definition.pack.manifest.durationMinutes*60000,introRemainingMs:p.introRemainingMs,language:c.role==='controller'?c.language:c.room.language,station:'1',room:'1',sessionId:p.id};c.sequence++;c.pending=c.sequence;c.ackAt=now;c.lastSent=now;if(c.encoder){if(ws.readyState===WebSocket.OPEN)ws.send(c.encoder.encode(state,c.sequence));}else send(ws,{type:'state',sequence:c.sequence,state});}catch(error){send(ws,{type:'error',message:'This game could not render its state.'});}
  }
 },25);
 const heartbeat=setInterval(()=>{for(const [ws,c] of clients){if(!c.alive){ws.terminate();continue;}c.alive=false;ws.ping();}for(const [key,value] of limits)if(value.until<clock())limits.delete(key);},10000);
 const checkpoints=setInterval(()=>{maintainRooms();for(const room of rooms.values())persist(room)?.catch(console.error);prunePackages();pruneAvatars();},15000);
 return {server,rooms,
 async registerGame(definition){if(closing)throw Error('Host is closing');const source=definition.source||JSON.stringify(definition.pack);if(digest(source)!==definition.hash)throw Error('Package integrity mismatch');const pack=parsePackage(source,{allowNative:Boolean(definition.createEngine)});await store?.putPackage?.(definition.hash,source);const pinned={...definition,playerCapacity,pack,source};packages.set(pinned.hash,pinned);games.set(pack.manifest.id,pinned);prunePackages();},
 removeGame(id){games.delete(id);prunePackages();},
 async close(){closing=true;clearInterval(ticker);clearInterval(heartbeat);clearInterval(checkpoints);for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await Promise.all([...rooms.values()].map(persist));await Promise.allSettled([...pendingDeletes]);for(const room of rooms.values())room.party?.dispose();await new Promise(resolve=>server.close(resolve));}};
}
function safeMessageId(bytes){try{const id=JSON.parse(bytes.toString()).id;return typeof id==='string'?id.slice(0,100):undefined;}catch{return undefined;}}
