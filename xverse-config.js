// ═══════════════════════════════════════════════════════
//  xverse-config.js  —  Shared config for all pages
// ═══════════════════════════════════════════════════════

const XVERSE = {
  // ✅ CORRECTED Supabase URL (from your project ID)
  SUPABASE_URL: 'https://oobohevfmvitveulvqlf.supabase.co',
  // ⚠️ REPLACE with your actual anon key from Supabase → API Keys
  SUPABASE_KEY: 'sb_publishable_SKK21UE3-Ls5xS8kjt0DbA_qwj_QQ4v',  // <-- PASTE FULL KEY HERE

  // TMDB (already correct)
  TMDB_KEY:         'e37f31e73a670951fed2a295733184096',
  TMDB_BASE:        'https://api.themoviedb.org/3',
  TMDB_IMG:         'https://image.tmdb.org/t/p/',

  SITE_NAME:        'XverseMovies',
  LOGIN_PAGE:       'index.html',

  PAYMENT: {
    hd:  'https://payments.cashfree.com/forms/xversemovies-hd',
    fhd: 'https://payments.cashfree.com/forms/xversemovies-fhd',
    uhd: 'https://payments.cashfree.com/forms/xversemovies-4k',
  },

  PLANS: {
    free: { name:'Basic',       quality:'480p', price:'Free',   screens:1, order:0 },
    hd:   { name:'HD',          quality:'720p', price:'₹29/mo', screens:2, order:1 },
    fhd:  { name:'Full HD',     quality:'1080p',price:'₹49/mo', screens:2, order:2 },
    uhd:  { name:'4K Ultra HD', quality:'4K',   price:'₹99/mo', screens:4, order:3 },
  },
};

// ─────────────────────────────────────────────────────────
//  Supabase client
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
  async getUser() {
    const { data } = await getSB().auth.getUser();
    return data?.user || null;
  },
  async getProfile(uid) {
    const { data } = await getSB()
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .single();
    return data;
  },
  async getViewerProfiles(uid) {
    const { data } = await getSB()
      .from('viewer_profiles')
      .select('*')
      .eq('user_id', uid)
      .order('created_at');
    return data || [];
  },
  async signIn(email, password) {
    return getSB().auth.signInWithPassword({ email, password });
  },
  async signUp(email, password, name) {
    return getSB().auth.signUp({
      email, password,
      options: { data: { full_name: name } }
    });
  },
  async googleSignIn() {
    return getSB().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/' + XVERSE.LOGIN_PAGE }
    });
  },
  async signOut() {
    sessionStorage.removeItem('xverse_active_profile');
    return getSB().auth.signOut();
  },
  async resetPassword(email) {
    return getSB().auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/' + XVERSE.LOGIN_PAGE + '?reset=1'
    });
  },
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
  canAccess(userPlan, requiredPlan) {
    const o = XVERSE.PLANS;
    return (o[userPlan]?.order ?? 0) >= (o[requiredPlan]?.order ?? 0);
  },
};

// ─────────────────────────────────────────────────────────
//  DATABASE HELPERS (abbreviated – full version already in your file)
// ─────────────────────────────────────────────────────────
const DB = { /* Keep your existing DB object – unchanged */ };

// ─────────────────────────────────────────────────────────
//  TMDB HELPERS (unchanged)
// ─────────────────────────────────────────────────────────
const TMDB = { /* Keep your existing TMDB object – unchanged */ };

// ─────────────────────────────────────────────────────────
//  SESSION HELPERS
// ─────────────────────────────────────────────────────────
const Session = {
  setProfile(profile) { sessionStorage.setItem('xverse_active_profile', JSON.stringify(profile)); },
  getProfile() { try { return JSON.parse(sessionStorage.getItem('xverse_active_profile')); } catch { return null; } },
  clearProfile() { sessionStorage.removeItem('xverse_active_profile'); },
};

// ─────────────────────────────────────────────────────────
//  TOAST
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
//  AUTH GUARD & NAV AVATAR
// ─────────────────────────────────────────────────────────
async function requireAuth(redirectTo = XVERSE.LOGIN_PAGE) {
  const sb   = getSB();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = redirectTo;
    return null;
  }
  return session.user;
}

async function initNavAvatar(avatarElId = 'navAvatar') {
  const el = document.getElementById(avatarElId);
  if (!el) return;
  const profile = Session.getProfile();
  const user    = await Auth.getUser();
  if (!user) return;

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
      Auth.signOut().then(() => window.location.href = XVERSE.LOGIN_PAGE);
    }
  };
}
