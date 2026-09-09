import test from 'node:test';import assert from 'node:assert/strict';
import{difference,applyDifference,StateEncoder,StateDecoder}from'../state-delta.js';
const json=x=>JSON.parse(JSON.stringify(x));
test('stable food and trajectory identities survive additions, removals, cell entry and replay',()=>{
 let old={players:[{id:'a',body:[[4,5,5],[3,5,4],[2,5,3]]}],food:[{id:1,x:4},{id:2,x:8}]};
 const states=[{players:[{id:'a',body:[[5,5,6],[4,5,5],[3,5,4]]}],food:[{id:2,x:8},{id:3,x:9}]},{players:[{id:'a',body:[[4,5,5],[2,5,3]]}],food:[]},{players:[{id:'a',body:[[200,300,0],[210,300,-1]]}],food:[{id:99,x:5}]}];
 for(const next of states){const snapshot=json(old);assert.deepEqual(json(applyDifference(old,difference(old,next))),next);assert.deepEqual(old,snapshot);old=next;}
});
test('generic keyed arrays preserve exact order and ordinary arrays fall back safely',()=>{
 for(const [a,b]of [[[{id:'a'},{id:'b'}],[{id:'b'},{id:'c'},{id:'a'}]],[[1,2],[2,3]],[[{id:1},{id:1}],[{id:1}]],[[[1,2]],[[4,5]]]])assert.deepEqual(json(applyDifference(a,difference(a,b))),b);
 const a=JSON.parse('{"__proto__":{"safe":1},"constructor":2}'),b=JSON.parse('{"__proto__":{"safe":2},"prototype":4}');assert.deepEqual(json(applyDifference(a,difference(a,b))),b);assert.equal({}.safe,undefined);
});
test('only acknowledged state becomes the baseline; reconnect, desync and match changes get full states',()=>{
 const encoder=new StateEncoder,decoder=new StateDecoder;
 const state={sessionId:'a',static:'unchanged '.repeat(200),x:1};
 let m=JSON.parse(encoder.encode(state,1));assert.equal(m.type,'state');assert.deepEqual(decoder.accept(m),state);assert.equal(encoder.acknowledge(99),false);encoder.acknowledge(1);
 m=JSON.parse(encoder.encode({...state,x:2},2));assert.equal(m.type,'stateDelta');assert.equal(m.baseSequence,1);assert.deepEqual(json(decoder.accept(m)),{...state,x:2});
 assert.throws(()=>new StateDecoder().accept(m),/baseline/);assert.throws(()=>decoder.accept(m),/Stale/);
 encoder.reset();decoder.reset();m=JSON.parse(encoder.encode({...state,x:3},3));assert.equal(m.type,'state');decoder.accept(m);encoder.acknowledge(3);
 assert.equal(JSON.parse(encoder.encode({...state,sessionId:'b'},4)).type,'state');
});
