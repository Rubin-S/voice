import test from 'node:test';
import assert from 'node:assert/strict';
import {VoicePlayer} from '../public/game/voice-player.mjs';
import {VoicePlayer as PythonVoicePlayer} from '../voicestage/game/voice-player.mjs';
class Audio extends EventTarget{paused=true;duration=2;currentTime=0;src='';async play(){this.paused=false;this.dispatchEvent(new Event('playing'));}pause(){this.paused=true;}removeAttribute(){this.src='';}load(){}}
const clip={id:'one',mode:'live',url:'/api/speech?id=one',text:'Halt traveler',language_code:'en-IN',pace:1};
for(const [name,Player] of [['hosted',VoicePlayer],['Python',PythonVoicePlayer]]){
 test(`${name} default fetch preserves the browser global receiver`,async()=>{
  const original=globalThis.fetch;let calls=0;const errors=[];let player;
  globalThis.fetch=async function(){
   if(this!==globalThis)throw new TypeError('Illegal invocation');
   calls++;return new Response(new Uint8Array([73,68,51]),{headers:{'Content-Type':'audio/mpeg'}});
  };
  try{
   player=new Player(new Audio(),{onError:e=>errors.push(e)});const row={mode:'live'};
   await player.play(clip,row);assert.deepEqual(errors,[]);assert.equal(calls,1);assert.ok(player.hasAudio(clip.id));assert.equal(row.status,'playing');
  }finally{player?.dispose();globalThis.fetch=original;}
 });
}
test('buffered fallback caches one response and replay performs no new synthesis',async()=>{
 let calls=0;const a=new Audio();const p=new VoicePlayer(a,{fetcher:async()=>{calls++;return new Response(new Uint8Array([73,68,51]),{headers:{'Content-Type':'audio/mpeg'}});}});
 const r={mode:'live',status:'generated'};await p.play(clip,r);assert.equal(calls,1);assert.equal(r.playback,'buffered');assert.ok(p.hasAudio('one'));
 await p.play(clip,{mode:'live',cached:true});assert.equal(calls,1);p.dispose();
});
test('provider JSON errors cannot be played as audio',async()=>{
 const a=new Audio();const errors=[];const p=new VoicePlayer(a,{fetcher:async()=>new Response('{"detail":"Provider rejected request"}',{status:502,headers:{'Content-Type':'application/json'}}),onError:e=>errors.push(e)});
 const r={mode:'live'};await p.play(clip,r);assert.equal(r.status,'failed');assert.equal(a.paused,true);assert.match(errors[0],/rejected/);p.dispose();
});
test('stop cancels an incomplete download without manufacturing a replay clip',async()=>{
 let cancelled=false;const p=new VoicePlayer(new Audio(),{fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([73,68,51]));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg'}})});
 const r={mode:'live'};const playing=p.play(clip,r);await new Promise(resolve=>setTimeout(resolve,5));p.stop();await playing;
 assert.equal(cancelled,true);assert.equal(r.status,'interrupted');assert.equal(p.hasAudio('one'),false);p.dispose();
});
test('MSE starts playback before the complete response and caches its bytes',async()=>{
 const originalM=globalThis.MediaSource,originalURL=URL.createObjectURL;let provider;
 class Buffer extends EventTarget{updating=false;appendBuffer(){this.updating=true;queueMicrotask(()=>{this.updating=false;this.dispatchEvent(new Event('updateend'));});}}
 class Media extends EventTarget{static isTypeSupported(){return true;}readyState='closed';addSourceBuffer(){return new Buffer();}endOfStream(){this.readyState='ended';}}
 globalThis.MediaSource=Media;URL.createObjectURL=value=>{if(value instanceof Media){queueMicrotask(()=>{value.readyState='open';value.dispatchEvent(new Event('sourceopen'));});return 'blob:fake-mse';}return originalURL.call(URL,value);};
 class StreamingAudio extends Audio{async play(){provider.enqueue(new Uint8Array([4,5]));provider.close();return super.play();}}
 const p=new VoicePlayer(new StreamingAudio(),{fetcher:async()=>new Response(new ReadableStream({start(c){provider=c;c.enqueue(new Uint8Array([73,68,51]));}}),{headers:{'Content-Type':'audio/mpeg'}})});
 try{const r={mode:'live'};await p.play(clip,r);assert.equal(r.playback,'streaming');assert.ok(Number.isFinite(r.first_play_ms));assert.ok(p.hasAudio(clip.id));}
 finally{p.dispose();globalThis.MediaSource=originalM;URL.createObjectURL=originalURL;}
});
test('decoder rejection is reported as playback failure rather than autoplay blocking',async()=>{
 class BrokenAudio extends Audio{async play(){throw new DOMException('Bad media','NotSupportedError');}}
 const errors=[];const p=new VoicePlayer(new BrokenAudio(),{fetcher:async()=>new Response(new Uint8Array([1,2]),{headers:{'Content-Type':'audio/mpeg'}}),onError:e=>errors.push(e)});
 const r={mode:'live'};await p.play(clip,r);await Promise.resolve();assert.equal(r.status,'failed');assert.match(errors[0],/decode|play.*audio|audio.*play/i);p.dispose();
});
test('late media errors release the pending player and permit an explicit retry',async()=>{
 const a=new Audio();const p=new VoicePlayer(a,{fetcher:async()=>new Response(new Uint8Array([73,68,51]),{headers:{'Content-Type':'audio/mpeg'}})});const r={mode:'live'};
 await p.play(clip,r);a.dispatchEvent(new Event('error'));assert.equal(r.status,'failed');assert.equal(p.pending,false);assert.equal(p.playing,false);p.dispose();
});
test('suspending a persisted page preserves the audio context for back navigation',()=>{
 const p=new VoicePlayer(new Audio());let suspended=false,closed=false;p.context={suspend:async()=>{suspended=true;},close:async()=>{closed=true;}};
 p.suspend();assert.equal(suspended,true);assert.equal(closed,false);p.dispose();
});
