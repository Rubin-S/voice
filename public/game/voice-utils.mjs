/** Browser-observed measurements. Unknown values remain null, never zero-filled. */
export function summarize(rows,spend=null){
 const live=rows.filter(r=>r.mode==='live'&&!r.cached);
 const starts=live.map(r=>r.first_play_ms).filter(v=>Number.isFinite(v)&&v>=0).sort((a,b)=>a-b);
 const q=p=>{if(!starts.length)return null;const at=(starts.length-1)*p,lo=Math.floor(at);return starts[lo]+(starts[Math.ceil(at)]-starts[lo])*(at-lo);};
 const attempts=live.filter(r=>r.requested_audio).length;
 const measured=typeof spend==='number'&&Number.isFinite(spend)&&spend>=0?spend:null;
 return {samples:starts.length,attempts,p50_ms:q(.5),p95_ms:q(.95),failures:live.filter(r=>r.status==='failed').length,spend:measured,cost_per_attempt:measured!==null&&attempts?measured/attempts:null};
}
export function captionIndex(text,seconds,duration,pace=1){
 const words=text.trim().split(/\s+/).filter(Boolean);if(!words.length)return -1;
 const length=Number.isFinite(duration)&&duration>0?duration:Math.max(1,words.length/(2.5*pace));
 return Math.max(0,Math.min(words.length-1,Math.floor(Math.max(0,seconds)/length*words.length)));
}
export function ms(value){return Number.isFinite(value)?value<1000?`${Math.round(value)} ms`:`${(value/1000).toFixed(2)} s`:'—';}
export function csvExport(rows){
 const columns=['id','at','kind','mode','profile_id','speaker','language_code','pace','temperature','tone','text','status','playback','requested_audio','dialogue_ms','first_byte_ms','first_play_ms','audio_ready_ms','duration_s','naturalness','pronunciation','consistency','notes','error'];
 const cell=v=>{let s=v==null?'':String(v);if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return /[",\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
 return columns.map(cell).join(',')+'\r\n'+rows.map(r=>columns.map(c=>cell(r[c])).join(',')).join('\r\n');
}
