// Book 7 refactor — the renderer. Static client-shell payloads with no DB or
// request state: the PWA manifest, the service worker, and the HTML shell that
// boots the frontend. Kept separate from routing and business logic.

export const MANIFEST = {
  name: 'War Room — Lock In', short_name: 'War Room', start_url: '/', display: 'standalone',
  background_color: '#0a0e14', theme_color: '#0a0e14',
  icons: [{ src: '/static/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}

// Service worker: on-demand (runtime) caching of the book JSON only — private
// API responses are never cached. Also focuses/opens the app on notification tap.
export const SERVICE_WORKER = `
const CACHE='warroom-v1';
self.addEventListener('install',e=>{self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(clients.claim())});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/static/books/')){
    e.respondWith(caches.open(CACHE).then(async c=>{
      const hit=await c.match(e.request); if(hit) return hit;
      const r=await fetch(e.request); if(r.ok) c.put(e.request,r.clone()); return r;
    }));
  }
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
<script src="/static/morph.js"></script>
<script src="/static/fx.js"></script>
<script src="/static/app.js"></script>
<script src="/static/app2.js"></script>
<script src="/static/app3.js"></script>
<script src="/static/app4.js"></script>
<script src="/static/app5.js"></script>
<script src="/static/app6.js"></script>
<script src="/static/app7.js"></script>
<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js');}</script>
</body>
</html>`
