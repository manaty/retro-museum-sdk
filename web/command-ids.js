// Game frames often restart their counters at 1 after a reload. Namespace those
// counters per frame lifetime, while keeping the same namespace on WS reconnect.
export function createCommandIds(nonce=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12)){
 const prefix=nonce+':';
 return {
  encode(id){if(typeof id!=='string'||!id.length||id.length>64)throw Error('Invalid command identifier');return prefix+id;},
  decode(id){return typeof id==='string'&&id.startsWith(prefix)?id.slice(prefix.length):null;}
 };
}
