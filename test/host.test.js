import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createGameHost} from '../host.js';
import {RoomParty} from '../room-party.js';
const definition={hash:'a'.repeat(64),pack:{manifest:{id:'test-game',version:'1.0.0',title:{en:'Test'},description:{en:'A test'},players:{min:2,max:4},durationMinutes:15,options:{}},engine:`globalThis.RetroMuseumGame={create(players,saved){let n=saved?.n||0;return {snapshot(id){return {n,...(id?{private:{card:id}}:{})}},save(){return {n}},advance(){},action(id,a){if(a!=='move')throw Error('invalid');n++},status(){return {winner:null,requiredPlayers:players.map(p=>p.id)}},release(){},addPlayer(){}}}}`,view:'<!doctype html><html><body>Test</body></html>',assets:{}}};
test('late arrivals join the next match; eliminated players do not block resume; stale commands fail',()=>{
 let now=0;const party=new RoomParty({definition,clock:()=>now});try{
 party.join('a');party.join('b');party.admin('start');const old=party.id;now=3001;party.tick();party.join('c');assert.equal(party.players.find(p=>p.id==='c').spectator,true);assert.throws(()=>party.command('c',{matchId:old,id:'x',action:'move'}),/spectator/);
 party.leave('b');now+=19999;party.tick();assert.equal(party.phase,'playing');now+=2;party.tick();assert.equal(party.phase,'paused');party.join('b');assert.equal(party.phase,'playing');
 party.admin('end');party.admin('playAgain');party.admin('start');now+=3001;party.tick();assert.equal(party.players.find(p=>p.id==='c').spectator,false);assert.throws(()=>party.command('a',{matchId:old,id:'x',action:'move'}),/oldMatch/);assert.throws(()=>party.command('a',{matchId:party.id,id:'x',action:'hostTimeUp'}),/invalidGameAction/);
 }finally{party.dispose();}
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
 assert.equal((await post(path+'/control',{action:'start'},a.hostToken)).status,200);
 await new Promise(r=>setTimeout(r,200));assert.equal(display.states.at(-1).party.community.private,undefined);assert.equal(phone.states.at(-1).party.community.private.card,p.playerId);
 assert.equal((await post(path+'/join',{token:p.token})).status,200);assert.equal(Object.keys(host.rooms.get(a.id).members).length,2);
 await host.close();host=await createGameHost({definitions:[definition],store});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+host.server.address().port;
 assert.equal(host.rooms.get(a.id).party.phase,'paused');assert.equal((await post(path+'/join',{token:p.token})).status,200);assert.equal((await post(path+'/control',{action:'end'},a.hostToken)).status,200);
 }finally{for(const ws of sockets)ws.terminate();await host.close();}
});
