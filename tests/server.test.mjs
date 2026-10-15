import test from 'node:test';
import assert from 'node:assert/strict';
import {env,clear} from './mock-env.mjs';
import {GET,POST} from '../app/api/[kind]/route.ts';
const req=(kind,data,cookie,origin)=>new Request('https://game.test/api/'+kind,{method:data?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
async function start(){const r=await GET(req('state'));assert.equal(r.status,200);return r.headers.get('Set-Cookie').split(';')[0];}
async function post(kind,data,cookie){const r=await POST(req(kind,data,cookie));return {status:r.status,...await r.json()};}

test('hosted sessions are cookie-isolated and facts survive reload',async()=>{
 clear();const a=await start(),b=await start();
 assert.equal((await post('action',{action:'help_guard'},a)).state.gate_open,true);
 assert.equal((await (await GET(req('state',undefined,b))).json()).state.gate_open,false);
 assert.equal((await (await GET(req('state',undefined,a))).json()).state.gate_open,true);
 assert.equal((await post('action',{action:'steal_key'},a)).state.gate_open,false);
 assert.equal((await post('action',{action:'return_key'},a)).state.gate_open,true);
});
test('hosted memory, Hindi, validation and origins',async()=>{
 clear();const cookie=await start();
 await post('talk',{text:'My name is Rubin'},cookie);
 assert.match((await post('talk',{text:'Remember my name?'},cookie)).reply,/Rubin/);
 assert.match((await post('talk',{text:'Can I enter?',language_code:'hi-IN'},cookie)).reply,/[\u0900-\u097f]/);
 assert.equal((await post('talk',{text:' '},cookie)).status,422);
 assert.equal((await post('action',{action:'open_gate'},cookie)).status,422);
 assert.equal((await POST(req('action',{action:'help_guard'},cookie,'https://evil.test'))).status,403);
 assert.equal((await post('talk',{text:'hello'},'vs_session=00000000-0000-4000-8000-000000000000')).status,409);
});
test('concurrent world updates cannot overwrite each other',async()=>{
 clear();const cookie=await start();
 const r=await Promise.all([post('action',{action:'help_guard'},cookie),post('action',{action:'steal_key'},cookie)]);
 assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);
});
test('hosted live chain, history and partial speech failure',async()=>{
 clear();const cookie=await start();env.SARVAM_API_KEY='test-secret';
 const previous=globalThis.fetch;let count=0;
 globalThis.fetch=async(url)=>{count++;return new Response(url.endsWith('completions')?JSON.stringify({choices:[{message:{content:'You may enter.'}}]}):JSON.stringify({audios:['UklGRg==']}));};
 try{
  const r=await post('talk',{text:'Hello',delivery:'complete'},cookie);assert.equal(r.mode,'live');assert.equal(r.audio_base64,'UklGRg==');assert.equal(count,2);
  globalThis.fetch=async(url)=>url.endsWith('completions')?new Response(JSON.stringify({choices:[{message:{content:'The gate stays closed.'}}]})):new Response('private-key',{status:429});
  const partial=await post('talk',{text:'Again',delivery:'complete'},cookie);assert.equal(partial.status,200);assert.equal(partial.audio_base64,null);assert.match(partial.audio_warning,/rate limit/);
  globalThis.fetch=async()=>new Response('private-key',{status:401});
  const fail=await post('talk',{text:'Again',delivery:'complete'},cookie);assert.equal(fail.status,502);assert.ok(!fail.detail.includes('private-key'));
  const state=await (await GET(req('state',undefined,cookie))).json();assert.equal(state.history.length,4);
 }finally{globalThis.fetch=previous;delete env.SARVAM_API_KEY;}
});
