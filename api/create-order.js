// ═══════════════════════════════════════════════════════════
//  POST /api/create-order
//  Creates a Cashfree order server-side and returns a
//  payment_session_id for the frontend to open Checkout with.
//
//  Why this exists (Task 11 real fix): the old flow just opened a
//  static Cashfree Payment Link and hoped for the best — nothing
//  ever verified the payment actually happened, so `profiles.plan`
//  never got updated. This + api/cashfree-webhook.js together make
//  the upgrade flow actually work and be tamper-resistant:
//    1. Client asks us for an order (this file) — we decide the
//       amount server-side from `plan`, the client can't send its
//       own amount.
//    2. We store {uid, plan} on the order itself (order_tags), so
//       when Cashfree calls our webhook later we know who to upgrade
//       and to what, without trusting anything the client says then.
//    3. Cashfree calls /api/cashfree-webhook.js when payment
//       actually completes — THAT function verifies the webhook
//       signature and is what actually updates Supabase.
//
//  Required Vercel environment variables (Project → Settings →
//  Environment Variables — NEVER put these in any client-side file):
//    CASHFREE_APP_ID       — from Cashfree Dashboard → API Keys
//    CASHFREE_SECRET_KEY   — from Cashfree Dashboard → API Keys
//    CASHFREE_ENV          — "sandbox" or "production"
//    SITE_URL              — e.g. https://xverse-movies.vercel.app
// ═══════════════════════════════════════════════════════════

const PLAN_PRICES = {
  hd:  29,
  fhd: 49,
  uhd: 99,
};

// Vercel parses application/json bodies into req.body automatically
// for CommonJS functions like this one — no special config needed
// here (that's only required in cashfree-webhook.js, which needs the
// exact raw bytes for signature verification).

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { uid, plan, phone, email } = req.body || {};

    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ error: 'Missing uid' });
    }
    const amount = PLAN_PRICES[plan];
    if (!amount) {
      return res.status(400).json({ error: 'Invalid plan — must be hd, fhd or uhd' });
    }

    const appId     = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    const env       = (process.env.CASHFREE_ENV || 'sandbox').toLowerCase();
    const siteUrl   = process.env.SITE_URL || `https://${req.headers.host}`;

    if (!appId || !secretKey) {
      return res.status(500).json({ error: 'Cashfree credentials not configured on the server' });
    }

    const base = env === 'production'
      ? 'https://api.cashfree.com'
      : 'https://sandbox.cashfree.com';

    const orderId = `xv_${uid.slice(0, 8)}_${Date.now()}`;

    const orderPayload = {
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: uid,
        // Cashfree requires a phone number. We don't collect one from
        // users today (see xverse-config.js Auth/profiles), so this
        // falls back to a placeholder — fine for getting payments
        // working, but collecting a real number would be better for
        // refund/support contact.
        customer_phone: (phone && String(phone).replace(/\D/g, '').slice(-10)) || '9999999999',
        customer_email: email || undefined,
      },
      order_meta: {
        return_url: `${siteUrl}/XverseMovies_Settings.html?order_id={order_id}`,
        notify_url: `${siteUrl}/api/cashfree-webhook`,
      },
      // Embedded metadata — this is what the webhook reads back to
      // know WHO to upgrade and to WHAT plan. The client can't forge
      // this after the fact since it's stored on Cashfree's order,
      // not trusted from a later client request.
      order_tags: { uid, plan },
    };

    const cfRes = await fetch(`${base}/pg/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2023-08-01',
        'x-client-id': appId,
        'x-client-secret': secretKey,
      },
      body: JSON.stringify(orderPayload),
    });

    const data = await cfRes.json();

    if (!cfRes.ok) {
      console.error('Cashfree create-order failed:', data);
      return res.status(502).json({ error: data.message || 'Cashfree order creation failed' });
    }

    return res.status(200).json({
      order_id: data.order_id,
      payment_session_id: data.payment_session_id,
    });
  } catch (err) {
    console.error('create-order error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
