import test from 'node:test';
import assert from 'node:assert/strict';
import {env,clear} from './mock-env.mjs';
import {GET,POST} from '../app/api/[kind]/route.ts';
const req=(path,data,cookie)=>new Request('https://game.test/api/'+path,{method:data?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
async function start(){return(await GET(req('state'))).headers.get('Set-Cookie').split(';')[0];}
async function send(kind,data,c){const r=await POST(req(kind,data,c));return {status:r.status,...await r.json()};}
test('catalog and persisted voice settings are available without exposing credentials',async()=>{
 clear();const c=await start();const config=await(await GET(req('config'))).json();assert.equal(config.voices.profiles.length,3);
 const r=await send('voice',{profile_id:'warden',pace:.85,temperature:.5,adaptive:false},c);assert.equal(r.voice.profile_id,'warden');
 assert.equal((await(await GET(req('state',undefined,c))).json()).voice.pace,.85);
 assert.equal((await send('voice',{pace:7},c)).status,422);
});
test('actions immediately return state-correct bilingual reactions and a clip',async()=>{
 clear();const c=await start();const r=await send('action',{action:'steal_key',language_code:'hi-IN'},c);
 assert.equal(r.status,200);assert.match(r.reply,/[\u0900-\u097f]/);assert.equal(r.state.gate_open,false);assert.equal(r.speech.mode,'preview');
 const repeated=await send('action',{action:'steal_key'},c);assert.equal(repeated.reply,null);
 await send('voice',{profile_id:'warden'},c);await send('action',{action:'reset'},c);
 assert.equal((await(await GET(req('state',undefined,c))).json()).voice.profile_id,'warden');
 assert.equal((await GET(req('speech?id='+r.speech.id,undefined,c))).status,404);
});
test('auditions cannot change game state or history and use the selected profile',async()=>{
 clear();const c=await start();const r=await send('audition',{profile_id:'storyteller',language_code:'hi-IN',sample_id:'grateful'},c);
 assert.equal(r.speech.speaker,'ratan_hi_documentary');assert.equal(r.speech.source,'audition');
 const s=await(await GET(req('state',undefined,c))).json();assert.equal(s.state.gate_open,false);assert.deepEqual(s.history,[]);assert.equal(s.voice.profile_id,'sentinel');
});
test('streaming clips are private and paid synthesis begins only on audio request',async()=>{
 clear();const a=await start(),b=await start();env.SARVAM_API_KEY='test-secret';const saved=fetch;let count=0;
 globalThis.fetch=async()=>{count++;return new Response(new Uint8Array([73,68,51,4,5]),{headers:{'Content-Type':'audio/mpeg'}});};
 try{
  const action=await send('action',{action:'help_guard',delivery:'stream'},a);assert.equal(count,0);assert.ok(action.speech.url);
  assert.equal((await GET(req('speech?id='+action.speech.id,undefined,b))).status,404);assert.equal(count,0);
  const audio=await GET(req('speech?id='+action.speech.id,undefined,a));assert.equal(audio.status,200);assert.match(audio.headers.get('Content-Type'),/audio/);assert.equal((await audio.arrayBuffer()).byteLength,5);assert.equal(count,1);
 }finally{globalThis.fetch=saved;}
});
