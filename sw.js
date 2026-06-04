// ═══════════════════════════════════════════════════════════
//  XverseMovies — Service Worker v4
//  Handles: offline caching + ad/tracker domain blocking
// ═══════════════════════════════════════════════════════════

const CACHE_NAME    = 'xverse-v4'; // bumped → clears old cache
const SHELL_TIMEOUT = 3000;

const APP_SHELL = [
  '/index.html',
  '/XverseMovies_Home.html',
  '/XverseMovies_Browse.html',
  '/XverseMovies_MyList.html',
  '/XverseMovies_Player.html',
  '/XverseMovies_Settings.html',
  '/xverse-config.js',
  '/manifest.json',
  '/favicon.png',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap',
];

// Never cache — always live
const NETWORK_ONLY = [
  'supabase.co',
  'api.themoviedb.org',
  'vidsrc.to', 'vidsrc.me', 'vidsrc.xyz',
  'streamtape.com',
  'dailymotion.com',
  'corsproxy.io',
  'allorigins.win',
];

// ─────────────────────────────────────────────────────────
//  AD / TRACKER BLOCKLIST
//  These domains are silently blocked — returns empty 200
//  Works for: requests made by YOUR pages + scripts
//  Does NOT work for: inside cross-origin iframes
// ─────────────────────────────────────────────────────────
const AD_DOMAINS = [
  // Google ads & tracking
  'doubleclick.net','googlesyndication.com','googletagmanager.com',
  'googletagservices.com','google-analytics.com','adservice.google.com',
  'pagead2.googlesyndication.com','tpc.googlesyndication.com',
  // Major ad networks
  'adnxs.com','adsrvr.org','adform.net','advertising.com',
  'amazon-adsystem.com','media.net','outbrain.com','taboola.com',
  'revcontent.com','mgid.com','criteo.com','rubiconproject.com',
  'openx.net','pubmatic.com','appnexus.com','smartadserver.com',
  'serving-sys.com','adroll.com','adsterra.com',
  // Popunder/popup ad networks (common on streaming sites)
  'popads.net','popunder.ru','popcash.net','hilltopads.net',
  'propellerads.com','exoclick.com','trafficjunky.net','juicyads.com',
  'adcash.com','clickadu.com','richpush.co','evadav.com',
  'bidvertiser.com','traffichunt.com','plugrush.com',
  // Trackers
  'hotjar.com','mixpanel.com','clarity.ms','fullstory.com',
  // Known in vidsrc console errors
  'llypn.com','llvdn.com','llyptn.com',
];

function isAd(url) {
  try {
    const h = new URL(url).hostname;
    return AD_DOMAINS.some(d => h === d || h.endsWith('.' + d));
  } catch { return false; }
}

// Block response — empty, silent, no console error shown to users
const BLOCKED = new Response('', {
  status: 200,
  headers: { 'Content-Type': 'text/plain' },
});

// ─────────────────────────────────────────
//  INSTALL
// ─────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ─────────────────────────────────────────
//  ACTIVATE — delete old caches
// ─────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ─────────────────────────────────────────
//  FETCH — ad blocking + caching strategy
// ─────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // 1. BLOCK ad/tracker domains silently
  if (isAd(url)) {
    e.respondWith(BLOCKED.clone());
    return;
  }

  // 2. Network-only for video/API domains
  if (NETWORK_ONLY.some(d => url.includes(d))) {
    e.respondWith(fetch(e.request).catch(() => new Response('', {status: 503})));
    return;
  }

  // 3. Non-GET → network only
  if (e.request.method !== 'GET') {
    e.respondWith(fetch(e.request));
    return;
  }

  // 4. HTML pages → network-first with cache fallback
  if (url.endsWith('.html') || new URL(url).pathname === '/') {
    e.respondWith(networkFirstWithTimeout(e.request, SHELL_TIMEOUT));
    return;
  }

  // 5. Static assets → cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => offlinePage());
    })
  );
});

async function networkFirstWithTimeout(req, timeout) {
  const cached  = await caches.match(req);
  const network = fetch(req).then(res => {
    if (res.ok) caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
    return res;
  });
  try {
    return await Promise.race([
      network,
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), timeout)),
    ]);
  } catch {
    return cached || offlinePage();
  }
}

function offlinePage() {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset=UTF-8><title>Offline</title>
<style>body{margin:0;background:#141414;color:#fff;font-family:sans-serif;
display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
h1{color:#E50914;font-size:3rem;margin:0 0 8px}p{color:rgba(255,255,255,.6)}</style>
</head><body><div><h1>XverseMovies</h1>
<p>You're offline. <a href="/" style="color:#E50914">Try again</a></p></div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  );
}
