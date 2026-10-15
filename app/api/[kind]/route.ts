import {env} from 'cloudflare:workers';
import {freshState,publicState,applyAction,previewReply,systemPrompt,type GameState,type Action,type Language} from '../../../lib/game';
import {generateDialogue,generateSpeech,streamSpeech,ProviderError} from '../../../lib/sarvam';
import {voiceCatalog,normalizeVoice,queueClip,speechDescriptor,actionReaction,CLIP_TTL,type VoiceSettings,type SpeechClip} from '../../../lib/voice';
export const dynamic='force-dynamic';
const TTL=86400000;
const json=(data:unknown,status=200,cookie?:string)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...(cookie?{'Set-Cookie':`vs_session=${cookie}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`}:{})}});
const apiKey=()=>((env as unknown as Record<string,string>).SARVAM_API_KEY||'').trim();
class RequestError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
async function getSession(req:Request,create=false){
 if(!env.DB)throw new RequestError(503,'The encounter database is unavailable. Please try again later.');
 const now=Date.now();const token=req.headers.get('cookie')?.match(/(?:^|;\s*)vs_session=([a-f0-9-]{36})(?:;|$)/)?.[1];
 if(token){const row=await env.DB.prepare('SELECT payload,version,updated_at FROM game_sessions WHERE id=?').bind(token).first<{payload:string;version:number;updated_at:number}>();if(row&&now-row.updated_at<TTL)return{id:token,state:JSON.parse(row.payload) as GameState,version:row.version,newCookie:false};}
 if(!create)return null;
 const id=crypto.randomUUID(),state=freshState();
 await env.DB.prepare('INSERT INTO game_sessions(id,payload,version,updated_at) VALUES(?,?,0,?)').bind(id,JSON.stringify(state),now).run();
 await env.DB.prepare('DELETE FROM game_sessions WHERE updated_at < ?').bind(now-TTL).run();
 return{id,state,version:0,newCookie:true};
}
type Session=NonNullable<Awaited<ReturnType<typeof getSession>>>;
async function save(s:Session){
 const saved=await env.DB!.prepare('UPDATE game_sessions SET payload=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(JSON.stringify(s.state),Date.now(),s.id,s.version).run();
 if(saved.meta.changes!==1)throw new RequestError(409,'The scene changed during this request. Please try again.');
}
function failure(e:unknown){return json({detail:e instanceof ProviderError||e instanceof RequestError||e instanceof RangeError?e.message:'The encounter could not be updated. Please try again.'},e instanceof ProviderError?502:e instanceof RequestError?e.status:e instanceof RangeError?422:503);}
export async function GET(req:Request){
 const url=new URL(req.url),kind=url.pathname.split('/').pop();
 if(kind==='config')return json({mode:apiKey()?'live':'preview',llm_model:'sarvam-105b-conversations',tts_model:'bulbul:v4-flash',configured:!!apiKey(),voices:voiceCatalog});
 if(!['state','speech'].includes(kind??''))return json({detail:'Not found.'},404);
 try{
  const s=await getSession(req,kind==='state');
  if(!s)throw new RequestError(409,'Your encounter expired. Reload the page to begin again.');
  if(kind==='state')return json({state:publicState(s.state),history:s.state.history,voice:normalizeVoice(s.state.voice)},200,s.newCookie?s.id:undefined);
  const id=url.searchParams.get('id');const clip=s.state.clips?.find(c=>c.id===id&&Date.now()-c.created_at<CLIP_TTL);
  if(!clip)throw new RequestError(404,'This voice line expired or is not part of your encounter.');
  const key=apiKey();if(!key)throw new RequestError(409,'Bulbul speech needs a server-side Sarvam API key. Device preview is available.');
  return await streamSpeech(key,clip.text,clip.language_code,clip,req.signal);
 }catch(e){return failure(e);}
}
const fields:Record<string,string[]>={action:['action','language_code','delivery'],talk:['text','language_code','delivery'],voice:['profile_id','pace','temperature','adaptive'],audition:['profile_id','pace','temperature','adaptive','text','sample_id','language_code','delivery']};
export async function POST(req:Request){
 try{
  const kind=new URL(req.url).pathname.split('/').pop()??'';
  if(!Object.hasOwn(fields,kind))throw new RequestError(404,'Not found.');
  const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)throw new RequestError(403,'Cross-origin requests are not allowed.');
  const raw=await req.text();if(raw.length>4096)throw new RequestError(413,'Request is too large.');
  let body:any;try{body=JSON.parse(raw);}catch{throw new RequestError(422,'Please send valid JSON.');}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields[kind].includes(k)))throw new RequestError(422,'Invalid request fields.');
  const s=await getSession(req);if(!s)throw new RequestError(409,'Your encounter expired. Reload the page to begin again.');
  const lang=(body.language_code??'en-IN') as Language;
  if(!['en-IN','hi-IN'].includes(lang))throw new RequestError(422,'Choose English or Hindi.');
  const delivery=body.delivery??'stream';if(!['stream','complete'].includes(delivery))throw new RequestError(422,'Choose streaming or complete audio delivery.');
  const key=apiKey(),started=Date.now();let result:Record<string,unknown>={},clip:SpeechClip|undefined;
  if(kind==='voice'){
   s.state.voice=normalizeVoice({...normalizeVoice(s.state.voice),...body});result.voice=s.state.voice;
  }else if(kind==='action'){
   if(!['steal_key','return_key','help_guard','reset'].includes(body.action))throw new RequestError(422,'Unknown game action.');
   const action=body.action as Action,before=JSON.stringify(publicState(s.state));
   const event=applyAction(s.state,action);
   if(action==='reset'){const voice=normalizeVoice(s.state.voice);s.state={...freshState(),voice};}
   const changed=before!==JSON.stringify(publicState(s.state));
   const reply=changed?actionReaction(s.state,action,lang):null;
   if(reply)clip=queueClip(s.state,reply,lang,'action');
   result={event,reply};
  }else if(kind==='audition'){
   const settings=normalizeVoice({...normalizeVoice(s.state.voice),...Object.fromEntries(Object.entries(body).filter(([k])=>['profile_id','pace','temperature','adaptive'].includes(k)))});
   const sampleId=body.sample_id??'greeting';
   if(!Object.hasOwn(voiceCatalog.samples,sampleId))throw new RequestError(422,'Choose an audition scenario.');
   const samples=voiceCatalog.samples as Record<string,Record<string,string>>;
   const text=body.text??samples[sampleId][lang];
   if(typeof text!=='string'||!text.trim()||text.trim().length>280)throw new RequestError(422,'Audition text must be between 1 and 280 characters.');
   clip=queueClip(s.state,text.trim(),lang,'audition',{...settings,adaptive:false});
   result={reply:text.trim()};
  }else{
   if(typeof body.text!=='string'||!body.text.trim()||body.text.trim().length>280)throw new RequestError(422,'Enter a message between 1 and 280 characters.');
   let reply:string,usage:unknown=null;
   if(key){const chat=await generateDialogue(key,[{role:'system',content:systemPrompt(s.state,lang)},...s.state.history.slice(-8),{role:'user',content:body.text.trim()}]);reply=chat.reply;usage=chat.usage;}
   else reply=previewReply(s.state,body.text.trim(),lang);
   s.state.history=[...s.state.history,{role:'user' as const,content:body.text.trim()},{role:'assistant' as const,content:reply}].slice(-8);
   clip=queueClip(s.state,reply,lang,'dialogue');result={reply,metrics:{dialogue_ms:Date.now()-started,usage}};
  }
  const generatedMs=Date.now()-started;let audio:string|null=null,warning:string|null=null,ttsMs=0;
  if(clip&&key&&delivery==='complete'){
   const ts=Date.now();try{audio=await generateSpeech(key,clip.text,clip.language_code,fetch,clip);}catch(e){warning=e instanceof ProviderError?e.message:'Speech could not be generated. Your dialogue is still available.';}ttsMs=Date.now()-ts;
  }
  await save(s);
  return json({...result,mode:key?'live':'preview',voice:normalizeVoice(s.state.voice),speech:clip?speechDescriptor(clip,!!key):null,audio_base64:audio,audio_warning:warning,metrics:{...(result.metrics as object??{}),total_ms:Date.now()-started,llm_ms:kind==='talk'?generatedMs:0,tts_ms:ttsMs},state:publicState(s.state)});
 }catch(e){return failure(e);}
}
