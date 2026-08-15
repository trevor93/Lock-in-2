/* WAR ROOM — frontend */
const $ = (s) => document.querySelector(s);
const app = () => $('#app');
let TAB = 'now';
let STATE = null;
let CSRF_TOKEN = null;

axios.interceptors.request.use((config) => {
  const method = String(config.method || 'get').toLowerCase();
  const url = new URL(config.url || '/', location.origin);
  if (CSRF_TOKEN && url.origin === location.origin && !['get','head','options'].includes(method)) {
    config.headers = config.headers || {};
    config.headers['X-CSRF-Token'] = CSRF_TOKEN;
  }
  return config;
});

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nl2br = (s) => esc(s).replace(/\n/g,'<br>');

const CAT_ICON = { morning:'fa-sun', workout:'fa-dumbbell', deepwork:'fa-crosshairs', study:'fa-graduation-cap',
  meal:'fa-utensils', strategy:'fa-chess-knight', philosophy:'fa-book-open', entertainment:'fa-gamepad',
  skincare:'fa-droplet', admin:'fa-list-check', social:'fa-people-group', review:'fa-pen-nib',
  sleep:'fa-moon', flex:'fa-wind', rest:'fa-leaf' };

async function api(method, url, data) {
  try {
    const r = await axios({ method, url, data });
    return r.data;
  } catch (e) {
    if (e?.response?.status === 401 && e?.response?.data?.error === 'AUTH REQUIRED') { renderLogin(); throw e; }
    const msg = e?.response?.data?.error || 'Request failed';
    toast(msg, true);
    throw e;
  }
}

/* ============ AUTH GATE ============ */
function renderLogin(isSetup) {
  FX.killSplash && FX.killSplash();
  app().innerHTML = `
  <main class="max-w-lg mx-auto px-4 min-h-screen flex flex-col justify-center" id="login-screen">
    <div class="text-center mb-6">
      <div class="text-4xl mb-2">⚔</div>
      <h1 class="font-engraved gold-text text-2xl font-bold">WAR ROOM</h1>
      <p class="text-[10px] tracking-[.3em] text-gray-500 font-semibold mt-1">${isSetup?'SET THE GATE PASSWORD':'IDENTIFY YOURSELF'}</p>
    </div>
    <div class="card-lux p-5">
      <input id="login-pass" type="password" placeholder="${isSetup?'New password (min 8 chars)':'Password'}" autocomplete="${isSetup?'new-password':'current-password'}"
        class="w-full bg-ink border border-line rounded-lg px-3 py-3 text-sm mb-3" onkeydown="if(event.key==='Enter')doLogin(${isSetup?'true':'false'})">
      <button class="btn w-full p-3 bg-gold/15 border border-gold/50 text-gold font-bold text-sm" onclick="doLogin(${isSetup?'true':'false'})">
        <i class="fas fa-key mr-1"></i>${isSetup?'SEAL THE GATE':'ENTER'}
      </button>
      <p class="text-[10px] text-gray-600 mt-3 text-center">${isSetup?'This password protects everything — the whole command post sits behind it. There is no recovery. Write it somewhere real.':'The war room admits its commander only.'}</p>
    </div>
  </main>`;
  setTimeout(()=>{ const el=$('#login-pass'); if(el) el.focus(); }, 50);
}
async function doLogin(isSetup) {
  const pass = $('#login-pass').value;
  try {
    const auth = await axios.post(isSetup?'/api/auth/setup':'/api/auth/login', { password: pass });
    CSRF_TOKEN = auth.data.csrfToken;
    FX.success && FX.success();
    await loadState(); render();
  } catch (e) {
    toast(e?.response?.data?.error || 'Login failed', true);
  }
}
window.doLogin = doLogin;

function toast(msg, bad=false) { FX.toast(msg, bad?'bad':'ok'); }

// POST /api/tick = the ONLY engine crank. Server derives date/time from the
// stored timezone — the client clock is advisory (sent once to set the tz).
let TZ_SENT = false;
async function loadState() {
  const body = TZ_SENT ? {} : { tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || null) };
  STATE = (await axios.post('/api/tick', body)).data;
  TZ_SENT = true;
}

function tabBadge(id) {
  const s = STATE; if (!s) return 0;
  if (id==='now')  return s.flags.length;
  if (id==='mind') return s.dueCards||0;
  if (id==='tongue') return s.dueTongue||0;
  if (id==='debrief') return s.debriefDoneToday ? 0 : (new Date().getHours()>=20 ? 1 : 0);
  return 0;
}
function shell(content) {
  const tabs = [
    ['now','fa-crosshairs','NOW'],
    ['today','fa-calendar-day','DAY'],
    ['campaign','fa-chess-board','WAR'],
    ['library','fa-book-bookmark','BOOKS'],
    ['council','fa-user-secret','COUNCIL'],
    ['mind','fa-brain','MIND'],
    ['tongue','fa-comment-dots','TONGUE'],
    ['debrief','fa-pen-nib','LOG'],
    ['stats','fa-chart-line','STATS'],
  ];
  app().innerHTML = `
    <main class="max-w-lg mx-auto px-3 pt-3 pb-28">${content}</main>
    <nav class="tabbar flex max-w-lg mx-auto" id="main-nav">
      ${tabs.map(([id,ic,label])=>{
        const badge = tabBadge(id);
        return `
        <button class="tab-btn ${TAB===id?'active':''}" data-tab="${id}">
          ${badge?`<span class="tab-badge">${badge>9?'9+':badge}</span>`:''}
          <i class="fas ${ic}"></i>${label}
        </button>`;}).join('')}
    </nav>`;
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{ FX.tap(); TAB=b.dataset.tab; render(); window.scrollTo({top:0}); });
  FX.countUpAll();
}

function header() {
  const s = STATE;
  const flagCount = s.flags.length;
  const rank = FX.rank(s.points);
  return `
  <header class="mb-3">
    <div class="flex items-center justify-between mb-2.5">
      <div>
        <h1 class="font-engraved font-bold text-lg gold-text">⚔ WAR ROOM</h1>
        <p class="text-[10px] text-gray-500 tracking-wide">${new Date().toDateString()}</p>
      </div>
      <div class="text-right">
        <span class="rank-plate"><i class="fas ${rank.icon}"></i> ${rank.name}</span>
        ${rank.next?`<div class="text-[8px] text-gray-500 mt-1 font-semibold tracking-wider">${rank.nextAt - Math.max(s.points,0)} PTS → ${rank.next}</div>`:''}
      </div>
    </div>
    <div class="grid grid-cols-3 gap-2 text-center">
      <div class="card-glass px-2 py-2">
        <div class="font-disp font-bold text-lg leading-none"><i class="fas fa-fire ${FX.flameClass(s.streak)} text-sm"></i> <span class="text-white" data-countup="${s.streak}">${s.streak}</span></div>
        <div class="text-[8px] text-gray-500 font-bold tracking-[.18em] mt-1">STREAK</div>
      </div>
      <div class="card-glass px-2 py-2">
        <div class="font-disp font-bold text-lg leading-none gold-text" data-countup="${s.points}">${s.points}</div>
        <div class="text-[8px] text-gray-500 font-bold tracking-[.18em] mt-1">POINTS</div>
      </div>
      <div class="card-glass px-2 py-2 ${flagCount?'sev-critical':''}">
        <div class="font-disp font-bold text-lg leading-none ${flagCount?'text-red-400':'text-jade'}">${flagCount?flagCount:'✓'}</div>
        <div class="text-[8px] text-gray-500 font-bold tracking-[.18em] mt-1">FLAGS</div>
      </div>
    </div>
  </header>`;
}

function flagsPanel() {
  if (!STATE.flags.length) return '';
  return `
  <section id="honesty-flags" class="mb-3 fade-in">
    <h2 class="font-disp font-bold text-sm tracking-widest text-red-400 mb-1.5"><i class="fas fa-triangle-exclamation"></i> HONESTY ENGINE — UNRESOLVED</h2>
    ${STATE.flags.map(f=>`
      <article class="card sev-${f.severity} p-3 mb-2">
        <p class="text-xs leading-relaxed text-gray-300">${esc(f.message)}</p>
        <button class="btn mt-2 text-[11px] px-3 py-1.5 bg-gray-800 text-gray-300 border border-line" onclick="ackFlag(${f.id})">
          <i class="fas fa-check mr-1"></i>ACKNOWLEDGED — I OWN IT
        </button>
      </article>`).join('')}
  </section>`;
}
async function ackFlag(id){ await api('post',`/api/flags/${id}/ack`); await loadState(); render(); }

/* ================= NOW TAB ================= */
function statusBtns(b, compact=false) {
  const st = b.log_status;
  if (st === 'missed') {
    const canAppeal = STATE && STATE.appealAvailable;
    return `<span class="pill" style="background:rgba(153,27,27,.25);color:#f87171;border:1px solid rgba(220,38,38,.45);letter-spacing:.12em">
      <i class="fas fa-ban text-[9px]"></i>CANCELED</span>${canAppeal?`
    <button class="btn px-2 py-1 text-[9px] bg-gray-800/60 border border-gold/40 text-gold ml-1" title="Use this week's appeal token"
      onclick="appealBlock(${b.id},'${STATE.date}','${esc(b.title).replace(/'/g,'&#39;')}')"><i class="fas fa-gavel"></i></button>`:''}`;
  }
  const mk = (val, ic, cls, active) => `
    <button class="btn ${compact?'px-2.5 py-1.5 text-[11px]':'px-3 py-2 text-xs'} ${active?cls:'bg-gray-800/60 text-gray-500 border border-line'}"
      onclick="logBlock(${b.id},'${st===val?'pending':val}',event)"><i class="fas ${ic}"></i></button>`;
  return `<div class="flex gap-1.5">
    ${mk('done','fa-check','bg-emerald-700 text-white', st==='done')}
    ${mk('partial','fa-star-half-stroke','bg-amber-600 text-white', st==='partial')}
    ${mk('skipped','fa-xmark','bg-red-800 text-white', st==='skipped')}
  </div>`;
}
async function logBlock(id, status, ev){
  const el = ev && ev.target ? ev.target.closest('button') : null;
  const b = (STATE.blocks||[]).find(x=>x.id===id);
  try {
    await api('post',`/api/blocks/${id}/log`,{status}); // date is server-derived
  } catch(e) {
    FX.fail(); await loadState(); render(); return; // 409 WINDOW CLOSED — api() already toasted
  }
  if (status==='done') { FX.success(); if (b) FX.floatDelta(b.points, el); }
  else if (status==='skipped') FX.fail();
  await loadState(); render();
  if (status==='done' && STATE.adherence && STATE.adherence.pct>=100) {
    FX.confetti({count:130}); FX.toast('FULL DAY CONQUERED — 100% ADHERENCE','gold');
  }
}

function viewNow() {
  const s = STATE, c = s.current, n = s.next;
  const adh = s.adherence;
  const adhColor = adh.pct>=80?'#22c55e':adh.pct>=50?'#f59e0b':'#dc2626';
  return `${header()}${flagsPanel()}
  <section id="now-section" class="stagger">
    ${s.yesterdayTargets?`
    <div class="card p-3 mb-3 border-gold/30">
      <h3 class="text-[10px] font-bold tracking-widest text-gold mb-1"><i class="fas fa-bullseye"></i> TODAY'S 3 TARGETS (set last night — Law 4)</h3>
      <p class="text-xs text-gray-300 leading-relaxed">${nl2br(s.yesterdayTargets)}</p>
    </div>`:`
    <div class="card p-3 mb-3 border-amber-800/50">
      <p class="text-xs text-amber-400"><i class="fas fa-triangle-exclamation"></i> No targets set last night. You woke up without orders — Law 4 violated. Set tonight's targets in the Debrief tab.</p>
    </div>`}

    ${c?`
    <article class="card-lux now-ring p-5 mb-3 text-center">
      <p class="text-[10px] font-bold tracking-[.3em] gold-text mb-1.5">◆ RIGHT NOW · ${c.start_time}–${c.end_time} ◆</p>
      <div id="block-countdown" class="font-disp text-[11px] text-gray-500 font-bold mb-2"></div>
      <i class="fas ${CAT_ICON[c.category]||'fa-circle'} cat-${c.category} text-3xl mb-2" style="filter:drop-shadow(0 0 12px currentColor)"></i>
      <h2 class="font-disp font-bold text-2xl leading-tight mb-1 text-white">${esc(c.title)}</h2>
      <p class="text-xs text-gray-400 leading-relaxed mb-3">${esc(c.description||'')}</p>
      ${c.is_non_negotiable?'<span class="pill pill-blood mb-3 inline-flex"><i class="fas fa-lock text-[8px]"></i>NON-NEGOTIABLE</span>':''}
      ${c.log_status==='missed'?`<p class="text-[10px] text-red-400 font-bold tracking-[.2em] mb-2"><i class="fas fa-ban"></i> WINDOW CLOSED — AUTO-CANCELED. PENALTY APPLIED.</p>`:''}
      <div class="flex justify-center">${statusBtns(c)}</div>
    </article>`:`
    <article class="card-lux p-6 mb-3 text-center">
      <i class="fas fa-moon text-3xl text-blue-400 mb-2" style="filter:drop-shadow(0 0 14px rgba(96,165,250,.5))"></i>
      <h2 class="font-disp font-bold text-xl text-white">OFF THE CLOCK</h2>
      <p class="text-xs text-gray-500 mt-1">No scheduled block right now. If it's late — you should be asleep, soldier.</p>
    </article>`}

    ${n?`
    <div class="card p-3 mb-3 flex items-center gap-3">
      <i class="fas ${CAT_ICON[n.category]||'fa-circle'} cat-${n.category}"></i>
      <div class="flex-1">
        <p class="text-[10px] text-gray-500 font-bold tracking-widest">NEXT · ${n.start_time}</p>
        <p class="text-sm font-semibold">${esc(n.title)}</p>
      </div>
    </div>`:''}

    <div class="card-lux p-4 mb-3 flex items-center gap-4">
      ${FX.ring(adh.pct, 84, 7, adh.pct+'%', 'LAW 6')}
      <div class="flex-1">
        <h3 class="text-[10px] font-bold tracking-[.18em] text-gray-400 mb-1">WEIGHTED ADHERENCE</h3>
        <p class="text-xs text-gray-300"><span class="font-disp font-bold text-white">${adh.done}</span> / ${adh.total} scored blocks · <span class="text-gray-500">${Math.round(adh.wScore*10)/10}/${adh.wTotal} wt</span></p>
        <p class="text-[10px] text-gray-500 mt-1">Horizon: 80% · today's points
          <span class="font-disp font-bold ${s.todayPoints>=0?'text-jade':'text-red-400'}">${s.todayPoints>=0?'+':''}${s.todayPoints}</span></p>
        ${s.median!==null&&s.median!==undefined?`<p class="text-[10px] mt-0.5 ${s.delta>=0?'text-jade':'text-amber-400'}">vs your 14-day median (${s.median}%): <b>${s.delta>=0?'+':''}${s.delta}</b> — ${s.delta>=0?'ahead of your own baseline':'below your own baseline'}</p>`:''}
        <div class="prog mt-2"><div style="width:${adh.pct}%"></div></div>
      </div>
    </div>

    ${adh.mvdTotal>0?`
    <div class="card p-3 mb-3 ${adh.mvdHeld?'border-jade/40':''}" id="mvd-panel">
      <div class="flex items-center gap-2">
        <i class="fas fa-shield-halved ${adh.mvdHeld?'text-jade':'text-gray-500'}"></i>
        <div class="flex-1">
          <p class="text-[10px] font-bold tracking-widest ${adh.mvdHeld?'text-jade':'text-gray-400'}">${adh.mvdHeld?'✓ HELD THE LINE':'MINIMUM VIABLE DAY'}</p>
          <p class="text-[10px] text-gray-500">${adh.mvdDone}/${adh.mvdTotal} core blocks — ${adh.mvdHeld?'the streak survives no matter what else happens today.':'hit all of these and the day cannot collapse.'}</p>
        </div>
        <span class="font-disp font-bold ${adh.mvdHeld?'text-jade':'text-gray-400'}">${adh.mvdDone}/${adh.mvdTotal}</span>
      </div>
    </div>`:''}

    ${(s.loadReductions&&s.loadReductions.length)?s.loadReductions.map(lr=>`
    <div class="card p-3 mb-3 border-amber-700/40" id="load-reduction-${lr.id}">
      <p class="text-[10px] font-bold tracking-widest text-amber-400 mb-1"><i class="fas fa-compress"></i> LOAD REDUCTION · “${esc(lr.title)}” · half duration until ${lr.end_date}</p>
      ${lr.reason?`<p class="text-[10px] text-gray-500">Cause on record: ${esc(lr.reason.replace(/_/g,' '))}</p>`:`
      <p class="text-[10px] text-gray-400 mb-1.5">Two misses in a row — the plan was wrong somewhere. Why?</p>
      <div class="flex flex-wrap gap-1.5">
        ${[['wrong_time','WRONG TIME'],['too_long','TOO LONG'],['wrong_prereq','WRONG PREREQ'],['dont_want_it','DON’T WANT IT']].map(([v,l])=>`
        <button class="btn px-2 py-1.5 text-[10px] bg-gray-800/60 border border-line text-gray-300" onclick="answerLR(${lr.id},'${v}')">${l}</button>`).join('')}
      </div>`}
    </div>`).join(''):''}

    ${s.activeUnits.length?`
    <div class="card p-3 mb-3">
      <h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2"><i class="fas fa-chess-knight text-rose-400"></i> ACTIVE FRONTS</h3>
      ${s.activeUnits.map(u=>`
        <button class="w-full text-left flex items-center gap-2 py-1.5 border-b border-line/50 last:border-0" onclick="TAB='campaign';render()">
          <span class="pill ${u.track==='strategy'?'bg-rose-950 text-rose-300':'bg-indigo-950 text-indigo-300'}">${u.code}</span>
          <span class="text-xs flex-1">${esc(u.title)}</span>
          <span class="text-[9px] text-gray-500">${u.status.replace('_',' ').toUpperCase()}</span>
        </button>`).join('')}
    </div>`:''}

    ${s.dueCards>0?`
    <button class="btn w-full p-3 bg-gold/10 border border-gold/40 text-gold text-sm font-bold" onclick="TAB='mind';render()">
      <i class="fas fa-layer-group mr-1"></i> ${s.dueCards} FLASHCARD${s.dueCards>1?'S':''} DUE — DRILL THE PRINCIPLES
    </button>`:''}
  </section>`;
}

/* ================= TODAY TAB ================= */
let LAWS_CACHE = null;
function viewToday() {
  const nowMin = (() => { const [h,m]=nowTime().split(':').map(Number); return h*60+m; })();
  return `${header()}
  <section id="today-schedule" class="fade-in">
    <div class="sect">FULL DAY PLAN — ${dowLabel()}</div>
    <div class="relative" style="padding-left:14px">
    <div class="absolute top-2 bottom-2" style="left:4px;width:2px;background:linear-gradient(180deg,rgba(212,175,55,.4),rgba(29,41,66,.6))"></div>
    ${STATE.blocks.map(b=>{
      const isNow = STATE.current && STATE.current.id===b.id;
      const done = b.log_status==='done', part = b.log_status==='partial', skip = b.log_status==='skipped', missed = b.log_status==='missed';
      const [sh,sm] = b.start_time.split(':').map(Number);
      const past = (sh*60+sm) < nowMin && !isNow;
      const dotColor = done?'#22c55e':(skip||missed)?'#dc2626':part?'#f59e0b':isNow?'#d4af37':past?'#5d6b82':'#1d2942';
      return `
      <article class="card p-3 mb-2 relative ${isNow?'card-lux now-ring':''} ${done?'opacity-55':''} ${missed?'opacity-70':''}" ${missed?'style="border-color:rgba(220,38,38,.35);background:linear-gradient(135deg,rgba(60,10,10,.35),rgba(15,20,32,.9))"':''}>
        <div class="absolute rounded-full" style="left:-14px;top:50%;transform:translate(-50%,-50%);width:9px;height:9px;background:${dotColor};box-shadow:0 0 8px ${dotColor}${isNow?';animation:flicker 1.5s infinite':''}"></div>
        <div class="flex items-center gap-2.5">
          <div class="text-center w-11 shrink-0">
            <p class="font-disp font-bold text-xs ${isNow?'text-gold':'text-gray-400'}">${b.start_time}</p>
            <p class="text-[9px] text-gray-600">${b.end_time}</p>
          </div>
          <i class="fas ${CAT_ICON[b.category]||'fa-circle'} cat-${b.category} text-sm w-4"></i>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold ${done||missed?'line-through':''} ${skip||missed?'text-red-400':''}">${esc(b.title)}
              ${b.is_non_negotiable?'<i class="fas fa-lock text-[8px] text-red-500 ml-1"></i>':''}
            </p>
            <p class="text-[10px] ${missed?'text-red-500 font-bold tracking-wider':'text-gray-500'}">${missed?'✖ MISSED — WINDOW CLOSED · PENALTY TAKEN':`+${b.points} pts ${part?'· partial':''}`}</p>
          </div>
          ${statusBtns(b, true)}
        </div>
        ${isNow?'<p class="text-[9px] gold-text font-bold tracking-[.25em] mt-1.5 text-center">◄ YOU ARE HERE ►</p>':''}
      </article>`;
    }).join('')}
    </div>
    <div id="laws-panel" class="mt-4">${LAWS_CACHE?renderLaws():'<button class="btn w-full p-3 bg-panel border border-line text-sm" onclick="loadLaws()"><i class="fas fa-scale-balanced mr-1 text-gold"></i> CHECK THE 7 LAWS (tonight)</button>'}</div>
  </section>`;
}
function dowLabel(){ return ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][new Date().getDay()]; }
async function loadLaws(){ LAWS_CACHE = (await axios.get(`/api/laws?date=${todayStr()}`)).data; render(); }
function renderLaws() {
  return `
  <h2 class="font-disp font-bold text-sm tracking-widest text-gray-400 mb-2"><i class="fas fa-scale-balanced text-gold"></i> THE 7 LAWS — DID THEY HOLD TODAY?</h2>
  ${LAWS_CACHE.map(l=>`
    <article class="card p-3 mb-2">
      <div class="flex items-start gap-2">
        <span class="font-disp font-bold text-gold text-lg leading-none">${l.sort_order}</span>
        <div class="flex-1">
          <p class="text-xs font-bold">${esc(l.title)}</p>
          <p class="text-[10px] text-gray-500 leading-relaxed">${esc(l.detail)}</p>
        </div>
        <div class="flex gap-1.5">
          <button class="btn px-2.5 py-1.5 text-[11px] ${l.kept===1?'bg-emerald-700 text-white':'bg-gray-800/60 text-gray-500 border border-line'}" onclick="checkLaw(${l.id},true)"><i class="fas fa-check"></i></button>
          <button class="btn px-2.5 py-1.5 text-[11px] ${l.kept===0?'bg-red-800 text-white':'bg-gray-800/60 text-gray-500 border border-line'}" onclick="checkLaw(${l.id},false)"><i class="fas fa-xmark"></i></button>
        </div>
      </div>
    </article>`).join('')}`;
}
async function checkLaw(id, kept){
  await api('post',`/api/laws/${id}/check`,{date:todayStr(),kept});
  await loadLaws();
}

async function answerLR(id, reason){
  const r = await api('post',`/api/load-reductions/${id}/answer`,{reason});
  if (r.advice) FX.toast(r.advice, 'gold');
  await loadState(); render();
}
async function appealBlock(blockId, blockDate, title){
  const reason = prompt('APPEAL — “'+title+'” ('+blockDate+')\n\nOne token per week. The reason goes on the PERMANENT record and must be at least 100 characters. What actually happened?');
  if (reason===null) return;
  try {
    const r = await api('post','/api/appeals',{block_id:blockId, block_date:blockDate, reason});
    FX.success(); FX.toast('WINDOW REOPENED — '+(r.refunded||0)+' pts refunded. Now win it.', 'gold');
    await loadState(); render();
  } catch(_){}
}
window.ackFlag=ackFlag; window.logBlock=logBlock; window.loadLaws=loadLaws; window.checkLaw=checkLaw;
window.answerLR=answerLR; window.appealBlock=appealBlock;

/* render dispatcher — extended by app2.js */
function render() {
  if (TAB==='now') shell(viewNow());
  else if (TAB==='today') shell(viewToday());
  else if (window.renderExtra) window.renderExtra(TAB);
}
window.render = render;

/* live countdown inside the NOW hero (updates every second, no re-render) */
setInterval(()=>{
  const el = document.getElementById('block-countdown');
  if (!el || !STATE || !STATE.current) return;
  const [eh,em] = STATE.current.end_time.split(':').map(Number);
  const end = new Date(); end.setHours(eh,em,0,0);
  let diff = Math.floor((end - new Date())/1000);
  if (diff < 0) { el.textContent = 'BLOCK ENDED — LOG IT'; return; }
  const h = Math.floor(diff/3600), m = Math.floor((diff%3600)/60), s2 = diff%60;
  el.textContent = (h?`${h}h `:'')+`${String(m).padStart(2,'0')}:${String(s2).padStart(2,'0')} remaining`;
}, 1000);

(async function init(){
  try {
    const st = (await axios.get('/api/auth/status')).data;
    if (!st.setup) { renderLogin(true); FX.killSplash(); return; }
    if (!st.authed) { renderLogin(false); FX.killSplash(); return; }
    CSRF_TOKEN = st.csrfToken;
    await loadState(); render();
  }
  catch(e){ app().innerHTML = `<div class="p-6 text-center text-red-400 text-sm">Failed to load the war room. Pull to refresh.<br>${esc(e.message||'')}</div>`; }
  finally { FX.killSplash(); }
  setInterval(async ()=>{ if(STATE && (TAB==='now'||TAB==='today')){ try{ await loadState(); render(); }catch(_){} } }, 60000);
})();

/* ============ NEVER LOSE A WORD — textarea/input persistence ============ */
/* Every textarea and text input with an id is mirrored to localStorage on input,
   restored on render, and cleared when its form successfully submits. */
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t || !t.id) return;
  if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t.type === 'text' || t.type === 'time' || t.type === 'number' || t.type === 'date'))) {
    try { localStorage.setItem('wr_draft_' + t.id, t.value); } catch(_) {}
  }
});
function restoreDrafts(root) {
  (root || document).querySelectorAll('textarea[id], input[id]').forEach(el => {
    if (el.value) return; // server-filled value wins
    const v = localStorage.getItem('wr_draft_' + el.id);
    if (v !== null && v !== '') el.value = v;
  });
}
function clearDrafts(ids) { ids.forEach(id => localStorage.removeItem('wr_draft_' + id)); }
window.restoreDrafts = restoreDrafts; window.clearDrafts = clearDrafts;
/* auto-restore after each render */
const _origShell = shell;
shell = function(content) { _origShell(content); setTimeout(()=>restoreDrafts(), 0); };
