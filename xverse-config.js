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
  async movieDetails(id)  { return this.fetch(`/movie/${id}`, { append_to_response:'credits,videos,similar,release_dates,keywords' }); },
  async tvDetails(id)     { return this.fetch(`/tv/${id}`,    { append_to_response:'credits,videos,similar,seasons,content_ratings,keywords' }); },
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
    setTimeout(() => document.addEventListener('click', outsideClick), 0);
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

// ═════════════════════════════════════════════════════════════════
//  ML  —  Centralized My List Manager
//
//  Single source of truth for My List across every page.
//  ALL pages call ML.init(uid) once, then use ML.has / ML.toggle.
//
//  Eliminates all five bugs:
//    A) Single key = String(movie.id) — no more dual tmdb_id fallback
//    B) One implementation shared by Home, Browse, Player, MyList
//    C) Every Supabase write is error-checked and surfaces failures
//    D) getList filters out null-join rows before storing
//    E) Browse now has real "already in list" state via ML.has()
//
//  Rule: ONLY movies with a DB id (integer) can be saved.
//        TMDB-only content (trending rows without m.id) shows a
//        clear message instead of a silent no-op.
// ═════════════════════════════════════════════════════════════════
const ML = {
  _uid:  null,
  _ids:  new Set(),   // Set<string> of String(movie.id)
  _data: [],          // full movie objects from DB (with addedAt)

  /* ── init ─────────────────────────────────────────────────────
     Call once per page after auth, before rendering any cards.
     Fetches the user's list from Supabase and populates state.    */
  async init(uid) {
    if (!uid) return;
    this._uid = uid;
    try {
      const sb   = getSB();
      const { data, error } = await sb
        .from('my_list')
        .select('movie_id, added_at, movies(*)')
        .eq('user_id', uid)
        .order('added_at', { ascending: false });

      if (error) { console.error('ML.init fetch error:', error); return; }

      // BUG D FIX: filter rows where the movie join returned null
      // (can happen if a movie was deleted outside the FK cascade)
      const valid = (data || []).filter(r => r.movies && r.movies.id);

      this._data = valid.map(r => ({ ...r.movies, addedAt: r.added_at }));
      this._ids  = new Set(this._data.map(m => String(m.id)));
    } catch (e) {
      console.error('ML.init exception:', e);
    }
  },

  /* ── has ──────────────────────────────────────────────────────
     Returns true if movie with this DB id is in the list.
     Always pass movie.id (integer), never tmdb_id.                */
  has(movieId) {
    if (!movieId) return false;
    return this._ids.has(String(movieId));
  },

  /* ── toggle ───────────────────────────────────────────────────
     The one function all Add/Remove buttons should call.
     Returns: true  = just added
              false = just removed
              null  = failed or not applicable                     */
  async toggle(movie) {
    if (!this._uid) {
      showToast('⚠️ Please log in first');
      return null;
    }
    // BUG A FIX: only DB movies (with integer id) can be saved.
    // TMDB-only rows have no id and cannot be stored in my_list
    // because the FK requires a real movies.id.
    if (!movie || !movie.id) {
      showToast('ℹ️ Not in the library yet — ask admin to add it');
      return null;
    }

    if (this.has(movie.id)) {
      return this._remove(movie.id);
    } else {
      return this._add(movie);
    }
  },

  /* ── _add (internal) ─────────────────────────────────────────  */
  async _add(movie) {
    // BUG C FIX: check the error instead of ignoring it
    const { error } = await getSB()
      .from('my_list')
      .upsert({ user_id: this._uid, movie_id: movie.id },
              { onConflict: 'user_id,movie_id' });

    if (error) {
      console.error('ML._add error:', error);
      showToast('❌ Could not save — ' + (error.message || 'try again'));
      return null;
    }

    // Optimistic local update (no re-fetch needed)
    this._ids.add(String(movie.id));
    if (!this._data.find(m => m.id === movie.id)) {
      this._data.unshift({ ...movie, addedAt: new Date().toISOString() });
    }
    showToast('✅ Added to My List');
    return true;
  },

  /* ── _remove (internal) ──────────────────────────────────────  */
  async _remove(movieId) {
    const { error } = await getSB()
      .from('my_list')
      .delete()
      .eq('user_id', this._uid)
      .eq('movie_id', movieId);

    if (error) {
      console.error('ML._remove error:', error);
      showToast('❌ Could not remove — ' + (error.message || 'try again'));
      return null;
    }

    this._ids.delete(String(movieId));
    this._data = this._data.filter(m => m.id !== movieId);
    showToast('Removed from My List');
    return false;
  },

  /* ── getData ──────────────────────────────────────────────────
     Full array of saved movie objects for the MyList page.        */
  getData() { return [...this._data]; },

  /* ── removeLocal ──────────────────────────────────────────────
     Used by MyList page for optimistic undo — splices without DB. */
  removeLocal(movieId) {
    this._ids.delete(String(movieId));
    const idx = this._data.findIndex(m => m.id === movieId);
    if (idx === -1) return null;
    const [removed] = this._data.splice(idx, 1);
    return { ...removed, _idx: idx };
  },

  restoreLocal(snapshot) {
    if (!snapshot) return;
    this._ids.add(String(snapshot.id));
    this._data.splice(snapshot._idx, 0, snapshot);
  },
};

// ─────────────────────────────────────────────────────────
//  SHARED NOTIFICATION PANEL
//  Netflix-style slide-in drawer — works on every page.
//
//  Usage in any page:
//    1. Bell button: onclick="XvNotif.toggle()"
//    2. Add class "_xvNP-dot" on the red dot span  ← auto-hides/shows
//    3. In page init:  XvNotif.init(currentUser.id);
// ─────────────────────────────────────────────────────────
const XvNotif = {
  _uid:   null,
  _items: [],
  _open:  false,
  _tab:   'all',

  /* Call once after auth. Fire-and-forget is fine. */
  async init(uid) {
    this._uid = uid;
    this._inject();
    try {
      this._items = await DB.getNotifications(uid);
    } catch(e) { this._items = []; }
    this._badge();
    this._render();
  },

  /* Toggle open / close */
  toggle() {
    this._open = !this._open;
    const p  = document.getElementById('_xvNP');
    const ov = document.getElementById('_xvNPOv');
    if (p)  p.classList.toggle('_xvNP-open', this._open);
    if (ov) ov.classList.toggle('_xvNPOv-show', this._open);
    if (this._open) this._render();
  },

  close() { if (this._open) this.toggle(); },

  /* Switch All / Unread tabs */
  setTab(tab, btn) {
    this._tab = tab;
    document.querySelectorAll('._xvNP-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this._render();
  },

  /* Mark single notification read */
  async markRead(id) {
    DB.markNotifRead(id).catch(() => {});
    this._items = this._items.map(n => n.id === id ? { ...n, is_read: true } : n);
    this._badge();
    this._render();
  },

  /* Mark all read */
  async markAllRead() {
    if (!this._uid) return;
    try { await DB.markAllNotifsRead(this._uid); } catch(e) {}
    this._items = this._items.map(n => ({ ...n, is_read: true }));
    this._badge();
    this._render();
    showToast('✅ All marked as read');
  },

  /* ── private ── */

  _render() {
    const list = document.getElementById('_xvNPList');
    if (!list) return;

    let items = this._tab === 'unread'
      ? this._items.filter(n => !n.is_read)
      : [...this._items];

    if (!items.length) {
      list.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                    padding:52px 20px;text-align:center">
          <div style="font-size:2.6rem;margin-bottom:14px;opacity:.25">🔔</div>
          <div style="font-size:.9rem;font-weight:700;color:rgba(255,255,255,.45);margin-bottom:6px">
            ${this._tab === 'unread' ? 'Sab read ho gayi' : 'Abhi koi notification nahi'}
          </div>
          <div style="font-size:.76rem;color:rgba(255,255,255,.25);line-height:1.55">
            Nayi notifications yahan dikhegi
          </div>
        </div>`;
      return;
    }

    list.innerHTML = items.map(n => `
      <div class="_xvNP-item${n.is_read ? '' : ' _xvNP-unread'}"
           onclick="XvNotif.markRead(${n.id})" role="button">
        <img class="_xvNP-thumb"
             src="${n.image_url || 'https://ui-avatars.com/api/?name=XV&background=E50914&color=fff&size=64'}"
             onerror="this.src='https://ui-avatars.com/api/?name=XV&background=333&color=555&size=64'">
        <div class="_xvNP-body">
          <div class="_xvNP-ttl">
            ${!n.is_read ? '<span class="_xvNP-unread-dot"></span>' : ''}
            ${n.title || ''}
          </div>
          <div class="_xvNP-desc">${n.body || ''}</div>
          <div class="_xvNP-time">${this._timeAgo(n.created_at)}</div>
        </div>
      </div>`).join('');
  },

  _badge() {
    const u = this._items.filter(n => !n.is_read).length;

    /* Update count labels inside the panel */
    const cnt = document.getElementById('_xvNPCnt');
    if (cnt) { cnt.textContent = u > 99 ? '99+' : u; cnt.style.display = u ? 'flex' : 'none'; }

    /* Update every bell dot on the page that has class _xvNP-dot */
    document.querySelectorAll('._xvNP-dot').forEach(el => {
      el.style.display = u ? 'block' : 'none';
    });
  },

  _timeAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60)    return 'just now';
    if (s < 3600)  return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  },

  /* Inject CSS + HTML once */
  _inject() {
    if (document.getElementById('_xvNPStyle')) return;

    /* ── CSS ── */
    const css = document.createElement('style');
    css.id = '_xvNPStyle';
    css.textContent = `
      #_xvNPOv{position:fixed;inset:0;z-index:9000;display:none}
      #_xvNPOv._xvNPOv-show{display:block}
      #_xvNP{
        position:fixed;top:0;right:0;width:360px;height:100vh;
        background:rgba(9,9,9,.98);border-left:1px solid rgba(255,255,255,.08);
        z-index:9001;transform:translateX(100%);
        transition:transform .3s cubic-bezier(.4,0,.2,1);
        display:flex;flex-direction:column;
        backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
        box-shadow:-8px 0 32px rgba(0,0,0,.5)
      }
      #_xvNP._xvNP-open{transform:translateX(0)}
      ._xvNP-hd{
        display:flex;align-items:center;justify-content:space-between;
        padding:18px 18px 14px;border-bottom:1px solid rgba(255,255,255,.07);
        flex-shrink:0
      }
      ._xvNP-title{
        font-family:'Bebas Neue',cursive;font-size:1.15rem;letter-spacing:1.5px;
        color:#fff;display:flex;align-items:center;gap:9px
      }
      ._xvNP-cnt{
        background:#E50914;color:#fff;font-family:'Barlow',sans-serif;
        font-size:.6rem;font-weight:800;min-width:18px;height:18px;
        border-radius:9px;display:flex;align-items:center;justify-content:center;
        padding:0 5px;letter-spacing:0
      }
      ._xvNP-x{
        background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);
        color:rgba(255,255,255,.55);cursor:pointer;width:30px;height:30px;
        border-radius:50%;display:flex;align-items:center;justify-content:center;
        font-size:.85rem;transition:all .18s
      }
      ._xvNP-x:hover{background:rgba(255,255,255,.14);color:#fff}
      ._xvNP-tabs{
        display:flex;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0
      }
      ._xvNP-tab{
        flex:1;background:none;border:none;border-bottom:2px solid transparent;
        color:rgba(255,255,255,.4);font-size:.8rem;font-weight:600;
        padding:10px 6px;cursor:pointer;font-family:'Barlow',sans-serif;
        transition:all .2s;margin-bottom:-1px
      }
      ._xvNP-tab.active{color:#fff;border-bottom-color:#E50914}
      ._xvNP-list{
        flex:1;overflow-y:auto;
        scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.08) transparent
      }
      ._xvNP-list::-webkit-scrollbar{width:4px}
      ._xvNP-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
      ._xvNP-item{
        display:flex;gap:12px;padding:13px 16px;
        border-bottom:1px solid rgba(255,255,255,.05);
        cursor:pointer;transition:background .17s;position:relative
      }
      ._xvNP-item:hover{background:rgba(255,255,255,.04)}
      ._xvNP-unread{background:rgba(229,9,20,.04)}
      ._xvNP-unread::before{
        content:'';position:absolute;left:0;top:0;bottom:0;
        width:3px;background:#E50914;border-radius:0 2px 2px 0
      }
      ._xvNP-thumb{
        width:52px;height:52px;border-radius:6px;object-fit:cover;
        flex-shrink:0;background:#1e1e1e
      }
      ._xvNP-body{flex:1;min-width:0}
      ._xvNP-ttl{
        font-size:.83rem;font-weight:600;color:#fff;
        margin-bottom:3px;line-height:1.35;display:flex;align-items:center;gap:6px
      }
      ._xvNP-unread-dot{
        width:6px;height:6px;background:#E50914;border-radius:50%;
        flex-shrink:0;margin-top:1px
      }
      ._xvNP-desc{
        font-size:.74rem;color:rgba(255,255,255,.42);line-height:1.45;
        margin-bottom:4px;
        display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden
      }
      ._xvNP-time{font-size:.65rem;color:rgba(255,255,255,.22)}
      ._xvNP-ft{
        padding:12px 14px;border-top:1px solid rgba(255,255,255,.07);
        flex-shrink:0;display:flex;gap:8px
      }
      ._xvNP-mark{
        flex:1;background:rgba(255,255,255,.06);
        border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.62);
        padding:9px;font-size:.78rem;font-weight:600;border-radius:6px;
        cursor:pointer;font-family:'Barlow',sans-serif;transition:all .2s
      }
      ._xvNP-mark:hover{background:rgba(255,255,255,.11);color:#fff}
      ._xvNP-cfg{
        background:rgba(229,9,20,.08);border:1px solid rgba(229,9,20,.18);
        color:#E50914;padding:9px 13px;font-size:.78rem;font-weight:600;
        border-radius:6px;cursor:pointer;font-family:'Barlow',sans-serif;
        transition:all .2s;white-space:nowrap
      }
      ._xvNP-cfg:hover{background:rgba(229,9,20,.16)}
      @media(max-width:480px){
        #_xvNP{width:100vw;border-left:none}
      }
    `;
    document.head.appendChild(css);

    /* ── Overlay ── */
    const ov = document.createElement('div');
    ov.id = '_xvNPOv';
    ov.onclick = () => XvNotif.close();
    document.body.appendChild(ov);

    /* ── Panel ── */
    const panel = document.createElement('div');
    panel.id = '_xvNP';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Notifications');
    panel.innerHTML = `
      <div class="_xvNP-hd">
        <div class="_xvNP-title">
          Notifications
          <span class="_xvNP-cnt" id="_xvNPCnt" style="display:none">0</span>
        </div>
        <button class="_xvNP-x" onclick="XvNotif.close()" aria-label="Close">✕</button>
      </div>
      <div class="_xvNP-tabs">
        <button class="_xvNP-tab active" onclick="XvNotif.setTab('all',this)">All</button>
        <button class="_xvNP-tab" onclick="XvNotif.setTab('unread',this)">Unread</button>
      </div>
      <div class="_xvNP-list" id="_xvNPList">
        <div style="display:flex;flex-direction:column;align-items:center;
                    justify-content:center;padding:52px 20px;text-align:center">
          <div style="width:28px;height:28px;border:2px solid rgba(229,9,20,.4);
                      border-top-color:#E50914;border-radius:50%;
                      animation:_xvSpin .8s linear infinite;margin-bottom:14px"></div>
          <div style="font-size:.8rem;color:rgba(255,255,255,.3)">Loading…</div>
        </div>
      </div>
      <div class="_xvNP-ft">
        <button class="_xvNP-mark" onclick="XvNotif.markAllRead()">✓ Mark All Read</button>
        <button class="_xvNP-cfg"
          onclick="XvNotif.close();window.location.href='XverseMovies_Settings.html#notifs'">
          ⚙ Settings
        </button>
      </div>`;
    document.body.appendChild(panel);

    /* Spinner keyframes */
    const spin = document.createElement('style');
    spin.textContent = '@keyframes _xvSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(spin);

    /* Close on Escape key */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && XvNotif._open) XvNotif.close();
    });
  },
};

// ─────────────────────────────────────────────────────────
//  SERVICE WORKER UPDATE HANDLER
//  When a new service worker activates, reload the page so
//  fresh files (including this config) are used immediately.
//  Prevents "XvNotif is not defined" from stale SW cache.
// ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  var _xvSwRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (!_xvSwRefreshing) {
      _xvSwRefreshing = true;
      window.location.reload();
    }
  });
}
