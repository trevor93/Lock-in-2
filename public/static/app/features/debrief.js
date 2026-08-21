import { S } from '../core/store.js'
import { FX } from '../core/fx.js'
import { api, clearDrafts, header, loadState, render, toast, todayStr } from '../core/shell.js'
import { registerActions } from '../core/events.js'
import { esc, nl2br } from '../core/sanitize.js'

/* WAR ROOM — Debrief + Stats */
export function viewDebrief(){
  const d=S.STATE.debrief||{};
  const filed = !!S.STATE.debriefDoneToday;
  return header()+
  '<section id="debrief-section" class="stagger">'+
    '<div class="card-lux p-3.5 mb-3 flex items-center gap-3">'+
      '<i class="fas '+(filed?'fa-file-shield text-jade':'fa-pen-nib text-fuchsia-400')+' text-2xl" style="filter:drop-shadow(0 0 10px currentColor)"></i>'+
      '<div class="flex-1">'+
        '<h2 class="font-engraved font-bold text-sm '+(filed?'text-jade':'gold-text')+'">NIGHT DEBRIEF — '+todayStr()+'</h2>'+
        '<p class="text-[10px] text-gray-500 leading-relaxed mt-0.5">'+(filed?'Filed. You can still amend it before midnight.':'The single highest-leverage habit in this system. 10 minutes. Marcus Aurelius did this 1,900 years ago. Missing it triggers the honesty engine.')+'</p>'+
      '</div>'+
    '</div>'+
    '<div class="card p-3.5 mb-3">'+
      '<label class="text-[10px] font-bold tracking-widest text-emerald-400">WHAT DID I WIN TODAY?</label>'+
      '<textarea id="db-wins" rows="2" class="mb-2">'+esc(d.wins||'')+'</textarea>'+
      '<label class="text-[10px] font-bold tracking-widest text-red-400">WHERE DID I BREAK THE SCHEDULE — AND WHY, HONESTLY?</label>'+
      '<textarea id="db-breaks" rows="2" class="mb-2">'+esc(d.breaks||'')+'</textarea>'+
      '<label class="text-[10px] font-bold tracking-widest text-gold">TOMORROW\'S 3 TARGETS (Law 4 — decide tonight)</label>'+
      '<textarea id="db-targets" rows="3" placeholder="1.&#10;2.&#10;3." class="mb-2">'+esc(d.tomorrow_targets||'')+'</textarea>'+
      '<label class="text-[10px] font-bold tracking-widest text-rose-400">STRATEGY INSIGHT — one principle I saw or used today</label>'+
      '<textarea id="db-insight" rows="2" class="mb-2">'+esc(d.strategy_insight||'')+'</textarea>'+
      '<div class="grid grid-cols-2 gap-2 mb-2">'+
        '<div><label class="text-[10px] font-bold text-gray-400">MOOD (1-5)</label><input type="number" id="db-mood" min="1" max="5" value="'+(d.mood||'')+'"></div>'+
        '<div><label class="text-[10px] font-bold text-gray-400">ENERGY (1-5)</label><input type="number" id="db-energy" min="1" max="5" value="'+(d.energy||'')+'"></div>'+
      '</div>'+
      '<div class="grid grid-cols-3 gap-2 mb-3">'+
        '<div><label class="text-[10px] font-bold text-gray-400">WOKE AT</label><input type="time" id="db-wake" value="'+(d.wake_time||'')+'"></div>'+
        '<div><label class="text-[10px] font-bold text-gray-400">LIGHTS OUT</label><input type="time" id="db-sleep" value="'+(d.sleep_time||'')+'"></div>'+
        '<div><label class="text-[10px] font-bold text-gray-400">SLEPT (h)</label><input type="number" step="0.25" id="db-hours" value="'+(d.sleep_hours||'')+'"></div>'+
      '</div>'+
      '<button class="btn btn-gold w-full p-3 text-sm" data-act="saveDebrief"><i class="fas fa-file-shield mr-1"></i> FILE INTELLIGENCE REPORT (+25)</button>'+
    '</div>'+
    predictionsPanel()+
    rewardsPanel()+
    '<div class="sect">PAST REPORTS — '+S.DEBRIEFS.length+' FILED</div>'+
    S.DEBRIEFS.slice(0,14).map(x=>
      '<details class="card p-3 mb-2">'+
        '<summary class="text-xs font-bold cursor-pointer">'+x.log_date+(x.sleep_hours?' · '+x.sleep_hours+'h sleep':'')+(x.mood?' · mood '+x.mood+'/5':'')+'</summary>'+
        '<div class="mt-2 text-[11px] text-gray-400 space-y-1">'+
          (x.wins?'<p><span class="text-emerald-400 font-bold">WINS:</span> '+nl2br(x.wins)+'</p>':'')+
          (x.breaks?'<p><span class="text-red-400 font-bold">BREAKS:</span> '+nl2br(x.breaks)+'</p>':'')+
          (x.tomorrow_targets?'<p><span class="text-gold font-bold">TARGETS:</span> '+nl2br(x.tomorrow_targets)+'</p>':'')+
          (x.strategy_insight?'<p><span class="text-rose-400 font-bold">INSIGHT:</span> '+nl2br(x.strategy_insight)+'</p>':'')+
        '</div>'+
      '</details>').join('')+
  '</section>';
}

export function rewardsPanel(){
  if(!S.REWARDS){ axios.get('/api/rewards').then(r=>{S.REWARDS=r.data; if(S.TAB==='debrief')render();}); return ''; }
  return '<div class="card p-3">'+
    '<h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2"><i class="fas fa-trophy text-gold"></i> REWARDS — EARNED, NEVER GIVEN (you have <span class="text-gold font-bold">'+S.STATE.points+'</span> pts)</h3>'+
    S.REWARDS.map(r=>
      '<div class="flex items-center gap-2 py-1.5 border-b border-line/50 last:border-0">'+
        '<div class="flex-1"><p class="text-xs font-semibold">'+esc(r.title)+'</p><p class="text-[10px] text-gray-500">'+esc(r.description||'')+(r.redeemed_count?' · taken ×'+r.redeemed_count:'')+'</p></div>'+
        '<button class="btn px-3 py-1.5 text-[11px] font-bold '+(S.STATE.points>=r.cost?'bg-gold/20 border border-gold/50 text-gold':'bg-gray-800 text-gray-600 border border-line')+'" data-act="redeem" data-args="['+r.id+']">'+r.cost+'</button>'+
      '</div>').join('')+
  '</div>';
}

export async function redeem(id){
  await api('post','/api/rewards/'+id+'/redeem',{}); // date is server-derived
  FX.confetti({count:80}); FX.toast('REWARD CLAIMED — paid in discipline, enjoy with zero guilt','gold');
  S.REWARDS=(await axios.get('/api/rewards')).data; await loadState(); render();
}

export async function saveDebrief(){
  const b={date:todayStr(),wins:$('#db-wins').value,breaks:$('#db-breaks').value,tomorrow_targets:$('#db-targets').value,
    strategy_insight:$('#db-insight').value,mood:Number($('#db-mood').value)||null,energy:Number($('#db-energy').value)||null,
    wake_time:$('#db-wake').value||null,sleep_time:$('#db-sleep').value||null,sleep_hours:Number($('#db-hours').value)||null};
  if(!b.wins&&!b.breaks&&!b.tomorrow_targets){ toast('An empty report is a lie of omission. Write something true.',true); return; }
  if(!b.tomorrow_targets){ toast('Law 4: tomorrow\'s 3 targets are NOT optional. Decide tonight.',true); return; }
  await api('post','/api/debrief',b);
  if (clearDrafts) clearDrafts(['db-wins','db-breaks','db-targets','db-insight','db-mood','db-energy','db-wake','db-sleep','db-hours']);
  FX.success(); FX.toast('INTELLIGENCE REPORT FILED — tomorrow already knows its orders  +25','gold');
  S.DEBRIEFS=(await axios.get('/api/debriefs')).data; await loadState(); render();
}

/* ============ PREDICTION LOG — the calibration instrument ============ */
// state moved to core/store.js: PREDICTIONS, CALIBRATION
export async function loadPredictions(){
  [S.PREDICTIONS, S.CALIBRATION] = await Promise.all([
    axios.get('/api/predictions').then(r=>r.data),
    axios.get('/api/predictions/calibration').then(r=>r.data)
  ]);
}
export function predictionsPanel(){
  if(!S.PREDICTIONS){ loadPredictions().then(()=>{ if(S.TAB==='debrief')render(); }); return '<div class="card p-3 mb-3 text-[11px] text-gray-500">Loading prediction log…</div>'; }
  const open = S.PREDICTIONS.filter(p=>p.outcome==='unresolved');
  const overdue = open.filter(p=>p.resolve_by<=S.STATE.date);
  const resolved = S.PREDICTIONS.filter(p=>p.outcome==='right'||p.outcome==='wrong');
  const cal = S.CALIBRATION||{};
  return '<div class="card-lux p-3.5 mb-3" id="prediction-log">'+
    '<h3 class="font-engraved font-bold text-xs gold-text mb-1"><i class="fas fa-crosshairs mr-1"></i>PREDICTION LOG — CALIBRATED JUDGMENT</h3>'+
    '<p class="text-[10px] text-gray-500 mb-2">Claim → confidence → date → graded. The only cure for a brain that rewrites its own past.</p>'+
    (cal.n?'<div class="card-glass p-2.5 mb-2">'+
      '<p class="text-[10px] text-gray-400">'+cal.n+' graded · Brier <b class="text-gold">'+cal.brier+'</b> (0 = prophet, 0.25 = coin flip)</p>'+
      (cal.buckets&&cal.buckets.length?'<div class="flex items-end gap-1 mt-1.5" style="height:44px">'+
        cal.buckets.map(b=>'<div class="flex-1 text-center">'+
          '<div class="flex items-end justify-center gap-0.5" style="height:32px">'+
            '<div style="width:8px;height:'+(b.avgConfidence*0.32)+'px;background:#5b6b85" title="claimed"></div>'+
            '<div style="width:8px;height:'+(b.hitRate*0.32)+'px;background:'+(b.hitRate>=b.avgConfidence-5?'#22c55e':'#dc2626')+'" title="actual"></div>'+
          '</div><span class="text-[7px] text-gray-600">'+b.range+'</span></div>').join('')+
      '</div><p class="text-[7px] text-gray-600 mt-0.5">grey = claimed · green/red = reality</p>':'')+
      '<p class="text-[10px] mt-1.5 leading-relaxed '+((cal.verdict||'').startsWith('OVERCONF')?'text-red-400':(cal.verdict||'').startsWith('WELL')?'text-jade':'text-amber-400')+'">'+esc(cal.verdict||'')+'</p>'+
    '</div>':'<p class="text-[10px] text-gray-500 mb-2">'+esc(cal.verdict||'No graded predictions yet.')+'</p>')+
    (overdue.length?'<div class="card p-2.5 mb-2 border-red-800/50"><p class="text-[10px] font-bold text-red-400 mb-1">'+overdue.length+' PREDICTION'+(overdue.length>1?'S':'')+' AWAITING JUDGMENT — grade them now, memory rots fast:</p>'+
      overdue.map(p=>predRow(p)).join('')+'</div>':'')+
    (open.filter(p=>p.resolve_by>S.STATE.date).length?'<div class="mb-2">'+open.filter(p=>p.resolve_by>S.STATE.date).slice(0,5).map(p=>predRow(p)).join('')+'</div>':'')+
    '<div class="card p-2.5 mb-2">'+
      '<input id="pred-claim" type="text" placeholder="Precise, falsifiable claim — e.g. “X will reply within 3 days”" class="w-full bg-ink border border-line rounded px-2 py-2 text-[11px] mb-1.5">'+
      '<div class="grid grid-cols-3 gap-1.5 mb-1.5">'+
        '<div><label class="text-[8px] font-bold text-gray-500">CONFIDENCE %</label><input id="pred-conf" type="number" min="50" max="99" value="70" class="w-full"></div>'+
        '<div><label class="text-[8px] font-bold text-gray-500">RESOLVE BY</label><input id="pred-by" type="date" class="w-full"></div>'+
        '<div><label class="text-[8px] font-bold text-gray-500">DOMAIN</label><input id="pred-domain" type="text" placeholder="people/money/…" class="w-full"></div>'+
      '</div>'+
      '<button class="btn w-full p-2 text-[11px] bg-gold/10 border border-gold/40 text-gold font-bold" data-act="savePrediction"><i class="fas fa-stamp mr-1"></i>SEAL THE CLAIM</button>'+
    '</div>'+
    (resolved.length?'<details class="text-[10px] text-gray-500"><summary class="cursor-pointer font-bold">GRADED RECORD ('+resolved.length+')</summary>'+
      resolved.slice(0,15).map(p=>'<div class="py-1 border-b border-line/40"><span class="'+(p.outcome==='right'?'text-jade':'text-red-400')+' font-bold">'+p.outcome.toUpperCase()+'</span> · '+p.confidence+'% · '+esc(p.claim)+'</div>').join('')+'</details>':'')+
  '</div>';
}
export function predRow(p){
  return '<div class="flex items-center gap-1.5 py-1 border-b border-line/40 last:border-0">'+
    '<div class="flex-1 min-w-0"><p class="text-[10px] text-gray-300 truncate">'+esc(p.claim)+'</p>'+
    '<p class="text-[8px] text-gray-600">'+p.confidence+'% · by '+p.resolve_by+(p.domain?' · '+esc(p.domain):'')+'</p></div>'+
    '<button class="btn px-2 py-1 text-[9px] bg-emerald-900/60 border border-emerald-700 text-emerald-300" data-act="resolvePred" data-args="['+p.id+',&quot;right&quot;]">RIGHT</button>'+
    '<button class="btn px-2 py-1 text-[9px] bg-red-900/60 border border-red-800 text-red-300" data-act="resolvePred" data-args="['+p.id+',&quot;wrong&quot;]">WRONG</button>'+
    '<button class="btn px-1.5 py-1 text-[9px] bg-gray-800/60 border border-line text-gray-500" title="void (unfalsifiable/canceled)" data-act="resolvePred" data-args="['+p.id+',&quot;void&quot;]">—</button>'+
  '</div>';
}
export async function savePrediction(){
  const claim=$('#pred-claim').value, confidence=Number($('#pred-conf').value), resolve_by=$('#pred-by').value, domain=$('#pred-domain').value;
  await api('post','/api/predictions',{claim,confidence,resolve_by,domain});
  if (clearDrafts) clearDrafts(['pred-claim','pred-conf','pred-by','pred-domain']);
  FX.success(); FX.toast('CLAIM SEALED — reality will grade it on '+resolve_by,'gold');
  await loadPredictions(); render();
}
export async function resolvePred(id,outcome){
  await api('post','/api/predictions/'+id+'/resolve',{outcome});
  FX.tap(); await loadPredictions(); render();
}

/* ============ STATS ============ */
export function viewStats(){
  const s=S.STATS;
  const avg=Math.round(s.days.reduce((a,d)=>a+d.pct,0)/s.days.length);
  const sleepDays=s.days.filter(d=>d.sleep!=null);
  const avgSleep=sleepDays.length?(sleepDays.reduce((a,d)=>a+d.sleep,0)/sleepDays.length).toFixed(1):'—';
  const catName={morning:'Morning',workout:'Exercise',deepwork:'Deep Work',study:'University',meal:'Meals',strategy:'Strategy',philosophy:'Philosophy',entertainment:'Entertainment',skincare:'Skincare',admin:'Admin',social:'Social',review:'Review',sleep:'Sleep',flex:'Recovery',rest:'Rest'};
  const rank = FX.rank(S.STATE.points);
  return header()+
  '<section id="stats-section" class="stagger">'+
    '<div class="card-lux p-4 mb-3 flex items-center gap-4">'+
      FX.ring(rank.prog, 84, 7, '', '')+
      '<div class="flex-1">'+
        '<p class="text-[9px] text-gray-500 font-bold tracking-[.2em]">CURRENT RANK</p>'+
        '<p class="font-engraved font-bold text-lg gold-text"><i class="fas '+rank.icon+' mr-1"></i>'+rank.name+'</p>'+
        (rank.next
          ?'<p class="text-[10px] text-gray-500 mt-0.5">'+(rank.nextAt-Math.max(S.STATE.points,0))+' pts to <span class="text-gold font-bold">'+rank.next+'</span> · '+rank.prog+'% there</p>'
          :'<p class="text-[10px] text-gold mt-0.5">MAXIMUM RANK ACHIEVED</p>')+
      '</div>'+
    '</div>'+
    (s.alternativeExplanations?(function(){var ae=s.alternativeExplanations;var rate=ae.total?Math.round(ae.nonePlausible/ae.total*100):0;return '<div class="card p-3 mb-3 border-amber-800/40">'+'<h3 class="text-[10px] font-bold tracking-widest text-amber-400 mb-1"><i class="fas fa-scale-balanced mr-1"></i>THE BRAKE — alternative explanations</h3>'+'<p class="text-xs text-gray-300">You logged <b>'+ae.total+'</b> alternative explanations on heated captures. <b class="'+(rate>=50?'text-red-400':'text-gray-300')+'">'+ae.nonePlausible+'</b> were \"none plausible\" ('+rate+'%).</p>'+'<p class="text-[10px] text-gray-500 mt-1">A rising none-plausible rate is the paranoia tell (Law 23). Low is good — it means you keep considering the charitable reading.</p>'+'</div>';})():'')+
    (S.STATS.changelog&&S.STATS.changelog.length?'<div class="card p-3 mb-3">'+'<h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2"><i class="fas fa-scroll mr-1"></i>HOW THE RULES CHANGED</h3>'+S.STATS.changelog.map(function(e){return '<p class="text-[11px] text-gray-400 mb-1.5"><span class="text-gold font-bold">'+esc(e.date)+'</span> — '+esc(e.change)+'</p>';}).join('')+'<p class="text-[9px] text-gray-600 mt-1">The rules of your own game are visible. Nothing changes silently.</p>'+'</div>':'')+
    '<div class="grid grid-cols-3 gap-2 mb-3">'+
      '<div class="card-glass p-3 text-center"><p class="font-disp font-bold text-xl '+(avg>=80?'text-jade':avg>=50?'text-amber-400':'text-red-400')+'" data-countup="'+avg+'">'+avg+'</p><p class="text-[8px] text-gray-500 font-bold tracking-widest">14-DAY ADH %</p></div>'+
      '<div class="card-glass p-3 text-center"><p class="font-disp font-bold text-xl text-sky-400">'+avgSleep+'h</p><p class="text-[8px] text-gray-500 font-bold tracking-widest">AVG SLEEP</p></div>'+
      '<div class="card-glass p-3 text-center"><p class="font-disp font-bold text-xl text-rose-400">'+(s.unitStats.complete||0)+'/'+(s.unitStats.total||0)+'</p><p class="text-[8px] text-gray-500 font-bold tracking-widest">UNITS WON</p></div>'+
    '</div>'+
    (s.medals?
    '<div class="card-lux p-3.5 mb-3">'+
      '<div class="flex items-center justify-between mb-2">'+
        '<h3 class="font-engraved font-bold text-xs gold-text"><i class="fas fa-medal mr-1"></i>MEDALS OF THE CAMPAIGN</h3>'+
        '<span class="pill pill-gold">'+s.medals.filter(m=>m.earned).length+' / '+s.medals.length+'</span>'+
      '</div>'+
      '<div class="grid grid-cols-3 gap-2">'+
        s.medals.map(m=>{
          const pct = m.goal ? Math.round((m.prog/m.goal)*100) : (m.earned?100:0);
          return '<div class="text-center p-2 rounded-xl" style="'+(m.earned
            ?'background:linear-gradient(160deg,rgba(212,175,55,.14),rgba(212,175,55,.03));border:1px solid rgba(212,175,55,.4)'
            :'background:rgba(15,21,32,.6);border:1px solid var(--line);opacity:.55')+'">'+
            '<i class="fas '+m.icon+' text-lg mb-1 '+(m.earned?'gold-text':'text-gray-600')+'" '+(m.earned?'style="filter:drop-shadow(0 0 8px rgba(212,175,55,.6))"':'')+'></i>'+
            '<p class="text-[8px] font-bold tracking-wider '+(m.earned?'text-gold':'text-gray-500')+'">'+m.title+'</p>'+
            '<p class="text-[7px] text-gray-600 leading-tight mt-0.5">'+m.desc+'</p>'+
            (m.goal&&!m.earned?'<div class="prog mt-1" style="height:3px"><div style="width:'+pct+'%"></div></div>':'')+
          '</div>';
        }).join('')+
      '</div>'+
    '</div>':'')+
    '<div class="card p-3 mb-3">'+
      '<h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">LAST 14 DAYS (green = victory · blue = held the line)</h3>'+
      '<div class="flex items-end gap-1" style="height:70px">'+
        s.days.map(d=>'<div class="flex-1 flex flex-col items-center gap-0.5">'+
          '<div class="w-full rounded-t" style="height:'+Math.max(d.pct,3)*0.6+'px;background:'+(d.pct>=80&&d.debrief?'#22c55e':d.mvdHeld?'#3b82f6':d.pct>=50?'#f59e0b':d.total===0?'#1e2a3d':'#dc2626')+'"></div>'+
          '<span class="text-[7px] text-gray-600">'+d.date.slice(8)+'</span></div>').join('')+
      '</div>'+
    '</div>'+
    '<div class="card p-3 mb-3">'+
      '<h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">7-DAY OUTPUT BY FRONT</h3>'+
      (s.categories.length?s.categories.map(cr=>{
        const pct=cr.total?Math.round((cr.done/cr.total)*100):0;
        return '<div class="mb-1.5"><div class="flex justify-between text-[10px] mb-0.5"><span class="cat-'+cr.category+' font-semibold">'+(catName[cr.category]||cr.category)+'</span><span class="text-gray-500">'+pct+'%</span></div><div class="prog"><div class="cat-'+cr.category+'" style="width:'+pct+'%;background:currentColor"></div></div></div>';
      }).join(''):'<p class="text-[11px] text-gray-500">No logs yet. Start checking off blocks.</p>')+
    '</div>'+
    '<div class="card p-3 mb-3">'+
      '<h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">MIND FORGE</h3>'+
      '<p class="text-[11px] text-gray-400">Flashcard reviews: <span class="text-gold font-bold">'+(s.cardStats.reviews||0)+'</span> · avg recall grade: <span class="text-gold font-bold">'+(s.cardStats.avg_grade?Number(s.cardStats.avg_grade).toFixed(2):'—')+'</span>/3</p>'+
      (s.flagCounts.length
        ?'<p class="text-[11px] text-gray-400 mt-1">Honesty flags all-time: '+s.flagCounts.map(f=>'<span class="text-red-400">'+f.flag_type.replace(/_/g,' ')+' ×'+f.n+'</span>').join(' · ')+'</p>'
        :'<p class="text-[11px] text-jade mt-1">Zero honesty flags. Clean record, soldier.</p>')+
    '</div>'+
    '<div class="card p-3">'+
      '<h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">POINTS LEDGER (latest)</h3>'+
      (s.ledger.slice(0,25).map(l=>
        '<div class="flex gap-2 py-1 border-b border-line/40 last:border-0 text-[10px]">'+
          '<span class="font-bold w-9 text-right '+(l.points>=0?'text-jade':'text-red-400')+'">'+(l.points>=0?'+':'')+l.points+'</span>'+
          '<span class="text-gray-400 flex-1">'+esc(l.reason)+'</span>'+
          '<span class="text-gray-600 shrink-0">'+l.log_date.slice(5)+'</span>'+
        '</div>').join('')||'<p class="text-[11px] text-gray-500">Empty. Go earn.</p>')+
    '</div>'+
  '</section>';
}

registerActions({
  saveDebrief:    () => saveDebrief(),
  redeem:         (e, el, id) => redeem(id),
  savePrediction: () => savePrediction(),
  resolvePred:    (e, el, id, outcome) => resolvePred(id, outcome),
});
