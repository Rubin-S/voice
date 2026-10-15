import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceCatalog,normalizeVoice,deliveryFor,actionReaction} from '../lib/voice.ts';
import {freshState,applyAction} from '../lib/game.ts';
test('profiles pair English and Hindi personas; settings are validated',()=>{
 assert.equal(voiceCatalog.profiles.length,3);
 for(const p of voiceCatalog.profiles){assert.ok(p.speakers['en-IN']);assert.ok(p.speakers['hi-IN']);}
 assert.equal(normalizeVoice({}).profile_id,'sentinel');
 for(const v of [{profile_id:'invented'},{pace:0.1},{pace:3},{temperature:2},{pace:'1'},{adaptive:'true'}])assert.throws(()=>normalizeVoice(v));
});
test('state changes produce bilingual reactions and supported speech controls',()=>{
 const s=freshState();applyAction(s,'steal_key');
 assert.match(actionReaction(s,'steal_key','en-IN'),/key|hand/i);
 assert.match(actionReaction(s,'steal_key','hi-IN'),/[\u0900-\u097f]/);
 const d=deliveryFor(s,normalizeVoice({pace:.9,adaptive:true}),'hi-IN');
 assert.equal(d.speaker,'ratan_hi_customer_expressive');assert.ok(d.pace>=.5&&d.pace<=2);assert.equal(d.tone,'suspicious');
 applyAction(s,'help_guard');assert.match(actionReaction(s,'help_guard','en-IN'),/key/i);
 applyAction(s,'return_key');assert.match(actionReaction(s,'return_key','en-IN'),/enter|open/i);
 assert.equal(deliveryFor(s,normalizeVoice({adaptive:false,pace:1.2}),'en-IN').pace,1.2);
});
