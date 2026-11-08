import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandIds} from '../web/command-ids.js';

test('frame reloads never reuse command identities; retries in the same frame remain idempotent',()=>{
 const before=createCommandIds('before'),after=createCommandIds('after');
 assert.equal(before.encode('1'),before.encode('1'));
 assert.notEqual(before.encode('1'),after.encode('1'));
 assert.equal(before.decode(before.encode('1')),'1');
 assert.equal(after.decode(before.encode('1')),null,'old acknowledgements must not reach a new frame');
 assert.equal(after.decode(undefined),null);
 for(const id of ['',1,null,'x'.repeat(65)])assert.throws(()=>after.encode(id));
 assert.ok(after.encode('x'.repeat(64)).length<=100);
});
