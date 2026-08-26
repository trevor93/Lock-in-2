// Book 7 refactor — the renderer. Static client-shell payloads with no DB or
// request state: the PWA manifest, the service worker, and the HTML shell that
// boots the frontend. Kept separate from routing and business logic.

export const MANIFEST = {
  name: 'War Room — Lock In', short_name: 'War Room', start_url: '/', display: 'standalone',
  background_color: '#0a0e14', theme_color: '#0a0e14',
  icons: [{ src: '/static/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}

/**
 * Every cache this worker owns starts with this prefix, and nothing else in the origin may
 * use it. The purge on `activate` deletes by prefix, so the prefix is the boundary between
 * "mine to retire" and "someone else's, leave it alone".
 */
export const SW_CACHE_PREFIX = 'warroom-books-'

/**
 * The generation of the cache. Bump it when WHAT is cached changes — a new asset class, a
 * different key, a different response shape — and every previous generation is deleted on
 * the next activate instead of lingering forever.
 *
 * It is deliberately NOT the mechanism for content freshness. A hand-bumped constant is
 * precisely the thing that stops being bumped, and the audit's recurring finding is that a
 * hand-maintained value decays without anybody deciding to let it. Freshness is handled by
 * revalidation below, which needs no human to remember anything: a changed book reaches the
 * reader on the read after the one that served the stale copy, whatever this string says.
 */
export const SW_VERSION = 'v2'

// Service worker: on-demand (runtime) caching of the book JSON only — private API responses
// are never cached, and the fetch handler does not even intercept them. Also focuses/opens
// the app on notification tap.
//
// Book 17 item 4 / Book 11: this used to name one fixed cache, never enumerate the caches it
// owned, and never delete anything — so a corrected chapter could not reach a commander who
// had opened it once, and no generation of cached content could be retired short of asking
// the user to clear site data. Both are fixed here: the name carries a version, `activate`
// deletes every other generation of its own, and a cache hit is revalidated in the
// background. `test/service-worker-cache.dom.test.ts` executes this source rather than
// grepping it, because a test that greps proves only that the text says something.
export const SERVICE_WORKER = `
const CACHE='${SW_CACHE_PREFIX}${SW_VERSION}';
const MINE='${SW_CACHE_PREFIX}';
self.addEventListener('install',e=>{self.skipWaiting()});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    // Delete every generation of MINE that is not the current one. Scoped to the prefix, so
    // a cache this worker did not create is never touched.
    const names=await caches.keys();
    await Promise.all(names.map(n=>(n.startsWith(MINE)&&n!==CACHE)?caches.delete(n):null));
    await clients.claim();
  })());
});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/static/books/')){
    e.respondWith(caches.open(CACHE).then(async c=>{
      const hit=await c.match(e.request);
      // Stale-while-revalidate. The cached copy answers immediately — offline reading is the
      // whole point — and the network is consulted anyway so the NEXT read is the corrected
      // text. A failed revalidation is silent by design: offline must not break a read.
      const fresh=fetch(e.request).then(r=>{ if(r&&r.ok) c.put(e.request,r.clone()); return r; });
      if(hit){ fresh.catch(()=>{}); return hit; }
      return fresh;
    }));
  }
});
// Book 7 alarms — Web Push. The push carries NO payload (nothing about the day
// travels through a third-party push service), so the worker asks the origin what
// is due and shows that. If the fetch fails (offline, or the session has expired)
// it still shows a neutral prompt, because a push event must produce a visible
// notification.
self.addEventListener('push',e=>{
  e.waitUntil((async()=>{
    let title='WAR ROOM', body='Something is due. Open the war room.';
    try{
      const r=await fetch('/api/next-alarm',{credentials:'include'});
      if(r.ok){ const d=await r.json(); if(d&&d.title){ title=d.title; body=d.body||body; } }
    }catch(_){}
    await self.registration.showNotification(title,{
      body, tag:'warroom-alarm', renotify:true, icon:'/static/icon.svg', badge:'/static/icon.svg',
    });
  })());
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window'}).then(cs=>{
    for(const c of cs){ if('focus' in c) return c.focus(); }
    return clients.openWindow('/');
  }));
});`

export const SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="theme-color" content="#0a0e14">
<title>WAR ROOM — Lock In</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚔️</text></svg>">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/static/icon.svg">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600;700&family=Cinzel:wght@500;600;700&display=swap" rel="stylesheet">
<link href="/static/style.css" rel="stylesheet">
<script>tailwind.config={theme:{extend:{fontFamily:{disp:['Rajdhani','sans-serif'],body:['Inter','sans-serif']},colors:{ink:'#0a0e14',panel:'#111826',line:'#1e2a3d',gold:'#d4af37',blood:'#dc2626',jade:'#22c55e'}}}}</script>
</head>
<body class="text-gray-200 font-body">
<div class="splash" id="splash">
  <div class="splash-sword">⚔</div>
  <div class="font-engraved gold-text text-2xl font-bold">WAR ROOM</div>
  <div class="splash-line"></div>
  <div class="text-[10px] tracking-[.35em] text-gray-500 font-semibold">DISCIPLINE · STRATEGY · HONESTY</div>
</div>
<canvas id="fx-canvas"></canvas>
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/bundle.js"></script>
<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js');}</script>
</body>
</html>`
