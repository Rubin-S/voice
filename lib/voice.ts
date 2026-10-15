import catalog from '../shared/voice-catalog.json' with {type:'json'};
import type {GameState,Language,Action} from './game';
export const voiceCatalog=catalog;
export type VoiceSettings={profile_id:string;pace:number;temperature:number;adaptive:boolean};
export type Delivery={speaker:string;profile_id:string;pace:number;temperature:number;tone:string};
export type SpeechClip=Delivery&{id:string;text:string;language_code:Language;created_at:number;source:'dialogue'|'action'|'audition'};
export const CLIP_TTL=10*60*1000;
export function normalizeVoice(input:Partial<VoiceSettings>={}):VoiceSettings{
 const result={profile_id:'sentinel',pace:1,temperature:.6,adaptive:true,...input};
 if(!catalog.profiles.some(p=>p.id===result.profile_id))throw new RangeError('Choose a voice profile from the catalog.');
 if(typeof result.pace!=='number'||!Number.isFinite(result.pace)||result.pace<.5||result.pace>2)throw new RangeError('Pace must be between 0.5 and 2.0.');
 if(typeof result.temperature!=='number'||!Number.isFinite(result.temperature)||result.temperature<.01||result.temperature>1)throw new RangeError('Temperature must be between 0.01 and 1.0.');
 if(typeof result.adaptive!=='boolean')throw new RangeError('Adaptive delivery must be true or false.');
 return result;
}
export function deliveryFor(s:GameState,settings:VoiceSettings,lang:Language):Delivery{
 const p=catalog.profiles.find(p=>p.id===settings.profile_id)!;
 const tone=s.key_stolen?'suspicious':s.helped_guard?'grateful':'watchful';
 const factor=settings.adaptive?(s.key_stolen?1.04:s.helped_guard?.96:1):1;
 return {speaker:p.speakers[lang],profile_id:p.id,pace:Math.round(Math.max(.5,Math.min(2,settings.pace*factor))*100)/100,temperature:settings.temperature,tone};
}
export function actionReaction(s:GameState,action:Action,lang:Language):string|null{
 const hi=lang==='hi-IN';
 if(action==='reset')return null;
 if(action==='steal_key')return hi?'अपना हाथ खोलो, यात्री। वह चाबी मेरी है। उसे लौटाओ; तब तक फाटक बंद रहेगा।':'Open your hand, traveler. That key belongs on my belt. Return it; the gate stays closed.';
 if(action==='return_key')return hi?(s.helped_guard?'चाबी लौट आई, और तुमने मेरी मदद भी की है। आगे बढ़ो, यात्री; फाटक खुला है।':'चाबी लौटाने के लिए धन्यवाद। मेरी बिखरी रसद समेटने में मदद करो, फिर प्रवेश की बात करेंगे।'):(s.helped_guard?'The key is back, and you have already earned my trust. You may enter.':'The key is back where it belongs. Help me recover my supplies, and we will speak of passage.');
 return hi?(s.key_stolen?'मेरी रसद समेटने के लिए धन्यवाद। अब मेरी चाबी भी लौटाओ; तभी फाटक खुलेगा।':'तुमने मेरी मदद की, यात्री। मेरा भरोसा जीत लिया है तुमने; फाटक खुला है।'):(s.key_stolen?'You recovered my supplies. Now return my key, and I can open the gate.':'You stopped to help when others walked past. You have earned my trust; the gate is open.');
}
export function queueClip(s:GameState,text:string,lang:Language,source:SpeechClip['source'],settings=normalizeVoice(s.voice)){
 const clip:SpeechClip={...deliveryFor(s,settings,lang),id:crypto.randomUUID(),text,language_code:lang,created_at:Date.now(),source};
 s.clips=[...(s.clips??[]).filter(c=>Date.now()-c.created_at<CLIP_TTL),clip].slice(-8);
 return clip;
}
export function speechDescriptor(clip:SpeechClip,live:boolean){return {...clip,mode:live?'live':'preview',url:live?`/api/speech?id=${clip.id}`:null};}
