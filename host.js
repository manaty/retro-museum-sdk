import http from 'node:http';
import {readFile,mkdir,writeFile,rename,readdir} from 'node:fs/promises';
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

export async function loadGame(path,{createEngine}={}){const bytes=await readFile(path);return {pack:parsePackage(bytes,{allowNative:typeof createEngine==='function'}),hash:digest(bytes),createEngine};}
export function fileRoomStore(directory){return {async list(){await mkdir(directory,{recursive:true});const result=[];for(const name of await readdir(directory)){if(!/^[a-z0-9]{12}\.json$/.test(name))continue;try{result.push(JSON.parse(await readFile(resolve(directory,name),'utf8')));}catch{}}return result;},async put(room){await mkdir(directory,{recursive:true});const path=resolve(directory,room.id+'.json');await writeFile(path+'.tmp',JSON.stringify(room),{mode:0o600});await rename(path+'.tmp',path);}};}

export async function createGameHost({definitions,store,publicOrigin,clock=Date.now,maxRooms=32}={}){
 const games=new Map(definitions.map(d=>[d.pack.manifest.id,d])),packages=new Map(definitions.map(d=>[d.hash,d])),rooms=new Map(),clients=new Map(),avatars=new Map(),limits=new Map();let closing=false;
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const rate=(key,max=30,period=60000)=>{const now=clock(),old=limits.get(key);const value=!old||old.until<now?{n:0,until:now+period}:old;value.n++;limits.set(key,value);return value.n<=max;};
 const serialize=room=>({id:room.id,game:room.game,packageHash:room.definition.hash,hostHash:room.hostHash,members:room.members,language:room.language,updatedAt:room.updatedAt,party:room.party.save()});
 const persist=room=>{room.saving=(room.saving||Promise.resolve()).catch(()=>{}).then(()=>store?.put(serialize(room)));return room.saving;};
 function publicProfile(value){const p=validateProfile(value);if(!p.avatar)return p;const id=hash(p.avatar);avatars.set(id,Buffer.from(p.avatar.split(',')[1],'base64'));return {...p,avatar:'/avatars/'+id+'.jpg'};}
 if(store?.putPackage)await Promise.all(definitions.map(d=>store.putPackage(d.hash,d.pack)));
 if(store)for(const saved of await store.list()){
  let definition=packages.get(saved.packageHash);const current=games.get(saved.game);
  if(!definition&&current&&store.getPackage){try{const pack=await store.getPackage(saved.packageHash);const bytes=JSON.stringify(pack);if(digest(bytes)!==saved.packageHash)throw Error('Package integrity mismatch');definition={pack:parsePackage(bytes,{allowNative:Boolean(current.createEngine)}),hash:saved.packageHash,createEngine:current.createEngine};packages.set(definition.hash,definition);}catch(error){console.error('Pinned package restore failed',saved.id,error.message);}}
  if(!definition||!validId(saved.id)||clock()-saved.updatedAt>86400000)continue;
  try{const room={...saved,definition,party:new RoomParty({definition,clock,saved:saved.party})};for(const member of Object.values(room.members)){const player=room.party.players.find(p=>p.id===member.id);if(player)Object.assign(player,publicProfile(member.profile));}rooms.set(room.id,room);}catch(error){console.error('Room restore failed',saved.id,error.message);}
 }
 const origin=req=>publicOrigin||`http://${req.headers.host}`;
 function permitted(req){return !req.headers.origin||req.headers.origin===origin(req);}
 const body=async req=>{let size=0,text='';for await(const chunk of req){size+=chunk.length;if(size>40000)throw Error('Request too large');text+=chunk;}return JSON.parse(text||'{}');};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const url=new URL(req.url,'http://host');const path=url.pathname;
   if(req.method==='POST'&&!permitted(req))return json(res,403,{error:'Invalid origin'});
   if(path==='/health')return json(res,200,{ok:true,rooms:rooms.size,games:[...games.keys()]});
   if(path==='/api/games')return json(res,200,definitions.map(d=>({...d.pack.manifest,hash:d.hash})));
   if(path==='/api/rooms'&&req.method==='POST'){
    if(!rate('create:'+req.socket.remoteAddress,10))return json(res,429,{error:'Please wait before creating another room.'});
    if(rooms.size>=maxRooms)return json(res,503,{error:'All rooms are busy. Please try again shortly.'});
    const input=await body(req),definition=games.get(input.game);if(!definition)return json(res,400,{error:'Unknown game'});
    const id=randomBytes(6).toString('hex'),hostToken=token(),room={id,game:input.game,definition,hostHash:hash(hostToken),members:{},language:['en','fr','tl'].includes(input.language)?input.language:'en',updatedAt:clock(),party:new RoomParty({definition,clock})};
    rooms.set(id,room);await persist(room);return json(res,201,{id,hostToken,displayUrl:origin(req)+'/r/'+id,joinUrl:origin(req)+'/j/'+id});
   }
   const api=/^\/api\/rooms\/([a-z0-9]{12})(?:\/(join|control|profile|qr))?$/.exec(path);
   if(api){
    const room=rooms.get(api[1]);if(!room)return json(res,404,{error:'This room is no longer available. Create a new room.'});
    if(req.method==='GET'&&!api[2])return json(res,200,{id:room.id,game:room.definition.pack.manifest,hash:room.definition.hash,language:room.language,joinUrl:origin(req)+'/j/'+room.id});
    if(req.method==='GET'&&api[2]==='qr'){res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private,max-age=60'});return res.end(await QRCode.toBuffer(origin(req)+'/j/'+room.id,{width:220,margin:2}));}
    if(req.method==='POST'&&api[2]==='join'){
     if(!rate('join:'+room.id+':'+req.socket.remoteAddress,40))return json(res,429,{error:'Please wait and retry.'});
     const input=await body(req);let credential=input.token,member=credential&&room.members[hash(credential)];
     if(credential&&!member)return json(res,401,{error:'Invalid player session'});
     if(!member){if(Object.keys(room.members).length>=32)return json(res,409,{error:'Room is full'});credential=token();member={id:randomBytes(16).toString('hex'),profile:validateProfile(input.profile||{name:'',avatar:null})};room.members[hash(credential)]=member;}
     else if(input.profile)member.profile=validateProfile(input.profile);
     // Joining is completed by the authenticated socket so abandoned forms don't occupy seats.
     room.updatedAt=clock();await persist(room);return json(res,200,{token:credential,playerId:member.id});
    }
    const bearer=req.headers.authorization?.replace(/^Bearer /,'');
    if(req.method==='POST'&&api[2]==='profile'){
     const member=bearer&&room.members[hash(bearer)];if(!member)return json(res,401,{error:'Invalid player session'});member.profile=validateProfile(await body(req));const player=room.party.players.find(p=>p.id===member.id);if(player)Object.assign(player,publicProfile(member.profile));await persist(room);return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&api[2]==='control'){
     if(!matches(bearer,room.hostHash))return json(res,403,{error:'Only the room organiser can do this.'});
     const command=await body(req);room.party.language=room.language;if(command.action==='language'){if(!['en','fr','tl'].includes(command.value))throw Error('Invalid language');room.language=command.value;}else room.party.admin(command.action,command.options);
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
   const staticFile={'/host.js':'host-client.js','/host.css':'host.css','/compat.js':'host-compat.js'}[path];
   if(staticFile){const ext=path.slice(path.lastIndexOf('.'));res.writeHead(200,{'Content-Type':mime[ext],'Cache-Control':'no-cache'});return res.end(await readFile(resolve(here,'web',staticFile)));}
   if(req.method==='GET'&&(path==='/'||/^\/(g\/[a-z0-9-]+|[rj]\/[a-z0-9]{12})$/.test(path))){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(await readFile(resolve(here,'web/index.html')));}
   return json(res,404,{error:'Not found'});
  }catch(error){return json(res,400,{error:String(error.message).slice(0,180)});}
 });
 const wss=new WebSocketServer({noServer:true,maxPayload:40000});
 server.on('upgrade',(req,socket,head)=>{if(req.url!=='/socket'||!permitted(req)||clients.size>=1000){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));});
 const send=(ws,value)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value));};
 wss.on('connection',(ws,req)=>{
  let client;const deadline=setTimeout(()=>{if(!client)ws.close(4001,'Authentication required');},7000);ws.on('error',()=>{});
  ws.on('message',async bytes=>{try{
   const message=JSON.parse(bytes.toString());
   if(!client){if(message.type!=='hello'||!validId(message.room)||!['display','controller'].includes(message.role))throw Error('Invalid connection');const room=rooms.get(message.room);if(!room)throw Error('Room not found');
    const member=message.role==='controller'&&typeof message.token==='string'?room.members[hash(message.token)]:null;if(message.role==='controller'&&!member)throw Error('Invalid player session');
    client={room,role:message.role,id:member?.id,language:['en','fr','tl'].includes(message.language)?message.language:'en',lastSent:0,sequence:0,alive:true};clients.set(ws,client);clearTimeout(deadline);
    if(member){for(const [other,c] of clients)if(other!==ws&&c.room===room&&c.id===member.id){clients.delete(other);other.close(4003,'Opened on another tab');}room.party.join(member.id,publicProfile(member.profile));}
    room.updatedAt=clock();send(ws,{type:'welcome'});return;
   }
   if(message.type==='ack'){if(message.sequence===client.pending){client.pending=null;client.ackAt=null;}return;}
   if(message.type==='language'){if(['en','fr','tl'].includes(message.value))client.language=message.value;return;}
   if(message.type!=='command'||client.role!=='controller'||typeof message.id!=='string'||message.id.length>100||!rate('command:'+client.id,160,1000))throw Error('Invalid command');
   if(message.action==='zxStart'&&client.room.game==='zx80'){client.room.party.language=client.room.language;client.room.party.admin('start');}
   else if(message.action==='playAgain'){client.room.party.admin('playAgain');if(client.room.party.canStart)client.room.party.admin('start',client.room.party.options);}
   else client.room.party.command(client.id,message);
   client.room.updatedAt=clock();send(ws,{type:'ack',id:message.id});
  }catch(error){send(ws,{type:'error',id:safeMessageId(bytes),code:String(error.message),message:String(error.message).slice(0,160)});if(!client)ws.close(4001,'Invalid connection');}});
  ws.on('pong',()=>{if(client)client.alive=true;});
  ws.on('close',()=>{clearTimeout(deadline);if(!clients.has(ws))return;clients.delete(ws);if(client.id&&!Array.from(clients.values()).some(c=>c.room===client.room&&c.id===client.id))client.room.party.leave(client.id);if(!closing)persist(client.room).catch(console.error);});
 });
 const ticker=setInterval(()=>{
  for(const room of rooms.values())room.party.tick();const now=clock();
  for(const [ws,c] of clients){
   if(c.pending){if(now-c.ackAt>5000)ws.terminate();continue;}
   if(now-c.lastSent<(c.role==='display'?50:100)||ws.bufferedAmount>65536)continue;
   try{const p=c.room.party.snapshot(c.id);const state={party:p,phase:p.phase,remainingMs:p.remainingMs,durationMs:c.room.definition.pack.manifest.durationMinutes*60000,introRemainingMs:p.introRemainingMs,language:c.role==='controller'?c.language:c.room.language,station:'1',room:'1',sessionId:p.id};c.sequence++;c.pending=c.sequence;c.ackAt=now;c.lastSent=now;send(ws,{type:'state',sequence:c.sequence,state});}catch(error){send(ws,{type:'error',message:'This game could not render its state.'});}
  }
 },25);
 const heartbeat=setInterval(()=>{for(const [ws,c] of clients){if(!c.alive){ws.terminate();continue;}c.alive=false;ws.ping();c.room.updatedAt=clock();}for(const [key,value] of limits)if(value.until<clock())limits.delete(key);},10000);
 const checkpoints=setInterval(()=>{for(const room of rooms.values()){if(clock()-room.updatedAt>86400000){room.party.dispose();rooms.delete(room.id);}else persist(room).catch(console.error);}},15000);
 return {server,rooms,async close(){closing=true;clearInterval(ticker);clearInterval(heartbeat);clearInterval(checkpoints);for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await Promise.all([...rooms.values()].map(persist));for(const room of rooms.values())room.party.dispose();await new Promise(resolve=>server.close(resolve));}};
}
function safeMessageId(bytes){try{const id=JSON.parse(bytes.toString()).id;return typeof id==='string'?id.slice(0,100):undefined;}catch{return undefined;}}
