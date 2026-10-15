import test from 'node:test';
import assert from 'node:assert/strict';
import {streamSpeech} from '../lib/sarvam.ts';
const delivery={speaker:'dev_en_conversational',pace:1,temperature:.6};
test('speech proxies first bytes before the provider has finished',async()=>{
 let upstream,body;
 const response=await streamSpeech('secret','Halt','en-IN',delivery,undefined,async(_,opts)=>{
  body=JSON.parse(opts.body);
  return new Response(new ReadableStream({start(c){upstream=c;c.enqueue(new Uint8Array([73,68,51]));}}),{headers:{'Content-Type':'audio/mpeg'}});
 });
 const reader=response.body.getReader();assert.deepEqual([...((await reader.read()).value)],[73,68,51]);
 upstream.enqueue(new Uint8Array([1,2]));upstream.close();assert.deepEqual([...((await reader.read()).value)],[1,2]);
 assert.equal((await reader.read()).done,true);assert.equal(body.model,'bulbul:v4-flash');assert.equal(body.output_audio_codec,'mp3');assert.equal(body.pace,1);
});
test('cancelling playback releases the upstream stream',async()=>{
 let cancelled=false;
 const r=await streamSpeech('secret','Halt','en-IN',delivery,undefined,async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([73,68,51]));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg'}}));
 await r.body.cancel();assert.equal(cancelled,true);
});
test('JSON errors, empty audio and provider failures are safe',async()=>{
 for(const f of [async()=>new Response('{}',{headers:{'Content-Type':'application/json'}}),async()=>new Response('',{headers:{'Content-Type':'audio/mpeg'}}),async()=>new Response('secret',{status:401})])await assert.rejects(()=>streamSpeech('secret','Halt','en-IN',delivery,undefined,f),e=>!e.message.includes('secret'));
});
