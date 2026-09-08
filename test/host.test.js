import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createGameHost,fileRoomStore} from '../host.js';
import {digest} from '../manifest.js';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {RoomParty} from '../room-party.js';
const definition={hash:'a'.repeat(64),pack:{manifest:{id:'test-game',version:'1.0.0',title:{en:'Test'},description:{en:'A test'},players:{min:2,max:4},durationMinutes:15,options:{}},engine:`globalThis.RetroMuseumGame={create(players,saved){let n=saved?.n||0;return {snapshot(id){return {n,...(id?{private:{card:id}}:{})}},save(){return {n}},advance(){},action(id,a){if(a!=='move')throw Error('invalid');n++},status(){return {winner:null,requiredPlayers:players.map(p=>p.id)}},release(){},addPlayer(){}}}}`,view:'<!doctype html><html><body>Test</body></html>',assets:{}}};
test('automatic start counts distinct connected players, keeps options, and never restarts a paused or finished match',()=>{
 const def={...definition,pack:{...definition.pack,manifest:{...definition.pack.manifest,players:{min:2,max:2},autoStartWhenFull:true,options:{minutes:{values:[3,5],default:5}}}}};
 const party=new RoomParty({definition:def});try{
 party.configure({options:{minutes:3},autoStartWhenFull:false});party.join('a');party.join('b');assert.equal(party.phase,'ready');
 const restored=new RoomParty({definition:def,saved:party.save()});assert.equal(restored.autoStartWhenFull,false);restored.dispose();
 party.leave('b');party.configure({autoStartWhenFull:true});party.join('a');assert.equal(party.phase,'ready');party.join('c');assert.equal(party.phase,'intro');assert.equal(party.options.minutes,3);assert.deepEqual(party.players.map(p=>p.id),['a','c']);
 const engine=party.engine;party.join('a');assert.equal(party.engine,engine);party.admin('pause');party.join('c');assert.equal(party.phase,'paused');
 assert.throws(()=>party.configure({autoStartWhenFull:false}),/already started/);party.admin('end');party.join('d');assert.equal(party.phase,'ended');
 }finally{party.dispose();}
});
test('HTTP enrollment and read-only displays do not auto-start; the second authenticated controller does',async()=>{
 const def={...definition,pack:{...definition.pack,manifest:{...definition.pack.manifest,players:{min:2,max:2},autoStartWhenFull:true}}};
 const host=await createGameHost({definitions:[def]});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+host.server.address().port,sockets=[];
 const post=async(path,data,token)=>fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(data)});
 const connect=async(room,role,token)=>{const ws=new WebSocket(base.replace('http','ws')+'/socket');sockets.push(ws);await new Promise((resolve,reject)=>{ws.on('error',reject);ws.on('open',()=>ws.send(JSON.stringify({type:'hello',room,role,token})));ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='welcome')resolve();if(m.type==='error')reject(Error(m.message));if(m.type==='state')ws.send(JSON.stringify({type:'ack',sequence:m.sequence}));});});};
 try{const room=await(await post('/api/rooms',{game:'test-game'})).json(),party=host.rooms.get(room.id).party;
 const a=await(await post('/api/rooms/'+room.id+'/join',{profile:{name:'a'}})).json(),b=await(await post('/api/rooms/'+room.id+'/join',{profile:{name:'b'}})).json();
 await connect(room.id,'display');assert.equal(party.phase,'ready');await connect(room.id,'controller',a.token);await connect(room.id,'controller',a.token);assert.equal(party.phase,'ready');
 assert.equal((await post('/api/rooms/'+room.id+'/control',{action:'configure',autoStartWhenFull:false},a.token)).status,403);
 await connect(room.id,'controller',b.token);assert.equal(party.phase,'intro');assert.equal(party.players.length,2);
 }finally{for(const ws of sockets)ws.terminate();await host.close();}
});
test('late arrivals join the next match; temporary disconnection gets a grace period; stale commands fail',()=>{
 let now=0;const party=new RoomParty({definition,clock:()=>now});try{
 party.join('a');party.join('b');party.admin('start');const old=party.id;now=3001;party.tick();party.join('c');assert.equal(party.players.find(p=>p.id==='c').spectator,true);assert.throws(()=>party.command('c',{matchId:old,id:'x',action:'move'}),/spectator/);
 party.leave('b');now+=19999;party.tick();assert.equal(party.phase,'playing');now+=2;party.tick();assert.equal(party.phase,'paused');party.join('b');assert.equal(party.phase,'playing');
 party.admin('end');party.admin('playAgain');party.admin('start');now+=3001;party.tick();assert.equal(party.players.find(p=>p.id==='c').spectator,false);assert.throws(()=>party.command('a',{matchId:old,id:'x',action:'move'}),/oldMatch/);assert.throws(()=>party.command('a',{matchId:party.id,id:'x',action:'hostTimeUp'}),/invalidGameAction/);
 }finally{party.dispose();}
});
test('local updates retain the exact package used by existing rooms',async()=>{
 const store=fileRoomStore(await mkdtemp(join(tmpdir(),'museum-package-')));
 const pack={...definition.pack,manifest:{...definition.pack.manifest,schemaVersion:1,license:'MIT',languages:['en'],runtime:'quickjs-v1',entry:'dist/game.rmg.json',permissions:[],author:'Test'},licenseText:'Test attribution '.repeat(10)};
 const source=JSON.stringify(pack),old={pack,source,hash:digest(source)};
 let host=await createGameHost({definitions:[old],store});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));
 const room=await (await fetch('http://127.0.0.1:'+host.server.address().port+'/api/rooms',{method:'POST',body:JSON.stringify({game:'test-game'})})).json();await host.close();
 const nextPack={...pack,manifest:{...pack.manifest,version:'1.0.1'},view:pack.view.replace('Test','Updated')},nextSource=JSON.stringify(nextPack);
 host=await createGameHost({definitions:[],store});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));
 try{const origin='http://127.0.0.1:'+host.server.address().port;assert.equal(host.rooms.get(room.id).definition.hash,old.hash);assert.equal(await store.getPackage(old.hash),source);await assert.rejects(store.getPackage('../elsewhere'),/Invalid package hash/);
 await host.registerGame({pack:nextPack,source:nextSource,hash:digest(nextSource)});assert.equal((await(await fetch(origin+'/api/games')).json())[0].version,'1.0.1');assert.equal(host.rooms.get(room.id).definition.hash,old.hash);
 host.removeGame('test-game');assert.deepEqual(await(await fetch(origin+'/api/games')).json(),[]);assert.equal((await fetch(origin+'/packages/'+old.hash+'/view')).status,200);assert.equal((await fetch(origin+'/packages/'+digest(nextSource)+'/view')).status,404);
 }finally{await host.close();}
});
test('recognised hostnames preserve invitation origin and reject foreign browser origins',async()=>{
 const host=await createGameHost({definitions:[definition],publicOrigin:'https://play.retro-museum.net',allowedOrigins:['https://legacy.example']});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));
 try{const url='http://127.0.0.1:'+host.server.address().port+'/api/rooms';
 const request=origin=>new Promise((resolve,reject)=>{const req=http.request(url,{method:'POST',headers:{Host:new URL(origin).host,Origin:origin}},res=>{let body='';res.on('data',bytes=>body+=bytes);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));});req.on('error',reject);req.end(JSON.stringify({game:'test-game'}));});
 for(const origin of ['https://play.retro-museum.net','https://legacy.example']){const response=await request(origin);assert.equal(response.status,201);assert.ok(response.body.joinUrl.startsWith(origin+'/j/'));}
 const rejected=await fetch(url,{method:'POST',headers:{Host:'play.retro-museum.net',Origin:'https://unrelated.example'},body:JSON.stringify({game:'test-game'})});assert.equal(rejected.status,403);
 }finally{await host.close();}
});
test('public rooms isolate controller credentials, private snapshots and host actions; sessions restore',async()=>{
 const saved=new Map(),store={list:async()=>[...saved.values()],put:async room=>saved.set(room.id,structuredClone(room))};let host=await createGameHost({definitions:[definition],store});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));let origin='http://127.0.0.1:'+host.server.address().port;const sockets=[];
 const post=(path,value,bearer)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify(value)});
 async function connect(room,role,token){const ws=new WebSocket(origin.replace('http','ws')+'/socket');sockets.push(ws);const states=[];ws.on('message',bytes=>{const message=JSON.parse(bytes);if(message.type==='state'){states.push(message.state);ws.send(JSON.stringify({type:'ack',sequence:message.sequence}));}});await new Promise((resolve,reject)=>{ws.once('open',()=>ws.send(JSON.stringify({type:'hello',room,role,token})));ws.on('message',bytes=>{const m=JSON.parse(bytes);if(m.type==='welcome')resolve();if(m.type==='error')reject(Error(m.message));});});return {ws,states};}
 try{
 const a=await(await post('/api/rooms',{game:'test-game'})).json(),b=await(await post('/api/rooms',{game:'test-game'})).json();const path='/api/rooms/'+a.id;
 const p=await(await post(path+'/join',{profile:{name:'Alice'}})).json(),q=await(await post(path+'/join',{profile:{name:'Bob'}})).json();
 assert.equal((await post('/api/rooms/'+b.id+'/join',{token:p.token})).status,401);assert.equal((await post(path+'/control',{action:'start'},p.token)).status,403);
 const phone=await connect(a.id,'controller',p.token);await connect(a.id,'controller',q.token);const display=await connect(a.id,'display');
 const personalDisplay=await connect(a.id,'display');
 assert.equal(host.rooms.get(a.id).party.players.length,2,'a personal display never consumes a player seat');
 assert.equal((await post(path+'/control',{action:'start'},a.hostToken)).status,200);
 await new Promise(r=>setTimeout(r,200));assert.equal(display.states.at(-1).party.community.private,undefined);assert.equal(phone.states.at(-1).party.community.private.card,p.playerId);
 assert.equal(personalDisplay.states.at(-1).party.community.private,undefined);
 personalDisplay.ws.close();await new Promise(r=>setTimeout(r,60));
 assert.equal(host.rooms.get(a.id).party.players.find(x=>x.id===p.playerId).connected,true,'hiding the personal display keeps the player connected');
 assert.equal((await post(path+'/join',{token:p.token})).status,200);assert.equal(Object.keys(host.rooms.get(a.id).members).length,2);
 await host.close();host=await createGameHost({definitions:[definition],store});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+host.server.address().port;
 assert.equal(host.rooms.get(a.id).party.phase,'paused');assert.equal((await post(path+'/join',{token:p.token})).status,200);assert.equal((await post(path+'/control',{action:'end'},a.hostToken)).status,200);
 }finally{for(const ws of sockets)ws.terminate();await host.close();}
});

test('host-limited activities admit a classroom and integer options reject out-of-range input',()=>{
 const def={...definition,playerCapacity:80,pack:{...definition.pack,manifest:{...definition.pack.manifest,players:{min:1,max:null},options:{questionCount:{type:'integer',min:1,max:100,default:10}}}}};
 const party=new RoomParty({definition:def});try{for(let i=0;i<80;i++)party.join('p'+i);assert.equal(party.maxPlayers,80);assert.equal(party.snapshot().canJoin,false);assert.throws(()=>party.join('overflow'),/partyFull/);assert.equal(party.validateOptions({questionCount:73}).questionCount,73);assert.throws(()=>party.validateOptions({questionCount:101}));assert.throws(()=>party.validateOptions({questionCount:'10'}));}finally{party.dispose();}
});
