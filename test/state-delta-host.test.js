import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createGameHost} from '../host.js';
import {StateDecoder} from '../state-delta.js';
const definition={hash:'b'.repeat(64),pack:{manifest:{id:'serpents',version:'1.0.0',title:{en:'Delta test'},players:{min:1,max:4},durationMinutes:15,options:{}},engine:`globalThis.RetroMuseumGame={create(players){return {snapshot(id){return {players:players.map(p=>({id:p.id,body:[[10,20,1],[8,20,0]]})),food:Array.from({length:100},(_,id)=>({id,x:id*3,y:id*2})),private:id}},advance(){},action(){},save(){return {}},status(){return {winner:null,requiredPlayers:[]}},release(){}}}}`,view:'<!doctype html><html><body>test</body></html>',assets:{}}};
test('real sockets negotiate deltas, isolate private views, recover baseline and retain legacy clients',{timeout:15000},async()=>{
 const host=await createGameHost({definitions:[definition]});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+host.server.address().port,sockets=[];
 const post=async(path,data,token)=>{const r=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(data)});assert.ok(r.ok,await r.clone().text());return r.json();};
 const until=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('socket wait timeout');};
 const connect=async(room,role,token,deltas=true)=>{
  const ws=new WebSocket(base.replace('http','ws')+'/socket'),decoder=new StateDecoder,received=[],errors=[];sockets.push(ws);
  ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state'||m.type==='stateDelta'){try{const state=decoder.accept(m);received.push({type:m.type,state});ws.send(JSON.stringify({type:'ack',sequence:m.sequence}));}catch(e){errors.push(e.message);}}});
  await new Promise((r,j)=>{ws.once('error',j);ws.once('open',()=>{ws.send(JSON.stringify({type:'hello',room,role,token,...(deltas?{stateDeltas:1}:{})}));r();});});return {ws,decoder,received,errors};
 };
 try{
  const room=await post('/api/rooms',{game:'serpents'}),path='/api/rooms/'+room.id;
  const a=await post(path+'/join',{profile:{name:'A'}}),b=await post(path+'/join',{profile:{name:'B'}});
  const phone=await connect(room.id,'controller',a.token),other=await connect(room.id,'controller',b.token),display=await connect(room.id,'display'),legacy=await connect(room.id,'display',null,false);
  await until(()=>host.rooms.get(room.id).party.players.length===2);await post(path+'/control',{action:'start'},room.hostToken);
  await until(()=>[phone,other,display].every(c=>c.received.some(m=>m.type==='stateDelta'&&m.state.party.community)));
  assert.equal(phone.received.at(-1).state.party.community.private,a.playerId);assert.equal(other.received.at(-1).state.party.community.private,b.playerId);assert.equal(display.received.at(-1).state.party.community.private,null);
  assert.ok(legacy.received.every(m=>m.type==='state'));assert.equal(phone.received.at(-1).state.party.community.food.length,100);
  // Browser explicitly requests a new full baseline after detecting a mismatch.
  const before=phone.received.length;phone.ws.send(JSON.stringify({type:'resync'}));await until(()=>phone.received.slice(before).some(m=>m.type==='state'));await until(()=>phone.received.slice(before).filter(m=>m.type==='stateDelta').length>=2);
  phone.ws.terminate();const reconnected=await connect(room.id,'controller',a.token);await until(()=>reconnected.received.length>=2);assert.equal(reconnected.received[0].type,'state');assert.equal(reconnected.received.at(-1).state.party.community.private,a.playerId);
  for(const c of [phone,other,display,legacy,reconnected])assert.deepEqual(c.errors,[]);
 }finally{for(const ws of sockets)ws.terminate();await host.close();}
});
