import {summarize,ms,csvExport} from './voice-utils.mjs';
const $=id=>document.getElementById(id);
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
export class VoiceStudio{
 constructor({onAudition,onSave,onLanguage}){
  this.onAudition=onAudition;this.onSave=onSave;this.onLanguage=onLanguage;this.rows=[];this.spend=null;this.catalog=null;this.mode='preview';this.language='en-IN';this.assigned={profile_id:'sentinel',pace:1,temperature:.6,adaptive:true};this.draft='sentinel';this.busy=true;
  try{const data=JSON.parse(sessionStorage.getItem('voicestage_voice_log')||'null');if(data&&Array.isArray(data.rows)){this.rows=data.rows.filter(r=>r&&typeof r==='object'&&typeof r.id==='string').slice(-100);this.spend=typeof data.spend==='number'&&Number.isFinite(data.spend)&&data.spend>=0?data.spend:null;}}catch{}
  for(const id of ['pace-range','variation-range'])$(id).addEventListener('input',()=>this.rangeValues());
  $('sample-scenario').addEventListener('change',()=>this.sampleText(true));
  $('studio-language').addEventListener('change',()=>this.onLanguage($('studio-language').value));
  $('audition-text').addEventListener('input',()=>this.countText());
  $('apply-voice').addEventListener('click',()=>this.onSave(this.settings()));
  $('rating-line').addEventListener('change',()=>this.fillRatings());
  for(const key of ['naturalness','pronunciation','consistency'])$('rating-'+key).addEventListener('change',()=>this.rate(key,$('rating-'+key).value?Number($('rating-'+key).value):null));
  $('rating-notes').addEventListener('input',()=>this.rate('notes',$('rating-notes').value));
  $('measured-spend').value=this.spend??'';
  $('measured-spend').addEventListener('input',()=>{const n=$('measured-spend').value;this.spend=n!==''&&Number.isFinite(Number(n))&&Number(n)>=0?Number(n):null;this.persist();this.renderMetrics();});
  $('export-csv').addEventListener('click',()=>this.download(csvExport(this.rows),'csv','text/csv;charset=utf-8'));
  $('export-json').addEventListener('click',()=>this.download(JSON.stringify({exported_at:new Date().toISOString(),model:'bulbul:v4-flash',summary:summarize(this.rows,this.spend),manual_spend_inr:this.spend,notes:'Playback-start is browser observed, not a physical audibility measurement. Caption word timing is estimated. Quality ratings and spend are entered by a human. Preview and cached replay are excluded from live latency summaries.',rows:this.rows},null,2),'json','application/json'));
  $('clear-measurements').addEventListener('click',()=>{const b=$('clear-measurements');if(b.dataset.confirm==='yes'){this.rows=[];this.spend=null;$('measured-spend').value='';this.persist();this.renderMetrics();b.dataset.confirm='';b.classList.remove('clear-confirm');b.textContent='Clear log';}else{b.dataset.confirm='yes';b.textContent='Confirm clear';b.classList.add('clear-confirm');setTimeout(()=>{b.dataset.confirm='';b.classList.remove('clear-confirm');b.textContent='Clear log';},5000);}});
  this.renderMetrics();this.rangeValues();
 }
 configure(config,settings){this.catalog=config.voices;this.mode=config.mode;this.setAssigned(settings);this.sampleText(true);this.renderCards();this.applyMode(config.mode);}
 applyMode(mode){this.mode=mode;$('studio-mode-label').textContent=mode==='live'?'Bulbul key configured':'Device preview';$('studio-disclosure').hidden=mode==='live';this.renderCards();}
 setAssigned(settings){this.assigned=settings;this.draft=settings.profile_id;$('pace-range').value=settings.pace;$('variation-range').value=settings.temperature;$('adaptive-voice').checked=settings.adaptive;this.rangeValues();const name=this.profileName(settings.profile_id);$('active-profile').textContent=name;$('voice-save-status').textContent=name+' is assigned to Toren.';this.renderCards();}
 profileName(id){return this.catalog?.profiles.find(p=>p.id===id)?.name||id||'Toren';}
 settings(profile=this.draft){return {profile_id:profile,pace:Number($('pace-range').value),temperature:Number($('variation-range').value),adaptive:$('adaptive-voice').checked};}
 auditionInput(profile){return {...this.settings(profile),language_code:this.language,sample_id:$('sample-scenario').value,text:$('audition-text').value.trim(),delivery:'stream'};}
 setLanguage(lang){
  const oldSample=this.catalog?.samples[$('sample-scenario').value]?.[this.language];const wasDefault=$('audition-text').value===oldSample;
  this.language=lang;$('studio-language').value=lang;if(wasDefault)this.sampleText(true);$('audition-text').lang=lang==='hi-IN'?'hi':'en';this.renderCards();
 }
 sampleText(force=false){if(this.catalog&&force)$('audition-text').value=this.catalog.samples[$('sample-scenario').value][this.language];this.countText();}
 countText(){$('audition-count').textContent=$('audition-text').value.length+' / 280';}
 rangeValues(){$('pace-value').textContent=Number($('pace-range').value).toFixed(2)+'×';$('variation-value').textContent=Number($('variation-range').value).toFixed(2);}
 setBusy(value){this.busy=value;$('apply-voice').disabled=value||!this.catalog;document.querySelectorAll('[data-audition-profile]').forEach(b=>b.disabled=value);}
 renderCards(){
  if(!this.catalog)return;const root=$('profile-cards');root.replaceChildren();
  this.catalog.profiles.forEach((profile,index)=>{
   const card=el('div','profile-card'+(profile.id===this.draft?' selected':''));const number=el('span','profile-number',String(index+1).padStart(2,'0'));number.setAttribute('aria-hidden','true');
   const choice=el('label','profile-choice'),radio=el('input');radio.type='radio';radio.name='voice-profile';radio.value=profile.id;radio.checked=profile.id===this.draft;radio.addEventListener('change',()=>{this.draft=profile.id;this.renderCards();root.querySelector('input:checked')?.focus({preventScroll:true});});choice.append(radio,document.createTextNode(profile.name));
   const detail=el('span','profile-speaker',profile.speakers[this.language]);detail.title='Bulbul persona for the selected language';const play=el('button','',this.mode==='live'?'Audition':'Device preview');play.type='button';play.dataset.auditionProfile=profile.id;play.disabled=this.busy;play.append(el('span','','▷'));play.addEventListener('click',()=>this.onAudition(this.auditionInput(profile.id)));
   card.append(number,choice,el('p','',profile.description),detail,play);root.append(card);
  });
 }
 record(clip,kind,metrics={},extra={}){
  const row={id:crypto.randomUUID(),at:new Date().toISOString(),kind,mode:clip.mode,profile_id:clip.profile_id,speaker:clip.speaker,language_code:clip.language_code,pace:clip.pace,temperature:clip.temperature,tone:clip.tone,text:clip.text,status:'generated',playback:clip.mode==='preview'?'device':null,requested_audio:false,dialogue_ms:metrics.dialogue_ms??metrics.llm_ms??null,first_byte_ms:null,first_play_ms:null,audio_ready_ms:null,duration_s:null,naturalness:null,pronunciation:null,consistency:null,notes:'',...extra};
  this.rows.push(row);this.rows=this.rows.slice(-100);this.update(row);return row;
 }
 update(row){this.current=row;this.persist();this.renderMetrics();$('now-title').textContent=this.profileName(row.profile_id)+' · '+(row.kind==='audition'?'Voice audition':row.kind==='action'?'Toren reacts':row.kind==='replay'?'Replay':'Toren replies');
  const source=row.mode==='preview'?'Device preview · Bulbul persona not applied':row.cached?'Bulbul audio · cached replay':row.playback==='streaming'?'Bulbul v4 Flash · streaming MP3':row.playback==='buffered'?'Bulbul v4 Flash · buffered fallback':'Bulbul v4 Flash';
  $('now-details').textContent=source+' · '+(row.language_code==='hi-IN'?'Hindi':'English')+' · '+row.pace+'×'+(Number.isFinite(row.first_play_ms)?' · playback '+ms(row.first_play_ms):'');
  $('playback-badge').textContent=(row.status||'ready').toUpperCase();
 }
 persist(){try{sessionStorage.setItem('voicestage_voice_log',JSON.stringify({rows:this.rows,spend:this.spend}));}catch{}}
 renderMetrics(){
  const s=summarize(this.rows,this.spend);$('metric-samples').textContent=s.samples;$('metric-p50').textContent=ms(s.p50_ms);$('metric-p95').textContent=ms(s.p95_ms);$('metric-cost').textContent=s.cost_per_attempt==null?'Not measured':'₹'+s.cost_per_attempt.toFixed(2);$('measurement-count').textContent=s.samples?s.samples+' live playback sample'+(s.samples===1?'':'s')+' · '+s.attempts+' attempts':'No live samples yet';
  const body=$('measurement-rows');body.replaceChildren();
  for(const row of [...this.rows].reverse().slice(0,12)){const tr=el('tr');tr.title=(row.text||'').slice(0,200);const source=row.mode==='preview'?'Device':row.cached?'Replay':row.playback==='buffered'?'Bulbul / buffered':row.playback==='streaming'?'Bulbul / stream':'Bulbul';for(const text of [this.profileName(row.profile_id)+' / '+(row.language_code==='hi-IN'?'HI':'EN'),source,ms(row.first_byte_ms),ms(row.first_play_ms),row.status]){const td=el('td',row.status==='failed'?'line-result-failed':'',text);tr.append(td);}body.append(tr);}
  if(!this.rows.length){const tr=el('tr'),td=el('td','','Your voice lines will appear here.');td.colSpan=5;tr.append(td);body.append(tr);}
  const select=$('rating-line'),previous=select.value;select.replaceChildren(el('option','','Choose a voice line'));select.options[0].value='';
  for(const row of [...this.rows].reverse()){const o=el('option','',this.profileName(row.profile_id)+' · '+(row.language_code==='hi-IN'?'HI':'EN')+' · '+row.mode+' · '+(row.text||'').slice(0,55));o.value=row.id;select.append(o);}select.value=this.rows.some(r=>r.id===previous)?previous:'';
  $('export-csv').disabled=$('export-json').disabled=!this.rows.length;this.fillRatings();
 }
 fillRatings(){const row=this.rows.find(r=>r.id===$('rating-line').value);for(const key of ['naturalness','pronunciation','consistency']){$('rating-'+key).disabled=!row;$('rating-'+key).value=row?.[key]??'';}$('rating-notes').disabled=!row;$('rating-notes').value=row?.notes??'';}
 rate(key,value){const row=this.rows.find(r=>r.id===$('rating-line').value);if(!row)return;row[key]=value;this.persist();}
 download(text,extension,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=el('a');a.href=url;a.download='VoiceStage-voice-evaluation-'+new Date().toISOString().slice(0,10)+'.'+extension;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
