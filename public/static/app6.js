/* WAR ROOM — THE COUNCIL: Life Intel + Hermes autonomous counsel */
let INTEL = null, HERMES_HIST = null, COUNCIL_MODE = 'hermes', INTEL_OPEN = false;

const DOMAINS = [
  ['loyalty', 'Loyalty', 'fa-handshake'], ['family', 'Family', 'fa-house-chimney'],
  ['friends', 'Friends', 'fa-user-group'], ['network', 'Network', 'fa-diagram-project'],
  ['community', 'Community/Society', 'fa-city'], ['neighbours', 'Neighbours', 'fa-door-open'],
  ['classmates', 'Classmates', 'fa-graduation-cap'], ['women_relationships', 'Women & Relationships', 'fa-heart'],
  ['money', 'Money & Finance', 'fa-coins'], ['hustle', 'Hustle', 'fa-fire'],
  ['manipulation_spotted', 'Manipulation Spotted', 'fa-eye'], ['clever_move', 'Clever Move', 'fa-chess'],
  ['dumb_move', 'Dumb Move (owned)', 'fa-face-flushed'], ['workaround', 'Smart Workaround', 'fa-screwdriver-wrench'],
  ['wisdom', 'Wisdom / Saying', 'fa-scroll'], ['other', 'Other', 'fa-ellipsis']
];
const domainMeta = (d) => DOMAINS.find(x => x[0] === d) || DOMAINS[DOMAINS.length - 1];

function viewCouncil() {
  return header() +
  '<section id="council-section" class="fade-in">' +
    '<div class="flex gap-2 mb-3">' +
      '<button class="btn flex-1 p-2 text-xs font-bold ' + (COUNCIL_MODE === 'hermes' ? 'bg-gold/20 border border-gold/50 text-gold' : 'bg-panel border border-line text-gray-400') + '" onclick="COUNCIL_MODE=\'hermes\';render()"><i class="fas fa-user-secret mr-1"></i>HERMES</button>' +
      '<button class="btn flex-1 p-2 text-xs font-bold ' + (COUNCIL_MODE === 'intel' ? 'bg-gold/20 border border-gold/50 text-gold' : 'bg-panel border border-line text-gray-400') + '" onclick="COUNCIL_MODE=\'intel\';render()"><i class="fas fa-folder-open mr-1"></i>LIFE INTEL (' + (INTEL ? INTEL.length : 0) + ')</button>' +
    '</div>' +
    (COUNCIL_MODE === 'hermes' ? viewHermes() : viewIntel()) +
  '</section>';
}

/* ============ HERMES CHAT ============ */
let BRIDGE_TOKEN = null;
async function showBridge() {
  const url = location.origin;
  const el = document.createElement('div');
  el.className = 'fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4';
  el.innerHTML = '<div class="card p-4 max-w-md w-full max-h-[85vh] overflow-y-auto border-gold/40">' +
    '<h3 class="font-disp font-bold text-gold text-sm tracking-widest mb-2"><i class="fas fa-link"></i> HERMES BRIDGE — CONNECT YOUR LOCAL AGENT</h3>' +
    '<p class="text-[11px] text-gray-400 mb-2">Your Termux Hermes gets FULL access: briefings, auto-journaling, block check-offs, intel filing, watch-loop alerts (termux-notification + optional Telegram relay).</p>' +
    '<p class="text-[10px] font-bold text-gray-400">1. AGENT TOKEN (keep secret):</p>' +
    (BRIDGE_TOKEN
      ? '<div class="card p-2 mb-2 text-[10px] font-mono text-gold break-all" onclick="navigator.clipboard&&navigator.clipboard.writeText(this.textContent).then(()=>toast(\'Token copied.\'))">' + esc(BRIDGE_TOKEN) + '</div>' +
        '<p class="text-[10px] text-amber-300 mb-2">Shown for this rotation only. Copy it now; reopening this dialog will not retrieve it.</p>'
      : '<div class="card p-2 mb-2 text-[10px] text-gray-400">No token is retrievable. Rotate explicitly to issue a new one; the current bridge will stop until WARROOM_TOKEN is updated.</div>') +
    '<p class="text-[10px] font-bold text-gray-400">2. IN TERMUX:</p>' +
    '<pre class="card p-2 mb-2 text-[9px] font-mono text-emerald-300 overflow-x-auto">pkg install python termux-api -y\npip install requests\ncurl -o hermes_bridge.py \\\n  ' + url + '/static/hermes_bridge.py\nexport WARROOM_URL="' + url + '"\nexport WARROOM_TOKEN="' + (BRIDGE_TOKEN ? esc(BRIDGE_TOKEN) : '&lt;paste newly rotated token&gt;') + '"</pre>' +
    '<p class="text-[10px] font-bold text-gray-400">3. COMMANDS YOUR AGENT CAN RUN:</p>' +
    '<pre class="card p-2 mb-2 text-[9px] font-mono text-sky-300 overflow-x-auto">python hermes_bridge.py briefing   # my full file\npython hermes_bridge.py pending    # what needs me NOW\npython hermes_bridge.py watch      # 24/7 alert daemon\npython hermes_bridge.py done 8     # check off block\npython hermes_bridge.py intel "Cousin asked for money" -d money -s "..." -m "..."\npython hermes_bridge.py journal --wins "..."\npython hermes_bridge.py say "counsel text"  # appears here\npython hermes_bridge.py export     # sync full memory</pre>' +
    '<p class="text-[10px] text-gray-500 mb-2">Run the watcher 24/7: <span class="font-mono text-emerald-300">termux-wake-lock && tmux new -d "python hermes_bridge.py watch"</span>. Telegram relay: also export TG_BOT_TOKEN and TG_CHAT_ID.</p>' +
    '<div class="flex gap-2">' +
    '<button class="btn flex-1 p-2 bg-red-900/60 border border-red-700 text-red-200 text-xs font-bold" onclick="rotateToken(this)">ROTATE TOKEN</button>' +
    '<button class="btn flex-1 p-2 bg-gray-800 border border-line text-gray-300 text-xs font-bold" onclick="BRIDGE_TOKEN=null;this.closest(\'.fixed\').remove()">CLOSE</button>' +
    '</div></div>';
  document.body.appendChild(el);
}
async function rotateToken(btn) {
  BRIDGE_TOKEN = (await api('post', '/api/agent/token/rotate')).token;
  toast('Token rotated. Update WARROOM_TOKEN in Termux.');
  btn.closest('.fixed').remove(); showBridge();
}
window.showBridge = showBridge; window.rotateToken = rotateToken;

function viewHermes() {
  return '<div class="card p-3 mb-3 border-gold/30">' +
    '<p class="text-[10px] text-gray-500 leading-relaxed"><span class="text-gold font-bold">HERMES</span> reads your ENTIRE file live: every debrief, honesty flag, drill report, and life-intel move. He answers with named principles, calls out your patterns, and never flatters. Ask him anything — loyalty, money moves, classmates, reading manipulations, your next play.</p>' +
    '<button class="btn w-full p-2.5 mt-2 bg-gold/15 border border-gold/40 text-gold text-xs font-bold" onclick="convene()"><i class="fas fa-chess-king mr-1"></i> CONVENE MORNING WAR COUNCIL (auto-review of my file)</button>' +
    '<button class="btn w-full p-2.5 mt-2 bg-indigo-900/50 border border-indigo-700 text-indigo-200 text-xs font-bold" onclick="showBridge()"><i class="fas fa-terminal mr-1"></i> HERMES BRIDGE — connect Termux / Telegram / CLI agent</button>' +
  '</div>' +
  '<div id="hermes-log" class="mb-3 flex flex-col gap-2">' +
    (HERMES_HIST && HERMES_HIST.length ? HERMES_HIST.map(m => {
      const isH = m.role === 'assistant';
      const typing = isH && !m.created_at;
      return '<div class="bubble ' + (isH ? 'bubble-hermes' : 'bubble-me') + ' fade-in">' +
        '<p class="text-[8px] font-bold tracking-[.18em] mb-1 ' + (isH ? 'text-gold' : 'text-emerald-400') + '">' + (isH ? '🦉 HERMES' : '⚔ YOU') + (m.created_at ? ' · ' + m.created_at.slice(5, 16).replace('T',' ') : '') + '</p>' +
        (typing
          ? '<div class="typing-dots py-1"><span></span><span></span><span></span></div>'
          : '<div class="text-[13px] text-gray-200 leading-relaxed hermes-md">' + mdLite(m.content) + '</div>') +
      '</div>'; }).join('')
    : '<div class="card-glass p-5 text-center"><i class="fas fa-feather-pointed text-gold text-xl mb-2"></i><p class="text-xs text-gray-400">No transmissions yet. Hermes is standing by with your complete file.</p></div>') +
  '</div>' +
  '<div class="card-glass p-2 flex gap-2 items-end sticky bottom-20">' +
    '<textarea id="hermes-input" rows="2" placeholder="Speak to your counsel, Commander…" class="flex-1"></textarea>' +
    '<button class="btn btn-gold p-3" onclick="askHermes()"><i class="fas fa-paper-plane"></i></button>' +
  '</div>';
}

function mdLite(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-gold">$1</strong>')
    .replace(/^### (.+)$/gm, '<p class="font-bold text-gold mt-1">$1</p>')
    .replace(/^## (.+)$/gm, '<p class="font-bold text-gold mt-1">$1</p>')
    .replace(/^# (.+)$/gm, '<p class="font-bold text-gold mt-1">$1</p>')
    .replace(/^- (.+)$/gm, '<p class="pl-3">• $1</p>')
    .replace(/^(\d+)\. (.+)$/gm, '<p class="pl-3">$1. $2</p>')
    .replace(/\n\n/g, '<br>')
    .replace(/\n/g, '<br>');
}

async function askHermes() {
  const el = $('#hermes-input');
  const msg = el.value.trim();
  if (!msg) { toast('Say something, Commander.', true); return; }
  el.value = '';
  HERMES_HIST = HERMES_HIST || [];
  HERMES_HIST.push({ role: 'user', content: msg, created_at: new Date().toISOString() });
  HERMES_HIST.push({ role: 'assistant', content: '', created_at: '' });
  render();
  try {
    const r = await api('post', '/api/hermes', { message: msg, date: todayStr() });
    HERMES_HIST[HERMES_HIST.length - 1] = { role: 'assistant', content: r.answer, created_at: new Date().toISOString() };
  } catch (e) {
    HERMES_HIST.pop();
  }
  render();
  window.scrollTo(0, document.body.scrollHeight);
}

async function convene() {
  toast('Hermes is reviewing your complete file…');
  HERMES_HIST = HERMES_HIST || [];
  HERMES_HIST.push({ role: 'assistant', content: '…convening the war council, reading every debrief, flag, and intel entry…', created_at: '' });
  render();
  try {
    const r = await api('post', '/api/hermes/council', { date: todayStr() });
    HERMES_HIST[HERMES_HIST.length - 1] = { role: 'assistant', content: '[MORNING WAR COUNCIL]\n' + r.answer, created_at: new Date().toISOString() };
  } catch (e) { HERMES_HIST.pop(); }
  render();
}

/* ============ LIFE INTEL ============ */
function viewIntel() {
  let h = '<button class="btn w-full p-2.5 mb-3 bg-emerald-900/50 border border-emerald-700 text-emerald-200 text-xs font-bold" onclick="INTEL_OPEN=!INTEL_OPEN;render()"><i class="fas fa-plus mr-1"></i> FILE NEW INTEL — a move, a read, a lesson (+15)</button>';
  if (INTEL_OPEN) {
    h += '<div class="card p-3 mb-3 fade-in">' +
      '<label class="text-[10px] font-bold text-gray-400">DOMAIN</label>' +
      '<select id="in-domain" class="mb-1.5">' + DOMAINS.map(d => '<option value="' + d[0] + '">' + d[1] + '</option>').join('') + '</select>' +
      '<input id="in-title" placeholder="Title (e.g. \'Cousin asked to borrow again\')" class="mb-1.5">' +
      '<textarea id="in-situation" rows="2" placeholder="THE SITUATION — what happened, the terrain" class="mb-1.5"></textarea>' +
      '<textarea id="in-move" rows="2" placeholder="MY MOVE — what I actually did/said" class="mb-1.5"></textarea>' +
      '<textarea id="in-outcome" rows="2" placeholder="OUTCOME — what resulted (or \'pending\')" class="mb-1.5"></textarea>' +
      '<input id="in-people" placeholder="People involved (names/roles)" class="mb-1.5">' +
      '<input id="in-principle" placeholder="Principle used or violated (if known)" class="mb-1.5">' +
      '<select id="in-verdict" class="mb-1.5"><option value="pending">Verdict: pending</option><option value="smart">Verdict: SMART move</option><option value="dumb">Verdict: DUMB move (owned)</option><option value="neutral">Verdict: neutral</option></select>' +
      '<button class="btn w-full p-2.5 bg-emerald-900/60 border border-emerald-700 text-emerald-200 text-xs font-bold" onclick="fileIntel()">FILE INTO THE RECORD</button>' +
    '</div>';
  }
  if (!INTEL || !INTEL.length) return h + '<div class="card p-4 text-center text-xs text-gray-500">The record is empty. Every real-world move you file becomes ammunition: Hermes cross-references all of it, and patterns emerge that you cannot see alone.</div>';
  h += INTEL.map(e => {
    const dm = domainMeta(e.domain);
    const vcls = e.verdict === 'smart' ? 'bg-emerald-950 text-emerald-300' : e.verdict === 'dumb' ? 'bg-red-950 text-red-300' : 'bg-gray-800 text-gray-400';
    return '<details class="card p-3 mb-2">' +
      '<summary class="cursor-pointer flex items-center gap-2">' +
        '<i class="fas ' + dm[2] + ' text-gold text-xs w-4"></i>' +
        '<span class="text-xs font-semibold flex-1">' + esc(e.title) + '</span>' +
        '<span class="pill ' + vcls + '">' + e.verdict.toUpperCase() + '</span>' +
      '</summary>' +
      '<div class="mt-2 text-[11px] text-gray-400 space-y-1">' +
        '<p class="text-[9px] text-gray-600">' + e.log_date + ' · ' + dm[1] + (e.people ? ' · ' + esc(e.people) : '') + '</p>' +
        (e.situation ? '<p><span class="text-sky-400 font-bold">SITUATION:</span> ' + nl2br(e.situation) + '</p>' : '') +
        (e.my_move ? '<p><span class="text-gold font-bold">MY MOVE:</span> ' + nl2br(e.my_move) + '</p>' : '') +
        (e.outcome ? '<p><span class="text-emerald-400 font-bold">OUTCOME:</span> ' + nl2br(e.outcome) + '</p>' : '') +
        (e.principle_used ? '<p><span class="text-rose-400 font-bold">PRINCIPLE:</span> ' + esc(e.principle_used) + '</p>' : '') +
        (e.lesson ? '<p><span class="text-fuchsia-400 font-bold">LESSON:</span> ' + nl2br(e.lesson) + '</p>' : '') +
        (e.hermes_analysis
          ? '<div class="card p-2 mt-1 border-gold/25"><p class="text-[9px] font-bold text-gold">🦉 HERMES COUNSEL</p><div class="hermes-md">' + mdLite(e.hermes_analysis) + '</div></div>'
          : '<button class="btn px-3 py-1.5 mt-1 bg-gold/15 border border-gold/40 text-gold text-[10px] font-bold" onclick="analyzeIntel(' + e.id + ')"><i class="fas fa-user-secret mr-1"></i>REQUEST HERMES ANALYSIS</button>') +
      '</div>' +
    '</details>';
  }).join('');
  return h;
}

async function fileIntel() {
  const b = { domain: $('#in-domain').value, title: $('#in-title').value, situation: $('#in-situation').value,
    my_move: $('#in-move').value, outcome: $('#in-outcome').value, people: $('#in-people').value,
    principle_used: $('#in-principle').value, verdict: $('#in-verdict').value, log_date: todayStr() };
  if (!b.title) { toast('A title is required — name the move.', true); return; }
  await api('post', '/api/intel', b);
  FX.success(); FX.toast('INTEL FILED INTO THE RECORD  +15 — Hermes now knows','gold');
  INTEL_OPEN = false;
  INTEL = (await axios.get('/api/intel')).data;
  await loadState(); render();
}

async function analyzeIntel(id) {
  toast('Hermes is analyzing the move…');
  await api('post', '/api/intel/' + id + '/analyze', {});
  INTEL = (await axios.get('/api/intel')).data;
  render();
}

window.viewCouncil = viewCouncil; window.askHermes = askHermes; window.convene = convene;
window.fileIntel = fileIntel; window.analyzeIntel = analyzeIntel;
