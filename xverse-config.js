// ═══════════════════════════════════════════════════════
//  xverse-config.js  —  Shared config for all pages
//  Include this FIRST in every HTML file:
//  <script src="xverse-config.js"></script>
// ═══════════════════════════════════════════════════════

const XVERSE = {
  SUPABASE_URL:     'https://oobohevfmvitveulvqlf.supabase.co',
  SUPABASE_KEY:     'sb_publishable_SKK21UE3-Ls5xS8kjt0DbA_qwj_QQ4v',
  TMDB_KEY:         'cf25940d9a3514c67d8dbbfe9d6c00dc',
  TMDB_BASE:        'https://api.themoviedb.org/3',
  TMDB_IMG:         'https://image.tmdb.org/t/p/',
  SITE_NAME:        'XverseMovies',

  // Cashfree payment links — apne dashboard se update karo
  PAYMENT: {
    hd:  'https://payments.cashfree.com/forms/xversemovies-hd',   // ₹29
    fhd: 'https://payments.cashfree.com/forms/xversemovies-fhd',  // ₹49
    uhd: 'https://payments.cashfree.com/forms/xversemovies-4k',   // ₹99
  },

  PLANS: {
    free: { name:'Basic',       quality:'480p', price:'Free',   screens:1, order:0 },
    hd:   { name:'HD',          quality:'720p', price:'₹29/mo', screens:2, order:1 },
    fhd:  { name:'Full HD',     quality:'1080p',price:'₹49/mo', screens:2, order:2 },
    uhd:  { name:'4K Ultra HD', quality:'4K',   price:'₹99/mo', screens:4, order:3 },
  },
};

// ─────────────────────────────────────────────────────────
//  Supabase client (loaded from CDN)
// ─────────────────────────────────────────────────────────
let _sb = null;
function getSB() {
  if (_sb) return _sb;
  if (typeof supabase === 'undefined') {
    console.error('Supabase CDN not loaded!');
    return null;
  }
  _sb = supabase.createClient(XVERSE.SUPABASE_URL, XVERSE.SUPABASE_KEY);
  return _sb;
}

// ─────────────────────────────────────────────────────────
//  AUTH HELPERS
// ─────────────────────────────────────────────────────────
const Auth = {
  // Get current session user (fast, no network)
  async getUser() {

  const { data: { session } } =
  await getSB().auth.getSession();

  return session?.user || null;
},

  // Get full profile from DB
  async getProfile(uid) {
    const { data } = await getSB()
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle(); // FIX: .single() throws 406 when no row exists (new users)
    return data;
  },

  // Get viewer profiles
  async getViewerProfiles(uid) {
    const { data } = await getSB()
      .from('viewer_profiles')
      .select('*')
      .eq('user_id', uid)
      .order('created_at');
    return data || [];
  },

  // Sign in with email
  async signIn(email, password) {
    return getSB().auth.signInWithPassword({ email, password });
  },

  // Sign up with email
  async signUp(email, password, name) {
    return getSB().auth.signUp({
      email, password,
      options: { data: { full_name: name } }
    });
  },

  // Google OAuth
  async googleSignIn() {
    return getSB().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/index.html' }
    });
  },

  // Sign out
  async signOut() {
    // Don't clear saved profile on sign out —
    // so the same user skips Who's Watching on next sign-in.
    // Profile is only cleared when "Switch Profile" is explicitly used.
    return getSB().auth.signOut();
  },

  // Reset password
  async resetPassword(email) {
    return getSB().auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/index.html?reset=1'
    });
  },

  // Update plan after payment
  async updatePlan(uid, plan) {
    const now = new Date();
    const end = new Date(now); end.setMonth(end.getMonth() + 1);
    return getSB().from('profiles').update({
      plan,
      plan_start:  now.toISOString(),
      plan_end:    end.toISOString(),
      plan_active: true,
    }).eq('id', uid);
  },

  // Can user access this content?
  canAccess(userPlan, requiredPlan) {
    const o = XVERSE.PLANS;
    return (o[userPlan]?.order ?? 0) >= (o[requiredPlan]?.order ?? 0);
  },
};

// ─────────────────────────────────────────────────────────
//  DATABASE HELPERS
// ─────────────────────────────────────────────────────────
const DB = {
  // ── MY LIST ──────────────────────────────────────────
  async getMyList(uid) {
    const { data } = await getSB()
      .from('my_list')
      .select('movie_id, added_at, movies(*)')
      .eq('user_id', uid)
      .order('added_at', { ascending: false });
    return (data || []).map(r => ({ ...r.movies, addedAt: r.added_at }));
  },

  async addToMyList(uid, movieId) {
    return getSB().from('my_list').upsert({ user_id: uid, movie_id: movieId });
  },

  async removeFromMyList(uid, movieId) {
    return getSB().from('my_list')
      .delete().eq('user_id', uid).eq('movie_id', movieId);
  },

  async isInMyList(uid, movieId) {
    const { data } = await getSB()
      .from('my_list')
      .select('id')
      .eq('user_id', uid)
      .eq('movie_id', movieId)
      .maybeSingle(); // FIX: .single() throws 406 when movie not in list
    return !!data;
  },

  // ── CONTINUE WATCHING ────────────────────────────────
  async getContinueWatching(uid) {
    const { data } = await getSB()
      .from('continue_watching')
      .select('*, movies(*)')
      .eq('user_id', uid)
      .order('updated_at', { ascending: false });
    return (data || []).map(r => ({
      ...r.movies,
      progress:    r.progress_sec,
      duration:    r.duration_sec,
      completed:   r.completed,
      updatedAt:   r.updated_at,
      // TV show resume: last watched season + episode
      lastSeason:  r.last_season  || 1,
      lastEpisode: r.last_episode || 1,
    }));
  },

  async updateEmbedStatus(movieId, working, source = null) {
    const updates = {
      embed_working: working,
      last_checked:  new Date().toISOString(),
    };
    if (source) updates.embed_source = source;
    return getSB().from('movies').update(updates).eq('id', movieId);
  },

  async logSubscription(uid, plan, paymentId, amountINR) {
    // Log payment to subscriptions table (for audit trail)
    return getSB().from('subscriptions').insert({
      user_id:    uid,
      plan,
      amount:     amountINR,
      currency:   'INR',
      payment_id: paymentId || null,
      gateway:    'cashfree',
      status:     'active',
      starts_at:  new Date().toISOString(),
    });
  },

  // FIX: function signature was missing — caused SyntaxError breaking the ENTIRE app
  async upsertContinueWatching(uid, movieId, progressSec, durationSec, extraData = {}) {
    const completed = durationSec > 0 && (progressSec / durationSec) > 0.9;
    return getSB().from('continue_watching').upsert({
      user_id:      uid,
      movie_id:     movieId,
      progress_sec: progressSec,
      duration_sec: durationSec,
      completed,
      updated_at:   new Date().toISOString(),
      // Store last-watched season/episode for TV shows (ignored if column doesn't exist)
      ...(extraData.season  ? { last_season:  extraData.season  } : {}),
      ...(extraData.episode ? { last_episode: extraData.episode } : {}),
    }, { onConflict: 'user_id,movie_id' });
  },

  async removeContinueWatching(uid, movieId) {
    return getSB().from('continue_watching')
      .delete().eq('user_id', uid).eq('movie_id', movieId);
  },

  // ── WATCH HISTORY ────────────────────────────────────
  async getHistory(uid, limit = 50) {
    const { data } = await getSB()
      .from('watch_history')
      .select('*, movies(*)')
      .eq('user_id', uid)
      .order('watched_at', { ascending: false })
      .limit(limit);
    return (data || []).map(r => ({ ...r.movies, watchedAt: r.watched_at }));
  },

  async addToHistory(uid, movieId) {
    return getSB().from('watch_history').upsert({
      user_id:    uid,
      movie_id:   movieId,
      watched_at: new Date().toISOString(),
    }, { onConflict: 'user_id,movie_id' });
  },

  async clearHistory(uid) {
    return getSB().from('watch_history').delete().eq('user_id', uid);
  },

  // ── MOVIES ───────────────────────────────────────────
  async getMovies({ type, lang, genre, featured, limit = 30, page = 0 } = {}) {
    let q = getSB().from('movies').select('*').eq('status', 'active');
    if (type)     q = q.eq('type', type);
    if (lang)     q = q.eq('language', lang);
    if (featured) q = q.eq('featured', true);
    if (genre)    q = q.contains('genres', [genre]);
    return q.order('created_at', { ascending: false })
            .range(page * limit, (page + 1) * limit - 1);
  },

  async getAllMovies(limit = 100) {

  const { data } = await getSB()
    .from('movies')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit);

  return data || [];
},

  async getMovie(id) {
    const { data } = await getSB().from('movies').select('*').eq('id', id).single();
    return data;
  },

  async searchMovies(query) {
    const { data } = await getSB().from('movies')
      .select('*')
      .eq('status', 'active')
      .ilike('title', `%${query}%`)
      .limit(20);
    return data || [];
  },

  async getFeatured() {
    const { data } = await getSB().from('movies')
      .select('*')
      .eq('featured', true)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(7);
    return data || [];
  },

  async incrementViews(movieId) {
    return getSB().rpc('increment_views', { movie_id: movieId });
  },

  // ── NOTIFICATIONS ────────────────────────────────────
  async getNotifications(uid) {
    const { data } = await getSB()
      .from('notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(30);
    return data || [];
  },

  async markNotifRead(id) {
    return getSB().from('notifications').update({ is_read: true }).eq('id', id);
  },

  async markAllNotifsRead(uid) {
    return getSB().from('notifications')
      .update({ is_read: true }).eq('user_id', uid);
  },

  // ── VIEWER PROFILES ──────────────────────────────────
  async addViewerProfile(uid, name, avatarUrl = null, isKids = false) {
    return getSB().from('viewer_profiles').insert({
      user_id: uid, name, avatar_url: avatarUrl, is_kids: isKids,
    });
  },

  async updateViewerProfile(id, updates) {
    return getSB().from('viewer_profiles').update(updates).eq('id', id);
  },

  async deleteViewerProfile(id) {
    return getSB().from('viewer_profiles').delete().eq('id', id);
  },
};

// ─────────────────────────────────────────────────────────
//  TMDB HELPERS
// ─────────────────────────────────────────────────────────
const TMDB = {
  async fetch(path, params = {}) {
    const url = new URL(XVERSE.TMDB_BASE + path);
    url.searchParams.set('api_key', XVERSE.TMDB_KEY);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
    const proxies = [
      url.toString(),
      'https://corsproxy.io/?' + encodeURIComponent(url.toString()),
    ];
    for (const u of proxies) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
        if (r.ok) return r.json();
      } catch(e) {}
    }
    return null;
  },

  img(path, size = 'w500') {
    return path ? XVERSE.TMDB_IMG + size + path : null;
  },

  normalize(item) {
    const isTV = item.media_type === 'tv' || item.name;
    return {
      tmdb_id:      item.id,
      title:        item.title || item.name,
      type:         isTV ? 'tv' : 'movie',
      year:         (item.release_date || item.first_air_date || '').slice(0,4),
      rating:       item.vote_average?.toFixed(1),
      overview:     item.overview,
      poster_url:   TMDB.img(item.poster_path),
      backdrop_url: TMDB.img(item.backdrop_path, 'w1280'),
      genres:       [],
    };
  },

  async trending()    { return this.fetch('/trending/all/week'); },
  async topMovies()   { return this.fetch('/movie/top_rated', { region:'IN' }); },
  async topTV()       { return this.fetch('/tv/top_rated'); },
  async popularMov()  { return this.fetch('/movie/popular', { region:'IN' }); },
  async popularTV()   { return this.fetch('/tv/popular'); },
  async upcoming()    { return this.fetch('/movie/upcoming', { region:'IN' }); },
  async nowPlaying()  { return this.fetch('/movie/now_playing', { region:'IN' }); },
  async hindiMovies() { return this.fetch('/discover/movie', { with_original_language:'hi', sort_by:'popularity.desc', region:'IN' }); },
  async southMovies() { return this.fetch('/discover/movie', { with_original_language:'te', sort_by:'popularity.desc' }); },
  async movieDetails(id)  { return this.fetch(`/movie/${id}`, { append_to_response:'credits,videos,similar' }); },
  async tvDetails(id)     { return this.fetch(`/tv/${id}`,    { append_to_response:'credits,videos,similar,seasons' }); },
  async tvSeason(id, s)   { return this.fetch(`/tv/${id}/season/${s}`); },
  async search(q)         { return this.fetch('/search/multi', { query:q }); },
};

// ─────────────────────────────────────────────────────────
//  SESSION HELPERS  (localStorage — persists across tabs + restarts)
// ─────────────────────────────────────────────────────────
const Session = {
  setProfile(profile) {
    localStorage.setItem('xverse_active_profile', JSON.stringify(profile));
  },
  getProfile() {
    try { return JSON.parse(localStorage.getItem('xverse_active_profile')); }
    catch { return null; }
  },
  clearProfile() {
    localStorage.removeItem('xverse_active_profile');
  },
};

// ─────────────────────────────────────────────────────────
//  GLOBAL TOAST
// ─────────────────────────────────────────────────────────
let _toastTimer;
function showToast(msg, duration = 2800) {
  let t = document.getElementById('xv-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'xv-toast';
    t.style.cssText = 'position:fixed;bottom:26px;right:22px;background:rgba(15,15,15,.97);border:1px solid rgba(255,255,255,.13);color:#fff;padding:10px 18px;border-radius:6px;font-size:.82rem;opacity:0;pointer-events:none;z-index:99999;transition:opacity .25s;backdrop-filter:blur(8px);box-shadow:0 4px 20px rgba(0,0,0,.5);font-family:Barlow,sans-serif;max-width:300px';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.style.opacity = '0', duration);
}

// ─────────────────────────────────────────────────────────
//  AUTH GUARD  — call on every protected page
// ─────────────────────────────────────────────────────────
async function requireAuth(redirectTo = 'index.html') {

  const sb = getSB();

  // FIRST TRY
  let { data: { session } } = await sb.auth.getSession();

  // Wait little if session restoring
  if (!session) {

    await new Promise(resolve => setTimeout(resolve, 1200));

    const retry = await sb.auth.getSession();

    session = retry.data.session;
  }

  // FINAL CHECK
  if (!session) {

    console.warn('No session found → redirecting');

    window.location.replace(redirectTo);

    return null;
  }

  return session.user;
}

// ─────────────────────────────────────────────────────────
//  NAV AVATAR — shared across all pages
// ─────────────────────────────────────────────────────────
async function initNavAvatar(avatarElId = 'navAvatar') {
  const el = document.getElementById(avatarElId);
  if (!el) return;
  const profile = Session.getProfile();
  const user    = await Auth.getUser();
  if (!user) return;

  const name  = profile?.name || user.email?.split('@')[0] || 'User';
  const email = user.email || '';

  if (profile?.avatar_url || user.user_metadata?.avatar_url) {
    const img = document.createElement('img');
    img.src   = profile?.avatar_url || user.user_metadata?.avatar_url;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit';
    img.onerror = () => { img.remove(); el.textContent = name[0].toUpperCase(); };
    el.innerHTML = '';
    el.appendChild(img);
  } else {
    el.textContent = name[0].toUpperCase();
  }

  const menuId = avatarElId + '_menu';

  function closeMenu() {
    const m = document.getElementById(menuId);
    if (m) m.remove();
    document.removeEventListener('click', outsideClick);
  }
  function outsideClick(e) {
    const m = document.getElementById(menuId);
    if (m && !m.contains(e.target) && e.target !== el) closeMenu();
  }

  el.onclick = (e) => {
    e.stopPropagation();
    if (document.getElementById(menuId)) { closeMenu(); return; }

    const rect = el.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id    = menuId;
    menu.style.cssText = `position:fixed;top:${rect.bottom+8}px;right:${window.innerWidth-rect.right}px;
      background:#1a1a1a;border:1px solid rgba(255,255,255,.12);border-radius:8px;min-width:210px;
      box-shadow:0 8px 32px rgba(0,0,0,.6);z-index:9999;overflow:hidden;animation:menuFadeIn .15s ease`;

    if (!document.getElementById('xvMenuStyle')) {
      const s = document.createElement('style');
      s.id = 'xvMenuStyle';
      s.textContent = `@keyframes menuFadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        .xvm-item{display:flex;align-items:center;gap:10px;padding:11px 16px;font-size:.84rem;
          color:rgba(255,255,255,.8);cursor:pointer;font-family:'Barlow',sans-serif;transition:background .15s;
          border:none;background:none;width:100%;text-align:left}
        .xvm-item:hover{background:rgba(255,255,255,.07);color:#fff}
        .xvm-item.danger{color:#ff6b6b}.xvm-item.danger:hover{background:rgba(229,9,20,.1);color:#ff4444}
        .xvm-sep{height:1px;background:rgba(255,255,255,.08);margin:4px 0}
        .xvm-header{padding:12px 16px 10px;border-bottom:1px solid rgba(255,255,255,.08)}
        .xvm-name{font-size:.88rem;font-weight:700;color:#fff}
        .xvm-email{font-size:.7rem;color:rgba(255,255,255,.38);margin-top:2px;word-break:break-all}`;
      document.head.appendChild(s);
    }

    Auth.getProfile(user.id).then(p => {
      const isAdmin = p?.is_admin || p?.role === 'admin' || p?.role === 'moderator';
      if (isAdmin) { const b = menu.querySelector('#xvm-admin-btn'); if (b) b.style.display='flex'; }
    });

    menu.innerHTML = `
      <div class="xvm-header">
        <div class="xvm-name">${name}</div>
        <div class="xvm-email">${email}</div>
      </div>
      <button class="xvm-item" onclick="window.location.href='XverseMovies_Settings.html'">⚙️ &nbsp;Account Settings</button>
      <button class="xvm-item" onclick="xvSwitchProfile()">👥 &nbsp;Switch Profile</button>
      <button class="xvm-item" id="xvm-admin-btn" style="display:none" onclick="window.location.href='XverseMovies_Admin.html'">🛡️ &nbsp;Admin Panel</button>
      <div class="xvm-sep"></div>
      <button class="xvm-item danger" onclick="xvSignOut()">🚪 &nbsp;Sign Out</button>`;

    document.body.appendChild(menu);
    // 50ms delay prevents the same touch event that opened the menu from immediately closing it
    setTimeout(() => document.addEventListener('click', outsideClick), 50);
  };
}

// Sign out — profile NOT cleared, so same user skips Who's Watching on return
async function xvSignOut() {
  await Auth.signOut();
  window.location.href = 'index.html';
}

// Switch profile — CLEARS saved profile so Who's Watching shows for selection
function xvSwitchProfile() {
  Session.setProfile(null);
  window.location.href = 'index.html';
}

// ─────────────────────────────────────────────────────────
//  NOTIFICATION BELL HANDLER  — works on any page
//  Usage: call initBellHandler('bellBtnId', currentUser.id) after login
// ─────────────────────────────────────────────────────────
function initBellHandler(bellElId, userId) {
  const bell = document.getElementById(bellElId);
  if (!bell || !userId) return;

  // Load initial unread count
  DB.getNotifications(userId).then(notifs => {
    const unread = notifs.filter(n => !n.is_read).length;
    const dot = document.querySelector('.notif-dot');
    if (dot && unread > 0) dot.classList.add('show');
  }).catch(() => {});

  bell.addEventListener('click', async (e) => {
    e.stopPropagation();

    const existing = document.getElementById('xvNotifPanel');
    if (existing) {
      existing.remove();
      document.removeEventListener('click', window._xvNClose);
      return;
    }

    // Build panel
    const panel = document.createElement('div');
    panel.id = 'xvNotifPanel';
    const isMobile = window.innerWidth <= 640;
    const navH = document.querySelector('nav')?.offsetHeight || 68;

    Object.assign(panel.style, {
      position: 'fixed',
      top: isMobile ? navH + 'px' : (bell.getBoundingClientRect().bottom + 8) + 'px',
      left: isMobile ? '0' : 'auto',
      right: isMobile ? '0' : '16px',
      zIndex: '9999',
      background: '#141414',
      border: isMobile ? 'none' : '1px solid rgba(255,255,255,.14)',
      borderBottom: isMobile ? '1px solid rgba(255,255,255,.1)' : 'none',
      borderRadius: isMobile ? '0' : '10px',
      width: isMobile ? '100%' : '360px',
      maxHeight: isMobile ? '75vh' : '480px',
      overflowY: 'auto',
      boxShadow: isMobile ? 'none' : '0 8px 40px rgba(0,0,0,.7)',
      backdropFilter: 'blur(12px)',
      fontFamily: "'Barlow', sans-serif",
    });

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);position:sticky;top:0;background:rgba(20,20,20,.98);backdrop-filter:blur(12px)">
        <span style="font-size:.9rem;font-weight:700;color:#fff;display:flex;align-items:center;gap:8px">
          Notifications
          <span id="xvNBadge" style="background:#E50914;color:#fff;font-size:.58rem;font-weight:800;min-width:17px;height:17px;border-radius:9px;display:none;align-items:center;justify-content:center;padding:0 4px"></span>
        </span>
        <button onclick="document.getElementById('xvNotifPanel')?.remove()" style="background:none;border:none;color:rgba(255,255,255,.5);cursor:pointer;font-size:1rem;padding:4px 8px;border-radius:4px;line-height:1">✕</button>
      </div>
      <div id="xvNList" style="padding:20px;text-align:center;color:rgba(255,255,255,.35);font-size:.84rem">
        <div style="font-size:2rem;margin-bottom:8px">🔔</div>Loading...
      </div>`;

    document.body.appendChild(panel);

    // Load notifications
    try {
      const notifs = await DB.getNotifications(userId);
      const unread = notifs.filter(n => !n.is_read).length;
      const badge = document.getElementById('xvNBadge');
      if (badge && unread > 0) { badge.style.display = 'inline-flex'; badge.textContent = unread; }

      const listEl = document.getElementById('xvNList');
      if (!listEl) return;

      const _fmt = ts => {
        if (!ts) return '';
        const s = Math.floor((Date.now() - new Date(ts)) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        return Math.floor(s / 86400) + 'd ago';
      };

      if (!notifs.length) {
        listEl.innerHTML = `<div><div style="font-size:2.2rem;margin-bottom:10px">🔔</div><div style="font-weight:600;color:rgba(255,255,255,.5)">No notifications yet</div><div style="font-size:.74rem;margin-top:4px;color:rgba(255,255,255,.25)">You're all caught up!</div></div>`;
        return;
      }

      listEl.style.cssText = 'padding:0;text-align:left';
      listEl.innerHTML = notifs.map(n => `
        <div onclick="xvMarkNotif(${n.id},this)" style="display:flex;gap:11px;padding:12px 15px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;position:relative;background:${n.is_read ? 'transparent' : 'rgba(229,9,20,.04)'};transition:background .15s" onmouseenter="this.style.background='rgba(255,255,255,.04)'" onmouseleave="this.style.background='${n.is_read ? 'transparent' : 'rgba(229,9,20,.04)'}'">
          ${!n.is_read ? `<span style="position:absolute;left:0;top:0;bottom:0;width:2px;background:#E50914;border-radius:0 1px 1px 0"></span>` : ''}
          <div style="width:44px;height:44px;border-radius:7px;background:${n.image_url ? 'transparent' : 'rgba(229,9,20,.12)'};flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:1.1rem">
            ${n.image_url ? `<img src="${n.image_url}" style="width:100%;height:100%;object-fit:cover">` : '🔔'}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:.83rem;font-weight:${n.is_read ? '500' : '700'};color:${n.is_read ? 'rgba(255,255,255,.65)' : '#fff'};margin-bottom:2px;line-height:1.35">${n.title}</div>
            ${n.body ? `<div style="font-size:.74rem;color:rgba(255,255,255,.45);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${n.body}</div>` : ''}
            <div style="font-size:.65rem;color:rgba(255,255,255,.27);margin-top:3px">${_fmt(n.created_at)}</div>
          </div>
        </div>`).join('');

      if (unread > 0) {
        listEl.innerHTML += `<div style="padding:10px 14px;position:sticky;bottom:0;background:rgba(20,20,20,.97)">
          <button onclick="xvMarkAllNotifs('${userId}')" style="width:100%;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);color:rgba(255,255,255,.68);padding:9px;font-size:.8rem;font-weight:600;border-radius:6px;cursor:pointer;font-family:'Barlow',sans-serif;transition:all .2s" onmouseenter="this.style.background='rgba(255,255,255,.12)'" onmouseleave="this.style.background='rgba(255,255,255,.07)'">✓ Mark All as Read</button>
        </div>`;
        // Auto-clear dot
        setTimeout(() => document.querySelector('.notif-dot')?.classList.remove('show'), 2500);
      }
    } catch {
      const listEl = document.getElementById('xvNList');
      if (listEl) listEl.innerHTML = `<div style="color:rgba(255,100,100,.7);font-size:.82rem">Could not load notifications.</div>`;
    }

    // Close on outside click
    setTimeout(() => {
      window._xvNClose = ev => {
        const p = document.getElementById('xvNotifPanel');
        if (!p) { document.removeEventListener('click', window._xvNClose); return; }
        if (!p.contains(ev.target) && ev.target !== bell) {
          p.remove();
          document.removeEventListener('click', window._xvNClose);
        }
      };
      document.addEventListener('click', window._xvNClose);
    }, 50);
  });
}

async function xvMarkNotif(id, el) {
  await DB.markNotifRead(id).catch(() => {});
  if (el) { el.style.background = 'transparent'; const bar = el.querySelector('span[style*="E50914"]'); if (bar) bar.remove(); }
}

async function xvMarkAllNotifs(userId) {
  await DB.markAllNotifsRead(userId).catch(() => {});
  document.getElementById('xvNotifPanel')?.remove();
  document.querySelector('.notif-dot')?.classList.remove('show');
  showToast('✓ All notifications marked as read');
}

// ─────────────────────────────────────────────────────────
//  MOBILE BOTTOM NAV  — shared CSS injected once per page
// ─────────────────────────────────────────────────────────
function injectMobNavCSS() {
  if (document.getElementById('xvMobNavStyle')) return;
  const s = document.createElement('style');
  s.id = 'xvMobNavStyle';
  s.textContent = `
.xv-mob-nav{position:fixed;bottom:0;left:0;right:0;height:58px;background:rgba(8,8,8,.97);border-top:1px solid rgba(255,255,255,.08);z-index:998;display:none;align-items:center;justify-content:space-around;padding:0 4px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);-webkit-tap-highlight-color:transparent}
.xv-mob-nav a,.xv-mob-nav button{display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;padding:7px 2px 5px;color:rgba(255,255,255,.42);text-decoration:none;font-size:.56rem;font-weight:600;font-family:'Barlow',sans-serif;background:none;border:none;cursor:pointer;transition:color .2s;letter-spacing:.2px;-webkit-tap-highlight-color:transparent;min-width:0;overflow:hidden}
.xv-mob-nav a.xv-active,.xv-mob-nav button.xv-active{color:#fff}
.xv-mob-nav a.xv-active svg{stroke:#E50914}
.xv-mob-nav a svg,.xv-mob-nav button svg{width:22px;height:22px;flex-shrink:0;transition:all .2s;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.xv-mob-nav a.xv-active-fill svg{fill:#E50914;stroke:none}
@media(max-width:640px){.xv-mob-nav{display:flex}body{padding-bottom:58px!important}}`;
  document.head.appendChild(s);
}
