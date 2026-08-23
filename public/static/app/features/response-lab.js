import { S } from '../core/store.js'
import { FX } from '../core/fx.js'
import { api, header, loadState, render, todayStr } from '../core/shell.js'
import { actArgs, registerActions } from '../core/events.js'
import { esc } from '../core/sanitize.js'

/* WAR ROOM — RESPONSE LAB (Book 12.7).
   "The Tongue is renamed Response Lab and rebuilt around architectures rather than
   memorised domination lines."

   BUILD is therefore the first face and the one the book is about: eleven intents,
   each an architecture, and every response built in four layers — intent, truth,
   structure, delivery — because "never give the line alone; give the logic of the
   line so it can be adapted." Assessment is on six criteria, and escalation risk is
   the one where a higher score is a WORSE result, so no view here renders it as
   progress.

   The capture / drill / exam faces that follow are the memorisation engine for lines
   he heard in real rooms. They are kept because a built architecture still has to be
   in the mouth under pressure — but they are no longer the front of the surface, and
   the source field records the room, not the book (12.6).
*/

// state moved to core/store.js: RL

export const RL_CATS = [
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
export const RL_CAT = Object.fromEntries(RL_CATS.map(c=>[c[0],c]));

export const RL_MASTERY = {
  new:       ['NEW','#8b98ab','fa-seedling','Just captured — not yet in your head'],
  learning:  ['LEARNING','#60a5fa','fa-book-open','Forming — 3+ solid recalls'],
  memorized: ['MEMORIZED','#f59e0b','fa-brain','In memory — survives a week'],
  ingrained: ['INGRAINED','#d4af37','fa-anchor','Long-term — survives 3 weeks'],
  reflex:    ['REFLEX','#22c55e','fa-bolt-lightning','Yours forever — fires without thinking'],
};
export const RL_MODES = {
  recall:        ['fa-comments','SITUATION DRILL','You are IN the situation. The question comes at you. Speak your line OUT LOUD, then reveal.'],
  cloze:         ['fa-puzzle-piece','FILL THE GAPS','Key words are redacted. Reconstruct the exact line, then reveal.'],
  first_letters: ['fa-font','FIRST LETTERS','Only first letters remain. Rebuild the full response word-for-word.'],
  reverse:       ['fa-arrows-rotate','REVERSE','You see YOUR line. Name the situation & question it answers — proves deep binding.'],
  delivery:      ['fa-masks-theater','DELIVERY REP','Say it out loud 3× — vary tone: calm, amused, cold. Rate your fluency honestly.'],
};

/* ---------- 12.7 the four layers and the six criteria ----------
   Both lists come from the server (/api/lab/response/intents), which serves them from
   src/rhetoric-lab.ts. These are the field ids and the prompts the interface puts on
   screen; the RULES stay on the server so this file cannot drift from Book 12. */
export const RL_LAYER_FIELDS = [
  ['intent',    'rl-l-intent',    'LAYER 1 — INTENT',    'What this response is for. Not what you want to say: what it must accomplish.'],
  ['truth',     'rl-l-truth',     'LAYER 2 — TRUTH',     'What is actually true, stated to yourself first. If this layer is a lie the other three are decoration.'],
  ['structure', 'rl-l-structure', 'LAYER 3 — STRUCTURE', 'The moves, in order, following the intent’s architecture above.'],
  ['delivery',  'rl-l-delivery',  'LAYER 4 — DELIVERY',  'Cadence, emphasis, where to stop.'],
];

export const RL_SCORE_FIELDS = [
  ['appropriateness',   'rl-a-appropriateness',   'Appropriateness'],
  ['clarity',           'rl-a-clarity',           'Clarity'],
  ['proportionality',   'rl-a-proportionality',   'Proportionality'],
  ['naturalness',       'rl-a-naturalness',       'Naturalness'],
  ['objective_achieved','rl-a-objective_achieved','Objective achieved'],
  ['escalation_risk',   'rl-a-escalation_risk',   'Escalation risk'],
];

/* The server marks escalation_risk inverted. This asks the server's answer rather than
   hard-coding it, so a criterion that becomes inverted later cannot be rendered as
   progress by an out-of-date view. */
export function rlInverted(slug){
  const list = (S.RL.intents && S.RL.intents.assessment) || [];
  const found = list.find(a=>a.slug===slug);
  return found ? !!found.inverted : slug==='escalation_risk';
}

export async function loadResponseLab(){
  const [stats, due, intents] = await Promise.all([
    axios.get('/api/tongue/stats?date='+todayStr()).then(r=>r.data),
    axios.get('/api/tongue/due?date='+todayStr()).then(r=>r.data),
    S.RL.intents ? Promise.resolve(S.RL.intents)
                 : axios.get('/api/lab/response/intents').then(r=>r.data).catch(()=>null),
  ]);
  S.RL.stats = stats; S.RL.due = due;
  if (intents) S.RL.intents = intents;
  if (S.RL.view==='armory' || S.RL.list===null){
    S.RL.list = (await axios.get('/api/tongue?category='+S.RL.filter+(S.RL.search?'&q='+encodeURIComponent(S.RL.search):''))).data;
  }
  if (S.RL.view==='build' && S.RL.builds===null){
    try { S.RL.builds = (await axios.get('/api/lab/responses')).data; } catch(_){ S.RL.builds = { builds: [] }; }
  }
}

/* ---------- helpers ---------- */
export function rlCloze(text){
  const words = text.split(/\s+/);
  return words.map((w,i)=>{
    const core = w.replace(/[^A-Za-z']/g,'');
    if (core.length >= 4 && (i % 3 === 1 || core.length >= 8))
      return `<span class="px-1 rounded" style="background:rgba(212,175,55,.15);color:transparent;border-bottom:1px dashed rgba(212,175,55,.5)">${'_'.repeat(Math.min(core.length,10))}</span>`;
    return esc(w);
  }).join(' ');
}
export function rlFirstLetters(text){
  return text.split(/\s+/).map(w=>{
    const m = w.match(/^([A-Za-z])(.*)$/);
    return m ? `<b class="text-gold">${m[1]}</b><span class="text-gray-600">${'·'.repeat(Math.max(1,Math.min(m[2].replace(/[^A-Za-z']/g,'').length,8)))}</span>` : esc(w);
  }).join(' ');
}
export function rlMasteryPill(m){
  const [label,color,ic] = RL_MASTERY[m]||RL_MASTERY.new;
  return `<span class="pill" style="background:${color}18;color:${color};border:1px solid ${color}55"><i class="fas ${ic} text-[8px]"></i>${label}</span>`;
}
export function rlCatPill(cat){
  const c = RL_CAT[cat]||RL_CAT.wit;
  return `<span class="pill bg-gray-800/80 text-gray-300 border border-line"><i class="fas ${c[1]} text-[8px]"></i>${c[2].toUpperCase()}</span>`;
}

/* ---------- MAIN VIEW ---------- */
export function viewResponseLab(){
  const s = S.RL.stats||{};
  const mastered = (s.byMastery||[]).filter(x=>['memorized','ingrained','reflex'].includes(x.mastery)).reduce((a,x)=>a+x.n,0);
  const reflex = ((s.byMastery||[]).find(x=>x.mastery==='reflex')||{}).n||0;
  const pct = s.total ? Math.round(mastered/s.total*100) : 0;
  return header()+`
  <section id="response-lab-section" class="stagger">
    <div class="card-lux p-4 mb-3 flex items-center gap-4">
      ${FX.ring(pct, 84, 7, mastered, 'OF '+(s.total||0))}
      <div class="flex-1">
        <h2 class="font-engraved font-bold text-sm gold-text"><i class="fas fa-diagram-project mr-1"></i>RESPONSE LAB</h2>
        <p class="text-[10px] text-gray-500 leading-relaxed mt-1">Eleven intents, each an <b class="text-gold">architecture</b> rather than a line. Every response is built in four layers — intent, truth, structure, delivery — so the logic can be adapted instead of recited.</p>
        <p class="text-[10px] mt-1"><span class="text-gold font-bold">${reflex}</span> <span class="text-gray-500">at reflex ·</span> <span class="text-sky-400 font-bold">${s.captured7||0}</span> <span class="text-gray-500">captured this week</span></p>
      </div>
    </div>

    <div class="flex gap-1.5 mb-3">
      ${[['build','fa-diagram-project','BUILD'],['today','fa-crosshairs','TRAIN'],['capture','fa-plus','CAPTURE'],['armory','fa-box-archive','ARMORY'],['exam','fa-graduation-cap','EXAM']].map(([v,ic,l])=>`
        <button class="btn flex-1 py-2 text-[9px] font-bold tracking-wider ${S.RL.view===v?'bg-gold/15 text-gold border border-gold/40':'bg-panel text-gray-400 border border-line'}"
          data-act="rlView" data-args="${actArgs([v])}"><i class="fas ${ic} mr-1"></i>${l}</button>`).join('')}
    </div>

    ${S.RL.view==='build'?rlBuild():S.RL.view==='today'?rlToday():S.RL.view==='capture'?rlCapture():S.RL.view==='armory'?rlArmory():rlExamView()}
  </section>`;
}

/* ---------- BUILD — 12.7's own surface ----------
   The intent's architecture and its LOGIC are shown before any field, because the
   architecture is what is being learned; the four layers below are filled against it.
   Nothing here paraphrases the book: architecture, when_to_use, and logic all come from
   the server, which reads them from migration 0027. */
export function rlBuild(){
  const data = S.RL.intents;
  if (!data) return `
    <div class="card p-4 text-center">
      <i class="fas fa-plug-circle-xmark text-2xl text-gray-600 mb-2"></i>
      <p class="text-xs text-gray-500">The eleven intents could not be loaded. Nothing is shown from memory — the architectures and their logic live on the server, and a paraphrase would be worse than a blank.</p>
      <button class="btn mt-3 px-4 py-2 text-[10px] bg-panel border border-line text-gray-400 font-bold" data-act="rlRefresh">RETRY</button>
    </div>`;
  const intents = data.intents||[];
  const chosen = intents.find(i=>i.slug===S.RL.intentSlug) || null;
  return `
  <div class="card-lux p-4 mb-3">
    <h3 class="text-[10px] font-bold tracking-[.18em] text-gray-400 mb-1">1 · THE INTENT</h3>
    <p class="text-[10px] text-gray-500 mb-3 leading-relaxed">${esc(data.neverTheLineAlone||'')}</p>
    <div class="flex flex-wrap gap-1">
      ${intents.map(i=>`
        <button class="pill ${S.RL.intentSlug===i.slug?'bg-gold/15 text-gold border border-gold/40':'bg-gray-900 text-gray-400 border border-line'}"
          data-act="rlIntent" data-args="${actArgs([i.slug])}">${esc(i.title)}</button>`).join('')}
    </div>
  </div>
  ${!chosen?`
  <div class="card p-4 text-center">
    <i class="fas fa-hand-pointer text-2xl text-gray-600 mb-2"></i>
    <p class="text-xs text-gray-500">Choose the intent first. The architecture decides the structure — the reverse is how a response ends up well-worded and wrong.</p>
  </div>`:`
  <div class="card-lux p-4 mb-3" style="border-color:rgba(212,175,55,.4)">
    <h3 class="text-[10px] font-bold tracking-[.18em] text-gold mb-2">2 · THE ARCHITECTURE — ${esc(chosen.title).toUpperCase()}</h3>
    <p class="text-sm text-white font-semibold leading-relaxed mb-2">${esc(chosen.architecture||'')}</p>
    <p class="text-[10px] text-sky-300 leading-relaxed mb-2"><i class="fas fa-clock text-[9px] mr-1"></i>${esc(chosen.when_to_use||'')}</p>
    <div class="p-3 rounded-lg bg-black/30 border border-line">
      <p class="text-[9px] font-bold tracking-widest text-jade mb-1">WHY IT IS IN THAT ORDER</p>
      <p class="text-[11px] text-gray-400 leading-relaxed">${esc(chosen.logic||'')}</p>
    </div>
  </div>

  <div class="card-lux p-4 mb-3">
    <h3 class="text-[10px] font-bold tracking-[.18em] text-gray-400 mb-3">3 · THE FOUR LAYERS — ALL FOUR, OR IT IS A BARE LINE</h3>
    <label class="text-[10px] font-bold tracking-wider text-gray-400">THE SITUATION <span class="text-red-400">*</span></label>
    <textarea id="rl-b-sit" rows="2" class="w-full bg-black/30 border border-line rounded-lg p-2.5 text-xs mt-1 mb-3" placeholder="Who, where, what is actually at stake."></textarea>
    ${RL_LAYER_FIELDS.map(([slug,fid,label,asks])=>`
      <label class="text-[10px] font-bold tracking-wider text-gold">${label} <span class="text-red-400">*</span></label>
      <p class="text-[9px] text-gray-600 mb-1 leading-relaxed">${asks}</p>
      <textarea id="${fid}" rows="${slug==='structure'?'3':'2'}" class="w-full bg-black/30 border border-line rounded-lg p-2.5 text-xs mb-3"></textarea>`).join('')}
  </div>

  <div class="card p-4 mb-3">
    <h3 class="text-[10px] font-bold tracking-[.18em] text-gray-400 mb-1">4 · ASSESSMENT — SIX CRITERIA (0–3, OPTIONAL)</h3>
    <p class="text-[10px] text-amber-400 leading-relaxed mb-3"><i class="fas fa-triangle-exclamation text-[9px] mr-1"></i>Escalation risk is the one criterion where a higher score is a <b>worse</b> result. It is marked as such below and is never counted toward anything that reads as progress.</p>
    ${RL_SCORE_FIELDS.map(([slug,fid,label])=>{
      const inv = rlInverted(slug);
      return `
      <div class="flex items-center gap-2 mb-2">
        <label class="text-[11px] flex-1 ${inv?'text-amber-300':'text-gray-300'}">${label}${inv?' <span class="text-[9px] text-amber-500">(lower is better)</span>':''}</label>
        <select id="${fid}" class="bg-black/30 border ${inv?'border-amber-800/60':'border-line'} rounded-lg px-2 py-1.5 text-xs">
          <option value="">—</option><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option>
        </select>
      </div>`;
    }).join('')}
  </div>

  <button class="btn btn-gold w-full p-3 text-sm font-bold" data-act="rlSaveBuild"><i class="fas fa-layer-group mr-1"></i> RECORD THE BUILD</button>
  <p class="text-[9px] text-gray-600 mt-2 text-center">A build missing any of the four layers is refused, and the refusal names which layer is missing.</p>

  ${rlBuildHistory()}`}`;
}

/* Past builds. The architecture travels with each one so the structure can be checked
   against it rather than remembered. Escalation risk renders amber, never as a number
   climbing toward a good result. */
export function rlBuildHistory(){
  const list = (S.RL.builds && S.RL.builds.builds) || [];
  if (!list.length) return '';
  return `
  <div class="card p-4 mt-3">
    <h4 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">RECORDED BUILDS</h4>
    ${list.slice(0,12).map(b=>`
    <article class="py-2 border-b border-line/50 last:border-0">
      <div class="flex items-center gap-2 mb-1">
        <span class="pill bg-gold/10 text-gold border border-gold/40">${esc(b.intent_slug)}</span>
        <span class="text-[9px] text-gray-600 ml-auto">${esc(b.occurred_on||'')}</span>
      </div>
      <p class="text-[10px] text-gray-500 leading-relaxed mb-1">${esc(b.situation||'')}</p>
      <p class="text-[10px] text-sky-300 leading-relaxed mb-1"><b>STRUCTURE</b> · ${esc(b.layer_structure||'')}</p>
      <p class="text-[9px] text-gray-600 leading-relaxed">${esc(b.architecture||'')}</p>
      ${b.a_escalation_risk===null||b.a_escalation_risk===undefined?'':`
      <p class="text-[9px] text-amber-400 mt-1">escalation risk ${b.a_escalation_risk} — higher is worse</p>`}
    </article>`).join('')}
  </div>`;
}

export async function rlSaveBuild(){
  if (!S.RL.intentSlug){ FX.toast('Choose the intent first.','bad'); return; }
  const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const body = {
    intent_slug: S.RL.intentSlug,
    situation: v('rl-b-sit'),
    layer_intent: v('rl-l-intent'),
    layer_truth: v('rl-l-truth'),
    layer_structure: v('rl-l-structure'),
    layer_delivery: v('rl-l-delivery'),
    occurred_on: todayStr(),
  };
  for (const pair of RL_SCORE_FIELDS){
    const raw = v(pair[1]);
    if (raw !== '') body['a_'+pair[0]] = Number(raw);
  }
  try {
    await api('post','/api/lab/response', body);
    FX.success(); FX.toast('BUILD RECORDED — the architecture, not the line.','gold');
    S.RL.builds = null; await loadResponseLab(); render();
  } catch(e){ FX.fail(); }
}

export async function rlRefresh(){
  try {
    await loadResponseLab(); // refreshes stats + due (and the armory list when view==='armory')
  } catch(_){}
  render();
}

/* ---------- TRAIN (today) ---------- */
export function rlToday(){
  const s = S.RL.stats||{}, due = S.RL.due||[];
  if (S.RL.drill) return rlDrillCard();
  const ladder = ['new','learning','memorized','ingrained','reflex'].map(m=>{
    const n = ((s.byMastery||[]).find(x=>x.mastery===m)||{}).n||0;
    const [label,color,ic] = RL_MASTERY[m];
    return `<div class="text-center flex-1">
      <i class="fas ${ic} text-sm" style="color:${color}"></i>
      <p class="font-disp font-bold text-base" style="color:${color}">${n}</p>
      <p class="text-[8px] tracking-wider text-gray-500">${label}</p>
    </div>`;
  }).join('<div class="text-gray-700 self-center">→</div>');
  return `
    ${due.length?`
    <button class="btn w-full p-4 mb-3 bg-gold/10 border border-gold/40 text-gold font-bold text-sm" data-act="rlStartDrill">
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
    <button class="btn w-full p-3 mb-3 bg-red-950/40 border border-red-800/50 text-red-300 text-xs font-bold" data-act="rlExamView">
      <i class="fas fa-graduation-cap mr-1"></i> WEEKLY EXAM NOT TAKEN — FACE IT (pass ≥80% or take the flag)
    </button>`:''}

    <div class="card p-4">
      <h3 class="text-[10px] font-bold tracking-[.18em] text-gray-400 mb-2"><i class="fas fa-ear-listen text-gold mr-1"></i>THE DAILY HUNT</h3>
      <p class="text-[11px] text-gray-400 leading-relaxed">Wherever you are — office, movie, podcast, street — when someone answers a question in a way that makes them <b class="text-gold">unreadable, respected, clever</b>: pull out the phone. Capture the <b class="text-white">situation</b>, the exact <b class="text-white">question</b>, and the exact <b class="text-white">response</b>. Then this engine makes it permanently yours.</p>
    </div>`;
}

/* ---------- CAPTURE ---------- */
export function rlCapture(){
  return `
  <div class="card-lux p-4">
    <h3 class="font-engraved font-bold text-sm gold-text mb-3"><i class="fas fa-crosshairs mr-1"></i>CAPTURE THE LINE — EXACTLY AS HEARD</h3>
    <label class="text-[10px] font-bold tracking-wider text-gray-400">THE SITUATION <span class="text-red-400">*</span></label>
    <textarea id="rl-sit" rows="2" class="w-full bg-black/30 border border-line rounded-lg p-2.5 text-xs mt-1 mb-3" placeholder="Where/when. Who was present. What was at stake. e.g. 'Team meeting — boss asked in front of everyone…'"></textarea>
    <label class="text-[10px] font-bold tracking-wider text-gray-400">THE QUESTION / TRIGGER <span class="text-red-400">*</span></label>
    <textarea id="rl-q" rows="2" class="w-full bg-black/30 border border-line rounded-lg p-2.5 text-xs mt-1 mb-3" placeholder="The exact question or moment. e.g. 'So what do YOU think about the new policy?'"></textarea>
    <label class="text-[10px] font-bold tracking-wider text-gold">THE SMART WISE UNREADABLE RESPONSE <span class="text-red-400">*</span></label>
    <textarea id="rl-r" rows="3" class="w-full bg-black/30 border border-gold/40 rounded-lg p-2.5 text-xs mt-1 mb-3" placeholder="Word-for-word. The exact line that made them untouchable."></textarea>
    <label class="text-[10px] font-bold tracking-wider text-gray-400">WHY IT WORKS (what it signals / hides)</label>
    <textarea id="rl-why" rows="2" class="w-full bg-black/30 border border-line rounded-lg p-2.5 text-xs mt-1 mb-3" placeholder="e.g. 'Answers without revealing position; flips pressure back; sounds generous while conceding nothing.'"></textarea>
    <div class="flex gap-2 mb-3">
      <div class="flex-1">
        <label class="text-[10px] font-bold tracking-wider text-gray-400">SOURCE — THE ROOM</label>
        <input id="rl-src" class="w-full bg-black/30 border border-line rounded-lg p-2.5 text-xs mt-1" placeholder="Who said it, where, when. e.g. 'Standup, 14 Aug, delivery lead'">
      </div>
      <div class="flex-1">
        <label class="text-[10px] font-bold tracking-wider text-gray-400">CATEGORY</label>
        <select id="rl-cat" class="w-full bg-black/30 border border-line rounded-lg p-2.5 text-xs mt-1">
          ${RL_CATS.map(c=>`<option value="${c[0]}">${c[2]} — ${c[3]}</option>`).join('')}
        </select>
      </div>
    </div>
    <button class="btn btn-gold w-full p-3 text-sm font-bold" data-act="rlSave"><i class="fas fa-vault mr-1"></i> LOCK IT IN THE ARMORY (+3 pts)</button>
    <p class="text-[9px] text-gray-600 mt-2 text-center">It enters the drill queue immediately — first drill today.</p>
  </div>`;
}
export async function rlSave(){
  const v = id => document.getElementById(id).value;
  try {
    await api('post','/api/tongue',{ situation:v('rl-sit'), trigger_q:v('rl-q'), response:v('rl-r'), why_works:v('rl-why'), source:v('rl-src'), category:v('rl-cat') });
    FX.success(); FX.toast('CAPTURED. The line is in the armory — now make it yours.','gold');
    S.RL.list=null; await loadResponseLab(); S.RL.view='today'; render();
  } catch(e){ FX.fail(); }
}

/* ---------- DRILL ENGINE — 5 attack modes ---------- */
export function rlStartDrill(){
  S.RL.drill = S.RL.due.slice();
  S.RL.drillIdx = 0; S.RL.drillReveal = false; S.RL.drillSession = {done:0, fluent:0};
  render();
}

export function rlDrillCard(){
  const list = S.RL.drill;
  if (S.RL.drillIdx >= list.length){
    const s = S.RL.drillSession;
    setTimeout(()=>{ if(s.done>0 && s.fluent/s.done>=.7) FX.confetti({count:90}); },200);
    S.RL.drill = null;
    return `<div class="card-lux p-6 text-center mb-3">
      <i class="fas fa-medal text-3xl gold-text mb-2"></i>
      <h3 class="font-engraved font-bold text-lg gold-text">DRILL SESSION COMPLETE</h3>
      <p class="text-xs text-gray-400 mt-1">${s.done} lines attacked · ${s.fluent} fluent</p>
      <p class="text-[10px] text-gray-500 mt-2 leading-relaxed">Every honest grade tightens the schedule. Lines you almost lost come back tomorrow; lines you own retreat for weeks — that is long-term memory being built.</p>
      <button class="btn btn-gold mt-3 px-6 py-2 text-xs font-bold" data-act="rlRefresh">BACK TO TRAINING GROUND</button>
    </div>`;
  }
  const r = list[S.RL.drillIdx];
  const mode = r.drill_mode || 'recall';
  const [mIc, mLabel, mHint] = RL_MODES[mode];
  let challenge = '';
  if (!S.RL.drillReveal){
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
        <p class="text-sm leading-relaxed text-gray-300">${rlCloze(r.response)}</p>
      </div>`;
    else if (mode==='first_letters') challenge = `
      <div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
        <p class="text-[9px] font-bold tracking-widest text-sky-500 mb-1">“${esc(r.trigger_q)}”</p>
      </div>
      <div class="p-3 rounded-lg bg-black/30 border border-gold/30 mb-2">
        <p class="text-[9px] font-bold tracking-widest text-gold mb-1">FIRST LETTERS ONLY — REBUILD IT WORD-FOR-WORD</p>
        <p class="text-sm leading-loose">${rlFirstLetters(r.response)}</p>
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
      <span class="text-[10px] text-gray-500 font-bold">${S.RL.drillIdx+1} / ${list.length}</span>
    </div>
    <div class="prog mb-3"><div style="width:${Math.round(S.RL.drillIdx/list.length*100)}%"></div></div>
    <div class="flex gap-1.5 mb-3">${rlMasteryPill(r.mastery)}${rlCatPill(r.category)}${r.source?`<span class="pill bg-gray-900 text-gray-500 border border-line">${esc(r.source).slice(0,18)}</span>`:''}</div>
    <p class="text-[10px] text-gray-500 mb-3 leading-relaxed"><i class="fas fa-circle-info mr-1"></i>${mHint}</p>
    ${challenge}
    ${!S.RL.drillReveal?`
    <button class="btn btn-gold w-full p-3 mt-2 text-sm font-bold" data-act="rlDrillReveal"><i class="fas fa-eye mr-1"></i> REVEAL THE LINE</button>`:`
    <p class="text-[10px] font-bold tracking-widest text-gray-400 text-center mt-3 mb-2">HONEST GRADE — HOW DID IT FIRE?</p>
    <div class="grid grid-cols-4 gap-1.5">
      <button class="btn p-2.5 bg-red-950/60 border border-red-800/60 text-red-300 text-[10px] font-bold" data-act="rlGrade" data-args="${actArgs([r.id,0,mode])}">BLANK<br><span class="text-[8px] opacity-70">reset</span></button>
      <button class="btn p-2.5 bg-amber-950/60 border border-amber-800/60 text-amber-300 text-[10px] font-bold" data-act="rlGrade" data-args="${actArgs([r.id,1,mode])}">SHAKY<br><span class="text-[8px] opacity-70">soon</span></button>
      <button class="btn p-2.5 bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-[10px] font-bold" data-act="rlGrade" data-args="${actArgs([r.id,2,mode])}">SOLID<br><span class="text-[8px] opacity-70">later</span></button>
      <button class="btn p-2.5 bg-gold/15 border border-gold/50 text-gold text-[10px] font-bold" data-act="rlGrade" data-args="${actArgs([r.id,3,mode])}">FLUENT<br><span class="text-[8px] opacity-70">far</span></button>
    </div>`}
  </div>`;
}

export async function rlGrade(id, grade, mode){
  try {
    const res = await api('post', `/api/tongue/${id}/review`, { grade, mode, date: todayStr() });
    S.RL.drillSession.done++;
    if (grade===3) S.RL.drillSession.fluent++;
    if (grade===0) FX.fail(); else if (grade===3) FX.success(); else FX.tap();
    if (res.promoted){
      FX.confetti({count:70});
      FX.toast('⬆ PROMOTED TO '+res.promoted.toUpperCase()+' — this line is becoming part of you','gold');
    }
  } catch(e){}
  S.RL.drillIdx++; S.RL.drillReveal=false;
  render();
}

/* ---------- ARMORY ---------- */
export function rlArmory(){
  const list = S.RL.list||[];
  return `
  <div class="flex gap-1.5 mb-2">
    <input id="rl-search" class="flex-1 bg-black/30 border border-line rounded-lg px-3 py-2 text-xs" placeholder="Search situations, questions, lines…" value="${esc(S.RL.search)}"
      data-act-change="rlSearch">
    <button class="btn px-3 bg-panel border border-line text-gray-400 text-xs" data-act="rlSearchClear"><i class="fas fa-xmark"></i></button>
  </div>
  <div class="flex gap-1 mb-3 overflow-x-auto pb-1" style="scrollbar-width:none">
    <button class="pill shrink-0 ${S.RL.filter==='all'?'bg-gold/15 text-gold border border-gold/40':'bg-gray-900 text-gray-400 border border-line'}" data-act="rlFilter" data-args="${actArgs(['all'])}">ALL</button>
    ${RL_CATS.map(c=>`<button class="pill shrink-0 ${S.RL.filter===c[0]?'bg-gold/15 text-gold border border-gold/40':'bg-gray-900 text-gray-400 border border-line'}" data-act="rlFilter" data-args="${actArgs([c[0]])}"><i class="fas ${c[1]} text-[8px]"></i>${c[2].toUpperCase()}</button>`).join('')}
  </div>
  ${list.length===0?`<div class="card p-5 text-center"><i class="fas fa-box-open text-2xl text-gray-600 mb-2"></i><p class="text-xs text-gray-500">Armory ${S.RL.search||S.RL.filter!=='all'?'has no match':'is empty'}. ${!S.RL.search&&S.RL.filter==='all'?'Capture your first wise line — the hunt starts today.':''}</p></div>`:''}
  ${list.map(r=>`
  <article class="card p-3 mb-2">
    <div class="flex gap-1.5 mb-1.5 flex-wrap">${rlMasteryPill(r.mastery)}${rlCatPill(r.category)}
      <span class="text-[9px] text-gray-600 ml-auto self-center">${r.correct_reviews||0}✓ · ${r.lapses||0}✗ · every ${r.interval_days||0}d</span></div>
    <p class="text-[10px] text-gray-500 leading-relaxed mb-1"><i class="fas fa-location-dot text-[8px] mr-1"></i>${esc(r.situation)}</p>
    <p class="text-[11px] text-sky-300 mb-1">“${esc(r.trigger_q)}”</p>
    <p class="text-xs text-white font-semibold leading-relaxed">→ “${esc(r.response)}”</p>
    ${r.why_works?`<p class="text-[10px] text-gray-500 mt-1 italic">${esc(r.why_works)}</p>`:''}
    <div class="flex gap-2 mt-2 items-center">
      ${r.source?`<span class="text-[9px] text-gray-600"><i class="fas fa-film text-[8px] mr-0.5"></i>${esc(r.source)}</span>`:''}
      <button class="btn ml-auto px-2.5 py-1 text-[10px] bg-gray-900 text-gray-500 border border-line" data-act="rlDelete" data-args="${actArgs([r.id])}"><i class="fas fa-trash text-[9px]"></i></button>
    </div>
  </article>`).join('')}`;
}
export async function rlDelete(id){
  if (!confirm('Retire this line from the armory? Its training history is kept.')) return;
  await api('delete','/api/tongue/'+id);
  FX.tap(); S.RL.list=null; await loadResponseLab(); render();
}

/* ---------- WEEKLY EXAM ---------- */
export function rlExamView(){
  const s = S.RL.stats||{};
  if (!S.RL.exam){
    return `
    <div class="card-lux p-4 mb-3">
      <h3 class="font-engraved font-bold text-sm gold-text mb-2"><i class="fas fa-graduation-cap mr-1"></i>THE WEEKLY TONGUE EXAM</h3>
      <p class="text-[11px] text-gray-400 leading-relaxed mb-2">10 random lines from your armory. For each: the situation and question appear — <b class="text-white">speak your exact line out loud</b>, reveal, and judge yourself with ruthless honesty. <b class="text-gold">Pass ≥ 80%</b>. Fail = honesty flag + −10 pts. This is where you prove the armory lives in your head, not in the app.</p>
      ${s.total<3?`<p class="text-[10px] text-amber-400"><i class="fas fa-triangle-exclamation mr-1"></i>You need at least 3 trained lines before an exam makes sense. Capture and drill first.</p>`
      :`<button class="btn btn-gold w-full p-3 text-sm font-bold" data-act="rlStartExam"><i class="fas fa-swords mr-1"></i> BEGIN THE EXAM</button>`}
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
  const list = S.RL.exam;
  if (S.RL.examIdx >= list.length){
    const pct = Math.round(S.RL.examCorrect/list.length*100);
    return `<div class="card-lux p-6 text-center">
      <i class="fas ${pct>=80?'fa-trophy gold-text':'fa-skull text-red-400'} text-3xl mb-2"></i>
      <h3 class="font-engraved font-bold text-xl ${pct>=80?'gold-text':'text-red-400'}">${pct>=80?'EXAM PASSED':'EXAM FAILED'}</h3>
      <p class="font-disp font-bold text-3xl mt-1 ${pct>=80?'text-jade':'text-red-400'}">${pct}%</p>
      <p class="text-xs text-gray-400 mt-1">${S.RL.examCorrect} / ${list.length} lines fired correctly</p>
      <p class="text-[10px] text-gray-500 mt-2">${pct>=80?'+25 pts. The armory is in your head.':'−10 pts + flag filed. Drill the failures and retake.'}</p>
      <button class="btn btn-gold mt-3 px-6 py-2 text-xs font-bold" data-act="rlFinishExam" data-args="${actArgs([list.length])}">SEAL THE RECORD</button>
    </div>`;
  }
  const q = list[S.RL.examIdx];
  return `
  <div class="card-lux p-4">
    <div class="flex items-center justify-between mb-2">
      <span class="pill pill-blood"><i class="fas fa-graduation-cap text-[8px]"></i>EXAM</span>
      <span class="text-[10px] text-gray-500 font-bold">${S.RL.examIdx+1} / ${list.length}</span>
    </div>
    <div class="prog mb-3"><div style="width:${Math.round(S.RL.examIdx/list.length*100)}%"></div></div>
    <div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
      <p class="text-[9px] font-bold tracking-widest text-gray-500 mb-1">SITUATION</p>
      <p class="text-xs text-gray-300">${esc(q.situation)}</p>
    </div>
    <div class="p-3 rounded-lg bg-black/30 border border-sky-900/50 mb-2">
      <p class="text-[9px] font-bold tracking-widest text-sky-500 mb-1">THEY ASK YOU</p>
      <p class="text-sm text-white font-semibold">“${esc(q.trigger_q)}”</p>
    </div>
    ${!S.RL.examReveal?`
    <p class="text-[10px] text-gold text-center font-bold tracking-wider my-3">⟡ SPEAK YOUR EXACT LINE OUT LOUD ⟡</p>
    <button class="btn btn-gold w-full p-3 text-sm font-bold" data-act="rlExamReveal"><i class="fas fa-eye mr-1"></i> REVEAL & JUDGE</button>`:`
    <div class="p-3 rounded-lg border mb-3" style="background:rgba(212,175,55,.07);border-color:rgba(212,175,55,.4)">
      <p class="text-[9px] font-bold tracking-widest text-gold mb-1">THE EXACT LINE</p>
      <p class="text-sm text-white font-semibold leading-relaxed">“${esc(q.response)}”</p>
    </div>
    <p class="text-[10px] font-bold tracking-widest text-gray-400 text-center mb-2">DID YOU FIRE IT WORD-FOR-WORD? BE RUTHLESS.</p>
    <div class="grid grid-cols-2 gap-2">
      <button class="btn p-3 bg-red-950/60 border border-red-800/60 text-red-300 text-xs font-bold" data-act="rlExamAnswer" data-args="${actArgs([false])}"><i class="fas fa-xmark mr-1"></i>MISSED IT</button>
      <button class="btn p-3 bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-xs font-bold" data-act="rlExamAnswer" data-args="${actArgs([true])}"><i class="fas fa-check mr-1"></i>NAILED IT</button>
    </div>`}
  </div>`;
}
export async function rlStartExam(){
  try { S.RL.exam = (await axios.get('/api/tongue/exam')).data; }
  catch(_){ FX.toast('Could not load the exam — try again.','bad'); return; }
  if (!S.RL.exam.length){ FX.toast('No trained lines yet — drill first.','bad'); S.RL.exam=null; return; }
  S.RL.examIdx=0; S.RL.examReveal=false; S.RL.examCorrect=0;
  render();
}

export function rlExamAnswer(ok){
  if (ok){ S.RL.examCorrect++; FX.success(); } else FX.fail();
  S.RL.examIdx++; S.RL.examReveal=false; render();
}

export async function rlFinishExam(total){
  const res = await api('post','/api/tongue/exam/submit',{ total, correct: S.RL.examCorrect, date: todayStr() });
  if (res.passed){ FX.confetti({count:140}); FX.victory && FX.victory(); }
  S.RL.exam=null;
  await loadResponseLab(); await loadState(); render();
}

registerActions({
  rlView:        (e, el, v) => { S.RL.view = v; rlRefresh(); },
  rlExamView:    () => { S.RL.view = 'exam'; render(); },
  rlStartDrill:  () => rlStartDrill(),
  rlSave:        () => rlSave(),
  rlRefresh:     () => rlRefresh(),
  rlDrillReveal: () => { S.RL.drillReveal = true; FX.tap(); render(); },
  rlGrade:       (e, el, id, grade, mode) => rlGrade(id, grade, mode),
  rlSearch:      (e, el) => { S.RL.search = el.value; rlRefresh(); },
  rlSearchClear: () => { S.RL.search = ''; rlRefresh(); },
  rlFilter:      (e, el, f) => { S.RL.filter = f; rlRefresh(); },
  rlDelete:      (e, el, id) => rlDelete(id),
  rlStartExam:   () => rlStartExam(),
  rlFinishExam:  (e, el, total) => rlFinishExam(total),
  rlExamReveal:  () => { S.RL.examReveal = true; FX.tap(); render(); },
  rlExamAnswer:  (e, el, ok) => rlExamAnswer(ok),
  // 12.7 build surface
  rlIntent:      (e, el, slug) => { S.RL.intentSlug = slug; render(); },
  rlSaveBuild:   () => rlSaveBuild(),
});
