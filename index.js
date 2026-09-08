export * from './manifest.js';
export * from './runtime.js';
import {parsePackage,digest} from './manifest.js';
import {GameRuntime} from './runtime.js';
export function validatePackage(bytes){
 const checks=[],pack=parsePackage(bytes),start=performance.now();
 checks.push({name:'manifest-and-assets',passed:true});
 for(const count of [...new Set([pack.manifest.players.min,pack.manifest.players.max??128])]){
  const players=Array.from({length:count},(_,i)=>({id:`player-${i}`,number:i+1,color:['#abdf77','#ed9aca','#89c8fa','#ffbe69'][i%4]}));
  let game,restored;
  try{
   game=new GameRuntime(pack,players);
   const publicView=game.snapshot();if(publicView?.private)throw new Error('Public view exposes a private field.');
   const own=players.map(p=>game.snapshot(p.id));
   const save=game.save();restored=new GameRuntime(pack,players,save);
   if(JSON.stringify(restored.snapshot())!==JSON.stringify(publicView)||players.some((p,i)=>JSON.stringify(restored.snapshot(p.id))!==JSON.stringify(own[i])))throw new Error('Save/restore changed a public or private view.');
   game.addPlayer({id:'late-player',number:count+1});game.release(players[0].id);
   for(let i=0;i<120;i++)game.advance(.25);
   game.snapshot();game.snapshot('late-player');
   if(!game.metadata||!Array.isArray(game.metadata.requiredPlayers)||game.metadata.requiredPlayers.some(id=>!players.some(p=>p.id===id)))throw new Error('Invalid required-player status.');
   checks.push({name:`lifecycle-${count}-players`,passed:true});
  }finally{game?.dispose();restored?.dispose();}
 }
 return {schemaVersion:1,status:'passed',sha256:digest(bytes),game:pack.manifest.id,version:pack.manifest.version,checks,durationMs:Math.round(performance.now()-start),limits:{memoryMb:24,operationMs:40,externalPermissions:[]},scope:'Automated compatibility checks, not a security or gameplay certification.'};
}
