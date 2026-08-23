import { S } from '../core/store.js'
import { header, render, todayStr } from '../core/shell.js'
import { actArgs, registerActions } from '../core/events.js'
import { esc } from '../core/sanitize.js'

/* WAR ROOM — THE FARNSWORTH PROGRAMME (Book 11).

   Three faces. TRACK shows the root node, the four parts with the Part III gate
   REPORTED rather than hidden, and the chapter list. CHAPTER renders one chapter
   through the thirteen fixed slots of 11.6 — as a schema, not as prose, which is what
   the book asks the LEARN renderer to do. METRICS renders 11.9's falsifiable numbers,
   and it renders `noticed_ratio` as the inverted metric it is: being noticed is the
   failure condition, so a rising number is a worsening result and this view never
   draws it as progress.

   Every rule, day range, slot, and metric direction comes from the server
   (/api/rhetoric/*). Nothing about the syllabus is restated here, and where no page
   anchor was confirmed the server's own note is shown instead of a guess. */

// state moved to core/store.js: RH

export async function loadRhetoric(){
  const [track, today] = await Promise.all([
    axios.get('/api/rhetoric/track').then(r=>r.data),
    axios.get('/api/rhetoric/today?date='+todayStr()).then(r=>r.data).catch(()=>null),
  ]);
  S.RH.track = track; S.RH.today = today;
  if (S.RH.view==='metrics' && !S.RH.metrics){
    try { S.RH.metrics = (await axios.get('/api/rhetoric/metrics')).data; } catch(_){ S.RH.metrics = null; }
  }
}

export async function rhRefresh(){
  try { await loadRhetoric(); } catch(_){}
  render();
}

/* ---------- MAIN VIEW ---------- */
export function viewRhetoric(){
  const t = S.RH.track;
  if (!t) return header()+`
  <section class="stagger">
    <div class="card p-4 text-center">
      <i class="fas fa-plug-circle-xmark text-2xl text-gray-600 mb-2"></i>
      <p class="text-xs text-gray-500">The track could not be loaded. Nothing about the programme is shown from memory — the phases, day ranges, and chapter list live on the server.</p>
      <button class="btn mt-3 px-4 py-2 text-[10px] bg-panel border border-line text-gray-400 font-bold" data-act="rhRefresh">RETRY</button>
    </div>
  </section>`;
  const faces = [['track','fa-sitemap','TRACK'],['chapter','fa-book-open','CHAPTER'],['metrics','fa-ruler','MEASUREMENT']];
  return header()+`
  <section id="rhetoric-section" class="stagger">
    <div class="card-lux p-4 mb-3">
      <h2 class="font-engraved font-bold text-sm gold-text mb-1"><i class="fas fa-feather-pointed mr-1"></i>THE FARNSWORTH PROGRAMME</h2>
      <p class="text-[10px] text-gray-400 leading-relaxed">${esc(t.rootNode||'')}</p>
      <p class="text-[9px] text-gray-600 mt-2">Day ${t.firstDay} to day ${t.lastDay} · ${(t.chapters||[]).length} chapters · ${(t.phases||[]).length} phases</p>
    </div>

    <div class="flex gap-1.5 mb-3">
      ${faces.map(([v,ic,l])=>`
        <button class="btn flex-1 py-2 text-[10px] font-bold tracking-wider ${S.RH.view===v?'bg-gold/15 text-gold border border-gold/40':'bg-panel text-gray-400 border border-line'}"
          data-act="rhView" data-args="${actArgs([v])}"><i class="fas ${ic} mr-1"></i>${l}</button>`).join('')}
    </div>

    ${S.RH.view==='chapter'?rhChapter():S.RH.view==='metrics'?rhMetrics():rhTrack()}
  </section>`;
}
/* ---------- TRACK ----------
   11.1's ordering constraint is a gate, and a gate that is hidden teaches nothing. A
   locked part is shown WITH the server's reason, so he can see why Part III is not
   available yet rather than finding it missing. */
export function rhTrack(){
  const t = S.RH.track;
  const today = S.RH.today;
  return `
  ${today?`
  <div class="card p-3 mb-3 flex items-center gap-3">
    <div class="text-center border-r border-line pr-3">
      <p class="font-disp font-bold text-lg text-white">${today.programmeDay===null?'—':today.programmeDay}</p>
      <p class="text-[8px] text-gray-500 tracking-wider">PROGRAMME DAY</p>
    </div>
    <div class="flex-1">
      ${today.inTrack
        ? `<p class="text-[11px] text-gray-300">${esc((today.where&&today.where.title)||'On the track.')}</p>
           ${today.cycleDay?`<p class="text-[10px] text-gold mt-0.5">Day ${today.cycleDay.day} · ${esc(today.cycleDay.title)} — ${esc(today.cycleDay.job||'')}</p>
           <p class="text-[9px] text-amber-400 mt-0.5">${esc(today.cycleDay.constraint||'')}</p>`:''}`
        : `<p class="text-[11px] text-gray-500">Outside the track's day range. Nothing is inferred about where he would be.</p>`}
      <p class="text-[9px] text-gray-600 mt-1">${today.dailyReviewMinutes||10} minutes daily · ${esc(today.dailyReviewReason||'')}</p>
    </div>
  </div>`:''}

  <div class="card-lux p-4 mb-3">
    <h3 class="text-[10px] font-bold tracking-[.18em] text-gray-400 mb-1">THE FOUR PARTS</h3>
    <p class="text-[10px] text-gray-500 leading-relaxed mb-3">${esc(t.partOrderReason||'')}</p>
    ${(t.parts||[]).map(p=>`
    <div class="p-3 rounded-lg mb-2 border ${p.installed?'bg-jade/5 border-jade/40':p.unlocked?'bg-black/30 border-line':'bg-red-950/20 border-red-900/40'}">
      <div class="flex items-center gap-2 mb-1">
        <span class="pill ${p.installed?'bg-jade/15 text-jade border border-jade/40':p.unlocked?'bg-gray-900 text-gray-400 border border-line':'bg-red-950/60 text-red-300 border border-red-800/60'}">
          <i class="fas ${p.installed?'fa-circle-check':p.unlocked?'fa-circle-dot':'fa-lock'} text-[8px]"></i>PART ${p.part}
        </span>
        <span class="text-[11px] text-white font-semibold">acts on ${esc(p.acts_on)}</span>
      </div>
      <p class="text-[10px] text-gray-500 leading-relaxed">Operates on ${esc(p.operates_on)}. ${esc(p.why)}</p>
      ${p.unlocked?'':`<p class="text-[10px] text-red-300 mt-1.5 leading-relaxed"><i class="fas fa-lock text-[9px] mr-1"></i>${esc(p.reason||'')}</p>`}
    </div>`).join('')}
  </div>

  <div class="card p-4 mb-3">
    <h3 class="text-[10px] font-bold tracking-[.18em] text-gray-400 mb-2">THE SEVEN-DAY CYCLE</h3>
    ${(t.cycle||[]).map(d=>`
    <div class="py-1.5 border-b border-line/50 last:border-0">
      <p class="text-[11px] text-white font-semibold">Day ${d.day} · ${esc(d.title)}</p>
      <p class="text-[10px] text-gray-500 leading-relaxed">${esc(d.job)}</p>
      <p class="text-[9px] text-amber-400 leading-relaxed mt-0.5">${esc(d.constraint)}</p>
    </div>`).join('')}
  </div>

  <div class="card p-4">
    <h3 class="text-[10px] font-bold tracking-[.18em] text-gray-400 mb-2">THE CHAPTERS</h3>
    ${(t.chapters||[]).map(ch=>`
    <button class="w-full text-left py-1.5 border-b border-line/50 last:border-0" data-act="rhOpenChapter" data-args="${actArgs([ch.id])}">
      <span class="text-[10px] text-gray-600 mr-2">P${ch.part}</span>
      <span class="text-[11px] text-gray-300">${ch.id}. ${esc(ch.title)}</span>
      <span class="text-[9px] text-gray-600 float-right">d${ch.day_from}–${ch.day_to}${ch.self_audit?' · '+esc(ch.self_audit):''}</span>
    </button>`).join('')}
    <p class="text-[9px] text-gray-600 mt-2 leading-relaxed">Self-audit marks: ${(t.selfAuditMarks||[]).map(m=>esc(m.mark)+' = '+esc(m.meaning)).join(' · ')}. Unmarked chapters are unmarked, not new.</p>
  </div>

  <div class="card p-4 mt-3" style="border-color:rgba(212,175,55,.3)">
    <h3 class="text-[10px] font-bold tracking-[.18em] text-gold mb-2"><i class="fas fa-crosshairs mr-1"></i>THE FIELD DEFAULT WHILE THE PROGRAMME RUNS</h3>
    <p class="text-[11px] text-white font-semibold leading-relaxed">${esc((t.fieldDefault||{}).rule||'')}</p>
    <p class="text-[10px] text-jade mt-1.5 leading-relaxed"><b>CORRECT</b> · ${esc((t.fieldDefault||{}).success||'')}</p>
    <p class="text-[10px] text-amber-400 mt-0.5 leading-relaxed"><b>TOO LOUD</b> · ${esc((t.fieldDefault||{}).failure||'')}</p>
  </div>`;
}
/* ---------- CHAPTER — the thirteen-slot format (11.6) ----------
   "The LEARN renderer implements it as a schema rather than as prose." So the thirteen
   slots come from the server as a list, and this renderer walks that list: a slot the
   server has not populated is drawn as an EMPTY slot with its requirement, never
   quietly omitted and never filled with something plausible. */
export function rhChapter(){
  const c = S.RH.chapter;
  if (!c) return `
  <div class="card p-4 text-center">
    <i class="fas fa-hand-pointer text-2xl text-gray-600 mb-2"></i>
    <p class="text-xs text-gray-500">Open a chapter from the TRACK face.</p>
  </div>`;
  const f = c.figure;
  const sp = c.specimens || {};
  const slotContent = rhSlotContent(c);
  return `
  ${c.gate && c.gate.unlocked===false?`
  <div class="card p-3 mb-3 bg-red-950/20 border border-red-900/40">
    <p class="text-[10px] font-bold tracking-widest text-red-300 mb-1"><i class="fas fa-lock text-[9px] mr-1"></i>PART ${c.chapter.part} IS NOT UNLOCKED</p>
    <p class="text-[10px] text-red-200 leading-relaxed">${esc(c.gate.reason||'')}</p>
    <p class="text-[9px] text-gray-500 mt-1.5 leading-relaxed">The chapter is shown so it can be read. The drills are what the gate withholds.</p>
  </div>`:''}

  <div class="card-lux p-4 mb-3">
    <h3 class="font-engraved font-bold text-sm gold-text">${c.chapter.id}. ${esc(c.chapter.title)}</h3>
    <p class="text-[9px] text-gray-600 mt-0.5">Part ${c.chapter.part} · days ${c.chapter.day_from}–${c.chapter.day_to}${c.chapter.self_audit?' · self-audit '+esc(c.chapter.self_audit):''}</p>
  </div>

  <div class="card p-4 mb-3">
    <h4 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">THE SEVEN-DAY CYCLE FOR THIS CHAPTER</h4>
    <div class="flex flex-wrap gap-1">
      ${(c.cycle||[]).map(d=>`
      <span class="pill ${d.completed?'bg-jade/15 text-jade border border-jade/40':'bg-gray-900 text-gray-500 border border-line'}">
        <i class="fas ${d.completed?'fa-circle-check':'fa-circle'} text-[8px]"></i>D${d.day} ${esc(d.title).toUpperCase()}
      </span>`).join('')}
    </div>
  </div>

  ${(c.slots||[]).map(slot=>{
    const body = slotContent[slot.slug];
    return `
    <div class="card p-4 mb-2">
      <div class="flex items-center gap-2 mb-1">
        <span class="text-[9px] font-bold text-gold">SLOT ${slot.slot}</span>
        <span class="text-[10px] font-bold tracking-widest text-gray-300">${esc(slot.title).toUpperCase()}</span>
      </div>
      <p class="text-[9px] text-gray-600 leading-relaxed mb-2">${esc(slot.requirement)}</p>
      ${body || `<p class="text-[10px] text-amber-400 leading-relaxed"><i class="fas fa-circle-minus text-[9px] mr-1"></i>This slot is not populated for this chapter. It is shown empty rather than filled, because a slot filled with something plausible is worse than a slot that says it is empty.</p>`}
    </div>`;
  }).join('')}

  <div class="card p-4 mb-2">
    <h4 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">HIS PAGES</h4>
    ${(c.pageAnchors||[]).length?`
    ${(c.pageAnchors||[]).map(a=>`
      <p class="text-[10px] text-gray-400 leading-relaxed mb-1">
        <span class="text-gold font-bold">capture ${a.page_index}</span> · ${esc(a.label)}${a.is_opening?' <span class="text-[9px] text-jade">(opening page)</span>':''}
        <br><span class="text-[9px] text-gray-600">${esc(a.confirmed_by||'')}</span>
      </p>`).join('')}`:''}
    <p class="text-[9px] text-gray-600 leading-relaxed">${esc(c.pageAnchorNote||'')}</p>
  </div>

  ${f?`
  <div class="card p-4" style="border-color:rgba(212,175,55,.3)">
    <h4 class="text-[10px] font-bold tracking-widest text-gold mb-2">BOTH FACES — ALWAYS TOGETHER (11.7)</h4>
    <div class="p-3 rounded-lg bg-black/30 border border-jade/30 mb-2">
      <p class="text-[9px] font-bold tracking-widest text-jade mb-1">LEGITIMATE USE</p>
      <p class="text-[11px] text-gray-300 leading-relaxed">${esc(f.bothFaces.legitimate||'')}</p>
    </div>
    <div class="p-3 rounded-lg bg-black/30 border border-red-900/40 mb-2">
      <p class="text-[9px] font-bold tracking-widest text-red-300 mb-1">MANIPULATIVE MISUSE</p>
      <p class="text-[11px] text-gray-300 leading-relaxed">${esc(f.bothFaces.manipulative||'')}</p>
    </div>
    <div class="p-3 rounded-lg bg-black/30 border border-sky-900/50">
      <p class="text-[9px] font-bold tracking-widest text-sky-400 mb-1">DETECTION QUESTION — FOR SPOTTING IT INBOUND</p>
      <p class="text-[11px] text-gray-300 leading-relaxed">${esc(f.bothFaces.detectionQuestion||'')}</p>
      ${f.bothFaces.overuseTells?`<p class="text-[10px] text-amber-400 leading-relaxed mt-1.5"><b>OVERUSE TELLS</b> · ${esc(f.bothFaces.overuseTells)}</p>`:''}
    </div>
    ${(f.conversationalJobs||[]).length?`
    <h4 class="text-[10px] font-bold tracking-widest text-gray-400 mt-3 mb-1">THE CONVERSATIONAL JOB</h4>
    ${(f.conversationalJobs||[]).map(j=>`
      <p class="text-[10px] text-gray-400 leading-relaxed mb-1">${esc(j.job)}<br><span class="text-[9px] text-red-300">boundary · ${esc(j.misuse_boundary)}</span></p>`).join('')}`:''}
  </div>`:''}

  <div class="card p-3 mt-2">
    <p class="text-[9px] text-gray-600 leading-relaxed">Tier targets · ${(sp.targets||[]).map(t=>'T'+t.tier+' '+esc(t.name)+' ('+esc(t.per_figure)+' per figure)').join(' · ')}. Tier 1 is his, copied by hand; the application logs that it happened and never becomes the page.</p>
  </div>`;
}
/* Maps a chapter payload onto the thirteen slots. A slug absent from this object, or
   present with an empty value, renders as the empty-slot notice above. Nothing is
   invented to fill a slot: the copia drill, live-fire script, and conversational
   conversion are things HE produces on days 5 and 6, so they are empty until he does. */
export function rhSlotContent(c){
  const f = c.figure || {};
  const sp = c.specimens || {};
  const p = txt => txt ? `<p class="text-[11px] text-gray-300 leading-relaxed">${esc(txt)}</p>` : '';
  const tier = (n, rows) => `
    <p class="text-[10px] font-bold tracking-widest ${n===1?'text-gold':'text-gray-500'} mt-2 mb-1">TIER ${n} — ${(rows||[]).length} HELD</p>
    ${(rows||[]).length
      ? (rows||[]).map(r=>`<p class="text-[11px] text-gray-300 leading-relaxed mb-1">“${esc(r.text)}” <span class="text-[9px] text-gray-600">— ${esc(r.attribution||'unattributed')}${r.year?', '+esc(r.year):''}</span></p>`).join('')
      : `<p class="text-[10px] text-gray-600 leading-relaxed">${n===1
          ? 'Empty by design. Tier 1 is six to eight lines he chooses and copies by hand into the commonplace book on Day 2. The application records that it happened, never the text.'
          : 'No Tier '+n+' specimens recorded for this figure yet.'}</p>`}`;
  return {
    orientation: [f.canonical_name, f.classical_name, f.etymology, f.plain_definition]
      .some(Boolean)
      ? `${f.canonical_name?`<p class="text-sm text-white font-semibold">${esc(f.canonical_name)}</p>`:''}
         ${f.classical_name?`<p class="text-[10px] text-gold">${esc(f.classical_name)}</p>`:''}
         ${f.etymology?`<p class="text-[10px] text-gray-500 italic mt-1">${esc(f.etymology)}</p>`:''}
         ${p(f.plain_definition)}`
      : '',
    mechanism: p(f.mechanism),
    notation_and_variants: (f.structural_formula || f.sub_variants)
      ? `${f.structural_formula?`<p class="text-xs font-mono text-gold leading-relaxed">${esc(f.structural_formula)}</p>`:''}
         ${f.sub_variants?`<p class="text-[11px] text-gray-400 leading-relaxed mt-1">${esc(f.sub_variants)}</p>`:''}`
      : '',
    hidden_layer: p(f.hidden_layer),
    tiered_specimen_bank: `${tier(1, sp.tier1)}${tier(2, sp.tier2)}${tier(3, sp.tier3)}`,
    skeleton_set: (sp.tier2||[]).length
      ? `<p class="text-[10px] text-gray-500 leading-relaxed mb-1">Day 4 strips each of these to its bare structural formula, then refills it from his own life, work, and arguments.</p>
         ${(sp.tier2||[]).map(r=>`<p class="text-[11px] text-gray-300 leading-relaxed mb-1">${esc(r.text)}</p>`).join('')}`
      : '',
    failure_modes: (f.overuse_tells || f.manipulative_misuse)
      ? `${f.overuse_tells?`<p class="text-[11px] text-amber-300 leading-relaxed"><b>OVERUSE TELLS</b> · ${esc(f.overuse_tells)}</p>`:''}
         ${f.manipulative_misuse?`<p class="text-[11px] text-red-300 leading-relaxed mt-1"><b>MISUSE</b> · ${esc(f.manipulative_misuse)}</p>`:''}`
      : '',
    conversational_conversion: f.conversational_job ? p(f.conversational_job) : '',
    one_line_summary: p(f.plain_definition),
  };
}
/* ---------- MEASUREMENT (11.9) ----------
   The server gives every metric its own `better` direction and an explicit
   `renderAsProgress` flag. This view honours the flag: an inverted metric is drawn in
   amber with "higher is worse" said out loud, and its bar is never filled left-to-right
   like an achievement. `noticed_ratio` is the one that matters — being noticed is the
   failure condition, so a rising number is a worsening result. */
export function rhMetrics(){
  const m = S.RH.metrics;
  if (!m) return `
  <div class="card p-4 text-center">
    <i class="fas fa-plug-circle-xmark text-2xl text-gray-600 mb-2"></i>
    <p class="text-xs text-gray-500">The measurements could not be loaded. No number is shown from memory.</p>
    <button class="btn mt-3 px-4 py-2 text-[10px] bg-panel border border-line text-gray-400 font-bold" data-act="rhRefresh">RETRY</button>
  </div>`;
  const pct = v => v===null||v===undefined ? null : Math.round(v*100);
  return `
  <div class="card p-3 mb-3">
    <p class="text-[10px] text-gray-500">Programme day <b class="text-white">${m.programmeDay===null?'—':m.programmeDay}</b>. Every metric below is falsifiable; a metric with no attempts reports no value rather than a zero that looks like a score.</p>
  </div>

  ${(m.metrics||[]).map(x=>{
    const d = x.data || {};
    const inverted = !x.renderAsProgress;
    const shown = (x.slug==='identification_accuracy'||x.slug==='construction_accuracy')
      ? (d.attempts ? pct(d.value)+'%' : 'no attempts yet')
      : x.slug==='noticed_ratio'
        ? (d.deployments ? pct(d.value)+'%' : 'no deployments yet')
        : String(d.value===null||d.value===undefined?'—':d.value);
    return `
    <div class="card p-4 mb-2 ${inverted?'border-amber-800/50':''}">
      <div class="flex items-start gap-2 mb-1">
        <div class="flex-1">
          <p class="text-[11px] font-bold ${inverted?'text-amber-300':'text-gray-200'}">${esc(x.title)}</p>
          <p class="text-[9px] text-gray-600 leading-relaxed">${esc(x.measures)}</p>
        </div>
        <p class="font-disp font-bold text-lg ${inverted?'text-amber-400':'text-white'}">${esc(shown)}</p>
      </div>
      ${inverted?`
      <p class="text-[10px] text-amber-400 leading-relaxed mt-1"><i class="fas fa-arrow-down text-[9px] mr-1"></i>LOWER IS BETTER. This number is not progress and is never drawn as progress.</p>`:''}
      ${x.note?`<p class="text-[9px] ${inverted?'text-amber-500':'text-gray-600'} leading-relaxed mt-1">${esc(x.note)}</p>`:''}
      ${x.slug==='deployment_outcomes'?`
      <p class="text-[10px] text-gray-400 mt-1.5">fits <b class="text-jade">${d.fits||0}</b> · barely <b class="text-amber-400">${d.barely||0}</b> · fails <b class="text-sky-400">${d.fails||0}</b></p>`:''}
      ${x.slug==='copia_volume'?`
      <p class="text-[10px] text-gray-400 mt-1.5">${d.renderings||0} renderings across ${d.sessions||0} sessions · ${d.distinct||0} distinct · ${d.selfMarkedBad||0} he marked bad · target ${d.target||0}</p>`:''}
      ${x.slug==='recording_comparison'?`
      <p class="text-[10px] ${d.dueNow?'text-gold':'text-gray-400'} mt-1.5">${(d.relistens||[]).length} scheduled re-listens logged · days ${(d.scheduledDays||[]).join(' and ')}${d.dueNow?' · DUE TODAY':''}</p>`:''}
    </div>`;
  }).join('')}

  <div class="card p-4 mt-1" style="border-color:rgba(212,175,55,.3)">
    <h4 class="text-[10px] font-bold tracking-widest text-gold mb-1">THE FIELD DEFAULT</h4>
    <p class="text-[11px] text-white leading-relaxed">${esc((m.fieldDefault||{}).rule||'')}</p>
  </div>`;
}

export async function rhOpenChapter(id){
  try {
    S.RH.chapter = (await axios.get('/api/rhetoric/chapter/'+id)).data;
    S.RH.chapterId = id;
    S.RH.view = 'chapter';
  } catch(_){ S.RH.chapter = null; }
  render();
}

registerActions({
  rhView:        (e, el, v) => { S.RH.view = v; rhRefresh(); },
  rhRefresh:     () => rhRefresh(),
  rhOpenChapter: (e, el, id) => rhOpenChapter(id),
});
