import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomParty} from '../room-party.js';
import {createLocalHost,offlineProfile} from '../web/offline/local-host.js';
import {pipe,framed,serveLink,tunnelClient} from '../web/offline/link.js';

const manifest={schemaVersion:1,id:'offline-test',version:'1.0.0',title:{en:'Offline'},description:{en:'Offline test'},author:'Manaty',license:'MIT',languages:['en'],players:{min:2,max:4},durationMinutes:10,runtime:'quickjs-v1',entry:'dist/game.rmg.json',permissions:[]};
const engine=`globalThis.RetroMuseumGame={create(players,saved){let s=saved||{moves:0,secret:{}};for(const p of players)s.secret[p.id]=s.secret[p.id]||'card-'+p.id.slice(0,4);return{action(id,a){if(a!=='move')throw Error('illegal');s.moves++},advance(){},snapshot(id){return {moves:s.moves,mine:id?s.secret[id]:null}},save(){return s},release(){},status(){return {ended:s.moves>=3,winner:null,requiredPlayers:[]}},addPlayer(){}}}}`;
const definition={pack:{manifest,engine,view:'<html></html>',assets:{}},hash:'a'.repeat(64)};
function memoryStore(){const rooms=new Map();return {rooms,list:async()=>[...rooms.values()].map(r=>structuredClone(r)),put:async r=>{rooms.set(r.id,structuredClone(r));},delete:async id=>{rooms.delete(id);}};}
const wait=(ms=30)=>new Promise(r=>setTimeout(r,ms));
async function json(client,path,body,token){const response=await client.fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};}
function connect(host){const [a,b]=pipe();serveLink(host,framed(a));return {client:tunnelClient(framed(b)),drop:()=>a.close()};}
function socket(client,hello){const ws=client.socket('ws://local/socket'),messages=[];ws.onmessage=e=>{const m=JSON.parse(e.data);messages.push(m);if(m.type==='state')ws.send(JSON.stringify({type:'ack',sequence:m.sequence}));};ws.onopen=()=>ws.send(JSON.stringify({type:'hello',...hello}));return {ws,messages,states:()=>messages.filter(m=>m.type==='state')};}

test('offline host runs a room over tunnelled links with private state and organiser control',async()=>{
 const store=memoryStore();const host=createLocalHost({Party:RoomParty,store,definitionForGame:async id=>id==='offline-test'?definition:null,definitionForHash:async()=>definition});
 host.start();
 try{
  const organiser=connect(host),alice=connect(host),bob=connect(host);
  const created=await json(organiser.client,'/api/rooms',{game:'offline-test',language:'fr'});
  assert.equal(created.status,201);assert.match(created.body.id,/^[a-f0-9]{12}$/);assert.equal(created.body.offline,true);
  assert.equal((await json(organiser.client,'/api/rooms',{game:'missing'})).status,400);
  const info=await json(alice.client,'/api/rooms/'+created.body.id);assert.equal(info.body.game.id,'offline-test');assert.equal(info.body.offline,true);
  const a=await json(alice.client,'/api/rooms/'+created.body.id+'/join',{profile:{name:'Alice',avatar:'data:image/jpeg;base64,AAAA'}});
  const b=await json(bob.client,'/api/rooms/'+created.body.id+'/join',{profile:{name:'Bob'}});
  assert.equal(a.status,200);assert.notEqual(a.body.token,b.body.token);
  assert.equal((await json(bob.client,'/api/rooms/'+created.body.id+'/join',{token:'forged'})).status,401);
  assert.equal((await json(bob.client,'/api/rooms/'+created.body.id+'/handoff',{})).status,501);
  const display=socket(organiser.client,{room:created.body.id,role:'display',hostToken:created.body.hostToken});
  const sa=socket(alice.client,{room:created.body.id,role:'controller',token:a.body.token});
  const sb=socket(bob.client,{room:created.body.id,role:'controller',token:b.body.token});
  await wait(150);
  const party=host.rooms.get(created.body.id).party;assert.deepEqual(party.players.map(p=>p.name),['Alice','Bob']);assert.equal(party.players[0].avatar,null);
  assert.equal((await json(bob.client,'/api/rooms/'+created.body.id+'/control',{action:'start'},b.body.token)).status,403);
  assert.equal((await json(organiser.client,'/api/rooms/'+created.body.id+'/control',{action:'start'},created.body.hostToken)).status,200);
  await wait(3300);
  sa.ws.send(JSON.stringify({type:'command',id:'c1',matchId:party.id,action:'move'}));await wait(150);
  assert.ok(sa.messages.some(m=>m.type==='ack'&&m.id==='c1'));
  const last=sa.states().at(-1).state.party,lastB=sb.states().at(-1).state.party,publicView=display.states().at(-1).state.party;
  assert.equal(JSON.stringify(last).includes('card-'+party.players[1].id.slice(0,4)),false,'player view leaks another hand');
  assert.ok(JSON.stringify(lastB).includes('card-'+party.players[1].id.slice(0,4)));
  assert.equal(JSON.stringify(publicView).includes('card-'),false,'public view leaks hands');
  // Losing a player's link releases the seat; the room and credentials persist for reconnection.
  alice.drop();await wait(100);assert.equal(party.players[0].connected,false);
  await wait(50);const saved=store.rooms.get(created.body.id);assert.ok(saved.members[a.body.token]);assert.equal(saved.hostToken,created.body.hostToken);
  const again=connect(host);assert.equal((await json(again.client,'/api/rooms/'+created.body.id+'/join',{token:a.body.token})).body.playerId,a.body.playerId);
 }finally{await host.stop();}
});

test('offline host restores saved rooms after the hosting tab reloads',async()=>{
 const store=memoryStore(),options={Party:RoomParty,store,definitionForGame:async()=>definition,definitionForHash:async()=>definition};
 const first=createLocalHost(options);const {client}=connect(first);
 const created=(await json(client,'/api/rooms',{game:'offline-test'})).body;const joined=(await json(client,'/api/rooms/'+created.id+'/join',{profile:{name:'Zoé'}})).body;await first.stop();
 const second=createLocalHost(options);await second.restore();
 try{const link=connect(second).client;assert.equal((await json(link,'/api/rooms/'+created.id+'/join',{token:joined.token})).body.playerId,joined.playerId);
  assert.equal((await json(link,'/api/rooms/'+created.id+'/control',{action:'language',value:'tl'},created.hostToken)).status,200);}
 finally{await second.stop();}
});

test('offline profiles drop avatars and validate names',()=>{
 assert.deepEqual(offlineProfile({name:' Ana ',avatar:'data:x'}),{name:'Ana',avatar:null});
 assert.throws(()=>offlineProfile({name:'x'.repeat(33)}),/32/);
});

test('framed links reassemble large messages',async()=>{
 const [a,b]=pipe(),fa=framed(a),fb=framed(b),got=[];fb.onmessage(t=>got.push(t));
 const big='x'.repeat(70000)+'end';fa.send(big);fa.send('small');await wait(20);assert.deepEqual(got,[big,'small']);
});

test('standalone host serves the installable app and complete packages for offline play',async()=>{
 const {createGameHost}=await import('../host.js');const {digest}=await import('../manifest.js');
 const pack={manifest,engine,view:'<html><body>view</body></html>',assets:{},licenseText:'MIT License. '.repeat(10)};const source=JSON.stringify(pack);
 const app=await createGameHost({definitions:[{pack,source,hash:digest(source)}]});await new Promise(r=>app.server.listen(0,r));const origin='http://localhost:'+app.server.address().port;
 try{
  const games=await (await fetch(origin+'/api/games')).json();assert.equal(games[0].offline,true);
  const response=await fetch(origin+'/packages/'+digest(source)+'/package.json');assert.equal(await response.text(),source);assert.match(response.headers.get('cache-control'),/immutable/);
  const sw=await fetch(origin+'/sw.js');assert.equal(sw.headers.get('service-worker-allowed'),'/');assert.match(await sw.text(),/retro-museum-packages-v1/);
  assert.equal((await (await fetch(origin+'/manifest.webmanifest')).json()).display,'standalone');
  assert.equal((await fetch(origin+'/quickjs.wasm')).headers.get('content-type'),'application/wasm');
  assert.match(await (await fetch(origin+'/')).text(),/rel="manifest"[^>]*>.*offline\.js/);
 }finally{await app.close();}
});
