# XverseMovies — Complete Setup Guide
## Sab files ready hain, ab sirf ye steps follow karo

---

## 📁 FILE LIST (sab ek folder mein rakho)

```
xversemovies/
├── xverse-config.js          ← Shared config (SABSE IMPORTANT)
├── XverseMovies_Login.html   ← Login / Signup / Profile select
├── XverseMovies_Home.html    ← Main home page
├── XverseMovies_Browse.html  ← TV Shows, Movies, New & Popular
├── XverseMovies_MyList.html  ← My List, Continue Watching, History
├── XverseMovies_Player.html  ← Streamtape video player
├── XverseMovies_Settings.html← Account settings
├── XverseMovies_Admin.html   ← Admin panel (movie add karo)
└── supabase_schema.sql       ← DB schema (already run kar diya)
```

---

## ✅ STEP 1 — Supabase Setup (already done ✓)

Schema already run ho gaya. Bas ye 2 cheezein verify karo:

**Supabase Dashboard → Authentication → Providers:**
- ✅ Email/Password → ENABLE
- ✅ Google OAuth → ENABLE karo:
  1. Google Cloud Console → OAuth 2.0 credentials banao
  2. Client ID + Secret copy karo
  3. Supabase mein paste karo
  4. Authorized redirect URI add karo:
     `https://oobohovfmviteulvqlf.supabase.co/auth/v1/callback`

**Supabase Dashboard → Authentication → URL Configuration:**
```
Site URL: https://YOUR-VERCEL-URL.vercel.app
Redirect URLs: https://YOUR-VERCEL-URL.vercel.app/XverseMovies_Login.html
```

---

## ✅ STEP 2 — xverse-config.js Update

`xverse-config.js` kholo aur **PAYMENT** section update karo:

```javascript
PAYMENT: {
  hd:  'https://payments.cashfree.com/forms/YOUR_HD_LINK',
  fhd: 'https://payments.cashfree.com/forms/YOUR_FHD_LINK',
  uhd: 'https://payments.cashfree.com/forms/YOUR_4K_LINK',
},
```

**Cashfree mein Payment Links kaise banao:**
1. Cashfree Dashboard → Payment Links → Create New
2. Amount: ₹29 → Name: "XverseMovies HD" → Save
3. Link copy karo → xverse-config.js mein paste karo
4. Same karo ₹49 aur ₹99 ke liye

---

## ✅ STEP 3 — Vercel Deploy

### Option A — GitHub se (Recommended)

1. GitHub pe new repository banao: `xversemovies`
2. Sab files upload karo
3. Vercel.com → New Project → Import from GitHub
4. Deploy → URL milegi jaise: `xversemovies.vercel.app`

### Option B — Vercel CLI se

```bash
# Install Vercel CLI
npm i -g vercel

# Folder mein jao
cd xversemovies

# Deploy
vercel

# Follow the prompts → Done!
```

### Option C — Direct Upload

1. vercel.com → New Project → Browse
2. Folder drag & drop karo
3. Deploy!

---

## ✅ STEP 4 — Admin Panel se Movies Add karo

1. `XverseMovies_Admin.html` kholo
2. **Add Movie / Show** pe click karo
3. Streamtape pe movie upload karo → URL copy karo
4. Admin panel mein paste karo
5. TMDB ID dalo → **Auto Fill** click karo (poster, overview sab automatic)
6. **Add to XverseMovies** → Done!

**Movie home page pe kab dikhegi?**
- Status: `Active` → turant dikhegi
- Featured: `Yes` → Hero banner mein dikhegi
- Home page real-time TMDB + tumhara DB dono use karta hai

---

## ✅ STEP 5 — Supabase mein Google Auth Setup

Agar Google login chahiye:

1. [Google Cloud Console](https://console.cloud.google.com) → New Project
2. APIs & Services → OAuth consent screen → External → Fill details
3. Credentials → Create OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized redirect URIs:
     `https://oobohovfmviteulvqlf.supabase.co/auth/v1/callback`
4. Client ID + Secret copy karo
5. Supabase → Authentication → Providers → Google → Paste karo → Save

---

## 🔗 PAGE NAVIGATION MAP

```
Login.html
    ↓ (after login)
Profile Select
    ↓ (profile click)
Home.html ←──────────────────────────────┐
    ↓ (Play button)                       │
Player.html ──── progress sync ──→ Supabase
    ↓ (Back button)                       │
Home.html ────────────────────────────────┘
    
Home.html → Browse.html (TV Shows/Movies/New)
Home.html → MyList.html (My List/CW/History)
Home.html → Settings.html (Account/Plan/Notifs)
Settings.html → Admin.html (Add movies)
```

---

## 💾 DATABASE FLOW

```
User signs up
    ↓
Supabase Auth creates user
    ↓
Trigger: auto-create profiles + viewer_profiles row
    ↓
User selects plan → profiles.plan updated
    ↓
User watches movie → continue_watching updated every 30s
    ↓
User adds to list → my_list row inserted
    ↓
All data syncs across devices automatically ✅
```

---

## 🔐 ADMIN PANEL SECURITY

Admin panel abhi sirf auth check karta hai. Production ke liye:

**Supabase mein admin role add karo:**
```sql
-- SQL Editor mein run karo
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean default false;

-- Apna user admin banao (apna UID daalo)
UPDATE public.profiles SET is_admin = true 
WHERE email = 'YOUR_EMAIL@gmail.com';
```

**Admin.html mein ye check add karo (line 1 ke baad script tag mein):**
```javascript
// Admin check
const profile = await Auth.getProfile(session.user.id);
if (!profile?.is_admin) {
  alert('Access denied — Admin only!');
  window.location.href = 'XverseMovies_Home.html';
  return;
}
```

---

## 📱 PWA — Install as App (Optional)

`manifest.json` banao aur sab folder mein rakho:

```json
{
  "name": "XverseMovies",
  "short_name": "XverseMovies",
  "description": "Watch Movies & Shows",
  "start_url": "/XverseMovies_Login.html",
  "display": "standalone",
  "background_color": "#141414",
  "theme_color": "#E50914",
  "icons": [
    {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
    {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"}
  ]
}
```

Har HTML file ke `<head>` mein add karo:
```html
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#E50914">
```

---

## 🚨 COMMON ISSUES & FIXES

| Issue | Fix |
|-------|-----|
| "Supabase CDN not loaded" | Internet connection check karo |
| Google login redirect error | Supabase URL config mein apna Vercel URL add karo |
| Movies home pe nahi dikh rahi | Admin panel mein Status = Active karo |
| Player mein video nahi chala | Streamtape ID correct hai? Test karo Admin → ▶ button |
| TMDB images nahi aa rahi | CORS proxy kaam kar raha hai — wait karo ya refresh |
| "Invalid API key" Supabase | xverse-config.js mein keys check karo |

---

## 📊 REVENUE SETUP

### Streamtape Ads (Free Users):
- Streamtape account mein ads enable karo
- India ke liye approx $0.45–0.70 per 1000 views
- Free users ko ads automatically dikhti hain embed mein

### Cashfree Subscriptions:
- ₹29 HD, ₹49 Full HD, ₹99 4K
- Payment → plan Supabase mein update hota hai
- Paid users ko player mein ad-free experience

---

## ✅ FINAL CHECKLIST

- [ ] Supabase schema run ✓ (already done)
- [ ] Email auth enabled ✓ (already done)  
- [ ] xverse-config.js mein keys correct ✓
- [ ] Google OAuth setup (optional)
- [ ] Cashfree payment links update karo
- [ ] Vercel pe deploy karo
- [ ] Supabase URL config update karo (Vercel URL)
- [ ] Admin panel se 2-3 test movies add karo
- [ ] Test: Login → Browse → Play → My List
- [ ] Admin role set karo

**Ab XverseMovies production-ready hai! 🚀**
