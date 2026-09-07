import test from 'node:test';import assert from 'node:assert/strict';import {shareInvitation} from '../web/share.js';
const url='https://play.example/j/123456abcdef';
test('native share receives only a public invitation and cancellation does not copy',async()=>{
 let payload,copied=false;let result=await shareInvitation({url,language:'fr',navigator:{share:async data=>payload=data},document:null});assert.equal(result.status,'shared');assert.deepEqual(payload,{url,title:'Retro Museum',text:'Rejoins ma partie sur Retro Museum !'});
 result=await shareInvitation({url,navigator:{share:async()=>{throw Object.assign(Error('cancelled'),{name:'AbortError'});},clipboard:{writeText:async()=>copied=true}},document:null});assert.equal(result.status,'cancelled');assert.equal(copied,false);
});
test('unsupported or denied native sharing falls back to copy and then manual selection',async()=>{
 let copied;const result=await shareInvitation({url,navigator:{canShare:()=>false,share:()=>assert.fail(),clipboard:{writeText:async value=>copied=value}},document:null});assert.equal(result.status,'copied');assert.equal(copied,url);
 const manual=await shareInvitation({url,navigator:{share:async()=>{throw Error('blocked');}},document:null});assert.equal(manual.status,'manual');assert.equal(manual.url,url);
 await assert.rejects(shareInvitation({url:'javascript:alert(1)',navigator:{},document:null}),/Invalid invitation/);
});
