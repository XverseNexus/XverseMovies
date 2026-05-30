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
//  AUTH HELPERS (unchanged, kept for completeness)
// ─────────────────────────────────────────────────────────
const Auth = {
  // Get current session user (fast, no network)
  async getUser() {

  const { data: { session } } =
  await getSB().auth.getSession();

  return session?.user || null;
},

  // Get full profile from DB
    const { data: { session } } = await getSB().auth.getSession();
    return session?.user || null;
  },
  async getProfile(uid) {
    const { data } = await getSB()
      .from('profiles')
@@ -63,8 +57,6 @@
      .single();
    return data;
  },

  // Get viewer profiles
  async getViewerProfiles(uid) {
    const { data } = await getSB()
      .from('viewer_profiles')
@@ -73,42 +65,30 @@
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
@@ -119,8 +99,6 @@
      plan_active: true,
    }).eq('id', uid);
  },

  // Can user access this content?
  canAccess(userPlan, requiredPlan) {
    const o = XVERSE.PLANS;
    return (o[userPlan]?.order ?? 0) >= (o[requiredPlan]?.order ?? 0);
@@ -131,7 +109,6 @@
//  DATABASE HELPERS
// ─────────────────────────────────────────────────────────
const DB = {
  // ── MY LIST ──────────────────────────────────────────
  async getMyList(uid) {
    const { data } = await getSB()
      .from('my_list')
@@ -140,16 +117,13 @@
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
@@ -159,8 +133,6 @@
      .single();
    return !!data;
  },

  // ── CONTINUE WATCHING ────────────────────────────────
  async getContinueWatching(uid) {
    const { data } = await getSB()
      .from('continue_watching')
@@ -175,7 +147,6 @@
      updatedAt: r.updated_at,
    }));
  },

  async upsertContinueWatching(uid, movieId, progressSec, durationSec) {
    const completed = durationSec > 0 && (progressSec / durationSec) > 0.9;
    return getSB().from('continue_watching').upsert({
@@ -187,13 +158,10 @@
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
@@ -203,20 +171,16 @@
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
@@ -226,24 +190,19 @@
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
@@ -252,7 +211,6 @@
      .limit(20);
    return data || [];
  },

  async getFeatured() {
    const { data } = await getSB().from('movies')
      .select('*')
@@ -262,12 +220,9 @@
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
@@ -277,34 +232,28 @@
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
//  TMDB HELPERS (unchanged)
// ─────────────────────────────────────────────────────────
const TMDB = {
  async fetch(path, params = {}) {
@@ -323,11 +272,9 @@
    }
    return null;
  },

  img(path, size = 'w500') {
    return path ? XVERSE.TMDB_IMG + size + path : null;
  },

  normalize(item) {
    const isTV = item.media_type === 'tv' || item.name;
    return {
@@ -342,7 +289,6 @@
      genres:       [],
    };
  },

  async trending()    { return this.fetch('/trending/all/week'); },
  async topMovies()   { return this.fetch('/movie/top_rated', { region:'IN' }); },
  async topTV()       { return this.fetch('/tv/top_rated'); },
@@ -359,7 +305,7 @@
};

// ─────────────────────────────────────────────────────────
//  SESSION HELPERS  (sessionStorage for active profile)
//  SESSION HELPERS
// ─────────────────────────────────────────────────────────
const Session = {
  setProfile(profile) {
@@ -393,49 +339,32 @@
}

// ─────────────────────────────────────────────────────────
//  AUTH GUARD  — call on every protected page
//  AUTH GUARD
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
//  NAV AVATAR (unchanged)
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
@@ -446,7 +375,6 @@
  } else {
    el.textContent = (profile?.name || user.email || 'U')[0].toUpperCase();
  }

  el.onclick = () => {
    const choice = confirm('XverseMovies Account\n\nOK → ⚙️ Settings\nCancel → 🚪 Sign Out');
    if (choice) window.location.href = 'XverseMovies_Settings.html';
@@ -455,3 +383,32 @@
    }
  };
}

// ─────────────────────────────────────────────────────────
//  NEW: Vidsrc availability checker (client-side via CORS proxy)
// ─────────────────────────────────────────────────────────
const Vidsrc = {
  /**
   * Check if a vidsrc.to embed URL is working (returns true if available).
   * Uses the same corsproxy.io that TMDB uses to bypass CORS.
   */
  async checkAvailability(embedUrl) {
    // Use the proxy to fetch the embed page HTML
    const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(embedUrl);
    try {
      const response = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (!response.ok) return false;
      const html = await response.text();
      // Check for the "unavailable" text
      return !html.includes('this media is unavailable at this moment');
    } catch (e) {
      console.error('Vidsrc check failed:', e);
      return false; // assume unavailable if check fails
    }
  }
};
