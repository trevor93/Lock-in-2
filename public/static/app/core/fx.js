
/* WAR ROOM — FX ENGINE: confetti, haptics, count-up, rings, ranks, sounds */
export const FX = {
  // ── Haptics (Android Chrome) ──
  tap()      { try { navigator.vibrate && navigator.vibrate(12); } catch(e){} },
  success()  { try { navigator.vibrate && navigator.vibrate([18, 40, 30]); } catch(e){} },
  fail()     { try { navigator.vibrate && navigator.vibrate([60, 50, 60]); } catch(e){} },
  victory()  { try { navigator.vibrate && navigator.vibrate([30, 40, 30, 40, 80]); } catch(e){} },

  // ── Gold confetti burst (canvas particle system) ──
  confetti(opts = {}) {
    const cv = document.getElementById('fx-canvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    cv.width = innerWidth; cv.height = innerHeight;
    const N = opts.count || 90;
    const colors = opts.colors || ['#d4af37','#f4d97a','#8a7223','#ffffff','#f59e0b'];
    const cx = opts.x ?? innerWidth/2, cy = opts.y ?? innerHeight*0.38;
    const P = [];
    for (let i=0;i<N;i++){
      const a = Math.random()*Math.PI*2, v = 4+Math.random()*7;
      P.push({ x:cx, y:cy, vx:Math.cos(a)*v, vy:Math.sin(a)*v-3,
        s:3+Math.random()*4, r:Math.random()*Math.PI, vr:(Math.random()-.5)*.3,
        c:colors[i%colors.length], life:1, decay:.011+Math.random()*.012,
        shape:Math.random()>.5?'rect':'circ' });
    }
    let raf;
    const step = () => {
      ctx.clearRect(0,0,cv.width,cv.height);
      let alive = false;
      for (const p of P){
        if (p.life<=0) continue;
        alive = true;
        p.x+=p.vx; p.y+=p.vy; p.vy+=.18; p.vx*=.985; p.r+=p.vr; p.life-=p.decay;
        ctx.save(); ctx.globalAlpha=Math.max(p.life,0); ctx.translate(p.x,p.y); ctx.rotate(p.r);
        ctx.fillStyle=p.c;
        if (p.shape==='rect') ctx.fillRect(-p.s/2,-p.s/2,p.s,p.s*0.6);
        else { ctx.beginPath(); ctx.arc(0,0,p.s/2,0,7); ctx.fill(); }
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(step);
      else ctx.clearRect(0,0,cv.width,cv.height);
    };
    cancelAnimationFrame(raf); step();
    this.victory();
  },

  // ── Animated number count-up ──
  countUp(el, target, dur = 900) {
    if (!el) return;
    const start = performance.now(), from = 0;
    const isNeg = target < 0;
    const tick = (t) => {
      const p = Math.min((t-start)/dur, 1);
      const eased = 1-Math.pow(1-p,3);
      el.textContent = Math.round(from + (target-from)*eased).toLocaleString();
      if (p<1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  countUpAll(root=document) {
    root.querySelectorAll('[data-countup]').forEach(el=>{
      this.countUp(el, parseInt(el.dataset.countup||'0',10));
    });
  },

  // ── SVG progress ring (returns HTML) ──
  ring(pct, size=88, stroke=7, label='', sub='') {
    const r = (size-stroke)/2, C = 2*Math.PI*r;
    const off = C*(1-Math.min(Math.max(pct,0),100)/100);
    return `<div class="ring-wrap" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}">
        <defs><linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8a7223"/><stop offset="50%" stop-color="#d4af37"/><stop offset="100%" stop-color="#f4d97a"/>
        </linearGradient></defs>
        <circle class="ring-track" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="${stroke}"/>
        <circle class="ring-fill" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="${stroke}"
          stroke-dasharray="${C}" stroke-dashoffset="${off}"/>
      </svg>
      <div class="ring-center">
        <div class="font-disp font-bold text-lg text-white leading-none">${label}</div>
        ${sub?`<div class="text-[8px] text-gray-500 font-bold tracking-widest mt-0.5">${sub}</div>`:''}
      </div>
    </div>`;
  },

  // ── Rank ladder (Duolingo-league style, war titles) ──
  RANKS: [
    [0,    'RECRUIT',        'fa-user'],
    [150,  'SOLDIER',        'fa-person-rifle'],
    [400,  'SERGEANT',       'fa-shield-halved'],
    [800,  'LIEUTENANT',     'fa-medal'],
    [1500, 'CAPTAIN',        'fa-star'],
    [2500, 'COMMANDER',      'fa-chess-knight'],
    [4000, 'GENERAL',        'fa-chess-king'],
    [6500, 'WARLORD',        'fa-crown'],
    [10000,'SOVEREIGN',      'fa-dragon'],
  ],
  // Book 8.5: the rank ladder is CUT - it was a second rendering of points the
  // commander can already see. It may return only when it is derived from
  // calibration and mastery rather than from a running points total.
  flameClass(streak) {
    if (streak >= 90) return 'flame-90';
    if (streak >= 30) return 'flame-30';
    if (streak >= 7)  return 'flame-7';
    if (streak >= 1)  return 'flame-1';
    return 'flame-0';
  },

  // ── Toast v2: icon + slide from top ──
  toast(msg, kind='ok') {
    const icons = { ok:'fa-circle-check', bad:'fa-triangle-exclamation', gold:'fa-trophy', info:'fa-circle-info' };
    const styles = {
      ok:   'background:linear-gradient(160deg,#052e16,#022c22);border:1px solid rgba(34,197,94,.4);color:#86efac',
      bad:  'background:linear-gradient(160deg,#450a0a,#2a0505);border:1px solid rgba(220,38,38,.5);color:#fca5a5',
      gold: 'background:linear-gradient(160deg,#2a2208,#1a1406);border:1px solid rgba(212,175,55,.55);color:#f4d97a',
      info: 'background:linear-gradient(160deg,#0c1a2e,#081120);border:1px solid rgba(56,189,248,.4);color:#7dd3fc',
    };
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;top:12px;left:12px;right:12px;z-index:400;padding:.8rem 1rem;border-radius:14px;font-size:.82rem;font-weight:600;display:flex;align-items:center;gap:.6rem;box-shadow:0 10px 30px rgba(0,0,0,.6);backdrop-filter:blur(10px);${styles[kind]||styles.ok};transform:translateY(-80px);transition:transform .35s cubic-bezier(.34,1.56,.64,1)`;
    t.innerHTML = `<i class="fas ${icons[kind]||icons.ok}"></i><span>${msg}</span>`;
    document.body.appendChild(t);
    requestAnimationFrame(()=>t.style.transform='translateY(0)');
    if (kind==='bad') this.fail(); else if (kind==='gold') this.success(); else this.tap();
    setTimeout(()=>{ t.style.transform='translateY(-90px)'; setTimeout(()=>t.remove(),400); }, kind==='bad'?4500:2600);
  },

  // ── Points delta floater (+25 rises from element) ──
  floatDelta(amount, el) {
    const rect = el ? el.getBoundingClientRect() : { left: innerWidth/2, top: innerHeight/2, width:0 };
    const f = document.createElement('div');
    const pos = amount >= 0;
    f.textContent = (pos?'+':'')+amount;
    f.style.cssText = `position:fixed;left:${rect.left+rect.width/2}px;top:${rect.top}px;z-index:300;font-family:Rajdhani,sans-serif;font-weight:800;font-size:1.3rem;pointer-events:none;transform:translateX(-50%);color:${pos?'#f4d97a':'#f87171'};text-shadow:0 0 12px ${pos?'rgba(212,175,55,.8)':'rgba(220,38,38,.8)'};transition:transform 1.1s cubic-bezier(.22,1,.36,1),opacity 1.1s`;
    document.body.appendChild(f);
    requestAnimationFrame(()=>{ f.style.transform='translateX(-50%) translateY(-70px)'; f.style.opacity='0'; });
    setTimeout(()=>f.remove(), 1200);
  },

  // ── Splash dismiss ──
  killSplash() {
    const s = document.getElementById('splash');
    if (s) setTimeout(()=>{ s.classList.add('gone'); setTimeout(()=>s.remove(), 700); }, 650);
  },
};

