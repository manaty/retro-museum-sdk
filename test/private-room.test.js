import test from 'node:test';import assert from 'node:assert/strict';
import {createGameHost} from '../host.js';import {digest} from '../manifest.js';
const pack={manifest:{schemaVersion:1,id:'private-quiz',version:'1.0.0',title:{en:'Private quiz'},description:{en:'A transferred questionnaire'},author:'Fixture',license:'MIT',languages:['en'],players:{min:1,max:4},durationMinutes:10,runtime:'quickjs-v1',entry:'dist/game.rmg.json',permissions:[]},licenseText:'MIT fixture license. '.repeat(10),assets:{},view:'<!doctype html><html><body>Fixture</body></html>',engine:'globalThis.RetroMuseumGame={create(){return {snapshot(){return {}},save(){return {}},advance(){},action(){},status(){return {winner:null}}}}}'};
const source=JSON.stringify(pack),definition={pack,source,hash:digest(source)};
test('private configured rooms preserve host authorization, capacity, package pinning and catalog isolation',async()=>{
 const saved=new Map(),packages=new Map(),store={list:async()=>[...saved.values()],put:async r=>saved.set(r.id,structuredClone(r)),putPackage:async(h,s)=>packages.set(h,s),getPackage:async h=>packages.get(h)};
 let host;host=await createGameHost({definitions:[],store,maxRooms:1,requestHandler:async(req,res)=>{
  if(req.url!=='/private-room')return false;const room=await host.createRoom(req,{language:'en'},definition);res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify(room));return true;
 }});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+host.server.address().port;
 try{
  assert.equal((await fetch(base+'/private-room',{method:'POST',headers:{Origin:'https://unrelated.example'}})).status,403);
  const response=await fetch(base+'/private-room',{method:'POST',headers:{Origin:base}});assert.equal(response.status,201);const room=await response.json();assert(room.hostToken);
  assert.deepEqual(await(await fetch(base+'/api/games')).json(),[]);assert.equal((await fetch(base+'/api/rooms/'+room.id)).status,200);
  assert.equal((await fetch(base+'/private-room',{method:'POST'})).status,503);assert.equal(packages.get(definition.hash),source);
  await host.close();host=await createGameHost({definitions:[],store});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+host.server.address().port;
  assert.equal((await fetch(base+'/api/rooms/'+room.id)).status,200);assert.deepEqual(await(await fetch(base+'/api/games')).json(),[]);
 }finally{await host.close();}
});
