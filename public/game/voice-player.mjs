import {captionIndex} from './voice-utils.mjs';
const abortError=()=>new DOMException('Playback canceled','AbortError');
function eventOnce(target,name,signal,timeout=10000){return new Promise((resolve,reject)=>{
 let timer;
 const done=()=>{clean();resolve();},fail=()=>{clean();reject(new Error('Audio buffering is unavailable.'));},abort=()=>{clean();reject(abortError());};
 const clean=()=>{clearTimeout(timer);target.removeEventListener(name,done);target.removeEventListener('error',fail);signal?.removeEventListener('abort',abort);};
 if(signal?.aborted){reject(abortError());return;}target.addEventListener(name,done,{once:true});target.addEventListener('error',fail,{once:true});signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(fail,timeout);
});}
/** One active line, incremental MP3 when supported, and a bounded replay cache. */
export class VoicePlayer{
 constructor(audio,{fetcher=fetch,onUpdate=()=>{},onError=()=>{},onCaption=()=>{},onLevel=()=>{}}={}){
  this.audio=audio;this.fetcher=fetcher;this.onUpdate=onUpdate;this.onError=onError;this.onCaption=onCaption;this.onLevel=onLevel;this.cache=new Map();this.active=null;this.context=null;this.analyser=null;this.frame=null;this.serial=0;
 }
 get playing(){return !!this.active?.speaking;}
 get pending(){return !!this.active&&['loading','playing','blocked','buffering'].includes(this.active.row.status);}
 hasAudio(id){return this.cache.has(id);}
 unlock(){
  try{const C=globalThis.AudioContext||globalThis.webkitAudioContext;if(!C)return;if(!this.context){this.context=new C();this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;this.samples=new Uint8Array(this.analyser.fftSize);this.context.createMediaElementSource(this.audio).connect(this.analyser);this.analyser.connect(this.context.destination);}this.context.resume().catch(()=>{});}catch{/* Playback remains available without an analyser. */}
 }
 stop(){
  const a=this.active;if(a){if(!['completed','failed','blocked'].includes(a.row.status))a.row.status='interrupted';a.lifetime.abort();a.controller.abort();a.reader?.cancel().catch(()=>{});if(a.mediaUrl)URL.revokeObjectURL(a.mediaUrl);a.speaking=false;this.active=null;this.onUpdate(a.row);}
  this.audio.pause();if('speechSynthesis'in globalThis)globalThis.speechSynthesis.cancel();if(this.frame&&globalThis.cancelAnimationFrame)cancelAnimationFrame(this.frame);this.frame=null;this.onLevel(0,false);this.onCaption(null,-1,false);
 }
 clear(){this.stop();this.audio.removeAttribute('src');this.audio.load?.();for(const value of this.cache.values())URL.revokeObjectURL(value);this.cache.clear();}
 suspend(){this.stop();this.context?.suspend?.().catch(()=>{});}
 dispose(){this.clear();this.context?.close().catch(()=>{});}
 cacheAudio(id,chunks){
  const blob=new Blob(chunks,{type:'audio/mpeg'}),url=URL.createObjectURL(blob);if(this.cache.has(id))URL.revokeObjectURL(this.cache.get(id));this.cache.set(id,url);
  while(this.cache.size>8){const key=this.cache.keys().next().value;URL.revokeObjectURL(this.cache.get(key));this.cache.delete(key);}return url;
 }
 notify(a){if(this.active===a)this.onUpdate(a.row);}
 begin(a){
  if(this.active!==a)return;if(this.frame&&globalThis.cancelAnimationFrame)cancelAnimationFrame(this.frame);this.frame=null;a.speaking=true;a.row.status='playing';a.playStarted=performance.now();
  if(a.row.first_play_ms==null)a.row.first_play_ms=performance.now()-a.started;
  this.onCaption(a.clip.text,0,true);this.notify(a);this.animate(a);
 }
 end(a){if(this.active!==a)return;a.speaking=false;a.row.status='completed';if(Number.isFinite(this.audio.duration))a.row.duration_s=this.audio.duration;this.notify(a);this.onLevel(0,false);this.onCaption(null,-1,false);}
 animate(a){
  if(this.active!==a||!a.speaking)return;
  let level=a.device&&a.boundaryAt?Math.max(0,1-(performance.now()-a.boundaryAt)/140):0;
  if(!a.device&&this.analyser){this.analyser.getByteTimeDomainData(this.samples);level=Math.min(1,Math.sqrt(this.samples.reduce((sum,v)=>sum+((v-128)/128)**2,0)/this.samples.length)*5);}
  const elapsed=a.device?(performance.now()-a.playStarted)/1000:this.audio.currentTime;
  const index=a.boundaryIndex??captionIndex(a.clip.text,elapsed,a.device?NaN:this.audio.duration,a.clip.pace);
  this.onLevel(level,true,a.device?'device':'audio');this.onCaption(a.clip.text,index,true);
  if(globalThis.requestAnimationFrame)this.frame=requestAnimationFrame(()=>this.animate(a));
 }
 mediaFailure(a){
  if(this.active!==a||a.controller.signal.aborted)return;
  if(a.usingMse){
   a.usingMse=false;a.mseFailed=true;a.speaking=false;this.audio.pause();a.row.playback='buffered';a.row.status='buffering';this.onLevel(0,false);this.onCaption(null,-1,false);this.notify(a);
   if(this.cache.has(a.clip.id)){this.audio.src=this.cache.get(a.clip.id);this.startElement(a);}return;
  }
  if(this.cache.has(a.clip.id)){URL.revokeObjectURL(this.cache.get(a.clip.id));this.cache.delete(a.clip.id);}
  this.fail(a,'This browser could not decode or play the audio. Your dialogue is still available.');
 }
 startElement(a){
  if(this.active!==a)return;const attempt=(a.playAttempt||0)+1;a.playAttempt=attempt;
  this.audio.play().catch(e=>{if(this.active!==a||a.controller.signal.aborted||a.playAttempt!==attempt)return;
   if(e.name==='NotAllowedError'){a.row.status='blocked';this.notify(a);this.onError('Press Replay to start the voice. Your browser blocked automatic playback.','warning');}
   else this.mediaFailure(a);
  });
 }
 async device(a){
  if(!('speechSynthesis'in globalThis))throw new Error('Device speech is unavailable. Continue with text, or connect Bulbul.');
  const synth=globalThis.speechSynthesis;
  let voices=synth.getVoices();
  if(!voices.length){await Promise.race([eventOnce(synth,'voiceschanged',a.controller.signal).catch(()=>{}),new Promise(r=>setTimeout(r,500))]);voices=synth.getVoices();}
  if(this.active!==a)return;
  const selected=voices.find(v=>v.lang.toLowerCase()===a.clip.language_code.toLowerCase())||voices.find(v=>v.lang.startsWith(a.clip.language_code.slice(0,2)));
  if(a.clip.language_code==='hi-IN'&&!selected)throw new Error('No Hindi device voice is installed. Bulbul Hindi speech becomes available after a server key is configured.');
  const utterance=new SpeechSynthesisUtterance(a.clip.text);a.device=true;utterance.lang=a.clip.language_code;utterance.rate=Math.max(.5,Math.min(2,a.clip.pace*.9));if(selected)utterance.voice=selected;
  a.row.playback='device';a.row.requested_audio=false;
  utterance.onstart=()=>this.begin(a);utterance.onend=()=>this.end(a);
  utterance.onboundary=e=>{if(e.name==='word'){a.boundaryAt=performance.now();a.boundaryIndex=a.clip.text.slice(0,e.charIndex+1).trim().split(/\s+/).length-1;}};
  utterance.onerror=e=>{if(this.active!==a||['interrupted','canceled'].includes(e.error))return;this.fail(a,'Device speech could not play. Try again or continue with text.');};
  synth.speak(utterance);this.notify(a);
 }
 fail(a,message){
  if(this.active!==a)return;a.row.status='failed';a.row.error=message;a.speaking=false;a.controller.abort();a.reader?.cancel().catch(()=>{});this.audio.pause();this.onLevel(0,false);this.onCaption(null,-1,false);this.notify(a);this.onError(message,'error');
 }
 async play(clip,row,{started=performance.now()}={}){
  this.stop();const a={clip,row,started,controller:new AbortController(),lifetime:new AbortController(),speaking:false,device:false};this.active=a;row.status='loading';this.notify(a);
  this.audio.addEventListener('error',()=>this.mediaFailure(a),{signal:a.lifetime.signal});
  this.audio.addEventListener('playing',()=>this.begin(a),{signal:a.lifetime.signal});this.audio.addEventListener('ended',()=>this.end(a),{signal:a.lifetime.signal});
  this.audio.addEventListener('durationchange',()=>{if(this.active===a&&Number.isFinite(this.audio.duration)){row.duration_s=this.audio.duration;this.notify(a);}},{signal:a.lifetime.signal});
  try{
   if(clip.mode==='preview'){await this.device(a);return;}
   if(this.cache.has(clip.id)){row.cached=true;row.requested_audio=false;row.playback='cached';this.audio.src=this.cache.get(clip.id);this.startElement(a);return;}
   if(!clip.url)throw new Error('This line has no audio source.');
   let source=null,buffer=null;const chunks=[];
   const M=globalThis.MediaSource;
   if(M?.isTypeSupported?.('audio/mpeg')){
    try{source=new M();a.usingMse=true;a.mediaUrl=URL.createObjectURL(source);this.audio.src=a.mediaUrl;await eventOnce(source,'sourceopen',a.controller.signal,2500);buffer=source.addSourceBuffer('audio/mpeg');row.playback='streaming';}
    catch(e){if(a.controller.signal.aborted)throw e;source=null;buffer=null;a.usingMse=false;row.playback='buffered';}
   }else row.playback='buffered';
   row.requested_audio=true;const requested=performance.now();this.notify(a);
   const timeout=setTimeout(()=>a.controller.abort(),60000);a.timeout=timeout;
   const response=await this.fetcher(clip.url,{credentials:'same-origin',cache:'no-store',signal:a.controller.signal});
   if(!response.ok){let detail;try{detail=(await response.json()).detail;}catch{}throw new Error(typeof detail==='string'?detail:'Speech generation failed. Your dialogue is still available.');}
   if(!response.headers.get('Content-Type')?.startsWith('audio/'))throw new Error('The server returned an unreadable audio response.');
   if(!response.body)throw new Error('The server returned no audio stream.');
   a.reader=response.body.getReader();let bytes=0,first=true,startedAudio=false;
   while(true){
    const next=await a.reader.read();if(a.controller.signal.aborted)throw abortError();if(next.done)break;if(!next.value.length)continue;
    if(first){row.first_byte_ms=performance.now()-requested;first=false;}
    bytes+=next.value.byteLength;if(bytes>8*1024*1024)throw new Error('The voice line exceeded the demo audio limit.');chunks.push(next.value);if(a.mseFailed)buffer=null;
    if(buffer){
     try{buffer.appendBuffer(next.value);await eventOnce(buffer,'updateend',a.controller.signal);if(!startedAudio){this.startElement(a);startedAudio=true;}}
     catch(e){if(a.controller.signal.aborted)throw e;this.audio.pause();buffer=null;a.usingMse=false;row.playback='buffered';row.status='buffering';a.speaking=false;this.onLevel(0,false);this.onCaption(null,-1,false);}
    }
   }
   if(!bytes)throw new Error('No speech audio was received.');
   a.downloaded=true;if(a.mseFailed)buffer=null;row.audio_ready_ms=performance.now()-requested;const cached=this.cacheAudio(clip.id,chunks);
   if(buffer&&source?.readyState==='open'){source.endOfStream();}else{this.audio.src=cached;this.startElement(a);}
   this.notify(a);
  }catch(e){
   if(this.active!==a||a.controller.signal.aborted&&row.status==='interrupted')return;
   this.fail(a,e.name==='AbortError'?'The voice request timed out. Your dialogue is still available.':e.message||'Speech playback failed.');
  }finally{if(a.timeout)clearTimeout(a.timeout);}
 }
}
