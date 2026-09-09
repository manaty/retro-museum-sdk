// Immutable, JSON-only patches. Stable IDs avoid retransmitting arrays when a
// trajectory grows at its head or an item disappears in the middle of a list.
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keyOf=(item,kind)=>kind==='points'?item[2]:item.id;
function keyedKind(a,b,field){
 const values=a.concat(b);if(!values.length)return null;
 const kind=field==='body'&&values.every(x=>Array.isArray(x)&&x.length===3&&x.every(Number.isFinite)&&Number.isSafeInteger(x[2]))?'points':values.every(x=>object(x)&&(typeof x.id==='string'||Number.isSafeInteger(x.id)))?'objects':null;
 return kind&&[a,b].every(list=>new Set(list.map(x=>keyOf(x,kind))).size===list.length)?kind:null;
}
export function difference(previous,next,field=''){
 if(Object.is(previous,next))return null;
 if(Array.isArray(previous)&&Array.isArray(next)){
  const kind=keyedKind(previous,next,field);
  if(kind){
   const before=new Map(previous.map(x=>[keyOf(x,kind),x])),after=new Map(next.map(x=>[keyOf(x,kind),x]));
   const removed=[...before.keys()].filter(id=>!after.has(id)),changes=[];
   for(const[id,value]of after){const patch=before.has(id)?difference(before.get(id),value):[0,value];if(patch)changes.push([id,patch]);}
   let order=null;
   if(kind==='objects'){
    const natural=[...before.keys()].filter(id=>after.has(id)).concat([...after.keys()].filter(id=>!before.has(id)));
    if(!same(natural,[...after.keys()]))order=[...after.keys()];
   }
   return removed.length||changes.length||order?[2,kind,removed,changes,order]:null;
  }
  return same(previous,next)?null:[0,next];
 }
 if(object(previous)&&object(next)){
  const removed=Object.keys(previous).filter(k=>!own(next,k)),changes=Object.create(null);
  for(const k of Object.keys(next)){const patch=own(previous,k)?difference(previous[k],next[k],k):[0,next[k]];if(patch)changes[k]=patch;}
  return removed.length||Object.keys(changes).length?[1,removed,changes]:null;
 }
 return [0,next];
}
export function applyDifference(previous,patch,depth=0){
 if(patch===null)return previous;
 if(depth>40||!Array.isArray(patch))throw Error('Invalid state patch');
 if(patch[0]===0&&patch.length===2)return patch[1];
 if(patch[0]===1&&object(previous)&&Array.isArray(patch[1])&&object(patch[2])){
  const result=Object.assign(Object.create(null),previous);
  for(const key of patch[1])delete result[key];
  for(const key of Object.keys(patch[2]))Object.defineProperty(result,key,{value:applyDifference(previous[key],patch[2][key],depth+1),enumerable:true,writable:true,configurable:true});
  return result;
 }
 if(patch[0]===2&&Array.isArray(previous)&&['points','objects'].includes(patch[1])&&Array.isArray(patch[2])&&Array.isArray(patch[3])){
  const kind=patch[1],map=new Map(previous.map(x=>[keyOf(x,kind),x]));
  for(const id of patch[2])map.delete(id);
  for(const[id,change]of patch[3]){const item=applyDifference(map.get(id),change,depth+1);if(keyOf(item,kind)!==id)throw Error('State identity mismatch');map.set(id,item);}
  if(kind==='points')return [...map.values()].sort((a,b)=>b[2]-a[2]);
  if(patch[4]){if(patch[4].length!==map.size||new Set(patch[4]).size!==map.size||patch[4].some(id=>!map.has(id)))throw Error('Invalid state order');return patch[4].map(id=>map.get(id));}
  return [...map.values()];
 }
 throw Error('Invalid state patch');
}
export class StateEncoder{
 constructor(){this.reset();}
 reset(){this.baseline=null;this.sequence=0;this.pending=null;}
 encode(state,sequence){
  const full=JSON.stringify({type:'state',sequence,state});let message=full;
  if(this.baseline&&this.baseline.sessionId===state.sessionId){const delta=JSON.stringify({type:'stateDelta',sequence,baseSequence:this.sequence,patch:difference(this.baseline,state)});if(delta.length<full.length*.9)message=delta;}
  this.pending={state:JSON.parse(full).state,sequence};return message;
 }
 acknowledge(sequence){if(this.pending?.sequence!==sequence)return false;this.baseline=this.pending.state;this.sequence=sequence;this.pending=null;return true;}
}
export class StateDecoder{
 constructor(){this.reset();}
 reset(){this.state=null;this.sequence=0;}
 accept(message){
  if(!Number.isSafeInteger(message.sequence)||message.sequence<=this.sequence)throw Error('Stale state');
  if(message.type==='state')this.state=message.state;
  else if(message.type==='stateDelta'&&this.state&&message.baseSequence===this.sequence)this.state=applyDifference(this.state,message.patch);
  else throw Error('Missing state baseline');
  this.sequence=message.sequence;return this.state;
 }
}
