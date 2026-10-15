import type {Language,Message} from './game';
const BASE='https://api.sarvam.ai';
export class ProviderError extends Error {}
async function call(key:string,path:string,payload:unknown,fetcher:typeof fetch=fetch):Promise<any>{
 let r:Response;
 try{r=await fetcher(BASE+path,{method:'POST',headers:{'api-subscription-key':key,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});}
 catch{throw new ProviderError('Sarvam could not be reached or timed out. Please try again.');}
 if(!r.ok)throw new ProviderError(r.status===401||r.status===403?'Sarvam rejected the API key or model access. Check server configuration.':r.status===429?'Sarvam’s rate limit was reached. Please wait and try again.':`Sarvam returned HTTP ${r.status}. Please try again.`);
 try{return await r.json();}catch{throw new ProviderError('Sarvam returned an unreadable response. Please try again.');}
}
export async function generateDialogue(key:string,messages:{role:string;content:string}[],fetcher:typeof fetch=fetch){
 const data=await call(key,'/v1/chat/completions',{model:'sarvam-105b-conversations',messages,temperature:0.6,max_tokens:180},fetcher);
 const raw=data?.choices?.[0]?.message?.content;
 if(typeof raw!=='string'||!raw.trim())throw new ProviderError('Sarvam returned no dialogue. Please try again.');
 return {reply:raw.replace(/\s+/g,' ').trim().slice(0,600),usage:data.usage??null};
}
export async function generateSpeech(key:string,text:string,language_code:Language,fetcher:typeof fetch=fetch,options?:SpeechParameters){
 const data=await call(key,'/text-to-speech',{text,model:'bulbul:v4-flash',language_code,speaker:language_code==='hi-IN'?'ratan_hi_customer_expressive':'dev_en_conversational',output_audio_codec:'wav',speech_sample_rate:24000,...(options??{})},fetcher);
 const audio=data?.audios?.[0];
 if(typeof audio!=='string'||!audio.length||!/^[A-Za-z0-9+/=\s]+$/.test(audio))throw new ProviderError('Sarvam returned no playable audio. Your dialogue is still available.');
 return audio;
}

export type SpeechParameters={speaker:string;pace:number;temperature:number};
function upstreamMessage(status:number){return status===401||status===403?'Sarvam rejected the API key or model access. Check server configuration.':status===429?'Sarvam’s rate limit was reached. Please wait and try again.':`Sarvam returned HTTP ${status}. Please try again.`;}
/** Proxy the first audio chunk immediately; retain no complete audio server-side. */
export async function streamSpeech(key:string,text:string,language_code:Language,delivery:SpeechParameters,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<Response>{
 const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted)controller.abort();
 const timer=setTimeout(abort,45000);
 const cancelReader=()=>{reader?.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancelReader,{once:true});
 const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',cancelReader);};
 const started=Date.now();
 try{
  const response=await fetcher(BASE+'/text-to-speech/stream',{method:'POST',headers:{'api-subscription-key':key,'Content-Type':'application/json'},body:JSON.stringify({text,model:'bulbul:v4-flash',language_code,speaker:delivery.speaker,pace:delivery.pace,temperature:delivery.temperature,output_audio_codec:'mp3',speech_sample_rate:24000}),signal:controller.signal});
  if(!response.ok)throw new ProviderError(upstreamMessage(response.status));
  const mime=response.headers.get('Content-Type')??'';
  if(!response.body||(!mime.startsWith('audio/')&&!mime.startsWith('application/octet-stream')))throw new ProviderError('Sarvam returned an unexpected audio response. Your dialogue is still available.');
  reader=response.body.getReader();if(controller.signal.aborted)throw new ProviderError('Speech was interrupted or timed out.');
  const first=await reader.read();
  if(first.done||!first.value?.length)throw new ProviderError('Sarvam returned no audio. Your dialogue is still available.');
  let received=first.value.byteLength;
  const body=new ReadableStream<Uint8Array>({
   start(c){c.enqueue(first.value);},
   async pull(c){try{
    const next=await reader!.read();if(controller.signal.aborted)throw new Error('interrupted');
    if(next.done){cleanup();c.close();return;}
    received+=next.value.byteLength;if(received>8*1024*1024)throw new Error('audio too large');c.enqueue(next.value);
   }catch{controller.abort();cleanup();c.error(new Error('The speech stream ended unexpectedly.'));}},
   async cancel(){await reader!.cancel().catch(()=>{});controller.abort();cleanup();}
  });
  return new Response(body,{headers:{'Content-Type':'audio/mpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-TTS-First-Byte-Ms':String(Date.now()-started),'Accept-Ranges':'none'}});
 }catch(e){await reader?.cancel().catch(()=>{});controller.abort();cleanup();if(e instanceof ProviderError)throw e;throw new ProviderError('Sarvam speech could not be reached or timed out. Your dialogue is still available.');}
}
