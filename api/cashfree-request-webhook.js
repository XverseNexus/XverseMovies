// api/cashfree-request-webhook.js
// Cashfree calls this once a payment attempt finishes. We verify the
// webhook signature (never trust an unverified webhook), then flip the
// matching `requests` row to payment_status='paid' (or 'failed'), and
// notify the user. This is the ONLY place a request ever becomes real —
// the create-order endpoint only ever inserts it as 'pending'.
//
// Cashfree Dashboard → Developers → Webhooks → add:
//   https://<your-domain>/api/cashfree-request-webhook
// and subscribe it to Payment events.

const crypto = require('crypto');

// Vercel needs the RAW request body (byte-for-byte) to verify the
// signature correctly — the default JSON body parser would re-serialize
// it, which can subtly differ from what Cashfree actually signed.
module.exports.config = {
  api: { bodyParser: false },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a || '', 'utf8');
  const bufB = Buffer.from(b || '', 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
  const SUPABASE_URL        = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!CASHFREE_SECRET_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('cashfree-request-webhook: missing environment variables');
    res.status(500).json({ error: 'Server is not configured correctly' });
    return;
  }

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    res.status(400).json({ error: 'Could not read request body' });
    return;
  }

  // ── Verify signature ──────────────────────────────────
  const timestamp = req.headers['x-webhook-timestamp'];
  const signature = req.headers['x-webhook-signature'];
  if (!timestamp || !signature) {
    res.status(401).json({ error: 'Missing signature headers' });
    return;
  }

  const expectedSignature = crypto
    .createHmac('sha256', CASHFREE_SECRET_KEY)
    .update(timestamp + rawBody)
    .digest('base64');

  if (!safeEqual(expectedSignature, signature)) {
    console.error('cashfree-request-webhook: signature mismatch — rejecting');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // ── Parse payload ──────────────────────────────────────
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const eventType     = body.type;
  const orderTags     = body.data?.order?.order_tags || {};
  const requestId     = orderTags.request_id;
  const paymentStatus = body.data?.payment?.payment_status; // 'SUCCESS' | 'FAILED' | 'USER_DROPPED' | ...
  const cfPaymentId   = body.data?.payment?.cf_payment_id || null;

  // Webhooks we don't recognize or that don't carry our request_id —
  // acknowledge with 200 so Cashfree doesn't keep retrying, but do nothing.
  if (!requestId) {
    res.status(200).json({ received: true, note: 'no request_id in order_tags' });
    return;
  }

  const restHeaders = {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // Fetch current row — needed for the notification message, and to
    // avoid double-processing if Cashfree retries the same webhook.
    const getRes = await fetch(
      `${SUPABASE_URL}/rest/v1/requests?id=eq.${requestId}&select=*`,
      { headers: restHeaders }
    );
    const rows = await getRes.json();
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row) {
      res.status(200).json({ received: true, note: 'request row not found' });
      return;
    }

    // Idempotency — already processed (Cashfree may retry webhooks).
    if (row.payment_status !== 'pending') {
      res.status(200).json({ received: true, note: 'already processed' });
      return;
    }

    const isSuccess = eventType === 'PAYMENT_SUCCESS_WEBHOOK' || paymentStatus === 'SUCCESS';
    const newStatus = isSuccess ? 'paid' : 'failed';

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/requests?id=eq.${requestId}`, {
      method: 'PATCH',
      headers: restHeaders,
      body: JSON.stringify({
        payment_status: newStatus,
        cashfree_payment_id: cfPaymentId,
      }),
    });
    if (!patchRes.ok) {
      const errText = await patchRes.text();
      throw new Error('Failed to update request: ' + errText);
    }

    // Notify the user — success or failure, they should know either way.
    const notifBody = isSuccess
      ? `✅ Payment successful! Your request for "${row.title}" has been submitted and is now pending review.`
      : `❌ Payment for your "${row.title}" request didn't go through. No amount was charged — please try again.`;

    await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
      method: 'POST',
      headers: { ...restHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify([{
        user_id: row.user_id,
        title: isSuccess ? '🎬 Request Submitted' : '⚠️ Payment Failed',
        body: notifBody,
        image_url: row.poster_url || null,
        is_read: false,
      }]),
    }).catch((e) => console.error('cashfree-request-webhook: notification insert failed', e));

    res.status(200).json({ received: true, status: newStatus });
  } catch (err) {
    console.error('cashfree-request-webhook error:', err);
    // Still 200 — Cashfree retries on non-2xx, and retrying won't fix a
    // bug on our end. Log it for us to investigate instead.
    res.status(200).json({ received: true, error: 'internal error, logged' });
  }
};
