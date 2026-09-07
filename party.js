import {randomUUID} from 'node:crypto';
import {GameRuntime} from './runtime.js';
const colors=['#a8dc78','#ea92bb','#8bc9ec','#efbd73','#b49ced','#ec8c72','#7bddc9','#ded987'];
export class CommunityParty {
 constructor({definition,stations,clock=Date.now,saved}={}){
  this.definition=definition;this.clock=clock;this.game='market.'+definition.pack.manifest.id;this.stations=[...stations];this.id=randomUUID();this.players=[];this.phase='ready';this.remainingMs=definition.pack.manifest.durationMinutes*60000;this.runningSince=null;this.introEndsAt=null;this.startedAt=null;this.reason=null;this.engine=null;this.options={};this.lastTick=clock();this.disconnected=new Map();this.seen=new Set();
  if(saved){for(const k of ['id','players','phase','remainingMs','startedAt','reason','options'])if(saved[k]!==undefined)this[k]=structuredClone(saved[k]);this.players.forEach(p=>p.connected=false);if(saved.engine)this.engine=new GameRuntime(definition.pack,this.players,saved.engine,this.options);if(['playing','intro'].includes(this.phase)){this.phase='paused';this.reason='serverRestart';}}
 }
 get minPlayers(){return this.definition.pack.manifest.players.min;}
 get maxPlayers(){return this.definition.pack.manifest.players.max;}
 get canStart(){return this.players.filter(p=>p.connected).length>=this.minPlayers;}
 get required(){return this.engine?.metadata?.requiredPlayers||[];}
 get canResume(){return Boolean(this.engine)&&this.required.every(id=>this.players.some(p=>p.id===id&&p.connected));}
 player(station,deviceId){return this.players.find(p=>p.deviceId===deviceId&&this.stations.includes(station));}
 join(station,deviceId){let p=this.player(station,deviceId);if(!p){if(this.players.length>=this.maxPlayers)throw Error('partyFull');p={id:randomUUID(),station,deviceId,number:this.players.length+1,color:colors[this.players.length%colors.length],connected:true};this.engine?.addPlayer(p);this.players.push(p);}p.connected=true;p.station=station;this.disconnected.delete(p.id);if(this.phase==='paused'&&['playerDisconnected','clientUpdate','serverRestart'].includes(this.reason)&&this.canResume)this.admin('resume');return p.id;}
 leave(station,deviceId,{updateUntil}={}){const p=this.player(station,deviceId);if(!p)return;p.connected=false;this.engine?.release(p.id);if(this.required.includes(p.id)&&['playing','intro'].includes(this.phase))this.disconnected.set(p.id,{until:updateUntil>this.clock()?Math.min(updateUntil,this.clock()+30000):this.clock()+20000,reason:updateUntil>this.clock()?'clientUpdate':'playerDisconnected'});}
 remaining(){return Math.max(0,this.remainingMs-(this.phase==='playing'?this.clock()-this.runningSince:0));}
 validate(action){if(!['start','skipIntro','pause','resume','reset','end'].includes(action))throw Error('invalidGameAction');if(action==='start'&&(this.phase!=='ready'||!this.canStart))throw Error('needPlayers');if(action==='resume'&&(this.phase!=='paused'||!this.canResume||this.failed))throw Error('needPlayers');if(action==='skipIntro'&&this.phase!=='intro')throw Error('noIntro');if(action==='pause'&&!['playing','intro'].includes(this.phase))throw Error('noPartyToPause');}
 admin(action,at=this.clock(),options){this.validate(action);if(action==='start'){this.options=options||{};this.players=this.players.filter(p=>p.connected).map((p,i)=>({...p,number:i+1}));this.engine=new GameRuntime(this.definition.pack,this.players,null,this.options);this.phase='intro';this.startedAt=at;this.introEndsAt=at+3000;this.reason=null;}
  if(action==='resume'||action==='skipIntro'){this.phase='playing';this.runningSince=at;this.introEndsAt=null;this.lastTick=at;this.reason=null;}
  if(action==='pause'||action==='end'){this.remainingMs=this.remaining();this.phase=action==='pause'?'paused':'ended';this.runningSince=null;this.introEndsAt=null;this.reason=action==='pause'?'adminPause':'adminEnded';if(!this.failed)this.engine?.release();}
  if(action==='reset'){this.engine?.dispose();this.engine=null;this.failed=false;this.id=randomUUID();this.phase='ready';this.players=this.players.filter(p=>p.connected);this.remainingMs=this.definition.pack.manifest.durationMinutes*60000;this.runningSince=null;this.introEndsAt=null;this.reason=null;this.disconnected.clear();this.seen.clear();}
 }
 command(player,message){if(message.matchId!==this.id)throw Error('oldMatch');if(this.phase!=='playing'||this.failed)throw Error('gameNotPlaying');const key=player.id+':'+message.id;if(this.seen.has(key))return {duplicate:true};if(message.action!=='communityAction'||!message.value||typeof message.value.action!=='string')throw Error('invalidGameAction');this.engine.action(player.id,message.value.action,message.value.value);this.seen.add(key);if(this.seen.size>2000)this.seen.delete(this.seen.values().next().value);this.finishIfWon();return {duplicate:false};}
 finishIfWon(){if(this.engine?.winner){this.remainingMs=this.remaining();this.phase='solved';this.runningSince=null;this.reason='gameWon';}}
 tick(){const now=this.clock();for(const [id] of this.disconnected)if(!this.required.includes(id)||this.players.some(p=>p.id===id&&p.connected))this.disconnected.delete(id);
  if(['intro','playing'].includes(this.phase)&&this.disconnected.size){const loss=[...this.disconnected.values()].sort((a,b)=>a.until-b.until)[0];if(now>=loss.until||(this.engine?.metadata?.decisionSeconds??Infinity)<=3){this.admin('pause');this.reason=loss.reason;return true;}}
  if(this.phase==='intro'&&now>=this.introEndsAt){this.admin('skipIntro');return true;}
  if(this.phase!=='playing'||now-this.lastTick<250)return false;
  try{const changed=this.engine.advance((now-this.lastTick)/1000);this.lastTick=now;const before=this.phase;this.finishIfWon();if(this.remaining()<=0)this.admin('end');return Boolean(changed)||before!==this.phase;}catch{this.remainingMs=this.remaining();this.phase='paused';this.runningSince=null;this.reason='communityError';this.failed=true;return true;}
 }
 snapshot(role,station,deviceId,profile=()=>({})){
  const player=role==='controller'?this.player(station,deviceId):null;let community=null;
  try{if(this.engine&&!this.failed)community=this.engine.snapshot(player?.id);}catch{this.failed=true;}
  return {id:this.id,game:this.game,stations:this.stations,phase:this.phase,reason:this.reason,remainingMs:this.remaining(),introRemainingMs:this.phase==='intro'?Math.max(0,this.introEndsAt-this.clock()):0,players:this.players.map(({deviceId,...p})=>({...p,...profile(deviceId)})),you:player?.id||null,minPlayers:this.minPlayers,maxPlayers:this.maxPlayers,canStart:this.canStart,canResume:this.canResume,canJoin:this.players.length<this.maxPlayers,community,plugin:{id:this.definition.pack.manifest.id,version:this.definition.pack.manifest.version,hash:this.definition.hash,title:this.definition.pack.manifest.title},reconnectingPlayers:[...this.disconnected].map(([id,x])=>({id,remainingMs:Math.max(0,x.until-this.clock())})),failed:Boolean(this.failed)};
 }
 save(){let engine=null;try{if(!this.failed)engine=this.engine?.save()||null;}catch{}return {game:this.game,id:this.id,pluginHash:this.definition.hash,stations:this.stations,players:this.players,phase:this.phase,reason:this.reason,remainingMs:this.remaining(),startedAt:this.startedAt,options:this.options,engine};}
 dispose(){this.engine?.dispose();}
}
