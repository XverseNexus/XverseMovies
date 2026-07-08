// ═══════════════════════════════════════════════════════════
//  POST /api/cashfree-webhook
//  Cashfree calls this automatically when a payment completes.
//  This is the ONLY place that actually upgrades a user's plan —
//  everything else (create-order.js, the Settings.html UI) just
//  starts the process. This is what makes it real/secure instead
//  of trust-based.
//
//  Flow:
//    1. Verify the request really came from Cashfree (HMAC-SHA256
//       signature over "timestamp + raw body", using our secret
//       key — see Cashfree's Webhook Signature Verification docs).
//    2. Re-fetch the order from Cashfree's API ourselves (don't
//       trust the webhook body's own claims about status) to get
//       the authoritative order_status + the {uid, plan} we stored
//       in order_tags when the order was created.
//    3. If — and only if — order_status is PAID, update
//       profiles.plan in Supabase using the service_role key
//       (server-side only, bypasses RLS safely because THIS code
//       already verified the payment).
//
//  Required Vercel environment variables (same as create-order.js,
//  plus Supabase):
//    CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV
//    SUPABASE_URL                — e.g. https://xxxx.supabase.co
//    SUPABASE_SERVICE_ROLE_KEY   — Project Settings → API → service_role
//                                  (NEVER the anon/public key — that
//                                  one can't bypass Row Level Security)
//
//  Also required: in Cashfree Dashboard → Developers → Webhooks,
//  add this endpoint's full URL (e.g.
//  https://xverse-movies.vercel.app/api/cashfree-webhook) and
//  subscribe it to the "Payment" event group.
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');

// Cashfree's signature is computed over the exact raw bytes of the
// request body. If Vercel's default JSON body-parser touches it
// first (re-serializing can change key order/whitespace), our
// computed HMAC won't match theirs — so we disable that here and
// read the raw stream ourselves below.
// (Attached to module.exports at the bottom of this file — has to
// happen AFTER module.exports is set to the handler function, or
// this property gets discarded when that assignment overwrites it.)

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, timestamp, signature, secretKey) {
  if (!timestamp || !signature) return false;
  const expected = crypto
    .createHmac('sha256', secretKey)
    .update(timestamp + rawBody)
    .digest('base64');
  // Constant-time comparison — avoids leaking info via response-time
  // differences (a naive `===` is a known timing-attack vector).
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  // Cashfree's dashboard "Test" button (and some monitoring pings)
  // send a GET/HEAD first just to check the endpoint is reachable —
  // it's not a real webhook delivery, so there's nothing to verify.
  // Respond 200 so that check passes; only POST goes through full
  // signature verification below.
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const appId     = process.env.CASHFREE_APP_ID;
  const env       = (process.env.CASHFREE_ENV || 'sandbox').toLowerCase();
  const supabaseUrl        = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secretKey || !appId || !supabaseUrl || !supabaseServiceKey) {
    console.error('cashfree-webhook: missing required environment variables');
    return res.status(500).json({ error: 'Server not configured' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error('Failed to read webhook body:', err);
    return res.status(400).json({ error: 'Could not read request body' });
  }

  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];

  if (!verifySignature(rawBody, timestamp, signature, secretKey)) {
    console.warn('cashfree-webhook: signature verification FAILED — rejecting');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Signature is valid, so we know this genuinely came from Cashfree.
  // Only act on payment-success events; ignore everything else
  // (refunds, failures, etc. aren't handled by this endpoint today).
  if (payload.type !== 'PAYMENT_SUCCESS_WEBHOOK') {
    return res.status(200).json({ received: true, skipped: payload.type || 'unknown_type' });
  }

  const orderId = (payload.data && payload.data.order && payload.data.order.order_id)
    || (payload.data && payload.data.order_id);
  if (!orderId) {
    console.error('cashfree-webhook: no order_id in payload', payload);
    return res.status(200).json({ received: true, error: 'no_order_id' });
  }

  // Don't trust the webhook body's status claim alone — re-fetch the
  // order from Cashfree's own API as the source of truth, and read
  // back the {uid, plan} we stored in order_tags at creation time.
  const base = env === 'production'
    ? 'https://api.cashfree.com'
    : 'https://sandbox.cashfree.com';

  let order;
  try {
    const orderRes = await fetch(`${base}/pg/orders/${orderId}`, {
      headers: {
        'x-api-version': '2023-08-01',
        'x-client-id': appId,
        'x-client-secret': secretKey,
      },
    });
    order = await orderRes.json();
    if (!orderRes.ok) throw new Error(order.message || 'fetch order failed');
  } catch (err) {
    console.error('cashfree-webhook: failed to re-fetch order', err);
    return res.status(502).json({ error: 'Could not verify order with Cashfree' });
  }

  if (order.order_status !== 'PAID') {
    console.warn(`cashfree-webhook: order ${orderId} status is ${order.order_status}, not upgrading`);
    return res.status(200).json({ received: true, order_status: order.order_status });
  }

  const uid  = order.order_tags && order.order_tags.uid;
  const plan = order.order_tags && order.order_tags.plan;
  if (!uid || !plan) {
    console.error('cashfree-webhook: order missing uid/plan tags', order);
    return res.status(200).json({ received: true, error: 'missing_order_tags' });
  }

  // Update Supabase using the service_role key — this is server-side
  // only and bypasses Row Level Security, which is exactly why this
  // key must never appear in any client-side file.
  try {
    const patchRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${uid}`, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ plan }),
    });
    if (!patchRes.ok) {
      const errText = await patchRes.text();
      throw new Error(errText);
    }
  } catch (err) {
    console.error('cashfree-webhook: Supabase update failed', err);
    // Returning an error status here (not 200) tells Cashfree to
    // retry the webhook later — we WANT that if our DB update failed.
    return res.status(500).json({ error: 'Failed to update plan' });
  }

  // ── NOTIFICATION (Task 12) ────────────────────────────────────
  // The bell/notification panel UI was already fully wired to
  // Supabase (see xverse-config.js DB.getNotifications) — nothing
  // in the codebase ever inserted a row, so it always showed empty.
  // This is the first real notification producer: tell the user
  // their upgrade went through. A failure here shouldn't fail the
  // whole webhook — the plan is already upgraded, which is what
  // actually matters — so this is best-effort and just logged.
  const PLAN_NAMES = { hd: 'HD', fhd: 'Full HD', uhd: '4K Ultra HD' };
  try {
    await fetch(`${supabaseUrl}/rest/v1/notifications`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        user_id: uid,
        title: '🎉 Plan Upgraded!',
        body: `Aapka plan ${PLAN_NAMES[plan] || plan} mein upgrade ho gaya hai. Enjoy karo!`,
        is_read: false,
      }),
    });
  } catch (err) {
    console.error('cashfree-webhook: notification insert failed (non-fatal)', err);
  }

  console.log(`✅ Plan upgraded: uid=${uid} → plan=${plan} (order ${orderId})`);
  return res.status(200).json({ received: true, upgraded: true, uid, plan });
};

// Must be set after module.exports is assigned above — see the
// comment near the top of this file for why.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
