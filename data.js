import {gunzipSync} from 'node:zlib';
const cache=new WeakMap();
export const MAX_DATA_BYTES=64*1024*1024;
// Immutable package-owned lookup tables. Nothing can address host files or network resources.
export function prepareData(pack){
 if(cache.has(pack))return cache.get(pack);
 const tables=pack.data||{};
 if(!tables||typeof tables!=='object'||Array.isArray(tables)||Object.keys(tables).length>32)throw Error('Invalid data tables.');
 const decoded=Object.create(null);let total=0;
 for(const [name,item] of Object.entries(tables)){
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(name)||item?.encoding!=='gzip-base64'||typeof item.data!=='string'||item.data.length>24*1024*1024||item.data.length%4||/[^A-Za-z0-9+/=]/.test(item.data)||Buffer.from(item.data,'base64').toString('base64')!==item.data)throw Error('Invalid data table.');
  const bytes=gunzipSync(Buffer.from(item.data,'base64'),{maxOutputLength:MAX_DATA_BYTES-total});total+=bytes.length;
  const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))throw Error('Invalid data encoding.');
  let previous='',offset=0;
  while(offset<text.length){const end=text.indexOf('\n',offset),stop=end<0?text.length:end,tab=text.indexOf('\t',offset);if(tab<offset||tab>=stop||tab-offset>80||stop-tab>1001)throw Error('Invalid data row.');const key=text.slice(offset,tab);if(!/^[a-zñ0-9-]+$/.test(key)||key<=previous)throw Error('Data keys must be unique and sorted.');previous=key;offset=stop+1;}
  decoded[name]=text;
 }
 const lookup=(table,key)=>{
  if(typeof table!=='string'||typeof key!=='string'||key.length>80||!Object.hasOwn(decoded,table))return null;
  const text=decoded[table];let lo=0,hi=text.length;
  while(lo<hi){const mid=Math.floor((lo+hi)/2),start=mid===lo?lo:text.lastIndexOf('\n',mid-1)+1,tab=text.indexOf('\t',start),end=text.indexOf('\n',tab),stop=end<0?text.length:end;const found=text.slice(start,tab);if(found===key)return text.slice(tab+1,stop);if(found<key)lo=stop+1;else hi=start;}
  return null;
 };
 cache.set(pack,lookup);return lookup;
}
