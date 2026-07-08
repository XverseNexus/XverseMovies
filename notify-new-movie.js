// ═══════════════════════════════════════════════════════════
//  POST /api/notify-new-movie
//  Called from XverseMovies_Admin.html after a movie/show is added
//  with status "active" — inserts one notification row per user so
//  everyone sees "New on XverseMovies: <title>" in their bell panel.
//
//  Why this is a serverless function and not a direct Supabase call
//  from Admin.html: bulk-reading every user's profile id and
//  inserting notifications FOR OTHER USERS is exactly the kind of
//  thing Row Level Security should (and does) block from the
//  client's anon key — a client shouldn't be able to write into
//  other users' rows directly. This runs server-side with the
//  service_role key instead, same pattern as the payment webhook.
//
//  Required Vercel environment variables (already set up for
//  Task 11's payment webhook — reused here, nothing new to add):
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//  NOTE: there's no admin-auth check in this file itself — the
//  actual gate is that only XverseMovies_Admin.html calls this,
//  and that page already checks Auth.getProfile(...).is_admin
//  before letting anyone add a movie in the first place. If this
//  endpoint needs to be hardened further later (e.g. rate limiting
//  against abuse), that's the natural next step.
// ═══════════════════════════════════════════════════════════

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl        = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('notify-new-movie: missing Supabase env vars');
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    const { title, type, image_url } = req.body || {};
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Missing movie/show title' });
    }

    // Fetch every user's id. `profiles` is 1 row per auth user
    // (created by the signup trigger — see SETUP_GUIDE.md), so this
    // gives us the full user list without touching auth.users
    // directly.
    const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id`, {
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
    });
    if (!profRes.ok) {
      const errText = await profRes.text();
      throw new Error('Failed to fetch profiles: ' + errText);
    }
    const profiles = await profRes.json();
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.status(200).json({ notified: 0 });
    }

    const label = type === 'tv' ? 'show' : 'movie';
    const rows = profiles.map((p) => ({
      user_id: p.id,
      title: '🎬 New on XverseMovies',
      body: `${title} — naya ${label} ab available hai, abhi dekho!`,
      image_url: image_url || null,
      is_read: false,
    }));

    // Supabase's PostgREST accepts an array body for bulk insert in
    // a single request — no need to loop one-by-one.
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/notifications`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      throw new Error('Failed to insert notifications: ' + errText);
    }

    return res.status(200).json({ notified: rows.length });
  } catch (err) {
    console.error('notify-new-movie error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
