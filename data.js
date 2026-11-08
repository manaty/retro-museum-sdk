import {gunzipSync} from 'node:zlib';
import {definePrepareData,MAX_DATA_BYTES} from './data-core.js';
export {MAX_DATA_BYTES};
export const prepareData=definePrepareData((data,limit)=>{
 if(Buffer.from(data,'base64').toString('base64')!==data)throw Error('Invalid data table.');
 const bytes=gunzipSync(Buffer.from(data,'base64'),{maxOutputLength:limit});
 const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))throw Error('Invalid data encoding.');
 return {text,size:bytes.length};
});
