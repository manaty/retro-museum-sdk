import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createGameHost,fileRoomStore} from '../host.js';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest} from '../manifest.js';
const definition={hash:'b'.repeat(64),pack:{manifest:{id:'idle-test',version:'1.0.0',title:{en:'Idle test'},players:{min:1,max:4},durationMinutes:30,options:{}},engine:`globalThis.RetroMuseumGame={create(players,saved){let n=saved?.n||0;return {snapshot(id){return {n,...(id?{private:id}:{})}},save(){return {n}},advance(){},action(){n++},status(){return {winner:null,requiredPlayers:players.map(p=>p.id)}},release(){},addPlayer(){}}}}`,view:'<!doctype html><html><body>Game</body></html>',assets:{}}};
definition.hash=digest(JSON.stringify(definition.pack));
const pause=()=>new Promise(r=>setTimeout(r,40));
function memory(){const data=new Map();return {data,list:async()=>[...data.values()].map(x=>structuredClone(x)),put:async r=>data.set(r.id,structuredClone(r)),delete:async id=>data.delete(id)};}
async function rig({store=memory(),now=100000,maxRooms=1}={}){
 let time=now;const sockets=[];const host=await createGameHost({definitions:[definition],store,clock:()=>time,maxRooms});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+host.server.address().port;
 const request=(path,value,token)=>fetch(base+path,{...(value?{method:'POST',body:JSON.stringify(value)}:{}),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})}});
 const health=async()=>await(await request('/health')).json();
 async function connect(id,role,token){const ws=new WebSocket(base.replace('http','ws')+'/socket');sockets.push(ws);ws.messages=[];ws.on('message',b=>{const m=JSON.parse(b);ws.messages.push(m);if(m.type==='state')ws.send(JSON.stringify({type:'ack',sequence:m.sequence}));});await once(ws,'open');ws.send(JSON.stringify({type:'hello',room:id,role,token}));for(let i=0;i<100;i++){const answer=ws.messages.find(m=>['welcome','error','roomExpired'].includes(m.type));if(answer)return {ws,answer};await new Promise(r=>setTimeout(r,5));}throw Error('Handshake timeout');}
 return {host,store,request,health,connect,set(t){time=t;},get now(){return time;},async create(){return (await request('/api/rooms',{game:'idle-test'})).json();},async close(){for(const ws of sockets)ws.terminate();await host.close();}};
}
test('empty room releases capacity at 30 seconds despite an open display; saves expire at 10 minutes',async()=>{
 const r=await rig({now:0});try{
  const room=await r.create(),path='/api/rooms/'+room.id;const display=await r.connect(room.id,'display');assert.equal(display.answer.type,'welcome');
  r.set(29999);assert.equal((await r.health()).rooms,1);r.set(30000);let health=await r.health();assert.equal(health.rooms,0);assert.equal(health.savedRooms,1);assert.equal(r.host.rooms.get(room.id).party,null);await pause();assert.ok(display.ws.messages.some(m=>m.type==='roomSleeping'));
  r.set(500000);assert.equal((await r.request(path)).status,200);await r.request(path+'/join',{profile:{name:'Alice'}});assert.equal((await r.request(path+'/control',{action:'start'},room.hostToken)).status,409);assert.equal((await r.health()).rooms,0);
  r.set(599999);assert.equal((await r.request(path)).status,200);const pending=r.host.rooms.get(room.id);
  r.set(600000);assert.equal((await r.request(path)).status,404);await pending.saving;assert.equal(r.store.data.has(room.id),false);await pause();assert.ok(display.ws.messages.some(m=>m.type==='roomExpired'));assert.equal(display.ws.readyState,WebSocket.CLOSED);assert.equal((await r.health()).savedRooms,0);
 }finally{await r.close();}
});
test('authenticated return restores score and private state; busy or invalid returns do not reset expiry',async()=>{
 const r=await rig();try{
  const room=await r.create(),path='/api/rooms/'+room.id;const member=await(await r.request(path+'/join',{profile:{name:'Alice'}})).json();let phone=await r.connect(room.id,'controller',member.token);
  assert.equal((await r.request(path+'/control',{action:'start'},room.hostToken)).status,200);r.set(104000);await pause();const party=r.host.rooms.get(room.id).party;party.command(member.playerId,{id:'one',matchId:party.id,action:'move'});const match=party.id;
  phone.ws.close();await once(phone.ws,'close');await pause();const gone=r.now;
  r.set(gone+29999);assert.equal((await r.health()).rooms,1);r.set(gone+30000);assert.equal((await r.health()).rooms,0);
  const other=await r.create();assert.ok(other.id);let rejected=await r.connect(room.id,'controller',member.token);assert.equal(rejected.answer.code,'roomsBusy');assert.equal(r.host.rooms.get(room.id).emptySince,gone);rejected=await r.connect(room.id,'controller','invalid');assert.equal(rejected.answer.type,'error');assert.equal(r.host.rooms.get(room.id).party,null);
  r.set(gone+60000);assert.equal((await r.health()).rooms,0);phone=await r.connect(room.id,'controller',member.token);assert.equal(phone.answer.type,'welcome');const restored=r.host.rooms.get(room.id).party;assert.equal(restored.id,match);assert.equal(restored.phase,'playing');assert.equal(restored.snapshot(member.playerId).community.n,1);assert.equal(restored.snapshot(member.playerId).community.private,member.playerId);assert.equal(restored.snapshot(null).community.private,undefined);assert.equal(restored.players[0].name,'Alice');assert.equal(r.host.rooms.get(room.id).emptySince,null);
  r.set(gone+700000);assert.equal((await r.health()).rooms,1,'connected player keeps the room beyond the previous deadline');
 }finally{await r.close();}
});
test('only the last controller leaving starts the deadline; replacement tabs do not mark a player absent',async()=>{
 const r=await rig();try{
  const room=await r.create(),path='/api/rooms/'+room.id;const a=await(await r.request(path+'/join',{profile:{name:'A'}})).json(),b=await(await r.request(path+'/join',{profile:{name:'B'}})).json();const first=await r.connect(room.id,'controller',a.token);const second=await r.connect(room.id,'controller',b.token);const replacement=await r.connect(room.id,'controller',a.token);await pause();assert.equal(first.ws.readyState,WebSocket.CLOSED);assert.equal(r.host.rooms.get(room.id).emptySince,null);
  replacement.ws.close();await once(replacement.ws,'close');await pause();r.set(800000);assert.equal((await r.health()).rooms,1);assert.equal((await r.health()).connectedPlayers,1);
  second.ws.close();await once(second.ws,'close');await pause();assert.equal(r.host.rooms.get(room.id).emptySince,800000);r.set(830000);assert.equal((await r.health()).rooms,0);
 }finally{await r.close();}
});
test('restart preserves archived expiry instead of giving an old room ten more minutes',async()=>{
 const store=memory();let r=await rig({store});const room=await r.create();r.set(140000);await r.health();await r.close();
 r=await rig({store,now:600000});try{assert.equal((await r.health()).rooms,0);assert.equal((await r.health()).savedRooms,1);assert.equal(r.host.rooms.get(room.id).emptySince,100000);r.set(700000);assert.equal((await r.request('/api/rooms/'+room.id)).status,404);await pause();assert.equal(store.data.has(room.id),false);}finally{await r.close();}
 r=await rig({store,now:800000});try{assert.equal(r.host.rooms.size,0);}finally{await r.close();}
});
test('legacy abandoned rooms are deleted from disk during startup and cannot reappear on restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'museum-idle-'));const store=fileRoomStore(dir);const id='abcdefabcdef';await store.put({id,game:'idle-test',packageHash:definition.hash,hostHash:'old',members:{},updatedAt:1000,party:{players:[],phase:'ready'}});
 const r=await rig({store,now:700000});try{assert.equal(r.host.rooms.size,0);assert.deepEqual(await store.list(),[]);await assert.rejects(readFile(join(dir,id+'.json')),e=>e.code==='ENOENT');await assert.rejects(store.delete('../elsewhere'),/Invalid room ID/);}finally{await r.close();}
});
test('concurrent room creation cannot exceed capacity after reading request bodies',async()=>{
 const r=await rig();try{const responses=await Promise.all(Array.from({length:4},()=>r.request('/api/rooms',{game:'idle-test'})));assert.deepEqual(responses.map(x=>x.status).sort(),[201,503,503,503]);}finally{await r.close();}
});
test('expiration deletes after pending saves and shutdown waits for the deletion',async()=>{
 const store=memory(),r=await rig({store});const room=await r.create();
 let release;const gate=new Promise(resolve=>{release=resolve;});const put=store.put;
 store.put=async data=>{await gate;await put(data);};
 r.set(130000);await r.health();const old=r.host.rooms.get(room.id);
 r.set(700000);await r.health();assert.equal(r.host.rooms.size,0);
 let closed=false;const closing=r.close().then(()=>{closed=true;});await pause();assert.equal(closed,false);
 release();await closing;await old.saving;assert.equal(store.data.has(room.id),false);
});
