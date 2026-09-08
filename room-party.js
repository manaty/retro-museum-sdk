import {randomUUID} from 'node:crypto';
import {GameRuntime} from './runtime.js';

// The same match lifecycle is used by standalone rooms and museum stations.
// Devices join a lobby; arrivals after start spectate until the next match.
export class RoomParty {
 constructor({definition,clock=Date.now,saved}={}) {
  this.definition=definition;this.clock=clock;this.id=randomUUID();this.players=[];this.phase='ready';this.reason=null;this.engine=null;this.options={};this.remainingMs=definition.pack.manifest.durationMinutes*60000;this.lastTick=clock();this.runningSince=null;this.introEndsAt=null;this.seen=new Set();this.disconnects=new Map();
  this.autoStartWhenFull=definition.pack.manifest.autoStartWhenFull===true;this.options=this.validateOptions();
  if(saved){for(const key of ['id','players','phase','reason','options','remainingMs','language','autoStartWhenFull'])if(saved[key]!==undefined)this[key]=structuredClone(saved[key]);this.players.forEach(p=>p.connected=false);if(saved.engine)this.engine=this.createEngine(this.players.filter(p=>!p.spectator),saved.engine);if(['playing','intro'].includes(this.phase)){this.phase='paused';this.reason='serverRestart';}}
 }
 createEngine(players,saved){const options={...this.options,language:this.language||'en'};return this.definition.createEngine?this.definition.createEngine(players,saved,options):new GameRuntime(this.definition.pack,players,saved,options);}
 get minPlayers(){return this.definition.pack.manifest.players.min;}
 get maxPlayers(){return this.definition.pack.manifest.players.max??this.definition.playerCapacity??128;}
 get required(){return this.engine?.metadata?.requiredPlayers||[];}
 get canStart(){return this.players.filter(p=>p.connected).length>=this.minPlayers;}
 get canResume(){return Boolean(this.engine)&&!this.failed&&this.required.every(id=>this.players.some(p=>p.id===id&&p.connected));}
 join(id,profile={}){
  let player=this.players.find(p=>p.id===id);
  if(!player){if(this.players.length>=(this.definition.pack.manifest.players.max===null?this.maxPlayers:32))throw Error('partyFull');player={id,number:this.players.length+1,color:['#64ddff','#ff7286','#ffd166','#b79bff','#71e5a4','#ffab66','#f293ef'][this.players.length%7],spectator:this.phase!=='ready'||this.players.filter(p=>!p.spectator).length>=this.maxPlayers};this.players.push(player);}
  Object.assign(player,profile,{connected:true});this.disconnects.delete(id);
  if(this.phase==='paused'&&['playerDisconnected','serverRestart','roomEmpty'].includes(this.reason)&&this.canResume)this.admin('resume');
  this.maybeAutoStart();
  return player;
 }
 maybeAutoStart(){if(this.phase==='ready'&&this.autoStartWhenFull&&this.definition.pack.manifest.players.max!==null&&this.players.filter(p=>p.connected).length>=this.maxPlayers)this.admin('start',this.options);}
 configure({options=this.options,autoStartWhenFull=this.autoStartWhenFull}={}){
  if(this.phase!=='ready')throw Error('Game already started');
  if(typeof autoStartWhenFull!=='boolean'||autoStartWhenFull&&this.definition.pack.manifest.players.max===null)throw Error('Automatic start requires a fixed player maximum');
  const validated=this.validateOptions(options);this.options=validated;this.autoStartWhenFull=autoStartWhenFull;this.maybeAutoStart();
 }
 leave(id){const p=this.players.find(p=>p.id===id);if(!p)return;p.connected=false;this.engine?.release(id);if(this.required.includes(id)&&['playing','intro'].includes(this.phase))this.disconnects.set(id,this.clock()+20000);}
 remaining(){return Math.max(0,this.remainingMs-(this.phase==='playing'?this.clock()-this.runningSince:0));}
 validateOptions(value={}){if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid options');const schema=this.definition.pack.manifest.options||{};for(const [key,item] of Object.entries(value))if(!(schema[key]?.type==='integer'?Number.isInteger(item)&&item>=schema[key].min&&item<=schema[key].max:schema[key]?.values?.includes(item)))throw Error('Invalid option: '+key);return Object.fromEntries(Object.entries(schema).map(([key,item])=>[key,value[key]??item.default]));}
 admin(action,options){
  if(action==='start'){
   if(this.phase!=='ready'||!this.canStart)throw Error('needPlayers');this.options=this.validateOptions(options??this.options);
   this.players=this.players.filter(p=>p.connected).map((p,i)=>({...p,number:i+1,spectator:i>=this.maxPlayers}));
   this.engine=this.createEngine(this.players.filter(p=>!p.spectator),null);this.phase='intro';this.introEndsAt=this.clock()+(this.definition.pack.manifest.introMs||3000);this.reason=null;
  }else if(action==='pause'){
   if(!['intro','playing'].includes(this.phase))throw Error('noPartyToPause');this.remainingMs=this.remaining();this.phase='paused';this.runningSince=null;this.introEndsAt=null;this.reason='adminPause';this.engine?.release();
  }else if(action==='resume'){
   if(this.phase!=='paused'||!this.canResume)throw Error('needPlayers');this.phase='playing';this.runningSince=this.clock();this.lastTick=this.clock();this.reason=null;
  }else if(action==='end'){
   this.remainingMs=this.remaining();this.phase='ended';this.runningSince=null;this.reason='adminEnded';this.engine?.release();
  }else if(action==='playAgain'){
   if(!['ended','solved'].includes(this.phase))throw Error('gameNotFinished');
   this.engine?.dispose();this.engine=null;this.failed=false;this.id=randomUUID();this.phase='ready';this.reason=null;this.remainingMs=this.definition.pack.manifest.durationMinutes*60000;this.runningSince=null;this.introEndsAt=null;this.seen.clear();this.disconnects.clear();this.players=this.players.filter(p=>p.connected).map((p,i)=>({...p,number:i+1,spectator:i>=this.maxPlayers}));
  }else throw Error('invalidGameAction');
 }
 command(id,message){
  if(message.matchId!==this.id)throw Error('oldMatch');const player=this.players.find(p=>p.id===id&&p.connected);if(!player||player.spectator)throw Error('spectator');
  if(this.phase!=='playing'||this.failed)throw Error('gameNotPlaying');
  if(message.action==='hostTimeUp')throw Error('invalidGameAction');
  const key=id+':'+message.id;if(this.seen.has(key))return {duplicate:true};
  this.engine.action(id,message.action,message.value);this.seen.add(key);if(this.seen.size>2000)this.seen.delete(this.seen.values().next().value);this.finish();return {duplicate:false};
 }
 finish(){if(this.engine?.winner||this.engine?.metadata?.ended){this.remainingMs=this.remaining();this.phase=this.engine.winner?'solved':'ended';this.runningSince=null;this.reason=this.engine.winner?'gameWon':'gameLost';if(this.definition.pack.manifest.id==='chess')for(const rating of this.engine.metadata?.ratings||[]){const player=this.players.find(p=>p.id===rating.id);if(player&&Number.isInteger(rating.after)&&rating.after>=0&&rating.after<=4000)player.chessElo=rating.after;}this.engine.release();}}
 tick(){
  const now=this.clock();for(const [id] of this.disconnects)if(!this.required.includes(id)||this.players.some(p=>p.id===id&&p.connected))this.disconnects.delete(id);
  if(['intro','playing'].includes(this.phase)&&this.disconnects.size&&(now>=Math.min(...this.disconnects.values())||(this.engine.metadata?.decisionSeconds??Infinity)<=3)){this.admin('pause');this.reason='playerDisconnected';return;}
  if(this.phase==='intro'&&now>=this.introEndsAt){this.phase='playing';this.runningSince=now;this.lastTick=now;this.introEndsAt=null;}
  if(this.phase!=='playing')return;
  try{this.engine.advance(Math.min(.1,Math.max(0,(now-this.lastTick)/1000)));this.lastTick=now;this.finish();if(this.remaining()<=0){this.engine.action(null,'hostTimeUp',{});this.finish();if(this.phase==='playing')this.admin('end');}}
  catch(error){this.remainingMs=this.remaining();this.phase='paused';this.reason='communityError';this.runningSince=null;this.failed=true;this.failure=String(error.message);}
 }
 snapshot(id){return {id:this.id,phase:this.phase,reason:this.reason,remainingMs:this.remaining(),introRemainingMs:this.phase==='intro'?Math.max(0,this.introEndsAt-this.clock()):0,players:this.players.map(p=>({...p})),you:id||null,minPlayers:this.minPlayers,maxPlayers:this.maxPlayers,canStart:this.canStart,canResume:this.canResume,canJoin:this.players.length<(this.definition.pack.manifest.players.max===null?this.maxPlayers:32),community:this.engine&&!this.failed?this.engine.snapshot(id):null,reconnectingPlayers:[...this.disconnects].map(([id,until])=>({id,remainingMs:Math.max(0,until-this.clock())})),autoStartWhenFull:this.autoStartWhenFull,options:this.options};}
 save(){return {id:this.id,players:this.players,phase:this.phase,reason:this.reason,autoStartWhenFull:this.autoStartWhenFull,options:this.options,language:this.language||'en',remainingMs:this.remaining(),engine:this.engine&&!this.failed?this.engine.save():null};}
 dispose(){this.engine?.dispose();this.engine=null;}
}
