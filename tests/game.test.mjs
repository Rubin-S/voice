import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState, publicState, applyAction, previewReply, systemPrompt} from '../lib/game.ts';

test('gate opens only after help with key safe',()=>{
 const s=freshState(); assert.equal(publicState(s).gate_open,false);
 applyAction(s,'help_guard'); assert.equal(publicState(s).gate_open,true);
 applyAction(s,'steal_key'); assert.equal(publicState(s).gate_open,false);
 assert.equal(publicState(s).trust,'suspicious');
 applyAction(s,'return_key'); assert.equal(publicState(s).gate_open,true);
});
test('return is idempotent; reset forgets actions and history',()=>{
 const s=freshState(); assert.match(applyAction(s,'return_key'),/already/);
 applyAction(s,'steal_key'); applyAction(s,'steal_key');
 s.history.push({role:'user',content:'My name is Rubin'});
 applyAction(s,'reset'); assert.deepEqual(s,freshState());
});
test('preview replies reflect theft, help, return and language',()=>{
 const s=freshState(); assert.match(previewReply(s,'May I enter?','en-IN'),/closed|earn/i);
 applyAction(s,'steal_key'); assert.match(previewReply(s,'Where is your key?','en-IN'),/key/i);
 applyAction(s,'return_key'); assert.match(previewReply(s,'I returned it','en-IN'),/return|back/i);
 applyAction(s,'help_guard'); assert.match(previewReply(s,'May I enter?','en-IN'),/open|enter/i);
 assert.match(previewReply(s,'Can I enter?','hi-IN'),/[\u0900-\u097f]/);
});
test('recent memory and authoritative prompt are supplied',()=>{
 const s=freshState(); s.history.push({role:'user',content:'My name is Rubin'});
 assert.match(previewReply(s,'Do you remember my name?','en-IN'),/Rubin/);
 applyAction(s,'steal_key'); const p=systemPrompt(s,'hi-IN');
 assert.match(p,/Devanagari/); assert.match(p,/key_stolen.*true/); assert.match(p,/steal_key/);
});
test('twenty conversations preserve gate invariant over changing states',()=>{
 const s=freshState(); const actions=['help_guard','steal_key','return_key','reset'];
 for(let i=0;i<20;i++){
  applyAction(s,actions[i%4]);
  const reply=previewReply(s,'May I enter?',i%2?'hi-IN':'en-IN');
  assert.ok(reply.length>10); assert.equal(publicState(s).gate_open,s.helped_guard&&!s.key_stolen);
  s.history.push({role:'user',content:'May I enter?'},{role:'assistant',content:reply});
 }
});
