import { S } from '../core/store.js'
import { FX } from '../core/fx.js'
import { api, header, loadState, render, todayStr } from '../core/shell.js'
import { actArgs, registerActions } from '../core/events.js'
import { esc } from '../core/sanitize.js'

/* WAR ROOM — THE TONGUE: wise-response armory + supreme memorization engine
   Capture → Drill (5 attack modes) → Weekly Exam → Mastery Ladder → Reflex.
   "The rehearsed one is never surprised. The fresh one is a fool." */

// state moved to core/store.js: TG

export const TG_CATS = [
  ['deflection','fa-shield-halved','Deflection','Dodge probes without lying'],
  ['wit','fa-bolt','Wit','Sharp, memorable comebacks'],
  ['power','fa-chess-king','Power','Frame control & authority'],
  ['mystery','fa-mask','Unreadable','Reveal nothing, stay interesting'],
  ['boundaries','fa-hand','Boundaries','Graceful, unmovable NO'],
  ['praise','fa-gem','Praise & Grace','Elegant compliments/receiving'],
  ['conflict','fa-fire','Conflict','De-escalate & dominate calmly'],
  ['small_talk','fa-mug-hot','Small Talk','Turn trivia into presence'],
  ['negotiation','fa-scale-balanced','Negotiation','Positioning & leverage'],
  ['silence','fa-volume-xmark','Silence','When NOT to speak'],
];
export const TG_CAT = Object.fromEntries(TG_CATS.map(c=>[c[0],c]));

export const TG_MASTERY = {
  new:       ['NEW','#8b98ab','fa-seedling','Just captured — not yet in your head'],
  learning:  ['LEARNING','#60a5fa','fa-book-open','Forming — 3+ solid recalls'],
  memorized: ['MEMORIZED','#f59e0b','fa-brain','In memory — survives a week'],
  ingrained: ['INGRAINED','#d4af37','fa-anchor','Long-term — survives 3 weeks'],
  reflex:    ['REFLEX','#22c55e','fa-bolt-lightning','Yours forever — fires without thinking'],
};
export const TG_MODES = {
  recall:        ['fa-comments','SITUATION DRILL','You are IN the situation. The question comes at you. Speak your line OUT LOUD, then reveal.'],
  cloze:         ['fa-puzzle-piece','FILL THE GAPS','Key words are redacted. Reconstruct the exact line, then reveal.'],
  first_letters: ['fa-font','FIRST LETTERS','Only first letters remain. Rebuild the full response word-for-word.'],
  reverse:       ['fa-arrows-rotate','REVERSE','You see YOUR line. Name the situation & question it answers — proves deep binding.'],
  delivery:      ['fa-masks-theater','DELIVERY REP','Say it out loud 3× — vary tone: calm, amused, cold. Rate your fluency honestly.'],
};

export async function loadTongue(){
  const [stats, due] = await Promise.all([
    axios.get('/api/tongue/stats?date='+todayStr()).then(r=>r.data),
    axios.get('/api/tongue/due?date='+todayStr()).then(r=>r.data),
  ]);
  S.TG.stats = stats; S.TG.due = due;
  if (S.TG.view==='armory' || S.TG.list===null){
    S.TG.list = (await axios.get('/api/tongue?category='+S.TG.filter+(S.TG.search?'&q='+encodeURIComponent(S.TG.search):''))).data;
  }
}

/* ---------- helpers ---------- */
export function tgCloze(text){
  const words = text.split(/\s+/);
  return words.map((w,i)=>{
    const core = w.replace(/[^A-Za-z']/g,'');
    if (core.length >= 4 && (i % 3 === 1 || core.length >= 8))
      return `<span class="px-1 rounded" style="background:rgba(212,175,55,.15);color:transparent;border-bottom:1px dashed rgba(212,175,55,.5)">${'_'.repeat(Math.min(core.length,10))}</span>`;
    return esc(w);
  }).join(' ');
}
export function tgFirstLetters(text){
  return text.split(/\s+/).map(w=>{
    const m = w.match(/^([A-Za-z])(.*)$/);
    return m ? `<b class="text-gold">${m[1]}</b><span class="text-gray-600">${'·'.repeat(Math.max(1,Math.min(m[2].replace(/[^A-Za-z']/g,'').length,8)))}</span>` : esc(w);
  }).join(' ');
}
export function tgMasteryPill(m){
  const [label,color,ic] = TG_MASTERY[m]||TG_MASTERY.new;
  return `<span class="pill" style="background:${color}18;color:${color};border:1px solid ${color}55"><i class="fas ${ic} text-[8px]"></i>${label}</span>`;
}
export function tgCatPill(cat){
  const c = TG_CAT[cat]||TG_CAT.wit;
  return `<span class="pill bg-gray-800/80 text-gray-300 border border-line"><i class="fas ${c[1]} text-[8px]"></i>${c[2].toUpperCase()}</span>`;
}

/* ---------- MAIN VIEW ---------- */
export function viewTongue(){
  const s = S.TG.stats||{};
  const mastered = (s.byMastery||[]).filter(x=>['memorized','ingrained','reflex'].includes(x.mastery)).reduce((a,x)=>a+x.n,0);
  const reflex = ((s.byMastery||[]).find(x=>x.mastery==='reflex')||{}).n||0;
  const pct = s.total ? Math.round(mastered/s.total*100) : 0;
  return header()+`
  <section id="tongue-section" class="stagger">
    <div class="card-lux p-4 mb-3 flex items-center gap-4">
      ${FX.ring(pct, 84, 7, mastered, 'OF '+(s.total||0))}
      <div class="flex-1">
        <h2 class="font-engraved font-bold text-sm gold-text"><i class="fas fa-comment-dots mr-1"></i>THE TONGUE</h2>
        <p class="text-[10px] text-gray-500 leading-relaxed mt-1">Every wise line you capture gets drilled into long-term memory until it fires as <b class="text-jade">reflex</b> — no scripts, no phone, just you.</p>
        <p class="text-[10px] mt-1"><span class="text-gold font-bold">${reflex}</span> <span class="text-gray-500">at reflex ·</span> <span class="text-sky-400 font-bold">${s.captured7||0}</span> <span class="text-gray-500">captured this week</span></p>
      </div>
    </div>

    <div class="flex gap-1.5 mb-3">
      ${[['today','fa-crosshairs','TRAIN'],['capture','fa-plus','CAPTURE'],['armory','fa-box-archive','ARMORY'],['exam','fa-graduation-cap','EXAM']].map(([v,ic,l])=>`
        <button class="btn flex-1 py-2 text-[10px] font-bold tracking-wider ${S.TG.view===v?'bg-gold/15 text-gold border border-gold/40':'bg-panel text-gray-400 border border-line'}"
          data-act="tgView" data-args="${actArgs([v])}"><i class="fas ${ic} mr-1"></i>${l}</button>`).join('')}
    </div>

    ${S.TG.view==='today'?tgToday():S.TG.view==='capture'?tgCapture():S.TG.view==='armory'?tgArmory():tgExamView()}
  </section>`;
}

export async function tgRefresh(){
  try {
    await loadTongue(); // refreshes stats + due (and the armory list when view==='armory')
  } catch(_){}
  render();
}

/* ---------- TRAIN (today) ---------- */
export function tgToday(){
  const s = S.TG.stats||{}, due = S.TG.due||[];
  if (S.TG.drill) return tgDrillCard();
  const ladder = ['new','learning','memorized','ingrained','reflex'].map(m=>{
    const n = ((s.byMastery||[]).find(x=>x.mastery===m)||{}).n||0;
    const [label,color,ic] = TG_MASTERY[m];
    return `<div class="text-center flex-1">
      <i class="fas ${ic} text-sm" style="color:${color}"></i>
      <p class="font-disp font-bold text-base" style="color:${color}">${n}</p>
      <p class="text-[8px] tracking-wider text-gray-500">${label}</p>
    </div>`;
  }).join('<div class="text-gray-700 self-center">→</div>');
  return `
    ${due.length?`
    <button class="btn w-full p-4 mb-3 bg-gold/10 border border-gold/40 text-gold font-bold text-sm" data-act="tgStartDrill">
      <i class="fas fa-dumbbell mr-1"></i> ${due.length} RESPONSE${due.length>1?'S':''} DUE — DRILL THE ARMORY NOW
    </button>`:`
    <div class="card p-4 mb-3 text-center">
      <i class="fas fa-circle-check text-jade text-2xl mb-1"></i>
      <p class="text-sm font-bold text-jade">ARMORY DRILLED — ALL FRESH</p>
      <p class="text-[10px] text-gray-500 mt-1">Nothing due. Go capture new wisdom — movies, podcasts, the office, books. Ears open.</p>
    </div>`}

    <div class="card-lux p-4 mb-3">
      <h3 class="text-[10px] font-bold tracking-[.18em] text-gray-400 mb-3">MASTERY LADDER — THE ROAD TO REFLEX</h3>
      <div class="flex items-start gap-1">${ladder}</div>
      <p class="text-[9px] text-gray-600 mt-3 leading-relaxed">NEW→LEARNING: 3 solid recalls · →MEMORIZED: 7 recalls + survives 1 week · →INGRAINED: 14 recalls + 3 weeks · →REFLEX: 25 recalls + 45 days. Reflex = it fires in live conversation without thinking.</p>
    </div>

    <div class="card p-3 mb-3 flex items-center gap-4">
      <div class="flex-1 text-center border-r border-line">
        <p class="font-disp font-bold text-lg text-white">${s.reviews7||0}</p>
        <p class="text-[9px] text-gray-500 tracking-wider">DRILLS THIS WEEK</p>
      </div>
      <div class="flex-1 text-center border-r border-line">
        <p class="font-disp font-bold text-lg ${s.reviews7&&s.solid7/s.reviews7>=.8?'text-jade':'text-amber-400'}">${s.reviews7?Math.round(s.solid7/s.reviews7*100):0}%</p>
        <p class="text-[9px] text-gray-500 tracking-wider">SOLID RECALL</p>
      </div>
      <div class="flex-1 text-center">
        <p class="font-disp font-bold text-lg ${s.weekExamDone?'text-jade':'text-red-400'}">${s.weekExamDone?'DONE':'DUE'}</p>
        <p class="text-[9px] text-gray-500 tracking-wider">WEEKLY EXAM</p>
      </div>
    </div>

    ${!s.weekExamDone && s.total>=3?`
    <button class="btn w-full p-3 mb-3 bg-red-950/40 border border-red-800/50 text-red-300 text-xs font-bold" data-act="tgExamView">
      <i class="fas fa-graduation-cap mr-1"></i> WEEKLY EXAM NOT TAKEN — FACE IT (pass ≥80% or take the flag)
    </button>`:''}

    <div class="card p-4">
      <h3 class="text-[10px] font-bold tracking-[.18em] text-gray-400 mb-2"><i class="fas fa-ear-listen text-gold mr-1"></i>THE DAILY HUNT</h3>
      <p class="text-[11px] text-gray-400 leading-relaxed">Wherever you are — office, movie, podcast, street — when someone answers a question in a way that makes them <b class="text-gold">unreadable, respected, clever</b>: pull out the phone. Capture the <b class="text-white">situation</b>, the exact <b class="text-white">question</b>, and the exact <b class="text-white">response</b>. Then this engine makes it permanently yours.</p>
    </div>`;
}

/* ---------- CAPTURE ---------- */
export function tgCapture(){
  return `
  <div class="card-lux p-4">
    <h3 class="font-engraved font-bold text-sm gold-text mb-3"><i class="fas fa-crosshairs mr-1"></i>CAPTURE THE LINE — EXACTLY AS HEARD</h3>
    <label class="text-[10px] font-bold tracking-wider text-gray-400">THE SITUATION <span class="text-red-400">*</span></label>
    <textarea id="tg-sit" rows="2" class="w-full bg-black/30 border border-line rounded-lg p-2.5 text-xs mt-1 mb-3" placeholder="Where/when. Who was present. What was at stake. e.g. 'Team meeting — boss asked in front of everyone…'"></textarea>
    <label class="text-[10px] font-bold tracking-wider text-gray-400">THE QUESTION / TRIGGER <span class="text-red-400">*</span></label>
    <textarea id="tg-q" rows="2" class="w-full bg-black/30 border border-line rounded-lg p-2.5 text-xs mt-1 mb-3" placeholder="The exact question or moment. e.g. 'So what do YOU think about the new policy?'"></textarea>
    <label class="text-[10px] font-bold tracking-wider text-gold">THE SMART WISE UNREADABLE RESPONSE <span class="text-red-400">*</span></label>
    <textarea id="tg-r" rows="3" class="w-full bg-black/30 border border-gold/40 rounded-lg p-2.5 text-xs mt-1 mb-3" placeholder="Word-for-word. The exact line that made them untouchable."></textarea>
    <label class="text-[10px] font-bold tracking-wider text-gray-400">WHY IT WORKS (what it signals / hides)</label>
    <textarea id="tg-why" rows="2" class="w-full bg-black/30 border border-line rounded-lg p-2.5 text-xs mt-1 mb-3" placeholder="e.g. 'Answers without revealing position; flips pressure back; sounds generous while conceding nothing.'"></textarea>
    <div class="flex gap-2 mb-3">
      <div class="flex-1">
        <label class="text-[10px] font-bold tracking-wider text-gray-400">SOURCE</label>
        <input id="tg-src" class="w-full bg-black/30 border border-line rounded-lg p-2.5 text-xs mt-1" placeholder="Movie / podcast / person / book">
      </div>
      <div class="flex-1">
        <label class="text-[10px] font-bold tracking-wider text-gray-400">CATEGORY</label>
        <select id="tg-cat" class="w-full bg-black/30 border border-line rounded-lg p-2.5 text-xs mt-1">
          ${TG_CATS.map(c=>`<option value="${c[0]}">${c[2]} — ${c[3]}</option>`).join('')}
        </select>
      </div>
    </div>
    <button class="btn btn-gold w-full p-3 text-sm font-bold" data-act="tgSave"><i class="fas fa-vault mr-1"></i> LOCK IT IN THE ARMORY (+3 pts)</button>
    <p class="text-[9px] text-gray-600 mt-2 text-center">It enters the drill queue immediately — first drill today.</p>
  </div>`;
}
export async function tgSave(){
  const v = id => document.getElementById(id).value;
  try {
    await api('post','/api/tongue',{ situation:v('tg-sit'), trigger_q:v('tg-q'), response:v('tg-r'), why_works:v('tg-why'), source:v('tg-src'), category:v('tg-cat') });
    FX.success(); FX.toast('CAPTURED. The line is in the armory — now make it yours.','gold');
    S.TG.list=null; await loadTongue(); S.TG.view='today'; render();
  } catch(e){ FX.fail(); }
}

/* ---------- DRILL ENGINE — 5 attack modes ---------- */
export function tgStartDrill(){
  S.TG.drill = S.TG.due.slice();
  S.TG.drillIdx = 0; S.TG.drillReveal = false; S.TG.drillSession = {done:0, fluent:0};
  render();
}

export function tgDrillCard(){
  const list = S.TG.drill;
  if (S.TG.drillIdx >= list.length){
    const s = S.TG.drillSession;
    setTimeout(()=>{ if(s.done>0 && s.fluent/s.done>=.7) FX.confetti({count:90}); },200);
    S.TG.drill = null;
    return `<div class="card-lux p-6 text-center mb-3">
      <i class="fas fa-medal text-3xl gold-text mb-2"></i>
      <h3 class="font-engraved font-bold text-lg gold-text">DRILL SESSION COMPLETE</h3>
      <p class="text-xs text-gray-400 mt-1">${s.done} lines attacked · ${s.fluent} fluent</p>
      <p class="text-[10px] text-gray-500 mt-2 leading-relaxed">Every honest grade tightens the schedule. Lines you almost lost come back tomorrow; lines you own retreat for weeks — that is long-term memory being built.</p>
      <button class="btn btn-gold mt-3 px-6 py-2 text-xs font-bold" data-act="tgRefresh">BACK TO TRAINING GROUND</button>
    </div>`;
  }
  const r = list[S.TG.drillIdx];
  const mode = r.drill_mode || 'recall';
  const [mIc, mLabel, mHint] = TG_MODES[mode];
  let challenge = '';
  if (!S.TG.drillReveal){
    if (mode==='recall') challenge = `
      <div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
        <p class="text-[9px] font-bold tracking-widest text-gray-500 mb-1">SITUATION</p>
        <p class="text-xs text-gray-300 leading-relaxed">${esc(r.situation)}</p>
      </div>
      <div class="p-3 rounded-lg bg-black/30 border border-sky-900/50 mb-2">
        <p class="text-[9px] font-bold tracking-widest text-sky-500 mb-1">THEY ASK YOU</p>
        <p class="text-sm text-white font-semibold leading-relaxed">“${esc(r.trigger_q)}”</p>
      </div>
      <p class="text-[10px] text-gold text-center font-bold tracking-wider mt-3 mb-1">⟡ SPEAK YOUR LINE OUT LOUD — THEN REVEAL ⟡</p>`;
    else if (mode==='cloze') challenge = `
      <div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
        <p class="text-[9px] font-bold tracking-widest text-sky-500 mb-1">“${esc(r.trigger_q)}”</p>
      </div>
      <div class="p-3 rounded-lg bg-black/30 border border-gold/30 mb-2">
        <p class="text-[9px] font-bold tracking-widest text-gold mb-1">YOUR LINE — GAPS REDACTED</p>
        <p class="text-sm leading-relaxed text-gray-300">${tgCloze(r.response)}</p>
      </div>`;
    else if (mode==='first_letters') challenge = `
      <div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
        <p class="text-[9px] font-bold tracking-widest text-sky-500 mb-1">“${esc(r.trigger_q)}”</p>
      </div>
      <div class="p-3 rounded-lg bg-black/30 border border-gold/30 mb-2">
        <p class="text-[9px] font-bold tracking-widest text-gold mb-1">FIRST LETTERS ONLY — REBUILD IT WORD-FOR-WORD</p>
        <p class="text-sm leading-loose">${tgFirstLetters(r.response)}</p>
      </div>`;
    else if (mode==='reverse') challenge = `
      <div class="p-3 rounded-lg bg-black/30 border border-gold/30 mb-2">
        <p class="text-[9px] font-bold tracking-widest text-gold mb-1">YOUR LINE</p>
        <p class="text-sm text-white font-semibold leading-relaxed">“${esc(r.response)}”</p>
      </div>
      <p class="text-[10px] text-sky-400 text-center font-bold tracking-wider mt-3 mb-1">⟡ WHAT SITUATION & QUESTION DOES THIS ANSWER? SAY IT — THEN REVEAL ⟡</p>`;
    else challenge = `
      <div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
        <p class="text-[9px] font-bold tracking-widest text-sky-500 mb-1">“${esc(r.trigger_q)}”</p>
      </div>
      <div class="p-3 rounded-lg bg-black/30 border border-gold/30 mb-2">
        <p class="text-[9px] font-bold tracking-widest text-gold mb-1">YOUR LINE</p>
        <p class="text-sm text-white font-semibold leading-relaxed">“${esc(r.response)}”</p>
      </div>
      <p class="text-[10px] text-gold text-center font-bold tracking-wider mt-2 mb-1">⟡ SAY IT OUT LOUD 3× — CALM · AMUSED · COLD ⟡</p>
      <p class="text-[9px] text-gray-500 text-center">Fluency in the mouth, not just the mind. If you stumble, grade honestly.</p>`;
  } else {
    challenge = `
      <div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
        <p class="text-[9px] font-bold tracking-widest text-gray-500 mb-1">SITUATION</p>
        <p class="text-xs text-gray-300">${esc(r.situation)}</p>
      </div>
      <div class="p-3 rounded-lg bg-black/30 border border-sky-900/50 mb-2">
        <p class="text-[9px] font-bold tracking-widest text-sky-500 mb-1">THE QUESTION</p>
        <p class="text-xs text-white">“${esc(r.trigger_q)}”</p>
      </div>
      <div class="p-3 rounded-lg border mb-2" style="background:rgba(212,175,55,.07);border-color:rgba(212,175,55,.4)">
        <p class="text-[9px] font-bold tracking-widest text-gold mb-1">THE EXACT LINE</p>
        <p class="text-sm text-white font-semibold leading-relaxed">“${esc(r.response)}”</p>
      </div>
      ${r.why_works?`<div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
        <p class="text-[9px] font-bold tracking-widest text-jade mb-1">WHY IT WORKS</p>
        <p class="text-[11px] text-gray-400 leading-relaxed">${esc(r.why_works)}</p>
      </div>`:''}`;
  }
  return `
  <div class="card-lux p-4 mb-3">
    <div class="flex items-center justify-between mb-2">
      <span class="pill bg-gold/10 text-gold border border-gold/40"><i class="fas ${mIc} text-[8px]"></i>${mLabel}</span>
      <span class="text-[10px] text-gray-500 font-bold">${S.TG.drillIdx+1} / ${list.length}</span>
    </div>
    <div class="prog mb-3"><div style="width:${Math.round(S.TG.drillIdx/list.length*100)}%"></div></div>
    <div class="flex gap-1.5 mb-3">${tgMasteryPill(r.mastery)}${tgCatPill(r.category)}${r.source?`<span class="pill bg-gray-900 text-gray-500 border border-line">${esc(r.source).slice(0,18)}</span>`:''}</div>
    <p class="text-[10px] text-gray-500 mb-3 leading-relaxed"><i class="fas fa-circle-info mr-1"></i>${mHint}</p>
    ${challenge}
    ${!S.TG.drillReveal?`
    <button class="btn btn-gold w-full p-3 mt-2 text-sm font-bold" data-act="tgDrillReveal"><i class="fas fa-eye mr-1"></i> REVEAL THE LINE</button>`:`
    <p class="text-[10px] font-bold tracking-widest text-gray-400 text-center mt-3 mb-2">HONEST GRADE — HOW DID IT FIRE?</p>
    <div class="grid grid-cols-4 gap-1.5">
      <button class="btn p-2.5 bg-red-950/60 border border-red-800/60 text-red-300 text-[10px] font-bold" data-act="tgGrade" data-args="${actArgs([r.id,0,mode])}">BLANK<br><span class="text-[8px] opacity-70">reset</span></button>
      <button class="btn p-2.5 bg-amber-950/60 border border-amber-800/60 text-amber-300 text-[10px] font-bold" data-act="tgGrade" data-args="${actArgs([r.id,1,mode])}">SHAKY<br><span class="text-[8px] opacity-70">soon</span></button>
      <button class="btn p-2.5 bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-[10px] font-bold" data-act="tgGrade" data-args="${actArgs([r.id,2,mode])}">SOLID<br><span class="text-[8px] opacity-70">later</span></button>
      <button class="btn p-2.5 bg-gold/15 border border-gold/50 text-gold text-[10px] font-bold" data-act="tgGrade" data-args="${actArgs([r.id,3,mode])}">FLUENT<br><span class="text-[8px] opacity-70">far</span></button>
    </div>`}
  </div>`;
}

export async function tgGrade(id, grade, mode){
  try {
    const res = await api('post', `/api/tongue/${id}/review`, { grade, mode, date: todayStr() });
    S.TG.drillSession.done++;
    if (grade===3) S.TG.drillSession.fluent++;
    if (grade===0) FX.fail(); else if (grade===3) FX.success(); else FX.tap();
    if (res.promoted){
      FX.confetti({count:70});
      FX.toast('⬆ PROMOTED TO '+res.promoted.toUpperCase()+' — this line is becoming part of you','gold');
    }
  } catch(e){}
  S.TG.drillIdx++; S.TG.drillReveal=false;
  render();
}

/* ---------- ARMORY ---------- */
export function tgArmory(){
  const list = S.TG.list||[];
  return `
  <div class="flex gap-1.5 mb-2">
    <input id="tg-search" class="flex-1 bg-black/30 border border-line rounded-lg px-3 py-2 text-xs" placeholder="Search situations, questions, lines…" value="${esc(S.TG.search)}"
      data-act-change="tgSearch">
    <button class="btn px-3 bg-panel border border-line text-gray-400 text-xs" data-act="tgSearchClear"><i class="fas fa-xmark"></i></button>
  </div>
  <div class="flex gap-1 mb-3 overflow-x-auto pb-1" style="scrollbar-width:none">
    <button class="pill shrink-0 ${S.TG.filter==='all'?'bg-gold/15 text-gold border border-gold/40':'bg-gray-900 text-gray-400 border border-line'}" data-act="tgFilter" data-args="${actArgs(['all'])}">ALL</button>
    ${TG_CATS.map(c=>`<button class="pill shrink-0 ${S.TG.filter===c[0]?'bg-gold/15 text-gold border border-gold/40':'bg-gray-900 text-gray-400 border border-line'}" data-act="tgFilter" data-args="${actArgs([c[0]])}"><i class="fas ${c[1]} text-[8px]"></i>${c[2].toUpperCase()}</button>`).join('')}
  </div>
  ${list.length===0?`<div class="card p-5 text-center"><i class="fas fa-box-open text-2xl text-gray-600 mb-2"></i><p class="text-xs text-gray-500">Armory ${S.TG.search||S.TG.filter!=='all'?'has no match':'is empty'}. ${!S.TG.search&&S.TG.filter==='all'?'Capture your first wise line — the hunt starts today.':''}</p></div>`:''}
  ${list.map(r=>`
  <article class="card p-3 mb-2">
    <div class="flex gap-1.5 mb-1.5 flex-wrap">${tgMasteryPill(r.mastery)}${tgCatPill(r.category)}
      <span class="text-[9px] text-gray-600 ml-auto self-center">${r.correct_reviews||0}✓ · ${r.lapses||0}✗ · every ${r.interval_days||0}d</span></div>
    <p class="text-[10px] text-gray-500 leading-relaxed mb-1"><i class="fas fa-location-dot text-[8px] mr-1"></i>${esc(r.situation)}</p>
    <p class="text-[11px] text-sky-300 mb-1">“${esc(r.trigger_q)}”</p>
    <p class="text-xs text-white font-semibold leading-relaxed">→ “${esc(r.response)}”</p>
    ${r.why_works?`<p class="text-[10px] text-gray-500 mt-1 italic">${esc(r.why_works)}</p>`:''}
    <div class="flex gap-2 mt-2 items-center">
      ${r.source?`<span class="text-[9px] text-gray-600"><i class="fas fa-film text-[8px] mr-0.5"></i>${esc(r.source)}</span>`:''}
      <button class="btn ml-auto px-2.5 py-1 text-[10px] bg-gray-900 text-gray-500 border border-line" data-act="tgDelete" data-args="${actArgs([r.id])}"><i class="fas fa-trash text-[9px]"></i></button>
    </div>
  </article>`).join('')}`;
}
export async function tgDelete(id){
  if (!confirm('Retire this line from the armory? Its training history is kept.')) return;
  await api('delete','/api/tongue/'+id);
  FX.tap(); S.TG.list=null; await loadTongue(); render();
}

/* ---------- WEEKLY EXAM ---------- */
export function tgExamView(){
  const s = S.TG.stats||{};
  if (!S.TG.exam){
    return `
    <div class="card-lux p-4 mb-3">
      <h3 class="font-engraved font-bold text-sm gold-text mb-2"><i class="fas fa-graduation-cap mr-1"></i>THE WEEKLY TONGUE EXAM</h3>
      <p class="text-[11px] text-gray-400 leading-relaxed mb-2">10 random lines from your armory. For each: the situation and question appear — <b class="text-white">speak your exact line out loud</b>, reveal, and judge yourself with ruthless honesty. <b class="text-gold">Pass ≥ 80%</b>. Fail = honesty flag + −10 pts. This is where you prove the armory lives in your head, not in the app.</p>
      ${s.total<3?`<p class="text-[10px] text-amber-400"><i class="fas fa-triangle-exclamation mr-1"></i>You need at least 3 trained lines before an exam makes sense. Capture and drill first.</p>`
      :`<button class="btn btn-gold w-full p-3 text-sm font-bold" data-act="tgStartExam"><i class="fas fa-swords mr-1"></i> BEGIN THE EXAM</button>`}
    </div>
    ${(s.exams&&s.exams.length)?`
    <div class="card p-3">
      <h4 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">EXAM RECORD</h4>
      ${s.exams.map(e=>`
        <div class="flex items-center gap-2 py-1.5 border-b border-line/50 last:border-0">
          <i class="fas ${e.passed?'fa-circle-check text-jade':'fa-circle-xmark text-red-400'}"></i>
          <span class="text-xs text-gray-300 flex-1">${e.exam_date}</span>
          <span class="font-disp font-bold text-sm ${e.passed?'text-jade':'text-red-400'}">${e.score_pct}%</span>
          <span class="text-[9px] text-gray-600">${e.correct}/${e.total}</span>
        </div>`).join('')}
    </div>`:''}`;
  }
  // live exam
  const list = S.TG.exam;
  if (S.TG.examIdx >= list.length){
    const pct = Math.round(S.TG.examCorrect/list.length*100);
    return `<div class="card-lux p-6 text-center">
      <i class="fas ${pct>=80?'fa-trophy gold-text':'fa-skull text-red-400'} text-3xl mb-2"></i>
      <h3 class="font-engraved font-bold text-xl ${pct>=80?'gold-text':'text-red-400'}">${pct>=80?'EXAM PASSED':'EXAM FAILED'}</h3>
      <p class="font-disp font-bold text-3xl mt-1 ${pct>=80?'text-jade':'text-red-400'}">${pct}%</p>
      <p class="text-xs text-gray-400 mt-1">${S.TG.examCorrect} / ${list.length} lines fired correctly</p>
      <p class="text-[10px] text-gray-500 mt-2">${pct>=80?'+25 pts. The armory is in your head.':'−10 pts + flag filed. Drill the failures and retake.'}</p>
      <button class="btn btn-gold mt-3 px-6 py-2 text-xs font-bold" data-act="tgFinishExam" data-args="${actArgs([list.length])}">SEAL THE RECORD</button>
    </div>`;
  }
  const q = list[S.TG.examIdx];
  return `
  <div class="card-lux p-4">
    <div class="flex items-center justify-between mb-2">
      <span class="pill pill-blood"><i class="fas fa-graduation-cap text-[8px]"></i>EXAM</span>
      <span class="text-[10px] text-gray-500 font-bold">${S.TG.examIdx+1} / ${list.length}</span>
    </div>
    <div class="prog mb-3"><div style="width:${Math.round(S.TG.examIdx/list.length*100)}%"></div></div>
    <div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
      <p class="text-[9px] font-bold tracking-widest text-gray-500 mb-1">SITUATION</p>
      <p class="text-xs text-gray-300">${esc(q.situation)}</p>
    </div>
    <div class="p-3 rounded-lg bg-black/30 border border-sky-900/50 mb-2">
      <p class="text-[9px] font-bold tracking-widest text-sky-500 mb-1">THEY ASK YOU</p>
      <p class="text-sm text-white font-semibold">“${esc(q.trigger_q)}”</p>
    </div>
    ${!S.TG.examReveal?`
    <p class="text-[10px] text-gold text-center font-bold tracking-wider my-3">⟡ SPEAK YOUR EXACT LINE OUT LOUD ⟡</p>
    <button class="btn btn-gold w-full p-3 text-sm font-bold" data-act="tgExamReveal"><i class="fas fa-eye mr-1"></i> REVEAL & JUDGE</button>`:`
    <div class="p-3 rounded-lg border mb-3" style="background:rgba(212,175,55,.07);border-color:rgba(212,175,55,.4)">
      <p class="text-[9px] font-bold tracking-widest text-gold mb-1">THE EXACT LINE</p>
      <p class="text-sm text-white font-semibold leading-relaxed">“${esc(q.response)}”</p>
    </div>
    <p class="text-[10px] font-bold tracking-widest text-gray-400 text-center mb-2">DID YOU FIRE IT WORD-FOR-WORD? BE RUTHLESS.</p>
    <div class="grid grid-cols-2 gap-2">
      <button class="btn p-3 bg-red-950/60 border border-red-800/60 text-red-300 text-xs font-bold" data-act="tgExamAnswer" data-args="${actArgs([false])}"><i class="fas fa-xmark mr-1"></i>MISSED IT</button>
      <button class="btn p-3 bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-xs font-bold" data-act="tgExamAnswer" data-args="${actArgs([true])}"><i class="fas fa-check mr-1"></i>NAILED IT</button>
    </div>`}
  </div>`;
}
export async function tgStartExam(){
  try { S.TG.exam = (await axios.get('/api/tongue/exam')).data; }
  catch(_){ FX.toast('Could not load the exam — try again.','bad'); return; }
  if (!S.TG.exam.length){ FX.toast('No trained lines yet — drill first.','bad'); S.TG.exam=null; return; }
  S.TG.examIdx=0; S.TG.examReveal=false; S.TG.examCorrect=0;
  render();
}

export function tgExamAnswer(ok){
  if (ok){ S.TG.examCorrect++; FX.success(); } else FX.fail();
  S.TG.examIdx++; S.TG.examReveal=false; render();
}

export async function tgFinishExam(total){
  const res = await api('post','/api/tongue/exam/submit',{ total, correct: S.TG.examCorrect, date: todayStr() });
  if (res.passed){ FX.confetti({count:140}); FX.victory && FX.victory(); }
  S.TG.exam=null;
  await loadTongue(); await loadState(); render();
}

registerActions({
  tgView:        (e, el, v) => { S.TG.view = v; tgRefresh(); },
  tgExamView:    () => { S.TG.view = 'exam'; render(); },
  tgStartDrill:  () => tgStartDrill(),
  tgSave:        () => tgSave(),
  tgRefresh:     () => tgRefresh(),
  tgDrillReveal: () => { S.TG.drillReveal = true; FX.tap(); render(); },
  tgGrade:       (e, el, id, grade, mode) => tgGrade(id, grade, mode),
  tgSearch:      (e, el) => { S.TG.search = el.value; tgRefresh(); },
  tgSearchClear: () => { S.TG.search = ''; tgRefresh(); },
  tgFilter:      (e, el, f) => { S.TG.filter = f; tgRefresh(); },
  tgDelete:      (e, el, id) => tgDelete(id),
  tgStartExam:   () => tgStartExam(),
  tgFinishExam:  (e, el, total) => tgFinishExam(total),
  tgExamReveal:  () => { S.TG.examReveal = true; FX.tap(); render(); },
  tgExamAnswer:  (e, el, ok) => tgExamAnswer(ok),
});
