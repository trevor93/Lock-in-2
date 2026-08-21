import { S } from '../core/store.js'
import { FX } from '../core/fx.js'
import { api, header, loadState, render, toast, todayStr } from '../core/shell.js'
import { registerActions } from '../core/events.js'
import { esc, nl2br } from '../core/sanitize.js'

/* WAR ROOM — THE COUNCIL: Life Intel + Hermes autonomous counsel */
// state moved to core/store.js: INTEL, HERMES_HIST, COUNCIL_MODE, INTEL_OPEN

export const DOMAINS = [
  ['loyalty', 'Loyalty', 'fa-handshake'], ['family', 'Family', 'fa-house-chimney'],
  ['friends', 'Friends', 'fa-user-group'], ['network', 'Network', 'fa-diagram-project'],
  ['community', 'Community/Society', 'fa-city'], ['neighbours', 'Neighbours', 'fa-door-open'],
  ['classmates', 'Classmates', 'fa-graduation-cap'], ['women_relationships', 'Women & Relationships', 'fa-heart'],
  ['money', 'Money & Finance', 'fa-coins'], ['hustle', 'Hustle', 'fa-fire'],
  ['manipulation_spotted', 'Manipulation Spotted', 'fa-eye'], ['clever_move', 'Clever Move', 'fa-chess'],
  ['dumb_move', 'Dumb Move (owned)', 'fa-face-flushed'], ['workaround', 'Smart Workaround', 'fa-screwdriver-wrench'],
  ['wisdom', 'Wisdom / Saying', 'fa-scroll'], ['other', 'Other', 'fa-ellipsis']
];
export const domainMeta = (d) => DOMAINS.find(x => x[0] === d) || DOMAINS[DOMAINS.length - 1];

export function viewCouncil() {
  return header() +
  '<section id="council-section" class="fade-in">' +
    '<button class="btn w-full p-2 mb-3 text-xs font-bold bg-panel border border-line text-gray-300" data-act="copyBrief"><i class="fas fa-clipboard-list mr-1"></i>COPY SESSION CONTINUITY BRIEF</button>' +
    '<div class="flex gap-2 mb-3">' +
      '<button class="btn flex-1 p-2 text-xs font-bold ' + (S.COUNCIL_MODE === 'hermes' ? 'bg-gold/20 border border-gold/50 text-gold' : 'bg-panel border border-line text-gray-400') + '" data-act="setCouncilMode" data-args="[&quot;hermes&quot;]"><i class="fas fa-user-secret mr-1"></i>HERMES</button>' +
      '<button class="btn flex-1 p-2 text-xs font-bold ' + (S.COUNCIL_MODE === 'intel' ? 'bg-gold/20 border border-gold/50 text-gold' : 'bg-panel border border-line text-gray-400') + '" data-act="setCouncilMode" data-args="[&quot;intel&quot;]"><i class="fas fa-folder-open mr-1"></i>LIFE INTEL (' + (S.INTEL ? S.INTEL.length : 0) + ')</button>' +
    '</div>' +
    (S.COUNCIL_MODE === 'hermes' ? viewHermes() : viewIntel()) +
  '</section>';
}

/* ============ HERMES CHAT ============ */
// state moved to core/store.js: BRIDGE_CREDENTIAL, BRIDGE_CREDENTIALS
export const DEFAULT_BRIDGE_SCOPES = [
  'briefing:read', 'blocks:read', 'blocks:write', 'debriefs:read',
  'debriefs:write', 'intel:read', 'intel:write', 'hermes:write'
];
export async function showBridge() {
  const url = location.origin;
  S.BRIDGE_CREDENTIALS = await api('get', '/api/agent/credentials');
  const el = document.createElement('div');
  el.className = 'fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4';
  el.innerHTML = '<div class="card p-4 max-w-md w-full max-h-[85vh] overflow-y-auto border-gold/40">' +
    '<h3 class="font-disp font-bold text-gold text-sm tracking-widest mb-2"><i class="fas fa-link"></i> HERMES BRIDGE — SCOPED CREDENTIALS</h3>' +
    '<p class="text-[11px] text-gray-400 mb-2">Issue one credential per device. Default bridge access excludes full export. Revoke a lost or retired device without disrupting the others.</p>' +
    '<label class="text-[10px] font-bold text-gray-400">DEVICE LABEL</label>' +
    '<input id="bridge-device-label" maxlength="100" placeholder="Termux phone" class="w-full mb-2">' +
    '<button class="btn w-full p-2 mb-2 bg-gold/15 border border-gold/40 text-gold text-xs font-bold" data-act="issueBridge">ISSUE DEFAULT BRIDGE CREDENTIAL</button>' +
    (S.BRIDGE_CREDENTIAL
      ? '<p class="text-[10px] font-bold text-gray-400">RAW CREDENTIAL — COPY NOW:</p>' +
        '<div class="card p-2 mb-2 text-[10px] font-mono text-gold break-all" data-act="copyCred">' + esc(S.BRIDGE_CREDENTIAL.token) + '</div>' +
        '<p class="text-[10px] text-amber-300 mb-2">Shown once. The server stores only its hash.</p>'
      : '<div class="card p-2 mb-2 text-[10px] text-gray-400">No raw credential is retrievable. Issue one and copy it before closing.</div>') +
    '<p class="text-[10px] font-bold text-gray-400">ACTIVE / REVOKED DEVICES:</p>' +
    '<div class="mb-2">' + (S.BRIDGE_CREDENTIALS.length ? S.BRIDGE_CREDENTIALS.map(function(c) {
      return '<div class="card p-2 mb-1 text-[10px]"><div class="flex justify-between gap-2"><span><b>' + esc(c.deviceLabel) + '</b><br><span class="font-mono text-gray-500">' + esc(c.tokenPrefix) + '…</span><br><span class="text-gray-500">' + esc(c.scopes.join(', ')) + '</span></span>' +
        (c.revokedAt ? '<span class="text-red-400">REVOKED</span>' : '<button class="btn px-2 border border-red-700 text-red-300" data-act="revokeBridge" data-args="[' + c.id + ']">REVOKE</button>') + '</div></div>';
    }).join('') : '<p class="text-[10px] text-gray-500">No credentials issued.</p>') + '</div>' +
    '<p class="text-[10px] font-bold text-gray-400">TERMUX:</p>' +
    '<pre class="card p-2 mb-2 text-[9px] font-mono text-emerald-300 overflow-x-auto">pkg install python termux-api -y\npip install requests\ncurl -o hermes_bridge.py \\\n  ' + url + '/static/hermes_bridge.py\nmkdir -p ~/.config/warroom\numask 077\ncat &gt; ~/.config/warroom/agent_token\n# Paste the copied credential, press Enter, then Ctrl-D\nexport WARROOM_URL="' + url + '"\nexport WARROOM_TOKEN_FILE="$HOME/.config/warroom/agent_token"</pre>' +
    '<p class="text-[10px] text-gray-500 mb-2">Full export requires a separate credential carrying <span class="font-mono">export:read</span> and the bridge flag <span class="font-mono">--authorize-full-export</span>.</p>' +
    '<button class="btn w-full p-2 bg-gray-800 border border-line text-gray-300 text-xs font-bold" data-act="closeBridge">CLOSE</button>' +
    '</div>';
  document.body.appendChild(el);
}
export async function issueBridgeCredential(btn) {
  const label = ($('#bridge-device-label').value || '').trim();
  if (!label) return toast('Give this device a label.', true);
  S.BRIDGE_CREDENTIAL = await api('post', '/api/agent/credentials', {
    deviceLabel: label, scopes: DEFAULT_BRIDGE_SCOPES, expiresInDays: 90
  });
  toast('Credential issued. Copy it now.');
  btn.closest('.fixed').remove(); await showBridge();
}
export async function revokeBridgeCredential(id, btn) {
  await api('post', '/api/agent/credentials/' + id + '/revoke');
  toast('Credential revoked.');
  btn.closest('.fixed').remove(); await showBridge();
}



export function viewHermes() {
  return '<div class="card p-3 mb-3 border-gold/30">' +
    '<p class="text-[10px] text-gray-500 leading-relaxed"><span class="text-gold font-bold">HERMES</span> reads your ENTIRE file live: every debrief, honesty flag, drill report, and life-intel move. He answers with named principles, calls out your patterns, and never flatters. Ask him anything — loyalty, money moves, classmates, reading manipulations, your next play.</p>' +
    '<button class="btn w-full p-2.5 mt-2 bg-gold/15 border border-gold/40 text-gold text-xs font-bold" data-act="convene"><i class="fas fa-chess-king mr-1"></i> CONVENE MORNING WAR COUNCIL (auto-review of my file)</button>' +
    '<button class="btn w-full p-2.5 mt-2 bg-indigo-900/50 border border-indigo-700 text-indigo-200 text-xs font-bold" data-act="showBridge"><i class="fas fa-terminal mr-1"></i> HERMES BRIDGE — connect Termux / Telegram / CLI agent</button>' +
  '</div>' +
  '<div id="hermes-log" class="mb-3 flex flex-col gap-2">' +
    (S.HERMES_HIST && S.HERMES_HIST.length ? S.HERMES_HIST.map(m => {
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
    '<button class="btn btn-gold p-3" data-act="askHermes"><i class="fas fa-paper-plane"></i></button>' +
  '</div>';
}

export function mdLite(s) {
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

export async function askHermes() {
  const el = $('#hermes-input');
  const msg = el.value.trim();
  if (!msg) { toast('Say something, Commander.', true); return; }
  el.value = '';
  S.HERMES_HIST = S.HERMES_HIST || [];
  S.HERMES_HIST.push({ role: 'user', content: msg, created_at: new Date().toISOString() });
  S.HERMES_HIST.push({ role: 'assistant', content: '', created_at: '' });
  render();
  try {
    const r = await api('post', '/api/hermes', { message: msg, date: todayStr() });
    S.HERMES_HIST[S.HERMES_HIST.length - 1] = { role: 'assistant', content: r.answer, created_at: new Date().toISOString() };
  } catch (e) {
    S.HERMES_HIST.pop();
  }
  render();
  window.scrollTo(0, document.body.scrollHeight);
}

export async function convene() {
  toast('Hermes is reviewing your complete file…');
  S.HERMES_HIST = S.HERMES_HIST || [];
  S.HERMES_HIST.push({ role: 'assistant', content: '…convening the war council, reading every debrief, flag, and intel entry…', created_at: '' });
  render();
  try {
    const r = await api('post', '/api/hermes/council', { date: todayStr() });
    S.HERMES_HIST[S.HERMES_HIST.length - 1] = { role: 'assistant', content: '[MORNING WAR COUNCIL]\n' + r.answer, created_at: new Date().toISOString() };
  } catch (e) { S.HERMES_HIST.pop(); }
  render();
}

/* ============ LIFE INTEL ============ */
export function viewIntel() {
  let h = '<button class="btn w-full p-2.5 mb-3 bg-emerald-900/50 border border-emerald-700 text-emerald-200 text-xs font-bold" data-act="toggleIntel"><i class="fas fa-plus mr-1"></i> FILE NEW INTEL — a move, a read, a lesson (+15)</button>';
  if (S.INTEL_OPEN) {
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
      '<label class="text-[10px] font-bold text-gray-400">HEAT — how did this land in you?</label>' +
      '<select id="in-heat" class="mb-1.5"><option value="calm">Calm</option><option value="baited">Baited</option><option value="proud">Proud</option><option value="afraid">Afraid</option></select>' +
      '<label class="text-[10px] font-bold text-amber-400">ALTERNATIVE EXPLANATION — required when heat is not calm (Law 23). The brake before you attribute intent. None plausible is allowed, but it is counted.</label>' +
      '<textarea id="in-alt" rows="2" placeholder="The most charitable reading. What else could explain it?" class="mb-1.5"></textarea>' +
      '<button class="btn w-full p-2.5 bg-emerald-900/60 border border-emerald-700 text-emerald-200 text-xs font-bold" data-act="fileIntel">FILE INTO THE RECORD</button>' +
    '</div>';
  }
  if (!S.INTEL || !S.INTEL.length) return h + '<div class="card p-4 text-center text-xs text-gray-500">The record is empty. Every real-world move you file becomes ammunition: Hermes cross-references all of it, and patterns emerge that you cannot see alone.</div>';
  h += S.INTEL.map(e => {
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
          : '<button class="btn px-3 py-1.5 mt-1 bg-gold/15 border border-gold/40 text-gold text-[10px] font-bold" data-act="analyzeIntel" data-args="[' + e.id + ']"><i class="fas fa-user-secret mr-1"></i>REQUEST HERMES ANALYSIS</button>') +
      '</div>' +
    '</details>';
  }).join('');
  return h;
}

export async function fileIntel() {
  const heatEl = $('#in-heat'); const altEl = $('#in-alt');
  const heat = heatEl ? heatEl.value : 'calm';
  const alt = altEl ? altEl.value.trim() : '';
  const b = { domain: $('#in-domain').value, title: $('#in-title').value, situation: $('#in-situation').value,
    my_move: $('#in-move').value, outcome: $('#in-outcome').value, people: $('#in-people').value,
    principle_used: $('#in-principle').value, verdict: $('#in-verdict').value, log_date: todayStr(),
    heat: heat };
  if (!b.title) { toast('A title is required — name the move.', true); return; }
  if (heat && heat !== 'calm' && !alt) {
    toast('The heat is not calm. Name one alternative explanation before you file — that is the brake.', true);
    if (altEl) altEl.focus();
    return;
  }
  if (heat && heat !== 'calm') b.alternative_explanation = alt;
  await api('post', '/api/intel', b);
  FX.success(); FX.toast('INTEL FILED INTO THE RECORD  +15 — Hermes now knows','gold');
  S.INTEL_OPEN = false;
  S.INTEL = (await axios.get('/api/intel')).data;
  await loadState(); render();
}

export async function analyzeIntel(id) {
  toast('Hermes is analyzing the move…');
  await api('post', '/api/intel/' + id + '/analyze', {});
  S.INTEL = (await axios.get('/api/intel')).data;
  render();
}

export async function copyContinuityBrief() {
  try {
    const res = await axios.get('/api/continuity-brief', { responseType: 'text' });
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      FX.success && FX.success(); toast('Continuity brief copied — paste it into any external session.');
    } else {
      const w = window.open('', '_blank'); if (w) { w.document.write('<pre>' + esc(text) + '</pre>'); }
    }
  } catch (e) { toast('Could not generate the continuity brief.', true); }
}


registerActions({
  copyBrief:      () => copyContinuityBrief(),
  setCouncilMode: (e, el, mode) => { S.COUNCIL_MODE = mode; render(); },
  issueBridge:    (e, el) => issueBridgeCredential(el),
  copyCred:       (e, el) => { if (navigator.clipboard) navigator.clipboard.writeText(el.textContent).then(() => toast('Credential copied.')); },
  revokeBridge:   (e, el, id) => revokeBridgeCredential(id, el),
  closeBridge:    (e, el) => { S.BRIDGE_CREDENTIAL = null; const d = el.closest('.fixed'); if (d) d.remove(); },
  convene:        () => convene(),
  showBridge:     () => showBridge(),
  askHermes:      () => askHermes(),
  toggleIntel:    () => { S.INTEL_OPEN = !S.INTEL_OPEN; render(); },
  fileIntel:      () => fileIntel(),
  analyzeIntel:   (e, el, id) => analyzeIntel(id),
});
