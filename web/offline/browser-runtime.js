import {newQuickJSWASMModuleFromVariant,newVariant,RELEASE_SYNC} from 'quickjs-emscripten';
import {gunzipSync} from 'fflate';
import {defineGameRuntime} from '../../runtime-core.js';
import {definePrepareData} from '../../data-core.js';
import {randomInt} from './shims/crypto.js';

const decoder=new TextDecoder('utf-8',{fatal:true});
export const prepareData=definePrepareData((data,limit)=>{
 const binary=atob(data),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 const output=gunzipSync(bytes);if(output.length>limit)throw Error('Data tables are too large.');
 let text;try{text=decoder.decode(output);}catch{throw Error('Invalid data encoding.');}
 return {text,size:output.length};
});
// room-party.js imports this binding; it is assigned before any room exists.
export let GameRuntime=null;
export async function initRuntime(wasmUrl){
 if(GameRuntime)return GameRuntime;
 const QuickJS=await newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC,{wasmLocation:wasmUrl}));
 GameRuntime=defineGameRuntime({QuickJS,randomInt,prepareData});return GameRuntime;
}
