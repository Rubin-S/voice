import test from 'node:test';
import assert from 'node:assert/strict';
import {generateDialogue,generateSpeech} from '../lib/sarvam.ts';

test('dialogue uses configured v1 model with history and event facts',async()=>{
 let call; const fetcher=async(url,opts)=>{call={url,opts};return new Response(JSON.stringify({choices:[{message:{content:' You may enter. '}}],usage:{total_tokens:18}}));};
 const r=await generateDialogue('secret',[{role:'system',content:'facts'},{role:'user',content:'hello'}],fetcher);
 assert.equal(r.reply,'You may enter.'); assert.match(call.url,/v1\/chat\/completions$/);
 assert.equal(JSON.parse(call.opts.body).model,'sarvam-105b-conversations');
});
test('speech uses Bulbul v4 persona and returns audio',async()=>{
 let body; const fetcher=async(_,opts)=>{body=JSON.parse(opts.body);return new Response(JSON.stringify({audios:['UklGRg==']}));};
 assert.equal(await generateSpeech('secret','नमस्ते','hi-IN',fetcher),'UklGRg==');
 assert.equal(body.model,'bulbul:v4-flash');assert.equal(body.speaker,'ratan_hi_customer_expressive');
});
test('timeouts, provider errors and malformed responses are safe failures',async()=>{
 for(const f of [async()=>{throw new Error('secret-network-detail');},async()=>new Response('secret',{status:401}),async()=>new Response('{'),async()=>new Response('{}')]){
  await assert.rejects(()=>generateDialogue('secret',[],f),e=>!e.message.includes('secret'));
 }
 await assert.rejects(()=>generateSpeech('secret','hi','en-IN',async()=>new Response('{"audios":[]}')));
});
