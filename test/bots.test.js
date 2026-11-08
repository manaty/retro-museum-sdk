import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomParty} from '../room-party.js';
import {manifest} from '../manifest.js';
import {createGameHost} from '../host.js';
import {digest} from '../manifest.js';
import {WebSocket} from 'ws';

const metadata={schemaVersion:1,id:'bot-test',version:'1.0.0',title:{en:'Bots'},description:{en:'Bot test game'},author:'Manaty',license:'MIT',languages:['en'],players:{min:2,max:4},durationMinutes:10,runtime:'quickjs-v1',entry:'dist/game.rmg.json',permissions:[],bots:{apiVersion:1,difficulties:['easy','medium','hard']}};
const definition={pack:{manifest:metadata,engine:`globalThis.RetroMuseumGame={create(players,saved){let s=saved||{moves:0};return{action(id,a){if(a!=='move')throw Error('illegal');s.moves++},botAction(){return {action:'move'}},advance(){},snapshot(){return s},save(){return s},release(){},status(){return {ended:s.moves>=3,requiredPlayers:players.map(p=>p.id)}},addPlayer(){}}}}`}};
test('robots reserve seats, have individual levels, need a human, and changes are transactional',()=>{
 const party=new RoomParty({definition});try{
  party.configure({bots:[{difficulty:'easy'},{difficulty:'hard'}]});assert.equal(party.canStart,false);assert.throws(()=>party.admin('start'),/needPlayers/);
  const ids=party.players.map(p=>p.id);party.join('human');assert.equal(party.canStart,true);
  const before=party.save();assert.throws(()=>party.configure({bots:[{difficulty:'unknown'}]}),/difficulty/);assert.deepEqual(party.save(),before);
  assert.throws(()=>party.configure({bots:[{id:'human',difficulty:'medium'}]}),/identity/);
  assert.throws(()=>party.configure({bots:Array(4).fill({difficulty:'easy'})}),/seat/);
  assert.throws(()=>party.configure({bots:[{id:ids[0],difficulty:'easy'},{id:ids[0],difficulty:'hard'}]}),/identity/);
  party.configure({bots:ids.map((id,i)=>({id,difficulty:i?'medium':'easy'}))});assert.equal(party.players.find(p=>p.id===ids[1]).difficulty,'medium');
  party.admin('start');assert.throws(()=>party.configure({bots:[]}),/started/);
 }finally{party.dispose();}
});
test('robot decisions stop during pause, persist across restart, and remain for replay',()=>{
 let now=0;const clock=()=>now;let party=new RoomParty({definition,clock});
 try{
  party.configure({bots:[{difficulty:'hard'}]});party.join('human');party.admin('start');
  now=3001;party.tick();assert.equal(party.snapshot().community.moves,1);
  party.admin('pause');now+=10000;party.tick();assert.equal(party.snapshot().community.moves,1);
  const saved=party.save(),robot=saved.players.find(p=>p.bot);party.dispose();party=new RoomParty({definition,clock,saved});
  assert.equal(party.players.find(p=>p.bot).connected,true);assert.equal(party.players.find(p=>!p.bot).connected,false);
  party.join('human');assert.equal(party.phase,'paused');party.admin('resume');now+=701;party.tick();assert.equal(party.snapshot().community.moves,2);
  now+=701;party.tick();assert.equal(party.phase,'ended');
  party.admin('playAgain');assert.equal(party.phase,'ready');assert.equal(party.players.find(p=>p.bot).id,robot.id);assert.equal(party.players.find(p=>p.bot).difficulty,'hard');
  party.admin('start');now+=3001;party.tick();assert.equal(party.snapshot().community.moves,1);
 }finally{party.dispose();}
});
test('unsupported games reject robots and bot capability declarations are validated',()=>{
 const party=new RoomParty({definition:{pack:{...definition.pack,manifest:{...metadata,bots:undefined}}}});
 try{assert.throws(()=>party.configure({bots:[{difficulty:'easy'}]}),/not support/);}finally{party.dispose();}
 assert.deepEqual(manifest(metadata).bots,metadata.bots);
 for(const bots of [{apiVersion:2,difficulties:['easy']},{apiVersion:1,difficulties:[]},{apiVersion:1,difficulties:['easy','easy']},{apiVersion:1,difficulties:['impossible']}])assert.throws(()=>manifest({...metadata,bots}));
});
test('only the organiser can manage robots; robots cannot be impersonated and never keep an empty room active',async()=>{
 let now=0;const saved=new Map(),store={list:async()=>[...saved.values()],put:async r=>saved.set(r.id,structuredClone(r))};
 const pack={...definition.pack,view:'<!doctype html><html><body>Robots</body></html>',assets:{},licenseText:'MIT licence fixture. '.repeat(10)},source=JSON.stringify(pack);
 const host=await createGameHost({definitions:[{pack,source,hash:digest(source)}],store,clock:()=>now});
 await new Promise(r=>host.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+host.server.address().port;
 const post=(path,data,token)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
 let ws;
 try{
  const created=await post('/api/rooms',{game:metadata.id,bots:[{difficulty:'hard'}]});assert.equal(created.status,201);const room=await created.json(),path='/api/rooms/'+room.id,party=host.rooms.get(room.id).party;
  assert.equal((await post(path+'/control',{action:'start'},room.hostToken)).status,400);
  const robot=party.players[0];assert.equal((await post(path+'/join',{token:robot.id,profile:{name:'Fake robot'}})).status,401);
  const player=await(await post(path+'/join',{profile:{name:'Human',bot:true,difficulty:'hard'}})).json();
  assert.equal((await post(path+'/control',{action:'configure',bots:[]},player.token)).status,403);
  ws=new WebSocket(origin.replace('http','ws')+'/socket');
  await new Promise((resolve,reject)=>{ws.once('error',reject);ws.once('open',()=>ws.send(JSON.stringify({type:'hello',room:room.id,role:'controller',token:player.token})));ws.on('message',bytes=>{const m=JSON.parse(bytes);if(m.type==='welcome')resolve();if(m.type==='state')ws.send(JSON.stringify({type:'ack',sequence:m.sequence}));});});
  assert.equal(party.players.find(p=>p.id===player.playerId).bot,undefined);
  assert.equal((await post(path+'/control',{action:'start'},room.hostToken)).status,200);
  now=3001;party.tick();assert.equal(party.snapshot().community.moves,1);
  assert.equal((await post(path+'/control',{action:'configure',bots:[]},room.hostToken)).status,400);
  const closed=new Promise(resolve=>ws.once('close',resolve));ws.close();await closed;
  now+=30001;const health=await(await fetch(origin+'/health')).json();assert.equal(health.rooms,0);assert.equal(health.connectedPlayers,0);assert.equal(health.savedRooms,1);
  await host.rooms.get(room.id).saving;assert.equal(saved.get(room.id).party.players.find(p=>p.bot).difficulty,'hard');
 }finally{ws?.terminate();await host.close();}
});
