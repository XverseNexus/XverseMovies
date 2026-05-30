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
      .single();
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
    sessionStorage.removeItem('xverse_active_profile');
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
      .single();
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
      progress:  r.progress_sec,
      duration:  r.duration_sec,
      completed: r.completed,
      updatedAt: r.updated_at,
    }));
  },

  async upsertContinueWatching(uid, movieId, progressSec, durationSec) {
    const completed = durationSec > 0 && (progressSec / durationSec) > 0.9;
    return getSB().from('continue_watching').upsert({
      user_id:      uid,
      movie_id:     movieId,
      progress_sec: progressSec,
      duration_sec: durationSec,
      completed,
      updated_at:   new Date().toISOString(),
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

  // ── TMDB MOVIE PERSISTENCE ─────────────────────────────
async ensureMovieFromTMDB(tmdbMovie) {
  // tmdbMovie is the normalized object from TMDB.normalize()
  if (!tmdbMovie.tmdb_id) return null;
  
  const { data, error } = await getSB()
    .rpc('ensure_tmdb_movie', {
      p_tmdb_id: tmdbMovie.tmdb_id,
      p_title: tmdbMovie.title,
      p_type: tmdbMovie.type,
      p_poster_url: tmdbMovie.poster_url,
      p_backdrop_url: tmdbMovie.backdrop_url,
      p_year: tmdbMovie.year,
      p_rating: tmdbMovie.rating,
      p_overview: tmdbMovie.overview
    });
  
  if (error) {
    console.error('ensureMovieFromTMDB error', error);
    return null;
  }
  return data; // returns the movie id
},

async getOrCreateMovie(movieLike) {
  // If it already has an 'id' (from DB), just return it
  if (movieLike.id) return movieLike;
  
  // If it has tmdb_id, ensure it's in DB and fetch full record
  if (movieLike.tmdb_id) {
    const newId = await DB.ensureMovieFromTMDB(movieLike);
    if (newId) {
      const { data } = await getSB().from('movies').select('*').eq('id', newId).single();
      return data;
    }
  }
  return null;
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
  try {
    await getSB().rpc('increment_views', { movie_id: movieId });
  } catch(e) { console.warn('incrementViews failed', e); }
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
//  GLOBAL HELPER: remove duplicate movies by tmdb_id
// ─────────────────────────────────────────────────────────
function removeDuplicateMovies(dbMovies, tmdbMovies) {
  const existingTmdbIds = new Set(dbMovies.map(m => m.tmdb_id).filter(Boolean));
  return tmdbMovies.filter(tm => !existingTmdbIds.has(tm.tmdb_id));
}

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
//  SESSION HELPERS  (sessionStorage for active profile)
// ─────────────────────────────────────────────────────────
const Session = {
  setProfile(profile) {
    sessionStorage.setItem('xverse_active_profile', JSON.stringify(profile));
  },
  getProfile() {
    try { return JSON.parse(sessionStorage.getItem('xverse_active_profile')); }
    catch { return null; }
  },
  clearProfile() {
    sessionStorage.removeItem('xverse_active_profile');
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

  // Show avatar image or initial
  if (profile?.avatar_url || user.user_metadata?.avatar_url) {
    const img = document.createElement('img');
    img.src = profile?.avatar_url || user.user_metadata?.avatar_url;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit';
    img.onerror = () => { img.remove(); el.textContent = (profile?.name || user.email || 'U')[0].toUpperCase(); };
    el.innerHTML = '';
    el.appendChild(img);
  } else {
    el.textContent = (profile?.name || user.email || 'U')[0].toUpperCase();
  }

  el.onclick = () => {
    const choice = confirm('XverseMovies Account\n\nOK → ⚙️ Settings\nCancel → 🚪 Sign Out');
    if (choice) window.location.href = 'XverseMovies_Settings.html';
    else if (confirm('Sign out karna chahte ho?')) {
      Auth.signOut().then(() => window.location.href = 'index.html');
    }
  };
}
