import test from 'node:test';import assert from 'node:assert/strict';
import {readRating,initialRating,applyRating} from '../web/chess-rating.js';
import {validateProfile} from '../profile.js';
test('local Elo survives reload and final snapshots are applied once, only for participants',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 assert.equal(readRating(storage),null);initialRating(storage,700);
 const s={phase:'solved',party:{id:'match1',you:'a',community:{ratings:[{id:'a',before:700,after:716}]}}};
 applyRating(storage,s);assert.equal(readRating(storage).elo,716);
 initialRating(storage,900);applyRating(storage,s);assert.equal(readRating(storage).elo,716);
 const second={...s,party:{...s.party,id:'match2',community:{ratings:[{id:'a',after:732}]}}};applyRating(storage,second);applyRating(storage,s);assert.equal(readRating(storage).elo,732);
 applyRating(storage,{...s,party:{...s.party,id:'spectator',you:'x'}});assert.equal(readRating(storage).elo,732);
 assert.equal(validateProfile({name:'Alice',chessElo:700}).chessElo,700);assert.throws(()=>validateProfile({name:'Alice',chessElo:'700'}));
});
