import { S } from '../core/store.js'
import { FX } from '../core/fx.js'
import { api, header, loadState, render, shell, toast, todayStr, segments } from '../core/shell.js'
import { registerActions } from '../core/events.js'
import { esc, nl2br } from '../core/sanitize.js'
import { viewCouncil } from './council.js'
import { viewDebrief, viewStats } from './debrief.js'
import { loadLibrary, viewLibrary } from './library.js'
import { viewMind } from './mind.js'
import { loadResponseLab, viewResponseLab } from './response-lab.js'
import { loadRhetoric, viewRhetoric } from './rhetoric.js'

/* WAR ROOM — Campaign / Mind / Debrief / Stats */
// state moved to core/store.js: CAMPAIGN, MAXIMS, DUE, STATS, DEBRIEFS, REWARDS
// state moved to core/store.js: OPEN_UNIT, CARD_IDX, CARD_FLIP, MIND_MODE

export const renderExtra = async function(tab){
  // Book 9: the five tabs. Each face is what used to be its own tab, so every
  // surface the commander had is still reachable - one level in, not nine across.
  const face = S.SUB[tab];
  if (tab==='learn'){
    if (face==='books'){ if(!S.LIBRARY) await loadLibrary(); shell(segments(tab) + viewLibrary()); }
    // Book 11: the Farnsworth programme is a LEARN face, because it is a syllabus with
    // a day range and a gate, not a drill queue.
    else if (face==='rhetoric'){ await loadRhetoric(); shell(segments(tab) + viewRhetoric()); }
    else { if(!S.CAMPAIGN) S.CAMPAIGN=(await axios.get('/api/campaign')).data; shell(segments(tab) + viewCampaign()); }
  }
  else if (tab==='practice'){
    // Book 12.7: the Tongue is the Response Lab.
    if (face==='response'){ await loadResponseLab(); shell(segments(tab) + viewResponseLab()); }
    else {
      if(!S.DUE) S.DUE=(await axios.get('/api/cards/due?date='+todayStr())).data;
      if(!S.MAXIMS) S.MAXIMS=(await axios.get('/api/maxims')).data;
      S.MIND_MODE = (face==='maxims') ? 'bank' : 'cards';
      shell(segments(tab) + viewMind());
    }
  }
  else if (tab==='review'){
    if (face==='stats'){
      S.STATS=(await axios.get('/api/stats?date='+todayStr())).data;
      try{ S.STATS.changelog=(await axios.get('/api/changelog')).data; }catch(_){ S.STATS.changelog=[]; }
      shell(segments(tab) + viewStats());
    } else {
      if(!S.DEBRIEFS) S.DEBRIEFS=(await axios.get('/api/debriefs')).data;
      shell(segments(tab) + viewDebrief());
    }
  }
  else if (tab==='more'){
    if(!S.INTEL) S.INTEL=(await axios.get('/api/intel')).data;
    if(!S.HERMES_HIST) S.HERMES_HIST=(await axios.get('/api/hermes/history')).data;
    if (face==='settings'){ if(!S.LIBRARY) await loadLibrary(); shell(segments(tab) + viewLibrary()); }
    else { S.COUNCIL_MODE = (face==='intel') ? 'intel' : 'hermes'; shell(segments(tab) + viewCouncil()); }
  }
};

/* ============ CAMPAIGN ============ */
export const UST = {locked:['LOCKED','bg-gray-800 text-gray-500'],active:['ACTIVE','bg-gold/20 text-gold'],reading_done:['READING OK','bg-sky-950 text-sky-300'],drill_done:['DRILL OK','bg-emerald-950 text-emerald-300'],complete:['CONQUERED','bg-emerald-800 text-emerald-100']};

export function viewCampaign(){
  const totalUnits = S.CAMPAIGN.reduce((a,p)=>a+p.total,0);
  const totalDone  = S.CAMPAIGN.reduce((a,p)=>a+p.complete,0);
  const warPct = totalUnits?Math.round(totalDone/totalUnits*100):0;
  return header()+
  '<section id="campaign-section" class="stagger">'+
    '<div class="card-lux p-4 mb-3 flex items-center gap-4">'+
      FX.ring(warPct, 84, 7, totalDone, 'OF '+totalUnits)+
      '<div class="flex-1">'+
        '<h2 class="font-engraved font-bold text-sm gold-text">THE CAMPAIGN</h2>'+
        '<p class="text-[10px] text-gray-500 leading-relaxed mt-1">Progress-locked. Unit N opens only when N−1 falls. No calendar pressure — depth is the weapon.</p>'+
      '</div>'+
    '</div>'+
    S.CAMPAIGN.map(p=>{
      const trackColor = p.track==='strategy'?'#f43f5e':'#818cf8';
      const phaseDone = p.complete===p.total && p.total>0;
      return '<article class="'+(phaseDone?'card-lux':'card')+' p-3.5 mb-3">'+
        '<div class="flex items-center justify-between mb-1">'+
          '<h3 class="font-disp font-bold text-sm tracking-wide" style="color:'+trackColor+'">'+(phaseDone?'🏆 ':'')+esc(p.title)+'</h3>'+
          '<span class="pill '+(phaseDone?'pill-gold':'pill-dim')+'">'+p.complete+' / '+p.total+'</span>'+
        '</div>'+
        '<p class="text-[10px] text-gray-500 mb-2">'+esc(p.subtitle||'')+'</p>'+
        '<div class="prog mb-2"><div style="width:'+p.progress+'%"></div></div>'+
        p.units.map(u=>{
          const st=UST[u.status]||UST.locked;
          const open=S.OPEN_UNIT===u.id;
          const isActive=['active','reading_done','drill_done'].includes(u.status);
          const icon=u.status==='locked'?'fa-lock text-gray-600':u.status==='complete'?'fa-flag text-emerald-400':u.is_exam?'fa-shield-halved text-gold':'fa-location-dot text-gold';
          return '<div class="border-t border-line/50 py-2 '+(isActive?'-mx-2 px-2 rounded-lg" style="background:rgba(212,175,55,.05)':'')+'">'+
            '<button class="w-full flex items-center gap-2 text-left" data-act="toggleUnit" data-args="['+u.id+']" '+(u.status==='locked'?'disabled':'')+'>'+
              '<i class="fas '+icon+' text-xs w-4 '+(isActive?'animate-pulse':'')+'"></i>'+
              '<span class="text-xs flex-1 '+(u.status==='locked'?'text-gray-600':'')+' '+(u.status==='complete'?'line-through text-gray-500':'')+'">'+esc(u.title)+'</span>'+
              '<span class="pill '+st[1]+'">'+st[0]+'</span>'+
            '</button>'+
            (open&&u.status!=='locked'?unitDetail(u):'')+
          '</div>';
        }).join('')+
      '</article>';}).join('')+
  '</section>';
}

export function unitDetail(u){
  const ex=u.exam_questions?JSON.parse(u.exam_questions):null;
  let h='<div class="mt-2 pl-6 fade-in">';
  if(u.reading) h+='<div class="mb-2"><p class="text-[9px] font-bold tracking-widest text-sky-400"><i class="fas fa-book"></i> READING</p><p class="text-xs text-gray-300">'+esc(u.reading)+'</p></div>';
  if(u.lesson) h+='<div class="mb-2"><p class="text-[9px] font-bold tracking-widest text-gold"><i class="fas fa-chess-knight"></i> THE LESSON</p><p class="text-xs text-gray-300 leading-relaxed">'+esc(u.lesson)+'</p></div>';
  if(u.field_drill) h+='<div class="mb-2"><p class="text-[9px] font-bold tracking-widest text-emerald-400"><i class="fas fa-person-running"></i> FIELD DRILL</p><p class="text-xs text-gray-300 leading-relaxed">'+esc(u.field_drill)+'</p></div>';
  if(u.debrief_prompt) h+='<div class="mb-2"><p class="text-[9px] font-bold tracking-widest text-fuchsia-400"><i class="fas fa-moon"></i> NIGHT DEBRIEF PROMPT</p><p class="text-xs text-gray-300 italic">'+esc(u.debrief_prompt)+'</p></div>';
  if(u.drill_report) h+='<div class="mb-2 card p-2"><p class="text-[9px] font-bold text-emerald-500">YOUR DRILL REPORT</p><p class="text-[11px] text-gray-400">'+nl2br(u.drill_report)+'</p></div>';
  if(u.status!=='complete'){ h+= u.is_exam?examForm(u,ex):stepForm(u); }
  else h+='<p class="text-[10px] text-emerald-400 font-bold"><i class="fas fa-flag"></i> CONQUERED '+(u.completed_at?u.completed_at.slice(0,10):'')+(u.exam_self_score!=null?' · exam '+u.exam_self_score+'/100':'')+'</p>';
  return h+'</div>';
}

export function stepForm(u){
  if(u.status==='active') return '<button class="btn w-full p-2.5 bg-sky-900/60 border border-sky-700 text-sky-200 text-xs font-bold" data-act="unitStep" data-args="['+u.id+',&quot;reading&quot;]"><i class="fas fa-book mr-1"></i> I FINISHED THE READING (twice, pen in hand)</button>';
  if(u.status==='reading_done') return '<p class="text-[10px] font-bold text-emerald-400 mb-1">NOW: EXECUTE THE FIELD DRILL, THEN REPORT:</p>'+
    '<textarea id="drill-report-'+u.id+'" rows="4" placeholder="What did you actually DO? What happened? Be specific — thin reports are rejected by the honesty engine."></textarea>'+
    '<button class="btn w-full p-2.5 mt-1.5 bg-emerald-900/60 border border-emerald-700 text-emerald-200 text-xs font-bold" data-act="unitStep" data-args="['+u.id+',&quot;drill&quot;]"><i class="fas fa-person-running mr-1"></i> FILE DRILL REPORT</button>';
  if(u.status==='drill_done') return '<textarea id="debrief-ans-'+u.id+'" rows="2" placeholder="(Optional) Answer the debrief prompt above in 1-3 sentences"></textarea>'+
    '<button class="btn w-full p-2.5 mt-1.5 bg-gold/20 border border-gold/50 text-gold text-xs font-bold" data-act="unitStep" data-args="['+u.id+',&quot;complete&quot;]"><i class="fas fa-flag mr-1"></i> CONQUER UNIT → UNLOCK NEXT</button>';
  return '';
}

export function examForm(u,qs){
  return '<div class="card p-3 border-gold/40">'+
    '<p class="text-[10px] font-bold tracking-widest text-gold mb-2"><i class="fas fa-shield-halved"></i> INTEGRATION EXAM — write from memory FIRST, then verify. Pass: 70/100 self-graded, brutally.</p>'+
    qs.map((q,i)=>'<div class="mb-2"><p class="text-[11px] text-gray-300 font-semibold mb-1">Q'+(i+1)+'. '+esc(q)+'</p><textarea id="exam-'+u.id+'-'+i+'" rows="3" placeholder="Your answer..."></textarea></div>').join('')+
    '<label class="text-[11px] text-gray-400 font-semibold">Brutal self-score (0-100): fluff = fail</label>'+
    '<input type="number" id="exam-score-'+u.id+'" min="0" max="100" placeholder="e.g. 75">'+
    '<button class="btn w-full p-2.5 mt-2 bg-gold/20 border border-gold/50 text-gold text-xs font-bold" data-act="submitExam" data-args="['+u.id+','+qs.length+']"><i class="fas fa-gavel mr-1"></i> SUBMIT EXAM FOR JUDGMENT</button>'+
  '</div>';
}

export function toggleUnit(id){ S.OPEN_UNIT=S.OPEN_UNIT===id?null:id; render(); }

export async function unitStep(id, step){
  const payload={step:step,date:todayStr()};
  if(step==='drill') payload.drill_report=($('#drill-report-'+id)||{}).value||'';
  if(step==='complete'){ const el=$('#debrief-ans-'+id); if(el) payload.debrief_answer=el.value; }
  await api('post','/api/units/'+id+'/step',payload);
  if(step==='complete'){ FX.confetti({count:110}); FX.toast('UNIT CONQUERED — NEXT FRONT UNLOCKED  +50','gold'); }
  else if(step==='drill'){ FX.success(); toast('Drill report filed. +30 pts.'); }
  else toast('Reading logged. +20 pts. Now: the field drill.');
  S.CAMPAIGN=(await axios.get('/api/campaign')).data; await loadState(); render();
}

export async function submitExam(id, n){
  const answers=[]; for(let i=0;i<n;i++) answers.push(($('#exam-'+id+'-'+i)||{}).value||'');
  if(answers.some(a=>a.trim().length<10)){ toast('Empty or one-line answers detected. This exam deserves real effort — the gate stays closed.', true); return; }
  const score=Number(($('#exam-score-'+id)||{}).value||0);
  const r=await api('post','/api/units/'+id+'/step',{step:'complete',exam_answers:answers,exam_self_score:score,date:todayStr()});
  if(r.failed){ FX.fail(); toast(r.message,true); } else { FX.confetti({count:160}); FX.toast('EXAM PASSED — PHASE GATE OPENED  +100','gold'); }
  S.CAMPAIGN=(await axios.get('/api/campaign')).data; await loadState(); render();
}

registerActions({
  toggleUnit: (e, el, id) => toggleUnit(id),
  unitStep:   (e, el, id, step) => unitStep(id, step),
  submitExam: (e, el, id, n) => submitExam(id, n),
});
