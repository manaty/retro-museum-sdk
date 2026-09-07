import {getQuickJS} from 'quickjs-emscripten';
import {randomInt} from 'node:crypto';
const QuickJS=await getQuickJS();
const METHODS=new Set(['action','advance','snapshot','save','release','addPlayer','status']);
export class GameRuntime {
 constructor(pack,players=[],saved=null,options={}){
  this.pack=pack;this.runtime=QuickJS.newRuntime();this.runtime.setMemoryLimit(24*1024*1024);this.runtime.setMaxStackSize(512*1024);
  this.deadline=performance.now()+250;this.runtime.setInterruptHandler(()=>performance.now()>this.deadline);
  this.context=this.runtime.newContext();
  const random=this.context.newFunction('__randomInt',bound=>{const max=this.context.getNumber(bound);if(!Number.isInteger(max)||max<1||max>4294967296)throw new Error('Invalid random bound');return this.context.newNumber(randomInt(max));});
  this.context.setProp(this.context.global,'__randomInt',random);random.dispose();
  try{
   this.evaluate(`globalThis.structuredClone=x=>JSON.parse(JSON.stringify(x));globalThis.crypto={getRandomValues(a){for(let i=0;i<a.length;i++)a[i]=__randomInt(4294967296);return a;}};\n${pack.engine}\nif(typeof RetroMuseumGame!=='object'||typeof RetroMuseumGame.create!=='function')throw Error('Missing RetroMuseumGame.create');globalThis.__game=RetroMuseumGame.create(${JSON.stringify(players)},${JSON.stringify(saved)},${JSON.stringify(options)});`);
   this.metadata=this.call('status');
  }catch(error){this.dispose();throw error;}
 }
 evaluate(source){
  const result=this.context.evalCode(source,'game.js');
  if(result.error){const error=this.context.dump(result.error);result.error.dispose();throw new Error(`Game runtime: ${error.message||'execution failed'}`);}
  try{return this.context.dump(result.value);}finally{result.value.dispose();}
 }
 call(method,args=[]){
  if(!METHODS.has(method)||!this.context)throw new Error('Invalid game operation');
  const input=JSON.stringify(args);if(input.length>512000)throw new Error('Game input too large');
  this.deadline=performance.now()+40;
  const output=this.evaluate(`(()=>{const result=__game[${JSON.stringify(method)}](...${input});const json=JSON.stringify(result===undefined?null:result);if(json.length>256000)throw Error('Game output too large');return json;})()`);
  return JSON.parse(output);
 }
 action(id,action,value){const result=this.call('action',[id,action,value]);this.metadata=this.call('status');return result;}
 advance(dt){const result=this.call('advance',[Math.max(0,Math.min(dt,1))]);this.metadata=this.call('status');return result;}
 snapshot(id){return this.call('snapshot',[id||null]);}
 save(){return this.call('save');}
 release(id){return this.call('release',[id||null]);}
 addPlayer(player){return this.call('addPlayer',[player]);}
 get winner(){return this.metadata?.winner||null;}
 dispose(){if(this.context){this.context.dispose();this.context=null;this.runtime.dispose();}}
}
