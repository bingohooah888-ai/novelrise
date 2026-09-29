import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceExactText } from '../src/worktree-safe-replace-bridge.js';

test('exact replacement changes only the required occurrence count',()=>{
  assert.equal(replaceExactText('alpha beta gamma','beta','BETA',1),'alpha BETA gamma');
  assert.equal(replaceExactText('x x','x','y',2),'y y');
});

test('exact replacement fails closed on count mismatch',()=>{
  assert.throws(()=>replaceExactText('alpha beta','missing','x',1));
  assert.throws(()=>replaceExactText('x x','x','y',1));
  assert.throws(()=>replaceExactText('abc','','x',1));
});
