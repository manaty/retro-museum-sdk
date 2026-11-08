// Browser replacements for the node:crypto functions used by room-party.js.
export const randomUUID=()=>crypto.randomUUID?crypto.randomUUID():'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
export function randomInt(max){if(!Number.isInteger(max)||max<1||max>4294967296)throw RangeError('Invalid random bound');const limit=4294967296-4294967296%max,value=new Uint32Array(1);do crypto.getRandomValues(value);while(value[0]>=limit);return value[0]%max;}
