import test from 'node:test';
import assert from 'node:assert/strict';
import {filterGames,supportsSolo,supportsTogether,createdRoomPath,soloBots} from '../web/play-catalog.js';

const games=[
 {id:'emulator',title:{en:'Computer',fr:'Ordinateur'},description:{en:'Explore BASIC'},players:{min:1,max:1}},
 {id:'quiz',title:{en:'Quiz'},description:{en:'Answer questions',fr:'Répondez aux questions'},players:{min:1,max:null}},
 {id:'chess',title:{en:'Chess',fr:'Échecs'},description:{en:'A duel'},players:{min:2,max:2}}
];
test('solo discovery follows player rules, including community and host-limited games',()=>{
 assert.deepEqual(filterGames(games,{mode:'solo'}).map(g=>g.id),['emulator','quiz']);
 assert.deepEqual(filterGames(games,{mode:'together'}).map(g=>g.id),['quiz','chess']);
 assert.equal(supportsSolo(games[2]),false);
 assert.equal(supportsTogether(games[0]),false);
});
test('search combines mode and localized title/description with English fallback',()=>{
 assert.deepEqual(filterGames(games,{language:'fr',query:'  ÉCHECS '}).map(g=>g.id),['chess']);
 assert.deepEqual(filterGames(games,{language:'fr',mode:'solo',query:'questions'}).map(g=>g.id),['quiz']);
 assert.deepEqual(filterGames(games,{language:'fr',query:'basic'}).map(g=>g.id),['emulator']);
 assert.deepEqual(filterGames(games,{mode:'solo',query:'Chess'}),[]);
});
test('solo enters a combined player screen and shared play keeps its display, including mounted hosts',()=>{
 assert.equal(createdRoomPath('/play',{id:'abc'},'solo'),'/play/j/abc?view=combined');
 assert.equal(createdRoomPath('',{id:'abc'},'together'),'/r/abc');
 assert.ok(!createdRoomPath('',{id:'abc',hostToken:'secret'},'solo').includes('secret'));
 assert.equal(createdRoomPath('',{id:'abc'},'solo',{singleDeviceView:'controller'}),'/j/abc?view=controller');
});
test('solo discovery includes robot-capable games and completes only the required seats',()=>{
 const chess={...games[2],bots:{apiVersion:1,difficulties:['easy','medium','hard']}};
 assert.equal(supportsSolo(chess),true);
 assert.deepEqual(soloBots(chess),[{difficulty:'medium'}]);
 assert.deepEqual(soloBots(games[0]),[]);
 assert.throws(()=>soloBots(games[2]),/cannot be played alone/);
 assert.deepEqual(soloBots({...chess,players:{min:3,max:3},bots:{difficulties:['easy']}}),[{difficulty:'easy'},{difficulty:'easy'}]);
});
