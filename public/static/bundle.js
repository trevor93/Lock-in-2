(function() {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const nl2br = (s) => esc(s).replace(/\n/g, "<br>");
  const ACTIONS = {};
  function registerActions(map) {
    Object.assign(ACTIONS, map);
  }
  const actArgs = (arr) => esc(JSON.stringify(arr));
  function _dispatchAct(e, attr, el) {
    const fn = ACTIONS[el.getAttribute(attr)];
    if (!fn) return;
    let args = [];
    const raw = el.getAttribute("data-args");
    if (raw) {
      try {
        args = JSON.parse(raw);
      } catch (_) {
        args = [];
      }
    }
    fn(e, el, ...args);
  }
  document.addEventListener("click", (e) => {
    const el = e.target && e.target.closest && e.target.closest("[data-act]");
    if (el) _dispatchAct(e, "data-act", el);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const el = e.target && e.target.closest && e.target.closest("[data-act-enter]");
    if (el) _dispatchAct(e, "data-act-enter", el);
  });
  document.addEventListener("change", (e) => {
    const el = e.target && e.target.closest && e.target.closest("[data-act-change]");
    if (el) _dispatchAct(e, "data-act-change", el);
  });
  function isElement(n) {
    return n && n.nodeType === 1;
  }
  function isText(n) {
    return n && (n.nodeType === 3 || n.nodeType === 8);
  }
  function keyOf(n) {
    return isElement(n) && n.id ? n.id : null;
  }
  function compatible(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (isElement(a)) return a.tagName === b.tagName && keyOf(a) === keyOf(b);
    return true;
  }
  function morphAttributes(from, to) {
    var toAttrs = to.attributes;
    for (var i = 0; i < toAttrs.length; i++) {
      var a = toAttrs[i];
      if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
    }
    var fromAttrs = from.attributes;
    for (var j = fromAttrs.length - 1; j >= 0; j--) {
      var name = fromAttrs[j].name;
      if (!to.hasAttribute(name)) from.removeAttribute(name);
    }
  }
  function preserveFormState(from, to, active) {
    var tag = from.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (from === active) {
        return true;
      }
      if (tag === "INPUT" && to.hasAttribute("value")) {
        if (from.value !== to.getAttribute("value")) from.value = to.getAttribute("value");
      }
      if (tag === "INPUT" && (from.type === "checkbox" || from.type === "radio")) {
        from.checked = to.hasAttribute("checked");
      }
    }
    return false;
  }
  function morphNode(from, to, active) {
    if (isText(from)) {
      if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
      return from;
    }
    if (isElement(from)) {
      morphAttributes(from, to);
      var skipChildren = preserveFormState(from, to, active);
      if (from.tagName === "TEXTAREA" && from === active) skipChildren = true;
      if (!skipChildren) morphChildren(from, to, active);
    }
    return from;
  }
  function morphChildren(fromEl, toEl, active) {
    var keyed = {};
    var n;
    for (n = fromEl.firstChild; n; n = n.nextSibling) {
      var k = keyOf(n);
      if (k) keyed[k] = n;
    }
    var curFrom = fromEl.firstChild;
    var curTo = toEl.firstChild;
    while (curTo) {
      var nextTo = curTo.nextSibling;
      var toKey = keyOf(curTo);
      var matched = null;
      if (toKey && keyed[toKey]) {
        matched = keyed[toKey];
        if (matched !== curFrom) fromEl.insertBefore(matched, curFrom);
        morphNode(matched, curTo, active);
        curFrom = matched.nextSibling;
        delete keyed[toKey];
      } else if (curFrom && !keyOf(curFrom) && !toKey && compatible(curFrom, curTo)) {
        morphNode(curFrom, curTo, active);
        curFrom = curFrom.nextSibling;
      } else {
        var clone = curTo.cloneNode(true);
        fromEl.insertBefore(clone, curFrom || null);
      }
      curTo = nextTo;
    }
    n = curFrom;
    while (n) {
      var next = n.nextSibling;
      if (!(active && n.nodeType === 1 && n.contains(active))) {
        fromEl.removeChild(n);
      }
      n = next;
    }
  }
  function morphInto(container, html) {
    var doc = container.ownerDocument || document;
    var tmp = doc.createElement(container.tagName || "DIV");
    tmp.innerHTML = html;
    var active = doc.activeElement;
    var selStart = null, selEnd = null, activeIsText = false;
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" && /^(text|search|url|tel|password|email|number)$/i.test(active.type || "text"))) {
      activeIsText = true;
      try {
        selStart = active.selectionStart;
        selEnd = active.selectionEnd;
      } catch (e) {
      }
    }
    morphChildren(container, tmp, active);
    if (active && doc.contains(active) && active !== doc.body) {
      if (doc.activeElement !== active && typeof active.focus === "function") {
        active.focus();
      }
      if (activeIsText && selStart !== null) {
        try {
          active.setSelectionRange(selStart, selEnd);
        } catch (e) {
        }
      }
    }
  }
  const FX = {
    // ── Haptics (Android Chrome) ──
    tap() {
      try {
        navigator.vibrate && navigator.vibrate(12);
      } catch (e) {
      }
    },
    success() {
      try {
        navigator.vibrate && navigator.vibrate([18, 40, 30]);
      } catch (e) {
      }
    },
    fail() {
      try {
        navigator.vibrate && navigator.vibrate([60, 50, 60]);
      } catch (e) {
      }
    },
    victory() {
      try {
        navigator.vibrate && navigator.vibrate([30, 40, 30, 40, 80]);
      } catch (e) {
      }
    },
    // ── Gold confetti burst (canvas particle system) ──
    confetti(opts = {}) {
      const cv = document.getElementById("fx-canvas");
      if (!cv) return;
      const ctx = cv.getContext("2d");
      cv.width = innerWidth;
      cv.height = innerHeight;
      const N = opts.count || 90;
      const colors = opts.colors || ["#d4af37", "#f4d97a", "#8a7223", "#ffffff", "#f59e0b"];
      const cx = opts.x ?? innerWidth / 2, cy = opts.y ?? innerHeight * 0.38;
      const P = [];
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 7;
        P.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 3,
          s: 3 + Math.random() * 4,
          r: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          c: colors[i % colors.length],
          life: 1,
          decay: 0.011 + Math.random() * 0.012,
          shape: Math.random() > 0.5 ? "rect" : "circ"
        });
      }
      let raf;
      const step = () => {
        ctx.clearRect(0, 0, cv.width, cv.height);
        let alive = false;
        for (const p of P) {
          if (p.life <= 0) continue;
          alive = true;
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.18;
          p.vx *= 0.985;
          p.r += p.vr;
          p.life -= p.decay;
          ctx.save();
          ctx.globalAlpha = Math.max(p.life, 0);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.r);
          ctx.fillStyle = p.c;
          if (p.shape === "rect") ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
          else {
            ctx.beginPath();
            ctx.arc(0, 0, p.s / 2, 0, 7);
            ctx.fill();
          }
          ctx.restore();
        }
        if (alive) raf = requestAnimationFrame(step);
        else ctx.clearRect(0, 0, cv.width, cv.height);
      };
      cancelAnimationFrame(raf);
      step();
      this.victory();
    },
    // ── Animated number count-up ──
    countUp(el, target, dur = 900) {
      if (!el) return;
      const start = performance.now(), from = 0;
      const tick = (t) => {
        const p = Math.min((t - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(from + (target - from) * eased).toLocaleString();
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    countUpAll(root = document) {
      root.querySelectorAll("[data-countup]").forEach((el) => {
        this.countUp(el, parseInt(el.dataset.countup || "0", 10));
      });
    },
    // ── SVG progress ring (returns HTML) ──
    ring(pct, size = 88, stroke = 7, label = "", sub = "") {
      const r = (size - stroke) / 2, C = 2 * Math.PI * r;
      const off = C * (1 - Math.min(Math.max(pct, 0), 100) / 100);
      return `<div class="ring-wrap" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}">
        <defs><linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8a7223"/><stop offset="50%" stop-color="#d4af37"/><stop offset="100%" stop-color="#f4d97a"/>
        </linearGradient></defs>
        <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
        <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"
          stroke-dasharray="${C}" stroke-dashoffset="${off}"/>
      </svg>
      <div class="ring-center">
        <div class="font-disp font-bold text-lg text-white leading-none">${label}</div>
        ${sub ? `<div class="text-[8px] text-gray-500 font-bold tracking-widest mt-0.5">${sub}</div>` : ""}
      </div>
    </div>`;
    },
    // ── Rank ladder (Duolingo-league style, war titles) ──
    RANKS: [
      [0, "RECRUIT", "fa-user"],
      [150, "SOLDIER", "fa-person-rifle"],
      [400, "SERGEANT", "fa-shield-halved"],
      [800, "LIEUTENANT", "fa-medal"],
      [1500, "CAPTAIN", "fa-star"],
      [2500, "COMMANDER", "fa-chess-knight"],
      [4e3, "GENERAL", "fa-chess-king"],
      [6500, "WARLORD", "fa-crown"],
      [1e4, "SOVEREIGN", "fa-dragon"]
    ],
    // Book 8.5: the rank ladder is CUT - it was a second rendering of points the
    // commander can already see. It may return only when it is derived from
    // calibration and mastery rather than from a running points total.
    flameClass(streak) {
      if (streak >= 90) return "flame-90";
      if (streak >= 30) return "flame-30";
      if (streak >= 7) return "flame-7";
      if (streak >= 1) return "flame-1";
      return "flame-0";
    },
    // ── Toast v2: icon + slide from top ──
    toast(msg, kind = "ok") {
      const icons = { ok: "fa-circle-check", bad: "fa-triangle-exclamation", gold: "fa-trophy", info: "fa-circle-info" };
      const styles = {
        ok: "background:linear-gradient(160deg,#052e16,#022c22);border:1px solid rgba(34,197,94,.4);color:#86efac",
        bad: "background:linear-gradient(160deg,#450a0a,#2a0505);border:1px solid rgba(220,38,38,.5);color:#fca5a5",
        gold: "background:linear-gradient(160deg,#2a2208,#1a1406);border:1px solid rgba(212,175,55,.55);color:#f4d97a",
        info: "background:linear-gradient(160deg,#0c1a2e,#081120);border:1px solid rgba(56,189,248,.4);color:#7dd3fc"
      };
      const t = document.createElement("div");
      t.style.cssText = `position:fixed;top:12px;left:12px;right:12px;z-index:400;padding:.8rem 1rem;border-radius:14px;font-size:.82rem;font-weight:600;display:flex;align-items:center;gap:.6rem;box-shadow:0 10px 30px rgba(0,0,0,.6);backdrop-filter:blur(10px);${styles[kind] || styles.ok};transform:translateY(-80px);transition:transform .35s cubic-bezier(.34,1.56,.64,1)`;
      t.innerHTML = `<i class="fas ${icons[kind] || icons.ok}"></i><span>${msg}</span>`;
      document.body.appendChild(t);
      requestAnimationFrame(() => t.style.transform = "translateY(0)");
      if (kind === "bad") this.fail();
      else if (kind === "gold") this.success();
      else this.tap();
      setTimeout(() => {
        t.style.transform = "translateY(-90px)";
        setTimeout(() => t.remove(), 400);
      }, kind === "bad" ? 4500 : 2600);
    },
    // ── Points delta floater (+25 rises from element) ──
    floatDelta(amount, el) {
      const rect = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0 };
      const f = document.createElement("div");
      const pos = amount >= 0;
      f.textContent = (pos ? "+" : "") + amount;
      f.style.cssText = `position:fixed;left:${rect.left + rect.width / 2}px;top:${rect.top}px;z-index:300;font-family:Rajdhani,sans-serif;font-weight:800;font-size:1.3rem;pointer-events:none;transform:translateX(-50%);color:${pos ? "#f4d97a" : "#f87171"};text-shadow:0 0 12px ${pos ? "rgba(212,175,55,.8)" : "rgba(220,38,38,.8)"};transition:transform 1.1s cubic-bezier(.22,1,.36,1),opacity 1.1s`;
      document.body.appendChild(f);
      requestAnimationFrame(() => {
        f.style.transform = "translateX(-50%) translateY(-70px)";
        f.style.opacity = "0";
      });
      setTimeout(() => f.remove(), 1200);
    },
    // ── Splash dismiss ──
    killSplash() {
      const s = document.getElementById("splash");
      if (s) setTimeout(() => {
        s.classList.add("gone");
        setTimeout(() => s.remove(), 700);
      }, 650);
    }
  };
  const S = {
    // navigation + session. Book 9 collapses nine tabs to five; SUB remembers
    // which face of a tab is showing, so nothing that used to be a tab is lost.
    TAB: "today",
    SUB: {
      today: "now",
      // now | schedule
      learn: "campaign",
      // campaign | books
      practice: "cards",
      // cards | maxims | tongue
      review: "debrief",
      // debrief | stats
      more: "council"
      // council | intel | settings
    },
    STATE: null,
    CSRF_TOKEN: null,
    TZ_SENT: false,
    // freshness watcher
    LAST_VERSION: null,
    VERSION_IN_FLIGHT: false,
    BOUNDARY_TIMER: null,
    // laws
    LAWS_CACHE: null,
    // lazily-loaded per-tab caches
    CAMPAIGN: null,
    MAXIMS: null,
    DUE: null,
    STATS: null,
    DEBRIEFS: null,
    REWARDS: null,
    PREDICTIONS: null,
    CALIBRATION: null,
    LIBRARY: null,
    INTEL: null,
    HERMES_HIST: null,
    // mind / cards view state
    OPEN_UNIT: null,
    CARD_IDX: 0,
    CARD_FLIP: false,
    MIND_MODE: "cards",
    // library reader
    BOOK: null,
    BOOK_ID: null,
    CHAP_IDX: 0,
    // council / bridge
    COUNCIL_MODE: "hermes",
    INTEL_OPEN: false,
    BRIDGE_CREDENTIAL: null,
    BRIDGE_CREDENTIALS: [],
    // the tongue engine's working state
    TG: {
      view: "today",
      list: null,
      due: null,
      stats: null,
      drill: null,
      drillIdx: 0,
      drillReveal: false,
      drillSession: { done: 0, fluent: 0 },
      exam: null,
      examIdx: 0,
      examReveal: false,
      examCorrect: 0,
      filter: "all",
      search: ""
    }
  };
  const DOMAINS = [
    ["loyalty", "Loyalty", "fa-handshake"],
    ["family", "Family", "fa-house-chimney"],
    ["friends", "Friends", "fa-user-group"],
    ["network", "Network", "fa-diagram-project"],
    ["community", "Community/Society", "fa-city"],
    ["neighbours", "Neighbours", "fa-door-open"],
    ["classmates", "Classmates", "fa-graduation-cap"],
    ["women_relationships", "Women & Relationships", "fa-heart"],
    ["money", "Money & Finance", "fa-coins"],
    ["hustle", "Hustle", "fa-fire"],
    ["manipulation_spotted", "Manipulation Spotted", "fa-eye"],
    ["clever_move", "Clever Move", "fa-chess"],
    ["dumb_move", "Dumb Move (owned)", "fa-face-flushed"],
    ["workaround", "Smart Workaround", "fa-screwdriver-wrench"],
    ["wisdom", "Wisdom / Saying", "fa-scroll"],
    ["other", "Other", "fa-ellipsis"]
  ];
  const domainMeta = (d) => DOMAINS.find((x) => x[0] === d) || DOMAINS[DOMAINS.length - 1];
  function viewCouncil() {
    return header() + '<section id="council-section" class="fade-in"><button class="btn w-full p-2 mb-3 text-xs font-bold bg-panel border border-line text-gray-300" data-act="copyBrief"><i class="fas fa-clipboard-list mr-1"></i>COPY SESSION CONTINUITY BRIEF</button><div class="flex gap-2 mb-3"><button class="btn flex-1 p-2 text-xs font-bold ' + (S.COUNCIL_MODE === "hermes" ? "bg-gold/20 border border-gold/50 text-gold" : "bg-panel border border-line text-gray-400") + '" data-act="setCouncilMode" data-args="[&quot;hermes&quot;]"><i class="fas fa-user-secret mr-1"></i>HERMES</button><button class="btn flex-1 p-2 text-xs font-bold ' + (S.COUNCIL_MODE === "intel" ? "bg-gold/20 border border-gold/50 text-gold" : "bg-panel border border-line text-gray-400") + '" data-act="setCouncilMode" data-args="[&quot;intel&quot;]"><i class="fas fa-folder-open mr-1"></i>LIFE INTEL (' + (S.INTEL ? S.INTEL.length : 0) + ")</button></div>" + (S.COUNCIL_MODE === "hermes" ? viewHermes() : viewIntel()) + "</section>";
  }
  const DEFAULT_BRIDGE_SCOPES = [
    "briefing:read",
    "blocks:read",
    "blocks:write",
    "debriefs:read",
    "debriefs:write",
    "intel:read",
    "intel:write",
    "hermes:write"
  ];
  async function showBridge() {
    const url = location.origin;
    S.BRIDGE_CREDENTIALS = await api("get", "/api/agent/credentials");
    const el = document.createElement("div");
    el.className = "fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4";
    el.innerHTML = '<div class="card p-4 max-w-md w-full max-h-[85vh] overflow-y-auto border-gold/40"><h3 class="font-disp font-bold text-gold text-sm tracking-widest mb-2"><i class="fas fa-link"></i> HERMES BRIDGE — SCOPED CREDENTIALS</h3><p class="text-[11px] text-gray-400 mb-2">Issue one credential per device. Default bridge access excludes full export. Revoke a lost or retired device without disrupting the others.</p><label class="text-[10px] font-bold text-gray-400">DEVICE LABEL</label><input id="bridge-device-label" maxlength="100" placeholder="Termux phone" class="w-full mb-2"><button class="btn w-full p-2 mb-2 bg-gold/15 border border-gold/40 text-gold text-xs font-bold" data-act="issueBridge">ISSUE DEFAULT BRIDGE CREDENTIAL</button>' + (S.BRIDGE_CREDENTIAL ? '<p class="text-[10px] font-bold text-gray-400">RAW CREDENTIAL — COPY NOW:</p><div class="card p-2 mb-2 text-[10px] font-mono text-gold break-all" data-act="copyCred">' + esc(S.BRIDGE_CREDENTIAL.token) + '</div><p class="text-[10px] text-amber-300 mb-2">Shown once. The server stores only its hash.</p>' : '<div class="card p-2 mb-2 text-[10px] text-gray-400">No raw credential is retrievable. Issue one and copy it before closing.</div>') + '<p class="text-[10px] font-bold text-gray-400">ACTIVE / REVOKED DEVICES:</p><div class="mb-2">' + (S.BRIDGE_CREDENTIALS.length ? S.BRIDGE_CREDENTIALS.map(function(c) {
      return '<div class="card p-2 mb-1 text-[10px]"><div class="flex justify-between gap-2"><span><b>' + esc(c.deviceLabel) + '</b><br><span class="font-mono text-gray-500">' + esc(c.tokenPrefix) + '…</span><br><span class="text-gray-500">' + esc(c.scopes.join(", ")) + "</span></span>" + (c.revokedAt ? '<span class="text-red-400">REVOKED</span>' : '<button class="btn px-2 border border-red-700 text-red-300" data-act="revokeBridge" data-args="[' + c.id + ']">REVOKE</button>') + "</div></div>";
    }).join("") : '<p class="text-[10px] text-gray-500">No credentials issued.</p>') + '</div><p class="text-[10px] font-bold text-gray-400">TERMUX:</p><pre class="card p-2 mb-2 text-[9px] font-mono text-emerald-300 overflow-x-auto">pkg install python termux-api -y\npip install requests\ncurl -o hermes_bridge.py \\\n  ' + url + '/static/hermes_bridge.py\nmkdir -p ~/.config/warroom\numask 077\ncat &gt; ~/.config/warroom/agent_token\n# Paste the copied credential, press Enter, then Ctrl-D\nexport WARROOM_URL="' + url + '"\nexport WARROOM_TOKEN_FILE="$HOME/.config/warroom/agent_token"</pre><p class="text-[10px] text-gray-500 mb-2">Full export requires a separate credential carrying <span class="font-mono">export:read</span> and the bridge flag <span class="font-mono">--authorize-full-export</span>.</p><button class="btn w-full p-2 bg-gray-800 border border-line text-gray-300 text-xs font-bold" data-act="closeBridge">CLOSE</button></div>';
    document.body.appendChild(el);
  }
  async function issueBridgeCredential(btn) {
    const label = ($("#bridge-device-label").value || "").trim();
    if (!label) return toast("Give this device a label.", true);
    S.BRIDGE_CREDENTIAL = await api("post", "/api/agent/credentials", {
      deviceLabel: label,
      scopes: DEFAULT_BRIDGE_SCOPES,
      expiresInDays: 90
    });
    toast("Credential issued. Copy it now.");
    btn.closest(".fixed").remove();
    await showBridge();
  }
  async function revokeBridgeCredential(id, btn) {
    await api("post", "/api/agent/credentials/" + id + "/revoke");
    toast("Credential revoked.");
    btn.closest(".fixed").remove();
    await showBridge();
  }
  function viewHermes() {
    return '<div class="card p-3 mb-3 border-gold/30"><p class="text-[10px] text-gray-500 leading-relaxed"><span class="text-gold font-bold">HERMES</span> reads your ENTIRE file live: every debrief, honesty flag, drill report, and life-intel move. He answers with named principles, calls out your patterns, and never flatters. Ask him anything — loyalty, money moves, classmates, reading manipulations, your next play.</p><button class="btn w-full p-2.5 mt-2 bg-gold/15 border border-gold/40 text-gold text-xs font-bold" data-act="convene"><i class="fas fa-chess-king mr-1"></i> CONVENE MORNING WAR COUNCIL (auto-review of my file)</button><button class="btn w-full p-2.5 mt-2 bg-indigo-900/50 border border-indigo-700 text-indigo-200 text-xs font-bold" data-act="showBridge"><i class="fas fa-terminal mr-1"></i> HERMES BRIDGE — connect Termux / Telegram / CLI agent</button></div><div id="hermes-log" class="mb-3 flex flex-col gap-2">' + (S.HERMES_HIST && S.HERMES_HIST.length ? S.HERMES_HIST.map((m) => {
      const isH = m.role === "assistant";
      const typing = isH && !m.created_at;
      return '<div class="bubble ' + (isH ? "bubble-hermes" : "bubble-me") + ' fade-in"><p class="text-[8px] font-bold tracking-[.18em] mb-1 ' + (isH ? "text-gold" : "text-emerald-400") + '">' + (isH ? "🦉 HERMES" : "⚔ YOU") + (m.created_at ? " · " + m.created_at.slice(5, 16).replace("T", " ") : "") + "</p>" + (typing ? '<div class="typing-dots py-1"><span></span><span></span><span></span></div>' : '<div class="text-[13px] text-gray-200 leading-relaxed hermes-md">' + mdLite(m.content) + "</div>") + "</div>";
    }).join("") : '<div class="card-glass p-5 text-center"><i class="fas fa-feather-pointed text-gold text-xl mb-2"></i><p class="text-xs text-gray-400">No transmissions yet. Hermes is standing by with your complete file.</p></div>') + '</div><div class="card-glass p-2 flex gap-2 items-end sticky bottom-20"><textarea id="hermes-input" rows="2" placeholder="Speak to your counsel, Commander…" class="flex-1"></textarea><button class="btn btn-gold p-3" data-act="askHermes"><i class="fas fa-paper-plane"></i></button></div>';
  }
  function mdLite(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong class="text-gold">$1</strong>').replace(/^### (.+)$/gm, '<p class="font-bold text-gold mt-1">$1</p>').replace(/^## (.+)$/gm, '<p class="font-bold text-gold mt-1">$1</p>').replace(/^# (.+)$/gm, '<p class="font-bold text-gold mt-1">$1</p>').replace(/^- (.+)$/gm, '<p class="pl-3">• $1</p>').replace(/^(\d+)\. (.+)$/gm, '<p class="pl-3">$1. $2</p>').replace(/\n\n/g, "<br>").replace(/\n/g, "<br>");
  }
  async function askHermes() {
    const el = $("#hermes-input");
    const msg = el.value.trim();
    if (!msg) {
      toast("Say something, Commander.", true);
      return;
    }
    el.value = "";
    S.HERMES_HIST = S.HERMES_HIST || [];
    S.HERMES_HIST.push({ role: "user", content: msg, created_at: (/* @__PURE__ */ new Date()).toISOString() });
    S.HERMES_HIST.push({ role: "assistant", content: "", created_at: "" });
    render();
    try {
      const r = await api("post", "/api/hermes", { message: msg, date: todayStr() });
      S.HERMES_HIST[S.HERMES_HIST.length - 1] = { role: "assistant", content: r.answer, created_at: (/* @__PURE__ */ new Date()).toISOString() };
    } catch (e) {
      S.HERMES_HIST.pop();
    }
    render();
    window.scrollTo(0, document.body.scrollHeight);
  }
  async function convene() {
    toast("Hermes is reviewing your complete file…");
    S.HERMES_HIST = S.HERMES_HIST || [];
    S.HERMES_HIST.push({ role: "assistant", content: "…convening the war council, reading every debrief, flag, and intel entry…", created_at: "" });
    render();
    try {
      const r = await api("post", "/api/hermes/council", { date: todayStr() });
      S.HERMES_HIST[S.HERMES_HIST.length - 1] = { role: "assistant", content: "[MORNING WAR COUNCIL]\n" + r.answer, created_at: (/* @__PURE__ */ new Date()).toISOString() };
    } catch (e) {
      S.HERMES_HIST.pop();
    }
    render();
  }
  function viewIntel() {
    let h = '<button class="btn w-full p-2.5 mb-3 bg-emerald-900/50 border border-emerald-700 text-emerald-200 text-xs font-bold" data-act="toggleIntel"><i class="fas fa-plus mr-1"></i> FILE NEW INTEL — a move, a read, a lesson (+15)</button>';
    if (S.INTEL_OPEN) {
      h += '<div class="card p-3 mb-3 fade-in"><label class="text-[10px] font-bold text-gray-400">DOMAIN</label><select id="in-domain" class="mb-1.5">' + DOMAINS.map((d) => '<option value="' + d[0] + '">' + d[1] + "</option>").join("") + `</select><input id="in-title" placeholder="Title (e.g. 'Cousin asked to borrow again')" class="mb-1.5"><textarea id="in-situation" rows="2" placeholder="THE SITUATION — what happened, the terrain" class="mb-1.5"></textarea><textarea id="in-move" rows="2" placeholder="MY MOVE — what I actually did/said" class="mb-1.5"></textarea><textarea id="in-outcome" rows="2" placeholder="OUTCOME — what resulted (or 'pending')" class="mb-1.5"></textarea><input id="in-people" placeholder="People involved (names/roles)" class="mb-1.5"><input id="in-principle" placeholder="Principle used or violated (if known)" class="mb-1.5"><select id="in-verdict" class="mb-1.5"><option value="pending">Verdict: pending</option><option value="smart">Verdict: SMART move</option><option value="dumb">Verdict: DUMB move (owned)</option><option value="neutral">Verdict: neutral</option></select><label class="text-[10px] font-bold text-gray-400">HEAT — how did this land in you?</label><select id="in-heat" class="mb-1.5"><option value="calm">Calm</option><option value="baited">Baited</option><option value="proud">Proud</option><option value="afraid">Afraid</option></select><label class="text-[10px] font-bold text-amber-400">ALTERNATIVE EXPLANATION — required when heat is not calm (Law 23). The brake before you attribute intent. None plausible is allowed, but it is counted.</label><textarea id="in-alt" rows="2" placeholder="The most charitable reading. What else could explain it?" class="mb-1.5"></textarea><button class="btn w-full p-2.5 bg-emerald-900/60 border border-emerald-700 text-emerald-200 text-xs font-bold" data-act="fileIntel">FILE INTO THE RECORD</button></div>`;
    }
    if (!S.INTEL || !S.INTEL.length) return h + '<div class="card p-4 text-center text-xs text-gray-500">The record is empty. Every real-world move you file becomes ammunition: Hermes cross-references all of it, and patterns emerge that you cannot see alone.</div>';
    h += S.INTEL.map((e) => {
      const dm = domainMeta(e.domain);
      const vcls = e.verdict === "smart" ? "bg-emerald-950 text-emerald-300" : e.verdict === "dumb" ? "bg-red-950 text-red-300" : "bg-gray-800 text-gray-400";
      return '<details class="card p-3 mb-2"><summary class="cursor-pointer flex items-center gap-2"><i class="fas ' + dm[2] + ' text-gold text-xs w-4"></i><span class="text-xs font-semibold flex-1">' + esc(e.title) + '</span><span class="pill ' + vcls + '">' + e.verdict.toUpperCase() + '</span></summary><div class="mt-2 text-[11px] text-gray-400 space-y-1"><p class="text-[9px] text-gray-600">' + e.log_date + " · " + dm[1] + (e.people ? " · " + esc(e.people) : "") + "</p>" + (e.situation ? '<p><span class="text-sky-400 font-bold">SITUATION:</span> ' + nl2br(e.situation) + "</p>" : "") + (e.my_move ? '<p><span class="text-gold font-bold">MY MOVE:</span> ' + nl2br(e.my_move) + "</p>" : "") + (e.outcome ? '<p><span class="text-emerald-400 font-bold">OUTCOME:</span> ' + nl2br(e.outcome) + "</p>" : "") + (e.principle_used ? '<p><span class="text-rose-400 font-bold">PRINCIPLE:</span> ' + esc(e.principle_used) + "</p>" : "") + (e.lesson ? '<p><span class="text-fuchsia-400 font-bold">LESSON:</span> ' + nl2br(e.lesson) + "</p>" : "") + (e.hermes_analysis ? '<div class="card p-2 mt-1 border-gold/25"><p class="text-[9px] font-bold text-gold">🦉 HERMES COUNSEL</p><div class="hermes-md">' + mdLite(e.hermes_analysis) + "</div></div>" : '<button class="btn px-3 py-1.5 mt-1 bg-gold/15 border border-gold/40 text-gold text-[10px] font-bold" data-act="analyzeIntel" data-args="[' + e.id + ']"><i class="fas fa-user-secret mr-1"></i>REQUEST HERMES ANALYSIS</button>') + "</div></details>";
    }).join("");
    return h;
  }
  async function fileIntel() {
    const heatEl = $("#in-heat");
    const altEl = $("#in-alt");
    const heat = heatEl ? heatEl.value : "calm";
    const alt = altEl ? altEl.value.trim() : "";
    const b = {
      domain: $("#in-domain").value,
      title: $("#in-title").value,
      situation: $("#in-situation").value,
      my_move: $("#in-move").value,
      outcome: $("#in-outcome").value,
      people: $("#in-people").value,
      principle_used: $("#in-principle").value,
      verdict: $("#in-verdict").value,
      log_date: todayStr(),
      heat
    };
    if (!b.title) {
      toast("A title is required — name the move.", true);
      return;
    }
    if (heat && heat !== "calm" && !alt) {
      toast("The heat is not calm. Name one alternative explanation before you file — that is the brake.", true);
      if (altEl) altEl.focus();
      return;
    }
    if (heat && heat !== "calm") b.alternative_explanation = alt;
    await api("post", "/api/intel", b);
    FX.success();
    FX.toast("INTEL FILED INTO THE RECORD  +15 — Hermes now knows", "gold");
    S.INTEL_OPEN = false;
    S.INTEL = (await axios.get("/api/intel")).data;
    await loadState();
    render();
  }
  async function analyzeIntel(id) {
    toast("Hermes is analyzing the move…");
    await api("post", "/api/intel/" + id + "/analyze", {});
    S.INTEL = (await axios.get("/api/intel")).data;
    render();
  }
  async function copyContinuityBrief() {
    try {
      const res = await axios.get("/api/continuity-brief", { responseType: "text" });
      const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        FX.success && FX.success();
        toast("Continuity brief copied — paste it into any external session.");
      } else {
        const w = window.open("", "_blank");
        if (w) {
          w.document.write("<pre>" + esc(text) + "</pre>");
        }
      }
    } catch (e) {
      toast("Could not generate the continuity brief.", true);
    }
  }
  registerActions({
    copyBrief: () => copyContinuityBrief(),
    setCouncilMode: (e, el, mode) => {
      S.COUNCIL_MODE = mode;
      render();
    },
    issueBridge: (e, el) => issueBridgeCredential(el),
    copyCred: (e, el) => {
      if (navigator.clipboard) navigator.clipboard.writeText(el.textContent).then(() => toast("Credential copied."));
    },
    revokeBridge: (e, el, id) => revokeBridgeCredential(id, el),
    closeBridge: (e, el) => {
      S.BRIDGE_CREDENTIAL = null;
      const d = el.closest(".fixed");
      if (d) d.remove();
    },
    convene: () => convene(),
    showBridge: () => showBridge(),
    askHermes: () => askHermes(),
    toggleIntel: () => {
      S.INTEL_OPEN = !S.INTEL_OPEN;
      render();
    },
    fileIntel: () => fileIntel(),
    analyzeIntel: (e, el, id) => analyzeIntel(id)
  });
  function viewDebrief() {
    const d = S.STATE.debrief || {};
    const filed = !!S.STATE.debriefDoneToday;
    return header() + '<section id="debrief-section" class="stagger"><div class="card-lux p-3.5 mb-3 flex items-center gap-3"><i class="fas ' + (filed ? "fa-file-shield text-jade" : "fa-pen-nib text-fuchsia-400") + ' text-2xl" style="filter:drop-shadow(0 0 10px currentColor)"></i><div class="flex-1"><h2 class="font-engraved font-bold text-sm ' + (filed ? "text-jade" : "gold-text") + '">NIGHT DEBRIEF — ' + todayStr() + '</h2><p class="text-[10px] text-gray-500 leading-relaxed mt-0.5">' + (filed ? "Filed. You can still amend it before midnight." : "The single highest-leverage habit in this system. 10 minutes. Marcus Aurelius did this 1,900 years ago. Missing it triggers the honesty engine.") + '</p></div></div><div class="card p-3.5 mb-3"><label class="text-[10px] font-bold tracking-widest text-emerald-400">WHAT DID I WIN TODAY?</label><textarea id="db-wins" rows="2" class="mb-2">' + esc(d.wins || "") + '</textarea><label class="text-[10px] font-bold tracking-widest text-red-400">WHERE DID I BREAK THE SCHEDULE — AND WHY, HONESTLY?</label><textarea id="db-breaks" rows="2" class="mb-2">' + esc(d.breaks || "") + `</textarea><label class="text-[10px] font-bold tracking-widest text-gold">TOMORROW'S 3 TARGETS (Law 4 — decide tonight)</label><textarea id="db-targets" rows="3" placeholder="1.&#10;2.&#10;3." class="mb-2">` + esc(d.tomorrow_targets || "") + '</textarea><label class="text-[10px] font-bold tracking-widest text-rose-400">STRATEGY INSIGHT — one principle I saw or used today</label><textarea id="db-insight" rows="2" class="mb-2">' + esc(d.strategy_insight || "") + '</textarea><div class="grid grid-cols-2 gap-2 mb-2"><div><label class="text-[10px] font-bold text-gray-400">MOOD (1-5)</label><input type="number" id="db-mood" min="1" max="5" value="' + (d.mood || "") + '"></div><div><label class="text-[10px] font-bold text-gray-400">ENERGY (1-5)</label><input type="number" id="db-energy" min="1" max="5" value="' + (d.energy || "") + '"></div></div><div class="grid grid-cols-3 gap-2 mb-3"><div><label class="text-[10px] font-bold text-gray-400">WOKE AT</label><input type="time" id="db-wake" value="' + (d.wake_time || "") + '"></div><div><label class="text-[10px] font-bold text-gray-400">LIGHTS OUT</label><input type="time" id="db-sleep" value="' + (d.sleep_time || "") + '"></div><div><label class="text-[10px] font-bold text-gray-400">SLEPT (h)</label><input type="number" step="0.25" id="db-hours" value="' + (d.sleep_hours || "") + '"></div></div><button class="btn btn-gold w-full p-3 text-sm" data-act="saveDebrief"><i class="fas fa-file-shield mr-1"></i> FILE INTELLIGENCE REPORT (+25)</button></div>' + predictionsPanel() + rewardsPanel() + '<div class="sect">PAST REPORTS — ' + S.DEBRIEFS.length + " FILED</div>" + S.DEBRIEFS.slice(0, 14).map((x) => '<details class="card p-3 mb-2"><summary class="text-xs font-bold cursor-pointer">' + x.log_date + (x.sleep_hours ? " · " + x.sleep_hours + "h sleep" : "") + (x.mood ? " · mood " + x.mood + "/5" : "") + '</summary><div class="mt-2 text-[11px] text-gray-400 space-y-1">' + (x.wins ? '<p><span class="text-emerald-400 font-bold">WINS:</span> ' + nl2br(x.wins) + "</p>" : "") + (x.breaks ? '<p><span class="text-red-400 font-bold">BREAKS:</span> ' + nl2br(x.breaks) + "</p>" : "") + (x.tomorrow_targets ? '<p><span class="text-gold font-bold">TARGETS:</span> ' + nl2br(x.tomorrow_targets) + "</p>" : "") + (x.strategy_insight ? '<p><span class="text-rose-400 font-bold">INSIGHT:</span> ' + nl2br(x.strategy_insight) + "</p>" : "") + "</div></details>").join("") + "</section>";
  }
  function rewardsPanel() {
    if (!S.REWARDS) {
      axios.get("/api/rewards").then((r) => {
        S.REWARDS = r.data;
        if (S.TAB === "debrief") render();
      });
      return "";
    }
    return '<div class="card p-3"><h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2"><i class="fas fa-trophy text-gold"></i> REWARDS — EARNED, NEVER GIVEN (you have <span class="text-gold font-bold">' + S.STATE.points + "</span> pts)</h3>" + S.REWARDS.map((r) => '<div class="flex items-center gap-2 py-1.5 border-b border-line/50 last:border-0"><div class="flex-1"><p class="text-xs font-semibold">' + esc(r.title) + '</p><p class="text-[10px] text-gray-500">' + esc(r.description || "") + (r.redeemed_count ? " · taken ×" + r.redeemed_count : "") + '</p></div><button class="btn px-3 py-1.5 text-[11px] font-bold ' + (S.STATE.points >= r.cost ? "bg-gold/20 border border-gold/50 text-gold" : "bg-gray-800 text-gray-600 border border-line") + '" data-act="redeem" data-args="[' + r.id + ']">' + r.cost + "</button></div>").join("") + "</div>";
  }
  async function redeem(id) {
    await api("post", "/api/rewards/" + id + "/redeem", {});
    FX.confetti({ count: 80 });
    FX.toast("REWARD CLAIMED — paid in discipline, enjoy with zero guilt", "gold");
    S.REWARDS = (await axios.get("/api/rewards")).data;
    await loadState();
    render();
  }
  async function saveDebrief() {
    const b = {
      date: todayStr(),
      wins: $("#db-wins").value,
      breaks: $("#db-breaks").value,
      tomorrow_targets: $("#db-targets").value,
      strategy_insight: $("#db-insight").value,
      mood: Number($("#db-mood").value) || null,
      energy: Number($("#db-energy").value) || null,
      wake_time: $("#db-wake").value || null,
      sleep_time: $("#db-sleep").value || null,
      sleep_hours: Number($("#db-hours").value) || null
    };
    if (!b.wins && !b.breaks && !b.tomorrow_targets) {
      toast("An empty report is a lie of omission. Write something true.", true);
      return;
    }
    if (!b.tomorrow_targets) {
      toast("Law 4: tomorrow's 3 targets are NOT optional. Decide tonight.", true);
      return;
    }
    await api("post", "/api/debrief", b);
    if (clearDrafts) clearDrafts(["db-wins", "db-breaks", "db-targets", "db-insight", "db-mood", "db-energy", "db-wake", "db-sleep", "db-hours"]);
    FX.success();
    FX.toast("INTELLIGENCE REPORT FILED — tomorrow already knows its orders  +25", "gold");
    S.DEBRIEFS = (await axios.get("/api/debriefs")).data;
    await loadState();
    render();
  }
  async function loadPredictions() {
    [S.PREDICTIONS, S.CALIBRATION] = await Promise.all([
      axios.get("/api/predictions").then((r) => r.data),
      axios.get("/api/predictions/calibration").then((r) => r.data)
    ]);
  }
  function predictionsPanel() {
    if (!S.PREDICTIONS) {
      loadPredictions().then(() => {
        if (S.TAB === "debrief") render();
      });
      return '<div class="card p-3 mb-3 text-[11px] text-gray-500">Loading prediction log…</div>';
    }
    const open = S.PREDICTIONS.filter((p) => p.outcome === "unresolved");
    const overdue = open.filter((p) => p.resolve_by <= S.STATE.date);
    const resolved = S.PREDICTIONS.filter((p) => p.outcome === "right" || p.outcome === "wrong");
    const cal = S.CALIBRATION || {};
    return '<div class="card-lux p-3.5 mb-3" id="prediction-log"><h3 class="font-engraved font-bold text-xs gold-text mb-1"><i class="fas fa-crosshairs mr-1"></i>PREDICTION LOG — CALIBRATED JUDGMENT</h3><p class="text-[10px] text-gray-500 mb-2">Claim → confidence → date → graded. The only cure for a brain that rewrites its own past.</p>' + (cal.n ? '<div class="card-glass p-2.5 mb-2"><p class="text-[10px] text-gray-400">' + cal.n + ' graded · Brier <b class="text-gold">' + cal.brier + "</b> (0 = prophet, 0.25 = coin flip)</p>" + (cal.buckets && cal.buckets.length ? '<div class="flex items-end gap-1 mt-1.5" style="height:44px">' + cal.buckets.map((b) => '<div class="flex-1 text-center"><div class="flex items-end justify-center gap-0.5" style="height:32px"><div style="width:8px;height:' + b.avgConfidence * 0.32 + 'px;background:#5b6b85" title="claimed"></div><div style="width:8px;height:' + b.hitRate * 0.32 + "px;background:" + (b.hitRate >= b.avgConfidence - 5 ? "#22c55e" : "#dc2626") + '" title="actual"></div></div><span class="text-[7px] text-gray-600">' + b.range + "</span></div>").join("") + '</div><p class="text-[7px] text-gray-600 mt-0.5">grey = claimed · green/red = reality</p>' : "") + '<p class="text-[10px] mt-1.5 leading-relaxed ' + ((cal.verdict || "").startsWith("OVERCONF") ? "text-red-400" : (cal.verdict || "").startsWith("WELL") ? "text-jade" : "text-amber-400") + '">' + esc(cal.verdict || "") + "</p></div>" : '<p class="text-[10px] text-gray-500 mb-2">' + esc(cal.verdict || "No graded predictions yet.") + "</p>") + (overdue.length ? '<div class="card p-2.5 mb-2 border-red-800/50"><p class="text-[10px] font-bold text-red-400 mb-1">' + overdue.length + " PREDICTION" + (overdue.length > 1 ? "S" : "") + " AWAITING JUDGMENT — grade them now, memory rots fast:</p>" + overdue.map((p) => predRow(p)).join("") + "</div>" : "") + (open.filter((p) => p.resolve_by > S.STATE.date).length ? '<div class="mb-2">' + open.filter((p) => p.resolve_by > S.STATE.date).slice(0, 5).map((p) => predRow(p)).join("") + "</div>" : "") + '<div class="card p-2.5 mb-2"><input id="pred-claim" type="text" placeholder="Precise, falsifiable claim — e.g. “X will reply within 3 days”" class="w-full bg-ink border border-line rounded px-2 py-2 text-[11px] mb-1.5"><div class="grid grid-cols-3 gap-1.5 mb-1.5"><div><label class="text-[8px] font-bold text-gray-500">CONFIDENCE %</label><input id="pred-conf" type="number" min="50" max="99" value="70" class="w-full"></div><div><label class="text-[8px] font-bold text-gray-500">RESOLVE BY</label><input id="pred-by" type="date" class="w-full"></div><div><label class="text-[8px] font-bold text-gray-500">DOMAIN</label><input id="pred-domain" type="text" placeholder="people/money/…" class="w-full"></div></div><button class="btn w-full p-2 text-[11px] bg-gold/10 border border-gold/40 text-gold font-bold" data-act="savePrediction"><i class="fas fa-stamp mr-1"></i>SEAL THE CLAIM</button></div>' + (resolved.length ? '<details class="text-[10px] text-gray-500"><summary class="cursor-pointer font-bold">GRADED RECORD (' + resolved.length + ")</summary>" + resolved.slice(0, 15).map((p) => '<div class="py-1 border-b border-line/40"><span class="' + (p.outcome === "right" ? "text-jade" : "text-red-400") + ' font-bold">' + p.outcome.toUpperCase() + "</span> · " + p.confidence + "% · " + esc(p.claim) + "</div>").join("") + "</details>" : "") + "</div>";
  }
  function predRow(p) {
    return '<div class="flex items-center gap-1.5 py-1 border-b border-line/40 last:border-0"><div class="flex-1 min-w-0"><p class="text-[10px] text-gray-300 truncate">' + esc(p.claim) + '</p><p class="text-[8px] text-gray-600">' + p.confidence + "% · by " + p.resolve_by + (p.domain ? " · " + esc(p.domain) : "") + '</p></div><button class="btn px-2 py-1 text-[9px] bg-emerald-900/60 border border-emerald-700 text-emerald-300" data-act="resolvePred" data-args="[' + p.id + ',&quot;right&quot;]">RIGHT</button><button class="btn px-2 py-1 text-[9px] bg-red-900/60 border border-red-800 text-red-300" data-act="resolvePred" data-args="[' + p.id + ',&quot;wrong&quot;]">WRONG</button><button class="btn px-1.5 py-1 text-[9px] bg-gray-800/60 border border-line text-gray-500" title="void (unfalsifiable/canceled)" data-act="resolvePred" data-args="[' + p.id + ',&quot;void&quot;]">—</button></div>';
  }
  async function savePrediction() {
    const claim = $("#pred-claim").value, confidence = Number($("#pred-conf").value), resolve_by = $("#pred-by").value, domain = $("#pred-domain").value;
    await api("post", "/api/predictions", { claim, confidence, resolve_by, domain });
    if (clearDrafts) clearDrafts(["pred-claim", "pred-conf", "pred-by", "pred-domain"]);
    FX.success();
    FX.toast("CLAIM SEALED — reality will grade it on " + resolve_by, "gold");
    await loadPredictions();
    render();
  }
  async function resolvePred(id, outcome) {
    await api("post", "/api/predictions/" + id + "/resolve", { outcome });
    FX.tap();
    await loadPredictions();
    render();
  }
  function viewStats() {
    const s = S.STATS;
    const avg = Math.round(s.days.reduce((a, d) => a + d.pct, 0) / s.days.length);
    const sleepDays = s.days.filter((d) => d.sleep != null);
    const avgSleep = sleepDays.length ? (sleepDays.reduce((a, d) => a + d.sleep, 0) / sleepDays.length).toFixed(1) : "—";
    const catName = { morning: "Morning", workout: "Exercise", deepwork: "Deep Work", study: "University", meal: "Meals", strategy: "Strategy", philosophy: "Philosophy", entertainment: "Entertainment", skincare: "Skincare", admin: "Admin", social: "Social", review: "Review", sleep: "Sleep", flex: "Recovery", rest: "Rest" };
    return header() + '<section id="stats-section" class="stagger"><div class="card-lux p-4 mb-3 flex items-center gap-4">' + FX.ring(avg, 84, 7, avg + "%", "ADHERENCE") + '<div class="flex-1"><p class="text-[9px] text-gray-500 font-bold tracking-[.2em]">THE LEDGER</p><p class="font-engraved font-bold text-lg gold-text">' + Math.max(S.STATE.points, 0) + ' PTS</p><p class="text-[10px] text-gray-500 mt-0.5">Fourteen-day weighted adherence on the left. No rank title: it only re-rendered these numbers.</p></div></div>' + (s.alternativeExplanations ? (function() {
      var ae = s.alternativeExplanations;
      var rate = ae.total ? Math.round(ae.nonePlausible / ae.total * 100) : 0;
      return '<div class="card p-3 mb-3 border-amber-800/40"><h3 class="text-[10px] font-bold tracking-widest text-amber-400 mb-1"><i class="fas fa-scale-balanced mr-1"></i>THE BRAKE — alternative explanations</h3><p class="text-xs text-gray-300">You logged <b>' + ae.total + '</b> alternative explanations on heated captures. <b class="' + (rate >= 50 ? "text-red-400" : "text-gray-300") + '">' + ae.nonePlausible + '</b> were "none plausible" (' + rate + '%).</p><p class="text-[10px] text-gray-500 mt-1">A rising none-plausible rate is the paranoia tell (Law 23). Low is good — it means you keep considering the charitable reading.</p></div>';
    })() : "") + (S.STATS.changelog && S.STATS.changelog.length ? '<div class="card p-3 mb-3"><h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2"><i class="fas fa-scroll mr-1"></i>HOW THE RULES CHANGED</h3>' + S.STATS.changelog.map(function(e) {
      return '<p class="text-[11px] text-gray-400 mb-1.5"><span class="text-gold font-bold">' + esc(e.date) + "</span> — " + esc(e.change) + "</p>";
    }).join("") + '<p class="text-[9px] text-gray-600 mt-1">The rules of your own game are visible. Nothing changes silently.</p></div>' : "") + '<div class="grid grid-cols-3 gap-2 mb-3"><div class="card-glass p-3 text-center"><p class="font-disp font-bold text-xl ' + (avg >= 80 ? "text-jade" : avg >= 50 ? "text-amber-400" : "text-red-400") + '" data-countup="' + avg + '">' + avg + '</p><p class="text-[8px] text-gray-500 font-bold tracking-widest">14-DAY ADH %</p></div><div class="card-glass p-3 text-center"><p class="font-disp font-bold text-xl text-sky-400">' + avgSleep + 'h</p><p class="text-[8px] text-gray-500 font-bold tracking-widest">AVG SLEEP</p></div><div class="card-glass p-3 text-center"><p class="font-disp font-bold text-xl text-rose-400">' + (s.unitStats.complete || 0) + "/" + (s.unitStats.total || 0) + '</p><p class="text-[8px] text-gray-500 font-bold tracking-widest">UNITS WON</p></div></div>' + (s.medals ? '<div class="card-lux p-3.5 mb-3"><div class="flex items-center justify-between mb-2"><h3 class="font-engraved font-bold text-xs gold-text"><i class="fas fa-medal mr-1"></i>MEDALS OF THE CAMPAIGN</h3><span class="pill pill-gold">' + s.medals.filter((m) => m.earned).length + " / " + s.medals.length + '</span></div><div class="grid grid-cols-3 gap-2">' + s.medals.map((m) => {
      const pct = m.goal ? Math.round(m.prog / m.goal * 100) : m.earned ? 100 : 0;
      return '<div class="text-center p-2 rounded-xl" style="' + (m.earned ? "background:linear-gradient(160deg,rgba(212,175,55,.14),rgba(212,175,55,.03));border:1px solid rgba(212,175,55,.4)" : "background:rgba(15,21,32,.6);border:1px solid var(--line);opacity:.55") + '"><i class="fas ' + m.icon + " text-lg mb-1 " + (m.earned ? "gold-text" : "text-gray-600") + '" ' + (m.earned ? 'style="filter:drop-shadow(0 0 8px rgba(212,175,55,.6))"' : "") + '></i><p class="text-[8px] font-bold tracking-wider ' + (m.earned ? "text-gold" : "text-gray-500") + '">' + m.title + '</p><p class="text-[7px] text-gray-600 leading-tight mt-0.5">' + m.desc + "</p>" + (m.goal && !m.earned ? '<div class="prog mt-1" style="height:3px"><div style="width:' + pct + '%"></div></div>' : "") + "</div>";
    }).join("") + "</div></div>" : "") + '<div class="card p-3 mb-3"><h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">LAST 14 DAYS (green = victory · blue = held the line)</h3><div class="flex items-end gap-1" style="height:70px">' + s.days.map((d) => '<div class="flex-1 flex flex-col items-center gap-0.5"><div class="w-full rounded-t" style="height:' + Math.max(d.pct, 3) * 0.6 + "px;background:" + (d.pct >= 80 && d.debrief ? "#22c55e" : d.mvdHeld ? "#3b82f6" : d.pct >= 50 ? "#f59e0b" : d.total === 0 ? "#1e2a3d" : "#dc2626") + '"></div><span class="text-[7px] text-gray-600">' + d.date.slice(8) + "</span></div>").join("") + '</div></div><div class="card p-3 mb-3"><h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">7-DAY OUTPUT BY FRONT</h3>' + (s.categories.length ? s.categories.map((cr) => {
      const pct = cr.total ? Math.round(cr.done / cr.total * 100) : 0;
      return '<div class="mb-1.5"><div class="flex justify-between text-[10px] mb-0.5"><span class="cat-' + cr.category + ' font-semibold">' + (catName[cr.category] || cr.category) + '</span><span class="text-gray-500">' + pct + '%</span></div><div class="prog"><div class="cat-' + cr.category + '" style="width:' + pct + '%;background:currentColor"></div></div></div>';
    }).join("") : '<p class="text-[11px] text-gray-500">No logs yet. Start checking off blocks.</p>') + '</div><div class="card p-3 mb-3"><h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">MIND FORGE</h3><p class="text-[11px] text-gray-400">Flashcard reviews: <span class="text-gold font-bold">' + (s.cardStats.reviews || 0) + '</span> · avg recall grade: <span class="text-gold font-bold">' + (s.cardStats.avg_grade ? Number(s.cardStats.avg_grade).toFixed(2) : "—") + "</span>/3</p>" + (s.flagCounts.length ? '<p class="text-[11px] text-gray-400 mt-1">Honesty flags all-time: ' + s.flagCounts.map((f) => '<span class="text-red-400">' + f.flag_type.replace(/_/g, " ") + " ×" + f.n + "</span>").join(" · ") + "</p>" : '<p class="text-[11px] text-jade mt-1">Zero honesty flags. Clean record, soldier.</p>') + '</div><div class="card p-3"><h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">POINTS LEDGER (latest)</h3>' + (s.ledger.slice(0, 25).map((l) => '<div class="flex gap-2 py-1 border-b border-line/40 last:border-0 text-[10px]"><span class="font-bold w-9 text-right ' + (l.points >= 0 ? "text-jade" : "text-red-400") + '">' + (l.points >= 0 ? "+" : "") + l.points + '</span><span class="text-gray-400 flex-1">' + esc(l.reason) + '</span><span class="text-gray-600 shrink-0">' + l.log_date.slice(5) + "</span></div>").join("") || '<p class="text-[11px] text-gray-500">Empty. Go earn.</p>') + "</div></section>";
  }
  registerActions({
    saveDebrief: () => saveDebrief(),
    redeem: (e, el, id) => redeem(id),
    savePrediction: () => savePrediction(),
    resolvePred: (e, el, id, outcome) => resolvePred(id, outcome)
  });
  const Alarm = {
    ctx: null,
    enabled: JSON.parse(localStorage.getItem("wr_alarm") || "true"),
    volume: Number(localStorage.getItem("wr_volume") || 0.9),
    fired: JSON.parse(localStorage.getItem("wr_fired") || "{}"),
    init() {
      const unlock = () => {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === "suspended") this.ctx.resume();
        document.removeEventListener("touchstart", unlock);
        document.removeEventListener("click", unlock);
      };
      document.addEventListener("touchstart", unlock);
      document.addEventListener("click", unlock);
      if ("Notification" in window && Notification.permission === "default") {
        setTimeout(() => Notification.requestPermission(), 3e3);
      }
      setInterval(() => this.tick(), 6e4);
      setTimeout(() => this.tick(), 4e3);
    },
    /* LUXURY GRAND CHIME — concert-hall bell synthesis.
       Each strike = fundamental + inharmonic bell partials (×2.76, ×5.4, ×8.9 like a real bronze bell),
       soft attack, long exponential decay, warm lowpass, subtle stereo shimmer + hall reverb tail. */
    _bell(ctx, master, freq, when, vel, dur) {
      const partials = [
        [1, 1, dur],
        // hum / prime
        [2, 0.42, dur * 0.82],
        // octave
        [2.76, 0.28, dur * 0.6],
        // minor-third bell partial
        [5.4, 0.12, dur * 0.38],
        // shimmer
        [8.93, 0.05, dur * 0.22]
        // sparkle
      ];
      for (const [ratio, amp, d] of partials) {
        const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        o.type = "sine";
        o.frequency.value = freq * ratio;
        if (ratio > 2) o.detune.setValueAtTime((Math.random() - 0.5) * 6, when);
        g.gain.setValueAtTime(1e-4, when);
        g.gain.exponentialRampToValueAtTime(vel * amp, when + 0.012);
        g.gain.exponentialRampToValueAtTime(vel * amp * 0.35, when + d * 0.25);
        g.gain.exponentialRampToValueAtTime(1e-4, when + d);
        if (p) {
          p.pan.value = ratio > 2 ? (Math.random() - 0.5) * 0.5 : 0;
          o.connect(g);
          g.connect(p);
          p.connect(master);
        } else {
          o.connect(g);
          g.connect(master);
        }
        o.start(when);
        o.stop(when + d + 0.05);
      }
    },
    ring(times = 3) {
      if (!this.ctx) {
        try {
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
          return;
        }
      }
      const ctx = this.ctx;
      if (ctx.state === "suspended") ctx.resume();
      const t0 = ctx.currentTime + 0.03;
      const master = ctx.createGain();
      master.gain.value = Math.min(this.volume, 0.9);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 5200;
      lp.Q.value = 0.6;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 24;
      comp.ratio.value = 5;
      comp.attack.value = 4e-3;
      comp.release.value = 0.3;
      master.connect(lp);
      lp.connect(comp);
      comp.connect(ctx.destination);
      const motif = [392, 493.88, 587.33, 783.99];
      const gap = 0.34, phrase = motif.length * gap + 1.6;
      for (let r = 0; r < times; r++) {
        const base = t0 + r * phrase;
        motif.forEach((f, i) => this._bell(ctx, master, f, base + i * gap, 0.5 - i * 0.06 + (i === motif.length - 1 ? 0.18 : 0), i === motif.length - 1 ? 3.2 : 1.6));
        this._bell(ctx, master, 196, base + (motif.length - 1) * gap, 0.22, 3.4);
      }
      if (navigator.vibrate) navigator.vibrate([180, 90, 180, 90, 420]);
    },
    notify(title, body, tag = "warroom-block") {
      if (!("Notification" in window)) return;
      if (Notification.permission === "default") {
        Notification.requestPermission();
        return;
      }
      if (Notification.permission !== "granted") return;
      const opts = {
        body,
        icon: "/static/icon.svg",
        badge: "/static/icon.svg",
        vibrate: [180, 90, 180, 90, 420],
        tag,
        renotify: true,
        requireInteraction: true,
        silent: false,
        timestamp: Date.now(),
        data: { url: "/" },
        actions: [{ action: "open", title: "⚔ REPORT FOR DUTY" }]
      };
      try {
        navigator.serviceWorker?.ready?.then((reg) => reg.showNotification(title, opts)).catch(() => {
          try {
            new Notification(title, { body, icon: "/static/icon.svg" });
          } catch (_) {
          }
        });
      } catch (e) {
        try {
          new Notification(title, { body });
        } catch (_) {
        }
      }
    },
    tick() {
      if (!this.enabled || !S.STATE) return;
      const t = nowTime();
      const today = todayStr();
      for (const b of S.STATE.blocks || []) {
        const key = today + "-" + b.id;
        if (b.start_time === t && !this.fired[key]) {
          this.fired[key] = 1;
          localStorage.setItem("wr_fired", JSON.stringify(this.fired));
          this.ring(3);
          this.notify("⚔ " + b.start_time + " — " + b.title, (b.is_non_negotiable ? "NON-NEGOTIABLE. " : "") + (b.description || "The block has started. Move."));
          this.banner(b);
        }
      }
      const prevMissed = new Set((S.STATE.blocks || []).filter((b) => b.log_status === "missed").map((b) => b.id));
      refreshIfStale().then(() => {
        for (const b of S.STATE.blocks || []) {
          if (b.log_status === "missed" && !prevMissed.has(b.id)) {
            const mkey = today + "-missed-" + b.id;
            if (!this.fired[mkey]) {
              this.fired[mkey] = 1;
              localStorage.setItem("wr_fired", JSON.stringify(this.fired));
              this.notify("✖ CANCELED — " + b.title, "Window closed unlogged. The block is gone and the penalty is on your ledger. — Law 2: The plan is law.", "warroom-missed");
              if (FX) FX.toast("✖ “" + b.title + "” AUTO-CANCELED — PENALTY APPLIED", "bad");
              if (navigator.vibrate) navigator.vibrate([500, 120, 500]);
            }
          }
        }
        if (S.TAB === "now" || S.TAB === "today") render();
      }).catch(() => {
      });
    },
    banner(b) {
      const el = document.createElement("div");
      el.className = "fixed inset-x-2 top-2 z-[200] card border-gold p-4 gold-glow fade-in";
      el.innerHTML = '<p class="text-[10px] font-bold tracking-[.2em] text-gold">⚔ BATTLE STATIONS — ' + b.start_time + '</p><p class="font-disp font-bold text-lg">' + esc(b.title) + '</p><p class="text-xs text-gray-400">' + esc(b.description || "") + '</p><div class="flex gap-2 mt-2"><button class="btn flex-1 p-2 bg-gold/20 border border-gold/50 text-gold text-xs font-bold" data-act="dismissHome">REPORTING FOR DUTY</button><button class="btn p-2 bg-gray-800 text-gray-400 text-xs border border-line" data-act="dismissClosest">✕</button></div>';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 12e4);
    },
    toggle() {
      this.enabled = !this.enabled;
      localStorage.setItem("wr_alarm", JSON.stringify(this.enabled));
      toast(this.enabled ? "War horns armed. No block will pass you unaware." : "War horns silenced. (Device calendar alarms still active if you exported.)", !this.enabled);
      render();
    }
  };
  Alarm.init();
  async function loadLibrary() {
    S.LIBRARY = (await axios.get("/api/library")).data;
  }
  function viewLibrary() {
    if (S.BOOK) return viewReader();
    return header() + '<section id="library-section" class="stagger"><p class="text-[10px] text-gray-500 mb-3">Official public-domain translations (Giles, Marriott, Long, Jowett, Common, Zimmern, Graham). The full actual books — every word, offline-cached after first read.</p><div class="card-glass p-3.5 mb-3"><h3 class="text-[10px] font-bold tracking-[.2em] text-gold mb-1"><i class="fas fa-bell"></i> ALARMS & ENGAGEMENT</h3><div class="flex items-center justify-between py-1.5"><span class="text-xs">War-horn alarm at every block start</span><button class="btn px-3 py-1 text-[11px] font-bold ' + (Alarm.enabled ? "bg-emerald-800 text-emerald-100" : "bg-gray-800 text-gray-500 border border-line") + '" data-act="alarmToggle">' + (Alarm.enabled ? "ARMED" : "OFF") + '</button></div><div class="flex items-center justify-between py-1.5"><span class="text-xs">Test the war horn</span><button class="btn px-3 py-1 text-[11px] font-bold bg-gold/20 border border-gold/50 text-gold" data-act="alarmRing">SOUND IT</button></div><div class="flex items-center justify-between py-1.5"><span class="text-xs pr-2">Push alarms (primary — the server pushes even when the app is closed)</span><button class="btn px-3 py-1 text-[11px] font-bold bg-sky-900/60 border border-sky-700 text-sky-200 shrink-0" data-act="enablePush">ENABLE</button></div><p class="text-[9px] text-gray-600 mt-1">Honest limit: push wakes this app on Android and desktop even when it is closed. On iPhone it only rings if you add the war room to your home screen (iOS 16.4+) — a tab in Safari will not. The in-page war horn needs the app open; the calendar export is the layer that always rings.</p><div class="flex items-center justify-between py-1.5"><span class="text-xs pr-2">Device calendar + native alarms (rings even when app is closed)</span><a class="btn px-3 py-1 text-[11px] font-bold bg-indigo-900/60 border border-indigo-700 text-indigo-200 shrink-0" href="/calendar.ics" download>EXPORT .ICS</a></div><p class="text-[9px] text-gray-600 mt-1">Import warroom.ics into Google Calendar / iPhone Calendar once — every block becomes a repeating native event with a 2-min-before alert. That is the bulletproof layer: your phone itself becomes the war horn.</p></div><div class="sect">THE ARSENAL — ' + S.LIBRARY.length + " COMPLETE TEXTS</div>" + S.LIBRARY.map((b) => {
      const total = b.chapters || 0;
      const pct = total ? Math.round(b.chaptersDone / total * 100) : 0;
      const finished = total > 0 && b.chaptersDone >= total;
      return '<button class="' + (finished ? "card-lux" : "card") + ' w-full p-3.5 mb-2 text-left flex items-center gap-3" data-act="openBook" data-args="[&quot;' + b.id + '&quot;]"><div class="w-10 h-12 rounded-md flex items-center justify-center shrink-0" style="background:linear-gradient(160deg,' + (b.phase === "PHIL" ? "#1e1b4b,#0f0d26" : "#4c0519,#1c0208") + ");border:1px solid " + (b.phase === "PHIL" ? "rgba(129,140,248,.35)" : "rgba(244,63,94,.35)") + ';box-shadow:inset 0 1px 0 rgba(255,255,255,.08)">' + (finished ? '<i class="fas fa-crown text-gold"></i>' : '<i class="fas fa-book ' + (b.phase === "PHIL" ? "text-indigo-400" : "text-rose-400") + '"></i>') + '</div><div class="flex-1 min-w-0"><p class="text-sm font-bold ' + (finished ? "gold-text" : "text-white") + '">' + esc(b.title) + '</p><p class="text-[10px] text-gray-500 mb-1">' + esc(b.author) + ' · <span class="pill ' + (b.phase === "PHIL" ? "bg-indigo-950 text-indigo-300" : "bg-rose-950 text-rose-300") + '">' + b.phase + '</span></p><div class="prog" style="height:5px"><div style="width:' + pct + '%"></div></div></div><div class="text-right shrink-0"><p class="font-disp font-bold ' + (finished ? "text-gold" : "text-gray-300") + '">' + b.chaptersDone + '<span class="text-gray-600 text-[10px]">/' + total + '</span></p><p class="text-[8px] text-gray-600 font-bold tracking-widest">' + (finished ? "CONQUERED" : pct + "%") + "</p></div></button>";
    }).join("") + "</section>";
  }
  async function openBook(id) {
    toast("Opening the real text…");
    S.BOOK = (await axios.get("/static/books/" + id + ".json")).data;
    S.BOOK_ID = id;
    const lib = S.LIBRARY.find((x) => x.id === id);
    S.CHAP_IDX = lib && lib.currentChapter != null ? lib.currentChapter : 0;
    render();
    window.scrollTo(0, 0);
  }
  function viewReader() {
    const ch = S.BOOK.chapters[S.CHAP_IDX];
    const chPct = Math.round((S.CHAP_IDX + 1) / S.BOOK.chapters.length * 100);
    return '<header class="flex items-center gap-2 mb-1 sticky top-0 py-2 z-40" style="background:linear-gradient(180deg,var(--ink-1) 75%,transparent)"><button class="btn btn-ghost px-3 py-2 text-xs" data-act="closeBook"><i class="fas fa-arrow-left"></i></button><div class="flex-1 min-w-0"><p class="text-xs font-bold truncate text-white">' + esc(S.BOOK.title) + '</p><p class="text-[9px] text-gray-500">' + esc(S.BOOK.author) + " · tr. " + esc(S.BOOK.translator) + '</p></div><select class="!w-auto text-xs" data-act-change="chapSelect">' + S.BOOK.chapters.map((c, i) => '<option value="' + i + '" ' + (i === S.CHAP_IDX ? "selected" : "") + ">" + esc(c.title.slice(0, 40)) + "</option>").join("") + '</select></header><div class="prog mb-4" style="height:4px"><div style="width:' + chPct + '%"></div></div><article id="reader" class="fade-in px-1"><div class="text-center mb-5"><p class="text-[9px] text-gray-600 font-bold tracking-[.3em] mb-1">CHAPTER ' + (S.CHAP_IDX + 1) + " OF " + S.BOOK.chapters.length + '</p><h2 class="font-engraved font-bold text-lg gold-text">' + esc(ch.title) + '</h2><div class="mx-auto mt-2" style="width:80px;height:1px;background:linear-gradient(90deg,transparent,var(--gold),transparent)"></div></div>' + ch.paras.map((p, i) => '<p class="text-[13.5px] leading-[1.85] text-gray-300 mb-3.5" style="text-align:justify">' + (i === 0 ? '<span class="font-engraved text-2xl gold-text float-left mr-1.5 leading-none mt-0.5">' + esc(p.charAt(0)) + "</span>" + esc(p.slice(1)) : esc(p)) + "</p>").join("") + '<div class="card-lux p-4 my-5 text-center"><button class="btn btn-gold w-full p-3 text-sm" data-act="finishChapter"><i class="fas fa-check mr-1"></i> CHAPTER CONQUERED (+20) → NEXT</button><p class="text-[9px] text-gray-600 mt-2">Slow reading is deep reading. Mark done only when you truly finished — the honesty engine trusts you here.</p></div></article>';
  }
  async function finishChapter() {
    await api("post", "/api/library/" + S.BOOK_ID + "/chapter/" + S.CHAP_IDX, { status: "done", date: todayStr() });
    FX.confetti({ count: 60 });
    FX.toast("CHAPTER CONQUERED  +20", "gold");
    if (S.CHAP_IDX < S.BOOK.chapters.length - 1) {
      S.CHAP_IDX++;
      await api("post", "/api/library/" + S.BOOK_ID + "/chapter/" + S.CHAP_IDX, { status: "reading" });
      render();
      window.scrollTo(0, 0);
    } else {
      FX.confetti({ count: 180 });
      FX.toast("📕 BOOK COMPLETE — " + S.BOOK.title + " is now inside you", "gold");
      S.BOOK = null;
      await loadLibrary();
      render();
    }
  }
  registerActions({
    dismissHome: (e, el) => {
      const d = el.closest("div.fixed");
      if (d) d.remove();
      S.TAB = "now";
      render();
    },
    dismissClosest: (e, el) => {
      const d = el.closest("div.fixed");
      if (d) d.remove();
    },
    alarmToggle: () => Alarm.toggle(),
    alarmRing: () => Alarm.ring(2),
    askNotify: () => Notification.requestPermission().then((p) => toast(p === "granted" ? "Notifications armed." : "Denied — enable in browser settings.", p !== "granted")),
    openBook: (e, el, id) => openBook(id),
    closeBook: () => {
      FX.tap();
      S.BOOK = null;
      loadLibrary().then(render);
    },
    chapSelect: (e, el) => {
      S.CHAP_IDX = Number(el.value);
      render();
      window.scrollTo(0, 0);
    },
    finishChapter: () => finishChapter()
  });
  function urlBase64ToUint8Array(base64) {
    const padding = "=".repeat((4 - base64.length % 4) % 4);
    const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast("This browser cannot do push. Use the calendar export.", true);
      return;
    }
    let key;
    try {
      key = (await axios.get("/api/push/key")).data.publicKey;
    } catch (_) {
      toast("Push is not configured on the server yet — use the calendar export.", true);
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast("Denied — enable notifications in browser settings.", true);
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key)
      });
      const raw = subscription.toJSON();
      await api("post", "/api/push/subscribe", {
        endpoint: raw.endpoint,
        p256dh: raw.keys.p256dh,
        auth: raw.keys.auth,
        device_label: "this device"
      });
      FX.success && FX.success();
      toast("Push armed. The server will wake this device.");
    } catch (_) {
      toast("Could not arm push — the calendar export still works.", true);
    }
  }
  registerActions({ enablePush: () => enablePush() });
  function viewMind() {
    return header() + '<section id="mind-section" class="fade-in"><div class="flex gap-2 mb-3"><button class="btn flex-1 p-2 text-xs font-bold ' + (S.MIND_MODE === "cards" ? "bg-gold/20 border border-gold/50 text-gold" : "bg-panel border border-line text-gray-400") + '" data-act="setMindMode" data-args="[&quot;cards&quot;]"><i class="fas fa-layer-group mr-1"></i>DRILL (' + S.DUE.length + ' due)</button><button class="btn flex-1 p-2 text-xs font-bold ' + (S.MIND_MODE === "bank" ? "bg-gold/20 border border-gold/50 text-gold" : "bg-panel border border-line text-gray-400") + '" data-act="setMindMode" data-args="[&quot;bank&quot;]"><i class="fas fa-book-skull mr-1"></i>MAXIM BANK</button></div>' + (S.MIND_MODE === "cards" ? viewCards() : viewBank()) + "</section>";
  }
  function viewCards() {
    if (!S.DUE.length) return '<div class="card-lux p-6 text-center"><i class="fas fa-check-double text-3xl text-jade mb-2" style="filter:drop-shadow(0 0 12px rgba(34,197,94,.5))"></i><p class="font-disp font-bold text-lg text-white">ALL PRINCIPLES DRILLED</p><p class="text-[11px] text-gray-500 mt-1">Spaced repetition is scheduling the next ambush. Come back tomorrow — this is how at-your-fingertips is built, rep by rep.</p></div>';
    if (S.CARD_IDX >= S.DUE.length) S.CARD_IDX = 0;
    const c = S.DUE[S.CARD_IDX];
    const pct = Math.round(S.CARD_IDX / S.DUE.length * 100);
    let h = '<div class="flex items-center gap-2 mb-2"><div class="prog flex-1"><div style="width:' + pct + '%"></div></div><span class="text-[10px] text-gray-500 font-bold">' + (S.CARD_IDX + 1) + "/" + S.DUE.length + '</span></div><p class="text-[10px] text-gray-500 text-center mb-2 tracking-wider">RECALL THE MASTER READING BEFORE FLIPPING</p><div class="flip-card mb-3" data-act="flipCard"><div class="flip-inner ' + (S.CARD_FLIP ? "flipped" : "") + '" style="min-height:230px"><div class="flip-face card-lux gold-glow p-5 flex flex-col justify-center text-center" style="min-height:230px"><p class="pill pill-dim mx-auto mb-3">' + esc(c.source) + '</p><p class="font-engraved font-bold text-base leading-snug text-white">“' + esc(c.principle) + '”</p><p class="text-[10px] text-gray-500 mt-4"><i class="fas fa-hand-pointer"></i> tap to reveal readings</p></div><div class="flip-back card p-4 overflow-y-auto" style="min-height:230px"><p class="text-[9px] font-bold tracking-widest text-red-400">NAIVE READING (the trap)</p><p class="text-[11px] text-gray-400 mb-2">' + esc(c.naive_reading) + '</p><p class="text-[9px] font-bold tracking-widest text-gold">MASTER READING</p><p class="text-[11px] text-gray-200 mb-2">' + esc(c.master_reading) + "</p>" + (c.my_words ? '<p class="text-[9px] font-bold tracking-widest text-emerald-400">YOUR WORDS</p><p class="text-[11px] text-emerald-200/80">' + esc(c.my_words) + "</p>" : "") + "</div></div></div>";
    if (S.CARD_FLIP) h += '<div class="grid grid-cols-4 gap-1.5"><button class="btn p-2.5 bg-red-900/70 border border-red-700 text-red-200 text-[11px] font-bold" data-act="gradeCard" data-args="[' + c.maxim_id + ',0]">FAIL</button><button class="btn p-2.5 bg-orange-900/70 border border-orange-700 text-orange-200 text-[11px] font-bold" data-act="gradeCard" data-args="[' + c.maxim_id + ',1]">HARD</button><button class="btn p-2.5 bg-emerald-900/70 border border-emerald-700 text-emerald-200 text-[11px] font-bold" data-act="gradeCard" data-args="[' + c.maxim_id + ',2]">GOOD</button><button class="btn p-2.5 bg-sky-900/70 border border-sky-700 text-sky-200 text-[11px] font-bold" data-act="gradeCard" data-args="[' + c.maxim_id + ',3]">EASY</button></div>';
    return h;
  }
  async function gradeCard(mid, g) {
    await api("post", "/api/cards/" + mid + "/review", { grade: g, date: todayStr() });
    if (g === 0) {
      FX.fail();
      toast("Failed card returns soon. Sun Tzu: know yourself — including what you do not know yet.", true);
    } else FX.tap();
    S.DUE.splice(S.CARD_IDX, 1);
    S.CARD_FLIP = false;
    if (!S.DUE.length) {
      FX.confetti({ count: 70 });
      FX.toast("DRILL SESSION COMPLETE — all principles rehearsed", "gold");
    }
    render();
  }
  function viewBank() {
    const groups = {};
    S.MAXIMS.forEach((m) => {
      (groups[m.source] = groups[m.source] || []).push(m);
    });
    let h = '<div class="card p-3 mb-3"><h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2"><i class="fas fa-plus text-gold"></i> ADD YOUR OWN MAXIM (from your reading)</h3><input id="nm-src" placeholder="Source (e.g. Sun Tzu Ch.4)" class="mb-1.5"><input id="nm-p" placeholder="The principle / quote" class="mb-1.5"><input id="nm-naive" placeholder="Naive reading (the trap)" class="mb-1.5"><input id="nm-master" placeholder="Master reading (the extraction)" class="mb-1.5"><input id="nm-mine" placeholder="In YOUR words (this is where ownership happens)" class="mb-1.5"><button class="btn w-full p-2 bg-gold/20 border border-gold/50 text-gold text-xs font-bold" data-act="addMaxim">DEPOSIT INTO BANK → creates flashcard</button></div>';
    for (const src of Object.keys(groups)) {
      const list = groups[src];
      h += '<h3 class="font-disp font-bold text-sm text-gold mt-3 mb-1.5">' + esc(src) + ' <span class="text-gray-500 text-[10px]">(' + list.length + ")</span></h3>";
      h += list.map((m) => '<article class="card p-3 mb-2"><p class="text-xs font-semibold leading-snug mb-1.5">"' + esc(m.principle) + '"</p><p class="text-[10px]"><span class="text-red-400 font-bold">✗</span> <span class="text-gray-500">' + esc(m.naive_reading) + '</span></p><p class="text-[10px] mt-0.5"><span class="text-gold font-bold">✓</span> <span class="text-gray-300">' + esc(m.master_reading) + "</span></p>" + (m.my_words ? '<p class="text-[10px] mt-0.5"><span class="text-emerald-400 font-bold">✍</span> <span class="text-emerald-200/80">' + esc(m.my_words) + "</span></p>" : '<button class="text-[10px] text-gray-500 underline mt-1" data-act="ownWords" data-args="[' + m.id + ']">+ rewrite in my own words</button>') + "</article>").join("");
    }
    return h;
  }
  async function addMaxim() {
    const b = { source: $("#nm-src").value, principle: $("#nm-p").value, naive_reading: $("#nm-naive").value, master_reading: $("#nm-master").value, my_words: $("#nm-mine").value };
    if (!b.source || !b.principle) {
      toast("Source and principle required.", true);
      return;
    }
    await api("post", "/api/maxims", b);
    S.MAXIMS = (await axios.get("/api/maxims")).data;
    S.DUE = (await axios.get("/api/cards/due?date=" + todayStr())).data;
    toast("Maxim deposited. Flashcard forged.");
    render();
  }
  async function ownWords(id) {
    const w = prompt("Rewrite this principle in YOUR OWN words (own words = ownership):");
    if (!w) return;
    await api("post", "/api/maxims/" + id + "/my-words", { my_words: w });
    S.MAXIMS = (await axios.get("/api/maxims")).data;
    render();
  }
  registerActions({
    setMindMode: (e, el, mode) => {
      S.MIND_MODE = mode;
      render();
    },
    flipCard: (e, el) => {
      FX.tap();
      S.CARD_FLIP = !S.CARD_FLIP;
      render();
    },
    gradeCard: (e, el, mid, g) => gradeCard(mid, g),
    addMaxim: () => addMaxim(),
    ownWords: (e, el, id) => ownWords(id)
  });
  const TG_CATS = [
    ["deflection", "fa-shield-halved", "Deflection", "Dodge probes without lying"],
    ["wit", "fa-bolt", "Wit", "Sharp, memorable comebacks"],
    ["power", "fa-chess-king", "Power", "Frame control & authority"],
    ["mystery", "fa-mask", "Unreadable", "Reveal nothing, stay interesting"],
    ["boundaries", "fa-hand", "Boundaries", "Graceful, unmovable NO"],
    ["praise", "fa-gem", "Praise & Grace", "Elegant compliments/receiving"],
    ["conflict", "fa-fire", "Conflict", "De-escalate & dominate calmly"],
    ["small_talk", "fa-mug-hot", "Small Talk", "Turn trivia into presence"],
    ["negotiation", "fa-scale-balanced", "Negotiation", "Positioning & leverage"],
    ["silence", "fa-volume-xmark", "Silence", "When NOT to speak"]
  ];
  const TG_CAT = Object.fromEntries(TG_CATS.map((c) => [c[0], c]));
  const TG_MASTERY = {
    new: ["NEW", "#8b98ab", "fa-seedling", "Just captured — not yet in your head"],
    learning: ["LEARNING", "#60a5fa", "fa-book-open", "Forming — 3+ solid recalls"],
    memorized: ["MEMORIZED", "#f59e0b", "fa-brain", "In memory — survives a week"],
    ingrained: ["INGRAINED", "#d4af37", "fa-anchor", "Long-term — survives 3 weeks"],
    reflex: ["REFLEX", "#22c55e", "fa-bolt-lightning", "Yours forever — fires without thinking"]
  };
  const TG_MODES = {
    recall: ["fa-comments", "SITUATION DRILL", "You are IN the situation. The question comes at you. Speak your line OUT LOUD, then reveal."],
    cloze: ["fa-puzzle-piece", "FILL THE GAPS", "Key words are redacted. Reconstruct the exact line, then reveal."],
    first_letters: ["fa-font", "FIRST LETTERS", "Only first letters remain. Rebuild the full response word-for-word."],
    reverse: ["fa-arrows-rotate", "REVERSE", "You see YOUR line. Name the situation & question it answers — proves deep binding."],
    delivery: ["fa-masks-theater", "DELIVERY REP", "Say it out loud 3× — vary tone: calm, amused, cold. Rate your fluency honestly."]
  };
  async function loadTongue() {
    const [stats, due] = await Promise.all([
      axios.get("/api/tongue/stats?date=" + todayStr()).then((r) => r.data),
      axios.get("/api/tongue/due?date=" + todayStr()).then((r) => r.data)
    ]);
    S.TG.stats = stats;
    S.TG.due = due;
    if (S.TG.view === "armory" || S.TG.list === null) {
      S.TG.list = (await axios.get("/api/tongue?category=" + S.TG.filter + (S.TG.search ? "&q=" + encodeURIComponent(S.TG.search) : ""))).data;
    }
  }
  function tgCloze(text) {
    const words = text.split(/\s+/);
    return words.map((w, i) => {
      const core = w.replace(/[^A-Za-z']/g, "");
      if (core.length >= 4 && (i % 3 === 1 || core.length >= 8))
        return `<span class="px-1 rounded" style="background:rgba(212,175,55,.15);color:transparent;border-bottom:1px dashed rgba(212,175,55,.5)">${"_".repeat(Math.min(core.length, 10))}</span>`;
      return esc(w);
    }).join(" ");
  }
  function tgFirstLetters(text) {
    return text.split(/\s+/).map((w) => {
      const m = w.match(/^([A-Za-z])(.*)$/);
      return m ? `<b class="text-gold">${m[1]}</b><span class="text-gray-600">${"·".repeat(Math.max(1, Math.min(m[2].replace(/[^A-Za-z']/g, "").length, 8)))}</span>` : esc(w);
    }).join(" ");
  }
  function tgMasteryPill(m) {
    const [label, color, ic] = TG_MASTERY[m] || TG_MASTERY.new;
    return `<span class="pill" style="background:${color}18;color:${color};border:1px solid ${color}55"><i class="fas ${ic} text-[8px]"></i>${label}</span>`;
  }
  function tgCatPill(cat) {
    const c = TG_CAT[cat] || TG_CAT.wit;
    return `<span class="pill bg-gray-800/80 text-gray-300 border border-line"><i class="fas ${c[1]} text-[8px]"></i>${c[2].toUpperCase()}</span>`;
  }
  function viewTongue() {
    const s = S.TG.stats || {};
    const mastered = (s.byMastery || []).filter((x) => ["memorized", "ingrained", "reflex"].includes(x.mastery)).reduce((a, x) => a + x.n, 0);
    const reflex = ((s.byMastery || []).find((x) => x.mastery === "reflex") || {}).n || 0;
    const pct = s.total ? Math.round(mastered / s.total * 100) : 0;
    return header() + `
  <section id="tongue-section" class="stagger">
    <div class="card-lux p-4 mb-3 flex items-center gap-4">
      ${FX.ring(pct, 84, 7, mastered, "OF " + (s.total || 0))}
      <div class="flex-1">
        <h2 class="font-engraved font-bold text-sm gold-text"><i class="fas fa-comment-dots mr-1"></i>THE TONGUE</h2>
        <p class="text-[10px] text-gray-500 leading-relaxed mt-1">Every wise line you capture gets drilled into long-term memory until it fires as <b class="text-jade">reflex</b> — no scripts, no phone, just you.</p>
        <p class="text-[10px] mt-1"><span class="text-gold font-bold">${reflex}</span> <span class="text-gray-500">at reflex ·</span> <span class="text-sky-400 font-bold">${s.captured7 || 0}</span> <span class="text-gray-500">captured this week</span></p>
      </div>
    </div>

    <div class="flex gap-1.5 mb-3">
      ${[["today", "fa-crosshairs", "TRAIN"], ["capture", "fa-plus", "CAPTURE"], ["armory", "fa-box-archive", "ARMORY"], ["exam", "fa-graduation-cap", "EXAM"]].map(([v, ic, l]) => `
        <button class="btn flex-1 py-2 text-[10px] font-bold tracking-wider ${S.TG.view === v ? "bg-gold/15 text-gold border border-gold/40" : "bg-panel text-gray-400 border border-line"}"
          data-act="tgView" data-args="${actArgs([v])}"><i class="fas ${ic} mr-1"></i>${l}</button>`).join("")}
    </div>

    ${S.TG.view === "today" ? tgToday() : S.TG.view === "capture" ? tgCapture() : S.TG.view === "armory" ? tgArmory() : tgExamView()}
  </section>`;
  }
  async function tgRefresh() {
    try {
      await loadTongue();
    } catch (_) {
    }
    render();
  }
  function tgToday() {
    const s = S.TG.stats || {}, due = S.TG.due || [];
    if (S.TG.drill) return tgDrillCard();
    const ladder = ["new", "learning", "memorized", "ingrained", "reflex"].map((m) => {
      const n = ((s.byMastery || []).find((x) => x.mastery === m) || {}).n || 0;
      const [label, color, ic] = TG_MASTERY[m];
      return `<div class="text-center flex-1">
      <i class="fas ${ic} text-sm" style="color:${color}"></i>
      <p class="font-disp font-bold text-base" style="color:${color}">${n}</p>
      <p class="text-[8px] tracking-wider text-gray-500">${label}</p>
    </div>`;
    }).join('<div class="text-gray-700 self-center">→</div>');
    return `
    ${due.length ? `
    <button class="btn w-full p-4 mb-3 bg-gold/10 border border-gold/40 text-gold font-bold text-sm" data-act="tgStartDrill">
      <i class="fas fa-dumbbell mr-1"></i> ${due.length} RESPONSE${due.length > 1 ? "S" : ""} DUE — DRILL THE ARMORY NOW
    </button>` : `
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
        <p class="font-disp font-bold text-lg text-white">${s.reviews7 || 0}</p>
        <p class="text-[9px] text-gray-500 tracking-wider">DRILLS THIS WEEK</p>
      </div>
      <div class="flex-1 text-center border-r border-line">
        <p class="font-disp font-bold text-lg ${s.reviews7 && s.solid7 / s.reviews7 >= 0.8 ? "text-jade" : "text-amber-400"}">${s.reviews7 ? Math.round(s.solid7 / s.reviews7 * 100) : 0}%</p>
        <p class="text-[9px] text-gray-500 tracking-wider">SOLID RECALL</p>
      </div>
      <div class="flex-1 text-center">
        <p class="font-disp font-bold text-lg ${s.weekExamDone ? "text-jade" : "text-red-400"}">${s.weekExamDone ? "DONE" : "DUE"}</p>
        <p class="text-[9px] text-gray-500 tracking-wider">WEEKLY EXAM</p>
      </div>
    </div>

    ${!s.weekExamDone && s.total >= 3 ? `
    <button class="btn w-full p-3 mb-3 bg-red-950/40 border border-red-800/50 text-red-300 text-xs font-bold" data-act="tgExamView">
      <i class="fas fa-graduation-cap mr-1"></i> WEEKLY EXAM NOT TAKEN — FACE IT (pass ≥80% or take the flag)
    </button>` : ""}

    <div class="card p-4">
      <h3 class="text-[10px] font-bold tracking-[.18em] text-gray-400 mb-2"><i class="fas fa-ear-listen text-gold mr-1"></i>THE DAILY HUNT</h3>
      <p class="text-[11px] text-gray-400 leading-relaxed">Wherever you are — office, movie, podcast, street — when someone answers a question in a way that makes them <b class="text-gold">unreadable, respected, clever</b>: pull out the phone. Capture the <b class="text-white">situation</b>, the exact <b class="text-white">question</b>, and the exact <b class="text-white">response</b>. Then this engine makes it permanently yours.</p>
    </div>`;
  }
  function tgCapture() {
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
          ${TG_CATS.map((c) => `<option value="${c[0]}">${c[2]} — ${c[3]}</option>`).join("")}
        </select>
      </div>
    </div>
    <button class="btn btn-gold w-full p-3 text-sm font-bold" data-act="tgSave"><i class="fas fa-vault mr-1"></i> LOCK IT IN THE ARMORY (+3 pts)</button>
    <p class="text-[9px] text-gray-600 mt-2 text-center">It enters the drill queue immediately — first drill today.</p>
  </div>`;
  }
  async function tgSave() {
    const v = (id) => document.getElementById(id).value;
    try {
      await api("post", "/api/tongue", { situation: v("tg-sit"), trigger_q: v("tg-q"), response: v("tg-r"), why_works: v("tg-why"), source: v("tg-src"), category: v("tg-cat") });
      FX.success();
      FX.toast("CAPTURED. The line is in the armory — now make it yours.", "gold");
      S.TG.list = null;
      await loadTongue();
      S.TG.view = "today";
      render();
    } catch (e) {
      FX.fail();
    }
  }
  function tgStartDrill() {
    S.TG.drill = S.TG.due.slice();
    S.TG.drillIdx = 0;
    S.TG.drillReveal = false;
    S.TG.drillSession = { done: 0, fluent: 0 };
    render();
  }
  function tgDrillCard() {
    const list = S.TG.drill;
    if (S.TG.drillIdx >= list.length) {
      const s = S.TG.drillSession;
      setTimeout(() => {
        if (s.done > 0 && s.fluent / s.done >= 0.7) FX.confetti({ count: 90 });
      }, 200);
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
    const mode = r.drill_mode || "recall";
    const [mIc, mLabel, mHint] = TG_MODES[mode];
    let challenge = "";
    if (!S.TG.drillReveal) {
      if (mode === "recall") challenge = `
      <div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
        <p class="text-[9px] font-bold tracking-widest text-gray-500 mb-1">SITUATION</p>
        <p class="text-xs text-gray-300 leading-relaxed">${esc(r.situation)}</p>
      </div>
      <div class="p-3 rounded-lg bg-black/30 border border-sky-900/50 mb-2">
        <p class="text-[9px] font-bold tracking-widest text-sky-500 mb-1">THEY ASK YOU</p>
        <p class="text-sm text-white font-semibold leading-relaxed">“${esc(r.trigger_q)}”</p>
      </div>
      <p class="text-[10px] text-gold text-center font-bold tracking-wider mt-3 mb-1">⟡ SPEAK YOUR LINE OUT LOUD — THEN REVEAL ⟡</p>`;
      else if (mode === "cloze") challenge = `
      <div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
        <p class="text-[9px] font-bold tracking-widest text-sky-500 mb-1">“${esc(r.trigger_q)}”</p>
      </div>
      <div class="p-3 rounded-lg bg-black/30 border border-gold/30 mb-2">
        <p class="text-[9px] font-bold tracking-widest text-gold mb-1">YOUR LINE — GAPS REDACTED</p>
        <p class="text-sm leading-relaxed text-gray-300">${tgCloze(r.response)}</p>
      </div>`;
      else if (mode === "first_letters") challenge = `
      <div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
        <p class="text-[9px] font-bold tracking-widest text-sky-500 mb-1">“${esc(r.trigger_q)}”</p>
      </div>
      <div class="p-3 rounded-lg bg-black/30 border border-gold/30 mb-2">
        <p class="text-[9px] font-bold tracking-widest text-gold mb-1">FIRST LETTERS ONLY — REBUILD IT WORD-FOR-WORD</p>
        <p class="text-sm leading-loose">${tgFirstLetters(r.response)}</p>
      </div>`;
      else if (mode === "reverse") challenge = `
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
      ${r.why_works ? `<div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
        <p class="text-[9px] font-bold tracking-widest text-jade mb-1">WHY IT WORKS</p>
        <p class="text-[11px] text-gray-400 leading-relaxed">${esc(r.why_works)}</p>
      </div>` : ""}`;
    }
    return `
  <div class="card-lux p-4 mb-3">
    <div class="flex items-center justify-between mb-2">
      <span class="pill bg-gold/10 text-gold border border-gold/40"><i class="fas ${mIc} text-[8px]"></i>${mLabel}</span>
      <span class="text-[10px] text-gray-500 font-bold">${S.TG.drillIdx + 1} / ${list.length}</span>
    </div>
    <div class="prog mb-3"><div style="width:${Math.round(S.TG.drillIdx / list.length * 100)}%"></div></div>
    <div class="flex gap-1.5 mb-3">${tgMasteryPill(r.mastery)}${tgCatPill(r.category)}${r.source ? `<span class="pill bg-gray-900 text-gray-500 border border-line">${esc(r.source).slice(0, 18)}</span>` : ""}</div>
    <p class="text-[10px] text-gray-500 mb-3 leading-relaxed"><i class="fas fa-circle-info mr-1"></i>${mHint}</p>
    ${challenge}
    ${!S.TG.drillReveal ? `
    <button class="btn btn-gold w-full p-3 mt-2 text-sm font-bold" data-act="tgDrillReveal"><i class="fas fa-eye mr-1"></i> REVEAL THE LINE</button>` : `
    <p class="text-[10px] font-bold tracking-widest text-gray-400 text-center mt-3 mb-2">HONEST GRADE — HOW DID IT FIRE?</p>
    <div class="grid grid-cols-4 gap-1.5">
      <button class="btn p-2.5 bg-red-950/60 border border-red-800/60 text-red-300 text-[10px] font-bold" data-act="tgGrade" data-args="${actArgs([r.id, 0, mode])}">BLANK<br><span class="text-[8px] opacity-70">reset</span></button>
      <button class="btn p-2.5 bg-amber-950/60 border border-amber-800/60 text-amber-300 text-[10px] font-bold" data-act="tgGrade" data-args="${actArgs([r.id, 1, mode])}">SHAKY<br><span class="text-[8px] opacity-70">soon</span></button>
      <button class="btn p-2.5 bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-[10px] font-bold" data-act="tgGrade" data-args="${actArgs([r.id, 2, mode])}">SOLID<br><span class="text-[8px] opacity-70">later</span></button>
      <button class="btn p-2.5 bg-gold/15 border border-gold/50 text-gold text-[10px] font-bold" data-act="tgGrade" data-args="${actArgs([r.id, 3, mode])}">FLUENT<br><span class="text-[8px] opacity-70">far</span></button>
    </div>`}
  </div>`;
  }
  async function tgGrade(id, grade, mode) {
    try {
      const res = await api("post", `/api/tongue/${id}/review`, { grade, mode, date: todayStr() });
      S.TG.drillSession.done++;
      if (grade === 3) S.TG.drillSession.fluent++;
      if (grade === 0) FX.fail();
      else if (grade === 3) FX.success();
      else FX.tap();
      if (res.promoted) {
        FX.confetti({ count: 70 });
        FX.toast("⬆ PROMOTED TO " + res.promoted.toUpperCase() + " — this line is becoming part of you", "gold");
      }
    } catch (e) {
    }
    S.TG.drillIdx++;
    S.TG.drillReveal = false;
    render();
  }
  function tgArmory() {
    const list = S.TG.list || [];
    return `
  <div class="flex gap-1.5 mb-2">
    <input id="tg-search" class="flex-1 bg-black/30 border border-line rounded-lg px-3 py-2 text-xs" placeholder="Search situations, questions, lines…" value="${esc(S.TG.search)}"
      data-act-change="tgSearch">
    <button class="btn px-3 bg-panel border border-line text-gray-400 text-xs" data-act="tgSearchClear"><i class="fas fa-xmark"></i></button>
  </div>
  <div class="flex gap-1 mb-3 overflow-x-auto pb-1" style="scrollbar-width:none">
    <button class="pill shrink-0 ${S.TG.filter === "all" ? "bg-gold/15 text-gold border border-gold/40" : "bg-gray-900 text-gray-400 border border-line"}" data-act="tgFilter" data-args="${actArgs(["all"])}">ALL</button>
    ${TG_CATS.map((c) => `<button class="pill shrink-0 ${S.TG.filter === c[0] ? "bg-gold/15 text-gold border border-gold/40" : "bg-gray-900 text-gray-400 border border-line"}" data-act="tgFilter" data-args="${actArgs([c[0]])}"><i class="fas ${c[1]} text-[8px]"></i>${c[2].toUpperCase()}</button>`).join("")}
  </div>
  ${list.length === 0 ? `<div class="card p-5 text-center"><i class="fas fa-box-open text-2xl text-gray-600 mb-2"></i><p class="text-xs text-gray-500">Armory ${S.TG.search || S.TG.filter !== "all" ? "has no match" : "is empty"}. ${!S.TG.search && S.TG.filter === "all" ? "Capture your first wise line — the hunt starts today." : ""}</p></div>` : ""}
  ${list.map((r) => `
  <article class="card p-3 mb-2">
    <div class="flex gap-1.5 mb-1.5 flex-wrap">${tgMasteryPill(r.mastery)}${tgCatPill(r.category)}
      <span class="text-[9px] text-gray-600 ml-auto self-center">${r.correct_reviews || 0}✓ · ${r.lapses || 0}✗ · every ${r.interval_days || 0}d</span></div>
    <p class="text-[10px] text-gray-500 leading-relaxed mb-1"><i class="fas fa-location-dot text-[8px] mr-1"></i>${esc(r.situation)}</p>
    <p class="text-[11px] text-sky-300 mb-1">“${esc(r.trigger_q)}”</p>
    <p class="text-xs text-white font-semibold leading-relaxed">→ “${esc(r.response)}”</p>
    ${r.why_works ? `<p class="text-[10px] text-gray-500 mt-1 italic">${esc(r.why_works)}</p>` : ""}
    <div class="flex gap-2 mt-2 items-center">
      ${r.source ? `<span class="text-[9px] text-gray-600"><i class="fas fa-film text-[8px] mr-0.5"></i>${esc(r.source)}</span>` : ""}
      <button class="btn ml-auto px-2.5 py-1 text-[10px] bg-gray-900 text-gray-500 border border-line" data-act="tgDelete" data-args="${actArgs([r.id])}"><i class="fas fa-trash text-[9px]"></i></button>
    </div>
  </article>`).join("")}`;
  }
  async function tgDelete(id) {
    if (!confirm("Retire this line from the armory? Its training history is kept.")) return;
    await api("delete", "/api/tongue/" + id);
    FX.tap();
    S.TG.list = null;
    await loadTongue();
    render();
  }
  function tgExamView() {
    const s = S.TG.stats || {};
    if (!S.TG.exam) {
      return `
    <div class="card-lux p-4 mb-3">
      <h3 class="font-engraved font-bold text-sm gold-text mb-2"><i class="fas fa-graduation-cap mr-1"></i>THE WEEKLY TONGUE EXAM</h3>
      <p class="text-[11px] text-gray-400 leading-relaxed mb-2">10 random lines from your armory. For each: the situation and question appear — <b class="text-white">speak your exact line out loud</b>, reveal, and judge yourself with ruthless honesty. <b class="text-gold">Pass ≥ 80%</b>. Fail = honesty flag + −10 pts. This is where you prove the armory lives in your head, not in the app.</p>
      ${s.total < 3 ? `<p class="text-[10px] text-amber-400"><i class="fas fa-triangle-exclamation mr-1"></i>You need at least 3 trained lines before an exam makes sense. Capture and drill first.</p>` : `<button class="btn btn-gold w-full p-3 text-sm font-bold" data-act="tgStartExam"><i class="fas fa-swords mr-1"></i> BEGIN THE EXAM</button>`}
    </div>
    ${s.exams && s.exams.length ? `
    <div class="card p-3">
      <h4 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">EXAM RECORD</h4>
      ${s.exams.map((e) => `
        <div class="flex items-center gap-2 py-1.5 border-b border-line/50 last:border-0">
          <i class="fas ${e.passed ? "fa-circle-check text-jade" : "fa-circle-xmark text-red-400"}"></i>
          <span class="text-xs text-gray-300 flex-1">${e.exam_date}</span>
          <span class="font-disp font-bold text-sm ${e.passed ? "text-jade" : "text-red-400"}">${e.score_pct}%</span>
          <span class="text-[9px] text-gray-600">${e.correct}/${e.total}</span>
        </div>`).join("")}
    </div>` : ""}`;
    }
    const list = S.TG.exam;
    if (S.TG.examIdx >= list.length) {
      const pct = Math.round(S.TG.examCorrect / list.length * 100);
      return `<div class="card-lux p-6 text-center">
      <i class="fas ${pct >= 80 ? "fa-trophy gold-text" : "fa-skull text-red-400"} text-3xl mb-2"></i>
      <h3 class="font-engraved font-bold text-xl ${pct >= 80 ? "gold-text" : "text-red-400"}">${pct >= 80 ? "EXAM PASSED" : "EXAM FAILED"}</h3>
      <p class="font-disp font-bold text-3xl mt-1 ${pct >= 80 ? "text-jade" : "text-red-400"}">${pct}%</p>
      <p class="text-xs text-gray-400 mt-1">${S.TG.examCorrect} / ${list.length} lines fired correctly</p>
      <p class="text-[10px] text-gray-500 mt-2">${pct >= 80 ? "+25 pts. The armory is in your head." : "−10 pts + flag filed. Drill the failures and retake."}</p>
      <button class="btn btn-gold mt-3 px-6 py-2 text-xs font-bold" data-act="tgFinishExam" data-args="${actArgs([list.length])}">SEAL THE RECORD</button>
    </div>`;
    }
    const q = list[S.TG.examIdx];
    return `
  <div class="card-lux p-4">
    <div class="flex items-center justify-between mb-2">
      <span class="pill pill-blood"><i class="fas fa-graduation-cap text-[8px]"></i>EXAM</span>
      <span class="text-[10px] text-gray-500 font-bold">${S.TG.examIdx + 1} / ${list.length}</span>
    </div>
    <div class="prog mb-3"><div style="width:${Math.round(S.TG.examIdx / list.length * 100)}%"></div></div>
    <div class="p-3 rounded-lg bg-black/30 border border-line mb-2">
      <p class="text-[9px] font-bold tracking-widest text-gray-500 mb-1">SITUATION</p>
      <p class="text-xs text-gray-300">${esc(q.situation)}</p>
    </div>
    <div class="p-3 rounded-lg bg-black/30 border border-sky-900/50 mb-2">
      <p class="text-[9px] font-bold tracking-widest text-sky-500 mb-1">THEY ASK YOU</p>
      <p class="text-sm text-white font-semibold">“${esc(q.trigger_q)}”</p>
    </div>
    ${!S.TG.examReveal ? `
    <p class="text-[10px] text-gold text-center font-bold tracking-wider my-3">⟡ SPEAK YOUR EXACT LINE OUT LOUD ⟡</p>
    <button class="btn btn-gold w-full p-3 text-sm font-bold" data-act="tgExamReveal"><i class="fas fa-eye mr-1"></i> REVEAL & JUDGE</button>` : `
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
  async function tgStartExam() {
    try {
      S.TG.exam = (await axios.get("/api/tongue/exam")).data;
    } catch (_) {
      FX.toast("Could not load the exam — try again.", "bad");
      return;
    }
    if (!S.TG.exam.length) {
      FX.toast("No trained lines yet — drill first.", "bad");
      S.TG.exam = null;
      return;
    }
    S.TG.examIdx = 0;
    S.TG.examReveal = false;
    S.TG.examCorrect = 0;
    render();
  }
  function tgExamAnswer(ok) {
    if (ok) {
      S.TG.examCorrect++;
      FX.success();
    } else FX.fail();
    S.TG.examIdx++;
    S.TG.examReveal = false;
    render();
  }
  async function tgFinishExam(total) {
    const res = await api("post", "/api/tongue/exam/submit", { total, correct: S.TG.examCorrect, date: todayStr() });
    if (res.passed) {
      FX.confetti({ count: 140 });
      FX.victory && FX.victory();
    }
    S.TG.exam = null;
    await loadTongue();
    await loadState();
    render();
  }
  registerActions({
    tgView: (e, el, v) => {
      S.TG.view = v;
      tgRefresh();
    },
    tgExamView: () => {
      S.TG.view = "exam";
      render();
    },
    tgStartDrill: () => tgStartDrill(),
    tgSave: () => tgSave(),
    tgRefresh: () => tgRefresh(),
    tgDrillReveal: () => {
      S.TG.drillReveal = true;
      FX.tap();
      render();
    },
    tgGrade: (e, el, id, grade, mode) => tgGrade(id, grade, mode),
    tgSearch: (e, el) => {
      S.TG.search = el.value;
      tgRefresh();
    },
    tgSearchClear: () => {
      S.TG.search = "";
      tgRefresh();
    },
    tgFilter: (e, el, f) => {
      S.TG.filter = f;
      tgRefresh();
    },
    tgDelete: (e, el, id) => tgDelete(id),
    tgStartExam: () => tgStartExam(),
    tgFinishExam: (e, el, total) => tgFinishExam(total),
    tgExamReveal: () => {
      S.TG.examReveal = true;
      FX.tap();
      render();
    },
    tgExamAnswer: (e, el, ok) => tgExamAnswer(ok)
  });
  const renderExtra = async function(tab) {
    const face = S.SUB[tab];
    if (tab === "learn") {
      if (face === "books") {
        if (!S.LIBRARY) await loadLibrary();
        shell(segments(tab) + viewLibrary());
      } else {
        if (!S.CAMPAIGN) S.CAMPAIGN = (await axios.get("/api/campaign")).data;
        shell(segments(tab) + viewCampaign());
      }
    } else if (tab === "practice") {
      if (face === "tongue") {
        await loadTongue();
        shell(segments(tab) + viewTongue());
      } else {
        if (!S.DUE) S.DUE = (await axios.get("/api/cards/due?date=" + todayStr())).data;
        if (!S.MAXIMS) S.MAXIMS = (await axios.get("/api/maxims")).data;
        S.MIND_MODE = face === "maxims" ? "bank" : "cards";
        shell(segments(tab) + viewMind());
      }
    } else if (tab === "review") {
      if (face === "stats") {
        S.STATS = (await axios.get("/api/stats?date=" + todayStr())).data;
        try {
          S.STATS.changelog = (await axios.get("/api/changelog")).data;
        } catch (_) {
          S.STATS.changelog = [];
        }
        shell(segments(tab) + viewStats());
      } else {
        if (!S.DEBRIEFS) S.DEBRIEFS = (await axios.get("/api/debriefs")).data;
        shell(segments(tab) + viewDebrief());
      }
    } else if (tab === "more") {
      if (!S.INTEL) S.INTEL = (await axios.get("/api/intel")).data;
      if (!S.HERMES_HIST) S.HERMES_HIST = (await axios.get("/api/hermes/history")).data;
      if (face === "settings") {
        if (!S.LIBRARY) await loadLibrary();
        shell(segments(tab) + viewLibrary());
      } else {
        S.COUNCIL_MODE = face === "intel" ? "intel" : "hermes";
        shell(segments(tab) + viewCouncil());
      }
    }
  };
  const UST = { locked: ["LOCKED", "bg-gray-800 text-gray-500"], active: ["ACTIVE", "bg-gold/20 text-gold"], reading_done: ["READING OK", "bg-sky-950 text-sky-300"], drill_done: ["DRILL OK", "bg-emerald-950 text-emerald-300"], complete: ["CONQUERED", "bg-emerald-800 text-emerald-100"] };
  function viewCampaign() {
    const totalUnits = S.CAMPAIGN.reduce((a, p) => a + p.total, 0);
    const totalDone = S.CAMPAIGN.reduce((a, p) => a + p.complete, 0);
    const warPct = totalUnits ? Math.round(totalDone / totalUnits * 100) : 0;
    return header() + '<section id="campaign-section" class="stagger"><div class="card-lux p-4 mb-3 flex items-center gap-4">' + FX.ring(warPct, 84, 7, totalDone, "OF " + totalUnits) + '<div class="flex-1"><h2 class="font-engraved font-bold text-sm gold-text">THE CAMPAIGN</h2><p class="text-[10px] text-gray-500 leading-relaxed mt-1">Progress-locked. Unit N opens only when N−1 falls. No calendar pressure — depth is the weapon.</p></div></div>' + S.CAMPAIGN.map((p) => {
      const trackColor = p.track === "strategy" ? "#f43f5e" : "#818cf8";
      const phaseDone = p.complete === p.total && p.total > 0;
      return '<article class="' + (phaseDone ? "card-lux" : "card") + ' p-3.5 mb-3"><div class="flex items-center justify-between mb-1"><h3 class="font-disp font-bold text-sm tracking-wide" style="color:' + trackColor + '">' + (phaseDone ? "🏆 " : "") + esc(p.title) + '</h3><span class="pill ' + (phaseDone ? "pill-gold" : "pill-dim") + '">' + p.complete + " / " + p.total + '</span></div><p class="text-[10px] text-gray-500 mb-2">' + esc(p.subtitle || "") + '</p><div class="prog mb-2"><div style="width:' + p.progress + '%"></div></div>' + p.units.map((u) => {
        const st = UST[u.status] || UST.locked;
        const open = S.OPEN_UNIT === u.id;
        const isActive = ["active", "reading_done", "drill_done"].includes(u.status);
        const icon = u.status === "locked" ? "fa-lock text-gray-600" : u.status === "complete" ? "fa-flag text-emerald-400" : u.is_exam ? "fa-shield-halved text-gold" : "fa-location-dot text-gold";
        return '<div class="border-t border-line/50 py-2 ' + (isActive ? '-mx-2 px-2 rounded-lg" style="background:rgba(212,175,55,.05)' : "") + '"><button class="w-full flex items-center gap-2 text-left" data-act="toggleUnit" data-args="[' + u.id + ']" ' + (u.status === "locked" ? "disabled" : "") + '><i class="fas ' + icon + " text-xs w-4 " + (isActive ? "animate-pulse" : "") + '"></i><span class="text-xs flex-1 ' + (u.status === "locked" ? "text-gray-600" : "") + " " + (u.status === "complete" ? "line-through text-gray-500" : "") + '">' + esc(u.title) + '</span><span class="pill ' + st[1] + '">' + st[0] + "</span></button>" + (open && u.status !== "locked" ? unitDetail(u) : "") + "</div>";
      }).join("") + "</article>";
    }).join("") + "</section>";
  }
  function unitDetail(u) {
    const ex = u.exam_questions ? JSON.parse(u.exam_questions) : null;
    let h = '<div class="mt-2 pl-6 fade-in">';
    if (u.reading) h += '<div class="mb-2"><p class="text-[9px] font-bold tracking-widest text-sky-400"><i class="fas fa-book"></i> READING</p><p class="text-xs text-gray-300">' + esc(u.reading) + "</p></div>";
    if (u.lesson) h += '<div class="mb-2"><p class="text-[9px] font-bold tracking-widest text-gold"><i class="fas fa-chess-knight"></i> THE LESSON</p><p class="text-xs text-gray-300 leading-relaxed">' + esc(u.lesson) + "</p></div>";
    if (u.field_drill) h += '<div class="mb-2"><p class="text-[9px] font-bold tracking-widest text-emerald-400"><i class="fas fa-person-running"></i> FIELD DRILL</p><p class="text-xs text-gray-300 leading-relaxed">' + esc(u.field_drill) + "</p></div>";
    if (u.debrief_prompt) h += '<div class="mb-2"><p class="text-[9px] font-bold tracking-widest text-fuchsia-400"><i class="fas fa-moon"></i> NIGHT DEBRIEF PROMPT</p><p class="text-xs text-gray-300 italic">' + esc(u.debrief_prompt) + "</p></div>";
    if (u.drill_report) h += '<div class="mb-2 card p-2"><p class="text-[9px] font-bold text-emerald-500">YOUR DRILL REPORT</p><p class="text-[11px] text-gray-400">' + nl2br(u.drill_report) + "</p></div>";
    if (u.status !== "complete") {
      h += u.is_exam ? examForm(u, ex) : stepForm(u);
    } else h += '<p class="text-[10px] text-emerald-400 font-bold"><i class="fas fa-flag"></i> CONQUERED ' + (u.completed_at ? u.completed_at.slice(0, 10) : "") + (u.exam_self_score != null ? " · exam " + u.exam_self_score + "/100" : "") + "</p>";
    return h + "</div>";
  }
  function stepForm(u) {
    if (u.status === "active") return '<button class="btn w-full p-2.5 bg-sky-900/60 border border-sky-700 text-sky-200 text-xs font-bold" data-act="unitStep" data-args="[' + u.id + ',&quot;reading&quot;]"><i class="fas fa-book mr-1"></i> I FINISHED THE READING (twice, pen in hand)</button>';
    if (u.status === "reading_done") return '<p class="text-[10px] font-bold text-emerald-400 mb-1">NOW: EXECUTE THE FIELD DRILL, THEN REPORT:</p><textarea id="drill-report-' + u.id + '" rows="4" placeholder="What did you actually DO? What happened? Be specific — thin reports are rejected by the honesty engine."></textarea><button class="btn w-full p-2.5 mt-1.5 bg-emerald-900/60 border border-emerald-700 text-emerald-200 text-xs font-bold" data-act="unitStep" data-args="[' + u.id + ',&quot;drill&quot;]"><i class="fas fa-person-running mr-1"></i> FILE DRILL REPORT</button>';
    if (u.status === "drill_done") return '<textarea id="debrief-ans-' + u.id + '" rows="2" placeholder="(Optional) Answer the debrief prompt above in 1-3 sentences"></textarea><button class="btn w-full p-2.5 mt-1.5 bg-gold/20 border border-gold/50 text-gold text-xs font-bold" data-act="unitStep" data-args="[' + u.id + ',&quot;complete&quot;]"><i class="fas fa-flag mr-1"></i> CONQUER UNIT → UNLOCK NEXT</button>';
    return "";
  }
  function examForm(u, qs) {
    return '<div class="card p-3 border-gold/40"><p class="text-[10px] font-bold tracking-widest text-gold mb-2"><i class="fas fa-shield-halved"></i> INTEGRATION EXAM — write from memory FIRST, then verify. Pass: 70/100 self-graded, brutally.</p>' + qs.map((q, i) => '<div class="mb-2"><p class="text-[11px] text-gray-300 font-semibold mb-1">Q' + (i + 1) + ". " + esc(q) + '</p><textarea id="exam-' + u.id + "-" + i + '" rows="3" placeholder="Your answer..."></textarea></div>').join("") + '<label class="text-[11px] text-gray-400 font-semibold">Brutal self-score (0-100): fluff = fail</label><input type="number" id="exam-score-' + u.id + '" min="0" max="100" placeholder="e.g. 75"><button class="btn w-full p-2.5 mt-2 bg-gold/20 border border-gold/50 text-gold text-xs font-bold" data-act="submitExam" data-args="[' + u.id + "," + qs.length + ']"><i class="fas fa-gavel mr-1"></i> SUBMIT EXAM FOR JUDGMENT</button></div>';
  }
  function toggleUnit(id) {
    S.OPEN_UNIT = S.OPEN_UNIT === id ? null : id;
    render();
  }
  async function unitStep(id, step) {
    const payload = { step, date: todayStr() };
    if (step === "drill") payload.drill_report = ($("#drill-report-" + id) || {}).value || "";
    if (step === "complete") {
      const el = $("#debrief-ans-" + id);
      if (el) payload.debrief_answer = el.value;
    }
    await api("post", "/api/units/" + id + "/step", payload);
    if (step === "complete") {
      FX.confetti({ count: 110 });
      FX.toast("UNIT CONQUERED — NEXT FRONT UNLOCKED  +50", "gold");
    } else if (step === "drill") {
      FX.success();
      toast("Drill report filed. +30 pts.");
    } else toast("Reading logged. +20 pts. Now: the field drill.");
    S.CAMPAIGN = (await axios.get("/api/campaign")).data;
    await loadState();
    render();
  }
  async function submitExam(id, n) {
    const answers = [];
    for (let i = 0; i < n; i++) answers.push(($("#exam-" + id + "-" + i) || {}).value || "");
    if (answers.some((a) => a.trim().length < 10)) {
      toast("Empty or one-line answers detected. This exam deserves real effort — the gate stays closed.", true);
      return;
    }
    const score = Number(($("#exam-score-" + id) || {}).value || 0);
    const r = await api("post", "/api/units/" + id + "/step", { step: "complete", exam_answers: answers, exam_self_score: score, date: todayStr() });
    if (r.failed) {
      FX.fail();
      toast(r.message, true);
    } else {
      FX.confetti({ count: 160 });
      FX.toast("EXAM PASSED — PHASE GATE OPENED  +100", "gold");
    }
    S.CAMPAIGN = (await axios.get("/api/campaign")).data;
    await loadState();
    render();
  }
  registerActions({
    toggleUnit: (e, el, id) => toggleUnit(id),
    unitStep: (e, el, id, step) => unitStep(id, step),
    submitExam: (e, el, id, n) => submitExam(id, n)
  });
  const $$1 = (s) => document.querySelector(s);
  const app = () => $$1("#app");
  const newRequestId = () => {
    if (crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "");
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  axios.interceptors.request.use((config) => {
    const method = String(config.method || "get").toLowerCase();
    const url = new URL(config.url || "/", location.origin);
    const mutating = !["get", "head", "options"].includes(method);
    if (S.CSRF_TOKEN && url.origin === location.origin && mutating) {
      config.headers = config.headers || {};
      config.headers["X-CSRF-Token"] = S.CSRF_TOKEN;
    }
    if (url.origin === location.origin && mutating) {
      config.headers = config.headers || {};
      if (!config.headers["X-Request-Id"]) {
        config.headers["X-Request-Id"] = newRequestId();
      }
    }
    return config;
  });
  const todayStr = () => {
    const d = /* @__PURE__ */ new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const nowTime = () => {
    const d = /* @__PURE__ */ new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const CAT_ICON = {
    morning: "fa-sun",
    workout: "fa-dumbbell",
    deepwork: "fa-crosshairs",
    study: "fa-graduation-cap",
    meal: "fa-utensils",
    strategy: "fa-chess-knight",
    philosophy: "fa-book-open",
    entertainment: "fa-gamepad",
    skincare: "fa-droplet",
    admin: "fa-list-check",
    social: "fa-people-group",
    review: "fa-pen-nib",
    sleep: "fa-moon",
    flex: "fa-wind",
    rest: "fa-leaf"
  };
  async function api(method, url, data) {
    try {
      const r = await axios({ method, url, data });
      return r.data;
    } catch (e) {
      if (e?.response?.status === 401 && e?.response?.data?.error === "AUTH REQUIRED") {
        renderLogin();
        throw e;
      }
      const msg = e?.response?.data?.error || "Request failed";
      toast(msg, true);
      throw e;
    }
  }
  registerActions({
    doLogin: (e, el, isSetup) => doLogin(isSetup),
    ackFlag: (e, el, id) => ackFlag(id),
    appealBlock: (e, el, id, date, title) => appealBlock(id, date, title),
    logBlock: (e, el, id, status) => logBlock(id, status, e),
    runCatchup: () => runCatchup(),
    answerLR: (e, el, id, v) => answerLR(id, v),
    loadLaws: () => loadLaws(),
    checkLaw: (e, el, id, kept) => checkLaw(id, kept),
    logRecovery: () => logRecovery(),
    setTab: (e, el, tab) => {
      S.TAB = tab;
      render();
    },
    setSub: (e, el, tab, face) => {
      S.SUB[tab] = face;
      render();
    },
    dismissId: (e, el, id) => {
      const t = document.getElementById(id);
      if (t) t.remove();
    }
  });
  const TONE_LINES = {
    no_targets: {
      neutral: "No targets were set last night.",
      firm: "No targets were set last night. Set tonight’s three in the debrief.",
      military: "No targets on record for today. Set three tonight.",
      compassionate: "Last night ended without targets. It happens - set three tonight so tomorrow starts with a direction."
    },
    day_open: {
      neutral: "The day is in progress.",
      firm: "The day is in progress. The mandatory set is what counts.",
      military: "Day in progress. Hold the mandatory set.",
      compassionate: "The day is in progress - the mandatory set is all that is being asked of you."
    }
  };
  function toneLine(key, tone) {
    const entry = TONE_LINES[key];
    if (!entry) return "";
    return entry[tone] || entry.firm;
  }
  function renderLogin(isSetup) {
    FX.killSplash && FX.killSplash();
    app().innerHTML = `
  <main class="max-w-lg mx-auto px-4 min-h-screen flex flex-col justify-center" id="login-screen">
    <div class="text-center mb-6">
      <div class="text-4xl mb-2">⚔</div>
      <h1 class="font-engraved gold-text text-2xl font-bold">WAR ROOM</h1>
      <p class="text-[10px] tracking-[.3em] text-gray-500 font-semibold mt-1">${isSetup ? "SET THE GATE PASSWORD" : "IDENTIFY YOURSELF"}</p>
    </div>
    <div class="card-lux p-5">
      <input id="login-pass" type="password" placeholder="${isSetup ? "New password (min 8 chars)" : "Password"}" autocomplete="${isSetup ? "new-password" : "current-password"}"
        class="w-full bg-ink border border-line rounded-lg px-3 py-3 text-sm mb-3" data-act-enter="doLogin" data-args="${actArgs([!!isSetup])}">
      <button class="btn w-full p-3 bg-gold/15 border border-gold/50 text-gold font-bold text-sm" data-act="doLogin" data-args="${actArgs([!!isSetup])}">
        <i class="fas fa-key mr-1"></i>${isSetup ? "SEAL THE GATE" : "ENTER"}
      </button>
      <p class="text-[10px] text-gray-600 mt-3 text-center">${isSetup ? "This password protects everything — the whole command post sits behind it. There is no recovery. Write it somewhere real." : "The war room admits its commander only."}</p>
    </div>
  </main>`;
    setTimeout(() => {
      const el = $$1("#login-pass");
      if (el) el.focus();
    }, 50);
  }
  async function doLogin(isSetup) {
    const pass = $$1("#login-pass").value;
    try {
      const auth = await axios.post(isSetup ? "/api/auth/setup" : "/api/auth/login", { password: pass });
      S.CSRF_TOKEN = auth.data.csrfToken;
      FX.success && FX.success();
      await loadState();
      render();
    } catch (e) {
      toast(e?.response?.data?.error || "Login failed", true);
    }
  }
  function toast(msg, bad = false) {
    FX.toast(msg, bad ? "bad" : "ok");
  }
  async function loadState() {
    const body = S.TZ_SENT ? {} : { tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null };
    S.STATE = (await axios.post("/api/tick", body)).data;
    S.TZ_SENT = true;
  }
  function tabBadge(id) {
    const s = S.STATE;
    if (!s) return 0;
    if (id === "today") return s.flags.length;
    if (id === "practice") return (s.dueCards || 0) + (s.dueTongue || 0);
    if (id === "review") return s.debriefDoneToday ? 0 : (/* @__PURE__ */ new Date()).getHours() >= 20 ? 1 : 0;
    return 0;
  }
  const SEGMENTS = {
    today: [["now", "NOW"], ["schedule", "SCHEDULE"]],
    learn: [["campaign", "CAMPAIGN"], ["books", "BOOKS"]],
    practice: [["cards", "CARDS"], ["maxims", "MAXIMS"], ["tongue", "TONGUE"]],
    review: [["debrief", "DEBRIEF"], ["stats", "STATS"]],
    more: [["council", "COUNCIL"], ["intel", "INTEL"], ["settings", "SETTINGS"]]
  };
  function segments(tab) {
    const faces = SEGMENTS[tab] || [];
    if (faces.length < 2) return "";
    const active = S.SUB[tab];
    return '<div class="flex gap-1.5 mb-3" id="tab-segments">' + faces.map(function(f) {
      const on = f[0] === active;
      return '<button class="btn flex-1 p-2 text-[11px] font-bold ' + (on ? "bg-gold/20 border border-gold/50 text-gold" : "bg-panel border border-line text-gray-400") + '" data-act="setSub" data-args="' + actArgs([tab, f[0]]) + '" data-seg="' + f[0] + '">' + f[1] + "</button>";
    }).join("") + "</div>";
  }
  function shell(content) {
    const tabs = [
      ["today", "fa-crosshairs", "TODAY"],
      ["learn", "fa-chess-board", "LEARN"],
      ["practice", "fa-brain", "PRACTICE"],
      ["review", "fa-chart-line", "REVIEW"],
      ["more", "fa-ellipsis", "MORE"]
    ];
    const markup = `
    <main id="app-main" class="max-w-lg mx-auto px-3 pt-3 pb-28">${content}</main>
    <nav class="tabbar flex max-w-lg mx-auto" id="main-nav">
      ${tabs.map(([id, ic, label]) => {
      const badge = tabBadge(id);
      return `
        <button class="tab-btn ${S.TAB === id ? "active" : ""}" data-tab="${id}">
          ${badge ? `<span class="tab-badge">${badge > 9 ? "9+" : badge}</span>` : ""}
          <i class="fas ${ic}"></i>${label}
        </button>`;
    }).join("")}
    </nav>`;
    morphInto(app(), markup);
    document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => {
      FX.tap();
      S.TAB = b.dataset.tab;
      render();
      window.scrollTo({ top: 0 });
    });
    FX.countUpAll();
  }
  function header() {
    const s = S.STATE;
    const flagCount = s.flags.length;
    return `
  <header class="mb-3">
    <div class="flex items-center justify-between mb-2.5">
      <div>
        <h1 class="font-engraved font-bold text-lg gold-text">⚔ WAR ROOM</h1>
        <p class="text-[10px] text-gray-500 tracking-wide">${(/* @__PURE__ */ new Date()).toDateString()}</p>
      </div>
      <div class="text-right">
        <span class="rank-plate"><i class="fas fa-coins"></i> ${Math.max(s.points, 0)} PTS</span>
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
      <div class="card-glass px-2 py-2 ${flagCount ? "sev-critical" : ""}">
        <div class="font-disp font-bold text-lg leading-none ${flagCount ? "text-red-400" : "text-jade"}">${flagCount ? flagCount : "✓"}</div>
        <div class="text-[8px] text-gray-500 font-bold tracking-[.18em] mt-1">FLAGS</div>
      </div>
    </div>
  </header>`;
  }
  function flagsPanel() {
    if (!S.STATE.flags.length) return "";
    return `
  <section id="honesty-flags" class="mb-3 fade-in">
    <h2 class="font-disp font-bold text-sm tracking-widest text-red-400 mb-1.5"><i class="fas fa-triangle-exclamation"></i> HONESTY ENGINE — UNRESOLVED</h2>
    ${S.STATE.flags.map((f) => `
      <article class="card sev-${f.severity} p-3 mb-2">
        <p class="text-xs leading-relaxed text-gray-300">${esc(f.message)}</p>
        <button class="btn mt-2 text-[11px] px-3 py-1.5 bg-gray-800 text-gray-300 border border-line" data-act="ackFlag" data-args="${actArgs([f.id])}">
          <i class="fas fa-check mr-1"></i>ACKNOWLEDGED — I OWN IT
        </button>
      </article>`).join("")}
  </section>`;
  }
  async function ackFlag(id) {
    await api("post", `/api/flags/${id}/ack`);
    await loadState();
    render();
  }
  function statusBtns(b, compact = false) {
    const st = b.log_status;
    if (st === "missed") {
      const canAppeal = S.STATE && S.STATE.appealAvailable;
      return `<span class="pill" style="background:rgba(153,27,27,.25);color:#f87171;border:1px solid rgba(220,38,38,.45);letter-spacing:.12em">
      <i class="fas fa-ban text-[9px]"></i>CANCELED</span>${canAppeal ? `
    <button class="btn px-2 py-1 text-[9px] bg-gray-800/60 border border-gold/40 text-gold ml-1" title="Use this week's appeal token"
      data-act="appealBlock" data-args="${actArgs([b.id, S.STATE.date, b.title])}"><i class="fas fa-gavel"></i></button>` : ""}`;
    }
    const mk = (val, ic, cls, active) => `
    <button class="btn ${compact ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-xs"} ${active ? cls : "bg-gray-800/60 text-gray-500 border border-line"}"
      data-act="logBlock" data-args="${actArgs([b.id, st === val ? "pending" : val])}"><i class="fas ${ic}"></i></button>`;
    return `<div class="flex gap-1.5">
    ${mk("done", "fa-check", "bg-emerald-700 text-white", st === "done")}
    ${mk("partial", "fa-star-half-stroke", "bg-amber-600 text-white", st === "partial")}
    ${mk("skipped", "fa-xmark", "bg-red-800 text-white", st === "skipped")}
  </div>`;
  }
  async function logBlock(id, status, ev) {
    const el = ev && ev.target ? ev.target.closest("button") : null;
    const b = (S.STATE.blocks || []).find((x) => x.id === id);
    try {
      await api("post", `/api/blocks/${id}/log`, { status });
    } catch (e) {
      FX.fail();
      await loadState();
      render();
      return;
    }
    if (status === "done") {
      FX.success();
      if (b) FX.floatDelta(b.points, el);
    } else if (status === "skipped") FX.fail();
    await loadState();
    render();
    if (status === "done" && S.STATE.adherence && S.STATE.adherence.pct >= 100) {
      FX.confetti({ count: 130 });
      FX.toast("FULL DAY CONQUERED — 100% ADHERENCE", "gold");
    }
  }
  function viewNow() {
    const s = S.STATE, c = s.current, n = s.next;
    const adh = s.adherence;
    adh.pct >= 80 ? "#22c55e" : adh.pct >= 50 ? "#f59e0b" : "#dc2626";
    return `${header()}${flagsPanel()}
  <section id="now-section" class="stagger">
    ${s.needsCatchup ? `
    <div class="card-lux p-4 mb-3 border-gold/40" id="catchup-door">
      <h3 class="text-[11px] font-bold tracking-[.2em] gold-text mb-1"><i class="fas fa-door-open"></i> THERE IS A WAY BACK IN</h3>
      <p class="text-xs text-gray-400 leading-relaxed mb-3">A few days have gone dark. That is data, not a verdict. Run the re-entry protocol — it forgives the backlog and gives you one action.</p>
      <button class="btn w-full p-2.5 bg-gold/15 border border-gold/50 text-gold font-bold text-xs" data-act="runCatchup"><i class="fas fa-compass mr-1"></i>RUN /catchup</button>
    </div>` : ""}
    ${s.yesterdayTargets ? `
    <div class="card p-3 mb-3 border-gold/30">
      <h3 class="text-[10px] font-bold tracking-widest text-gold mb-1"><i class="fas fa-bullseye"></i> TODAY'S 3 TARGETS (set last night — Law 4)</h3>
      <p class="text-xs text-gray-300 leading-relaxed">${nl2br(s.yesterdayTargets)}</p>
    </div>` : `
    <div class="card p-3 mb-3 border-amber-800/50">
      <p class="text-xs text-amber-400"><i class="fas fa-triangle-exclamation"></i> ${S.STATE.tone ? toneLine("no_targets", S.STATE.tone) : "No targets were set last night. Set tonight’s three in the debrief."} (Law 4)</p>
    </div>`}

    ${c ? `
    <article class="card-lux now-ring p-5 mb-3 text-center">
      <p class="text-[10px] font-bold tracking-[.3em] gold-text mb-1.5">◆ RIGHT NOW · ${c.start_time}–${c.end_time} ◆</p>
      <div id="block-countdown" class="font-disp text-[11px] text-gray-500 font-bold mb-2"></div>
      <i class="fas ${CAT_ICON[c.category] || "fa-circle"} cat-${c.category} text-3xl mb-2" style="filter:drop-shadow(0 0 12px currentColor)"></i>
      <h2 class="font-disp font-bold text-2xl leading-tight mb-1 text-white">${esc(c.title)}</h2>
      <p class="text-xs text-gray-400 leading-relaxed mb-3">${esc(c.description || "")}</p>
      ${c.is_non_negotiable ? '<span class="pill pill-blood mb-3 inline-flex"><i class="fas fa-lock text-[8px]"></i>NON-NEGOTIABLE</span>' : ""}
      ${c.log_status === "missed" ? `<p class="text-[10px] text-red-400 font-bold tracking-[.2em] mb-2"><i class="fas fa-ban"></i> WINDOW CLOSED — AUTO-CANCELED. PENALTY APPLIED.</p>` : ""}
      <div class="flex justify-center">${statusBtns(c)}</div>
    </article>` : `
    <article class="card-lux p-6 mb-3 text-center">
      <i class="fas fa-moon text-3xl text-blue-400 mb-2" style="filter:drop-shadow(0 0 14px rgba(96,165,250,.5))"></i>
      <h2 class="font-disp font-bold text-xl text-white">OFF THE CLOCK</h2>
      <p class="text-xs text-gray-500 mt-1">No scheduled block right now. If it's late — you should be asleep, soldier.</p>
    </article>`}

    ${n ? `
    <div class="card p-3 mb-3 flex items-center gap-3">
      <i class="fas ${CAT_ICON[n.category] || "fa-circle"} cat-${n.category}"></i>
      <div class="flex-1">
        <p class="text-[10px] text-gray-500 font-bold tracking-widest">NEXT · ${n.start_time}</p>
        <p class="text-sm font-semibold">${esc(n.title)}</p>
      </div>
    </div>` : ""}

    <div class="card-lux p-4 mb-3 flex items-center gap-4">
      ${FX.ring(adh.pct, 84, 7, adh.pct + "%", "LAW 6")}
      <div class="flex-1">
        <h3 class="text-[10px] font-bold tracking-[.18em] text-gray-400 mb-1">WEIGHTED ADHERENCE</h3>
        <p class="text-xs text-gray-300"><span class="font-disp font-bold text-white">${adh.done}</span> / ${adh.total} scored blocks · <span class="text-gray-500">${Math.round(adh.wScore * 10) / 10}/${adh.wTotal} wt</span></p>
        <p class="text-[10px] text-gray-500 mt-1">Horizon: 80% · today's points
          <span class="font-disp font-bold ${s.todayPoints >= 0 ? "text-jade" : "text-red-400"}">${s.todayPoints >= 0 ? "+" : ""}${s.todayPoints}</span></p>
        ${s.median !== null && s.median !== void 0 ? `<p class="text-[10px] mt-0.5 ${s.delta >= 0 ? "text-jade" : "text-amber-400"}">vs your 14-day median (${s.median}%): <b>${s.delta >= 0 ? "+" : ""}${s.delta}</b> — ${s.delta >= 0 ? "ahead of your own baseline" : "below your own baseline"}</p>` : ""}
        <div class="prog mt-2"><div style="width:${adh.pct}%"></div></div>
      </div>
    </div>

    ${adh.mvdTotal > 0 ? `
    <div class="card p-3 mb-3 ${adh.mvdHeld ? "border-jade/40" : ""}" id="mvd-panel">
      <div class="flex items-center gap-2">
        <i class="fas fa-shield-halved ${adh.mvdHeld ? "text-jade" : "text-gray-500"}"></i>
        <div class="flex-1">
          <p class="text-[10px] font-bold tracking-widest ${adh.mvdHeld ? "text-jade" : "text-gray-400"}">${adh.mvdHeld ? "✓ HELD THE LINE" : "MINIMUM VIABLE DAY"}</p>
          <p class="text-[10px] text-gray-500">${adh.mvdDone}/${adh.mvdTotal} core blocks — ${adh.mvdHeld ? "the streak survives no matter what else happens today." : "hit all of these and the day cannot collapse."}</p>
        </div>
        <span class="font-disp font-bold ${adh.mvdHeld ? "text-jade" : "text-gray-400"}">${adh.mvdDone}/${adh.mvdTotal}</span>
      </div>
    </div>` : ""}

    ${s.loadReductions && s.loadReductions.length ? s.loadReductions.map((lr) => `
    <div class="card p-3 mb-3 border-amber-700/40" id="load-reduction-${lr.id}">
      <p class="text-[10px] font-bold tracking-widest text-amber-400 mb-1"><i class="fas fa-compress"></i> LOAD REDUCTION · “${esc(lr.title)}” · half duration until ${lr.end_date}</p>
      ${lr.reason ? `<p class="text-[10px] text-gray-500">Cause on record: ${esc(lr.reason.replace(/_/g, " "))}</p>` : `
      <p class="text-[10px] text-gray-400 mb-1.5">Two misses in a row — the plan was wrong somewhere. Why?</p>
      <div class="flex flex-wrap gap-1.5">
        ${[["wrong_time", "WRONG TIME"], ["too_long", "TOO LONG"], ["wrong_prereq", "WRONG PREREQ"], ["dont_want_it", "DON’T WANT IT"]].map(([v, l]) => `
        <button class="btn px-2 py-1.5 text-[10px] bg-gray-800/60 border border-line text-gray-300" data-act="answerLR" data-args="${actArgs([lr.id, v])}">${l}</button>`).join("")}
      </div>`}
    </div>`).join("") : ""}

    ${s.activeUnits.length ? `
    <div class="card p-3 mb-3">
      <h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2"><i class="fas fa-chess-knight text-rose-400"></i> ACTIVE FRONTS</h3>
      ${s.activeUnits.map((u) => `
        <button class="w-full text-left flex items-center gap-2 py-1.5 border-b border-line/50 last:border-0" data-act="setTab" data-args="${actArgs(["campaign"])}">
          <span class="pill ${u.track === "strategy" ? "bg-rose-950 text-rose-300" : "bg-indigo-950 text-indigo-300"}">${u.code}</span>
          <span class="text-xs flex-1">${esc(u.title)}</span>
          <span class="text-[9px] text-gray-500">${u.status.replace("_", " ").toUpperCase()}</span>
        </button>`).join("")}
    </div>` : ""}

    ${s.dueCards > 0 ? `
    <button class="btn w-full p-3 bg-gold/10 border border-gold/40 text-gold text-sm font-bold" data-act="setTab" data-args="${actArgs(["mind"])}">
      <i class="fas fa-layer-group mr-1"></i> ${s.dueCards} FLASHCARD${s.dueCards > 1 ? "S" : ""} DUE — DRILL THE PRINCIPLES
    </button>` : ""}
  </section>`;
  }
  function viewToday() {
    const nowMin = (() => {
      const [h, m] = nowTime().split(":").map(Number);
      return h * 60 + m;
    })();
    return `${header()}
  <section id="today-schedule" class="fade-in">
    <div class="sect">FULL DAY PLAN — ${dowLabel()}</div>
    <div class="relative" style="padding-left:14px">
    <div class="absolute top-2 bottom-2" style="left:4px;width:2px;background:linear-gradient(180deg,rgba(212,175,55,.4),rgba(29,41,66,.6))"></div>
    ${S.STATE.blocks.map((b) => {
      const isNow = S.STATE.current && S.STATE.current.id === b.id;
      const done = b.log_status === "done", part = b.log_status === "partial", skip = b.log_status === "skipped", missed = b.log_status === "missed";
      const [sh, sm] = b.start_time.split(":").map(Number);
      const past = sh * 60 + sm < nowMin && !isNow;
      const dotColor = done ? "#22c55e" : skip || missed ? "#dc2626" : part ? "#f59e0b" : isNow ? "#d4af37" : past ? "#5d6b82" : "#1d2942";
      return `
      <article class="card p-3 mb-2 relative ${isNow ? "card-lux now-ring" : ""} ${done ? "opacity-55" : ""} ${missed ? "opacity-70" : ""}" ${missed ? 'style="border-color:rgba(220,38,38,.35);background:linear-gradient(135deg,rgba(60,10,10,.35),rgba(15,20,32,.9))"' : ""}>
        <div class="absolute rounded-full" style="left:-14px;top:50%;transform:translate(-50%,-50%);width:9px;height:9px;background:${dotColor};box-shadow:0 0 8px ${dotColor}${isNow ? ";animation:flicker 1.5s infinite" : ""}"></div>
        <div class="flex items-center gap-2.5">
          <div class="text-center w-11 shrink-0">
            <p class="font-disp font-bold text-xs ${isNow ? "text-gold" : "text-gray-400"}">${b.start_time}</p>
            <p class="text-[9px] text-gray-600">${b.end_time}</p>
          </div>
          <i class="fas ${CAT_ICON[b.category] || "fa-circle"} cat-${b.category} text-sm w-4"></i>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold ${done || missed ? "line-through" : ""} ${skip || missed ? "text-red-400" : ""}">${esc(b.title)}
              ${b.is_non_negotiable ? '<i class="fas fa-lock text-[8px] text-red-500 ml-1"></i>' : ""}
            </p>
            <p class="text-[10px] ${missed ? "text-red-500 font-bold tracking-wider" : "text-gray-500"}">${missed ? "✖ MISSED — WINDOW CLOSED · PENALTY TAKEN" : `+${b.points} pts ${part ? "· partial" : ""}`}</p>
          </div>
          ${statusBtns(b, true)}
        </div>
        ${isNow ? '<p class="text-[9px] gold-text font-bold tracking-[.25em] mt-1.5 text-center">◄ YOU ARE HERE ►</p>' : ""}
      </article>`;
    }).join("")}
    </div>
    <div id="laws-panel" class="mt-4">${S.LAWS_CACHE ? renderLaws() : '<button class="btn w-full p-3 bg-panel border border-line text-sm" data-act="loadLaws"><i class="fas fa-scale-balanced mr-1 text-gold"></i> CHECK THE 7 LAWS (tonight)</button>'}</div>
  </section>`;
  }
  function dowLabel() {
    return ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][(/* @__PURE__ */ new Date()).getDay()];
  }
  async function loadLaws() {
    S.LAWS_CACHE = (await axios.get(`/api/laws?date=${todayStr()}`)).data;
    render();
  }
  function renderLaws() {
    return `
  <h2 class="font-disp font-bold text-sm tracking-widest text-gray-400 mb-2"><i class="fas fa-scale-balanced text-gold"></i> THE 7 LAWS — DID THEY HOLD TODAY?</h2>
  ${S.LAWS_CACHE.map((l) => `
    <article class="card p-3 mb-2">
      <div class="flex items-start gap-2">
        <span class="font-disp font-bold text-gold text-lg leading-none">${l.sort_order}</span>
        <div class="flex-1">
          <p class="text-xs font-bold">${esc(l.title)}</p>
          <p class="text-[10px] text-gray-500 leading-relaxed">${esc(l.detail)}</p>
        </div>
        <div class="flex gap-1.5">
          <button class="btn px-2.5 py-1.5 text-[11px] ${l.kept === 1 ? "bg-emerald-700 text-white" : "bg-gray-800/60 text-gray-500 border border-line"}" data-act="checkLaw" data-args="${actArgs([l.id, true])}"><i class="fas fa-check"></i></button>
          <button class="btn px-2.5 py-1.5 text-[11px] ${l.kept === 0 ? "bg-red-800 text-white" : "bg-gray-800/60 text-gray-500 border border-line"}" data-act="checkLaw" data-args="${actArgs([l.id, false])}"><i class="fas fa-xmark"></i></button>
        </div>
      </div>
    </article>`).join("")}`;
  }
  async function checkLaw(id, kept) {
    await api("post", `/api/laws/${id}/check`, { date: todayStr(), kept });
    await loadLaws();
  }
  async function answerLR(id, reason) {
    const r = await api("post", `/api/load-reductions/${id}/answer`, { reason });
    if (r.advice) FX.toast(r.advice, "gold");
    await loadState();
    render();
  }
  async function appealBlock(blockId, blockDate, title) {
    const reason = prompt("APPEAL — “" + title + "” (" + blockDate + ")\n\nOne token per week. The reason goes on the PERMANENT record and must be at least 100 characters. What actually happened?");
    if (reason === null) return;
    try {
      const r = await api("post", "/api/appeals", { block_id: blockId, block_date: blockDate, reason });
      FX.success();
      FX.toast("WINDOW REOPENED — " + (r.refunded || 0) + " pts refunded. Now win it.", "gold");
      await loadState();
      render();
    } catch (_) {
    }
  }
  function render() {
    if (S.TAB === "today") {
      shell(segments("today") + (S.SUB.today === "schedule" ? viewToday() : viewNow()));
    } else {
      renderExtra(S.TAB);
    }
  }
  async function runCatchup() {
    let p;
    try {
      p = (await axios.post("/api/catchup", {})).data;
    } catch (e) {
      toast("Could not reach the re-entry protocol.", true);
      return;
    }
    const missed = (p.missed || []).map(
      (m) => `<li class="text-gray-400">${esc(m.date)} — ${m.unlogged_blocks} unlogged${m.debrief_missed ? ", debrief missed" : ""}</li>`
    ).join("") || '<li class="text-gray-500">Nothing on record to rewrite.</li>';
    const doNot = (p.do_not || []).map((d) => `<li>${esc(d)}</li>`).join("");
    const diag = (p.diagnostic || []).map((q, i) => `<li>${i + 1}. ${esc(q)}</li>`).join("");
    const k = p.keystone || {};
    const el = document.createElement("div");
    el.id = "catchup-overlay";
    el.className = "fixed inset-0 z-[300] bg-ink/95 overflow-y-auto p-4";
    el.innerHTML = '<div class="max-w-lg mx-auto py-4"><div class="flex items-center justify-between mb-3"><h2 class="font-engraved gold-text text-lg font-bold">⚔ RE-ENTRY</h2><button class="text-gray-500 text-xl" data-act="dismissId" data-args="[&quot;catchup-overlay&quot;]">✕</button></div><p class="text-[10px] text-gray-500 mb-3">' + (p.days_absent || 0) + " day(s) dark · trigger: " + esc(p.trigger || "manual") + '</p><div class="card p-3 mb-2"><h3 class="text-[10px] font-bold tracking-widest text-sky-400 mb-1">1 · WHAT WAS MISSED</h3><ul class="text-xs space-y-0.5">' + missed + '</ul></div><div class="card p-3 mb-2"><h3 class="text-[10px] font-bold tracking-widest text-amber-400 mb-1">2 · LIKELY MECHANISM</h3><p class="text-xs text-gray-300">' + esc(p.mechanism || "") + ' — a structural cause, not a character failure.</p></div><div class="card p-3 mb-2"><h3 class="text-[10px] font-bold tracking-widest text-red-400 mb-1">3 · WHAT NOT TO DO NOW</h3><ul class="text-xs text-gray-300 space-y-0.5 list-disc pl-4">' + doNot + '</ul></div><div class="card p-3 mb-2 border-gold/30"><h3 class="text-[10px] font-bold tracking-widest text-gold mb-1">4 · MINIMUM VIABLE RECOVERY</h3><p class="text-xs text-gray-300 mb-2">' + esc(p.minimum_viable_recovery || "") + '</p><button class="btn w-full p-2.5 bg-jade/15 border border-jade/50 text-jade font-bold text-xs" data-act="logRecovery"><i class="fas fa-check mr-1"></i>LOG MY ONE ACTION</button></div><div class="card p-3 mb-2"><h3 class="text-[10px] font-bold tracking-widest text-indigo-300 mb-1">5 · ONE STRUCTURAL PATCH</h3><p class="text-xs text-gray-300"><b>' + esc((p.structural_patch || {}).dimension || "") + ":</b> " + esc((p.structural_patch || {}).suggestion || "") + '</p></div><div class="card p-3 mb-2 border-gold/30"><h3 class="text-[10px] font-bold tracking-widest text-gold mb-1">6 · TOMORROW’S KEYSTONE</h3><p class="text-xs text-white font-semibold">' + esc(k.action || "") + " · " + esc(k.start_time || "") + '</p><p class="text-[11px] text-gray-400 mt-1">' + esc(k.environment || "") + '</p><p class="text-[11px] text-gray-400 mt-0.5">First move: ' + esc(k.first_physical_action || "") + "</p></div>" + (diag ? '<div class="card p-3 mb-2 border-amber-700/50"><h3 class="text-[10px] font-bold tracking-widest text-amber-400 mb-1">RE-ENTRY DIAGNOSTIC (14+ days)</h3><ul class="text-xs text-gray-300 space-y-1">' + diag + '</ul><p class="text-[10px] text-gray-500 mt-2">The ladder re-seats at its base: three anchors only.</p></div>' : "") + "</div>";
    document.body.appendChild(el);
  }
  async function logRecovery() {
    const action = prompt("MINIMUM VIABLE RECOVERY\n\nThe single action you just took that restores agency. One line. This makes today a non-broken day — it is survival, not a victory.");
    if (!action || !action.trim()) return;
    try {
      await axios.post("/api/recovery", { action: action.trim() });
      FX.success && FX.success();
      toast("Recovery logged. The line held.");
      const ov = document.getElementById("catchup-overlay");
      if (ov) ov.remove();
      await loadState();
      render();
    } catch (e) {
      toast(e?.response?.data?.error || "Could not log recovery.", true);
    }
  }
  setInterval(() => {
    const el = document.getElementById("block-countdown");
    if (!el || !S.STATE || !S.STATE.current) return;
    const [eh, em] = S.STATE.current.end_time.split(":").map(Number);
    const end = /* @__PURE__ */ new Date();
    end.setHours(eh, em, 0, 0);
    let diff = Math.floor((end - /* @__PURE__ */ new Date()) / 1e3);
    if (diff < 0) {
      el.textContent = "BLOCK ENDED — LOG IT";
      return;
    }
    const h = Math.floor(diff / 3600), m = Math.floor(diff % 3600 / 60), s2 = diff % 60;
    el.textContent = (h ? `${h}h ` : "") + `${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")} remaining`;
  }, 1e3);
  (async function init() {
    try {
      const st = (await axios.get("/api/auth/status")).data;
      if (!st.setup) {
        renderLogin(true);
        FX.killSplash();
        return;
      }
      if (!st.authed) {
        renderLogin(false);
        FX.killSplash();
        return;
      }
      S.CSRF_TOKEN = st.csrfToken;
      await loadState();
      render();
    } catch (e) {
      app().innerHTML = `<div class="p-6 text-center text-red-400 text-sm">Failed to load the war room. Pull to refresh.<br>${esc(e.message || "")}</div>`;
    } finally {
      FX.killSplash();
    }
    startFreshnessWatch();
  })();
  async function checkVersion({ force = false } = {}) {
    if (S.VERSION_IN_FLIGHT) return false;
    S.VERSION_IN_FLIGHT = true;
    try {
      const headers = {};
      if (S.LAST_VERSION && !force) headers["If-None-Match"] = `W/"${S.LAST_VERSION}"`;
      const res = await axios.get("/api/version", {
        headers,
        // 304 is a valid, expected answer — not an error.
        validateStatus: (s) => s === 200 || s === 304
      });
      if (res.status === 304) return false;
      const next = res.data && res.data.version;
      const changed = next !== S.LAST_VERSION;
      S.LAST_VERSION = next || S.LAST_VERSION;
      return changed;
    } catch (_) {
      return false;
    } finally {
      S.VERSION_IN_FLIGHT = false;
    }
  }
  async function refreshIfStale(opts) {
    if (!S.STATE) return;
    if (await checkVersion(opts)) {
      try {
        await loadState();
        render();
      } catch (_) {
      }
    }
    scheduleBoundaryCheck();
  }
  function scheduleBoundaryCheck() {
    if (S.BOUNDARY_TIMER) {
      clearTimeout(S.BOUNDARY_TIMER);
      S.BOUNDARY_TIMER = null;
    }
    const now = /* @__PURE__ */ new Date();
    const minsNow = now.getHours() * 60 + now.getMinutes();
    let nextMins = null;
    for (const b of S.STATE && S.STATE.blocks || []) {
      for (const hhmm of [b.start_time, b.end_time]) {
        if (!hhmm) continue;
        const [h, m] = String(hhmm).split(":").map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
        const t = h * 60 + m;
        if (t > minsNow && (nextMins === null || t < nextMins)) nextMins = t;
      }
    }
    const minutesAway = nextMins === null ? 10 : Math.min(nextMins - minsNow, 10);
    const ms = Math.max(2e4, minutesAway * 6e4 - now.getSeconds() * 1e3 + 2e3);
    S.BOUNDARY_TIMER = setTimeout(() => {
      refreshIfStale();
    }, ms);
  }
  function startFreshnessWatch() {
    checkVersion({ force: true });
    scheduleBoundaryCheck();
    window.addEventListener("focus", () => refreshIfStale());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshIfStale();
    });
    window.addEventListener("online", () => refreshIfStale({ force: true }));
  }
  axios.interceptors.response.use((res) => {
    const method = String(res.config && res.config.method || "get").toLowerCase();
    if (!["get", "head", "options"].includes(method) && res.status >= 200 && res.status < 300) {
      S.LAST_VERSION = null;
    }
    return res;
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!t || !t.id) return;
    if (t.tagName === "TEXTAREA" || t.tagName === "INPUT" && (t.type === "text" || t.type === "time" || t.type === "number" || t.type === "date")) {
      try {
        localStorage.setItem("wr_draft_" + t.id, t.value);
      } catch (_) {
      }
    }
  });
  function restoreDrafts(root) {
    document.querySelectorAll("textarea[id], input[id]").forEach((el) => {
      if (el.value) return;
      const v = localStorage.getItem("wr_draft_" + el.id);
      if (v !== null && v !== "") el.value = v;
    });
  }
  function clearDrafts(ids) {
    ids.forEach((id) => localStorage.removeItem("wr_draft_" + id));
  }
  const _origShell = shell;
  shell = function(content) {
    _origShell(content);
    setTimeout(() => restoreDrafts(), 0);
  };
})();
