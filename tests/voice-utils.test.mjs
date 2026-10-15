import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,captionIndex,csvExport} from '../public/game/voice-utils.mjs';
test('voice measurements exclude device preview and unknown spend stays unknown',()=>{
 const rows=[{mode:'live',requested_audio:true,first_play_ms:100,status:'completed'},{mode:'live',requested_audio:true,first_play_ms:300,status:'completed'},{mode:'preview',first_play_ms:1,status:'completed'}];
 const s=summarize(rows,null);assert.equal(s.samples,2);assert.equal(s.p50_ms,200);assert.equal(s.p95_ms,290);assert.equal(s.cost_per_attempt,null);
 assert.equal(summarize(rows,4).cost_per_attempt,2);
});
test('captions stay bounded and support Hindi text',()=>{
 assert.equal(captionIndex('',1,5,1),-1);assert.equal(captionIndex('Halt traveler',0,2,1),0);
 assert.equal(captionIndex('Halt traveler',9,2,1),1);assert.equal(captionIndex('रुको यात्री',1.8,2,1),1);
});
test('CSV export quotes dialogue and prevents spreadsheet formula injection',()=>{
 const s=csvExport([{id:'a',text:'=HYPERLINK("bad")',notes:'line 1\nline 2',mode:'preview'}]);
 assert.ok(s.includes("'=HYPERLINK"));assert.ok(s.includes('"line 1\nline 2"'));assert.ok(!s.includes('undefined'));
});
