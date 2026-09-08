import test from 'node:test';
import assert from 'node:assert/strict';
import {personalScreenEnabled} from '../web/personal-screen.js';
test('combined display preference persists, can be overridden by a link and tolerates blocked storage',()=>{
 const storage={getItem:()=> '1'};
 assert.equal(personalScreenEnabled(storage),true);
 assert.equal(personalScreenEnabled(storage,'?view=controller'),false);
 assert.equal(personalScreenEnabled({getItem:()=>null},'?view=combined'),true);
 assert.equal(personalScreenEnabled({getItem(){throw Error('Storage blocked');}}),false);
});
