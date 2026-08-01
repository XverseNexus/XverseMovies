// api/cashfree-payment-form-webhook.js
// Webhook for the TEMPORARY static Cashfree Payment Forms fallback (used
// while Orders-API whitelisting is blocked — see handoff notes). Cashfree
// Payment Forms don't let us attach our own order_tags/reference the way
// the Orders API does, so we can't match a webhook to a `requests` row by
// ID directly. Instead we correlate by:
//
//   (customer_email + order_amount → request_type + payment_status='pending',
//    most recently created)
//
// This relies on the user paying with the SAME email they used to log
// into the site (the Request page tells them this before redirecting).
// Matching only against rows still in 'pending' also makes this
// naturally idempotent if Cashfree retries the webhook.
//
// Configure in Cashfree Dashboard → Developers → Webhooks, subscribed to
// the "Payment Forms" → payment_form_order_webhook event, pointing at:
//   https://xwerse-movies.vercel.app/api/cashfree-payment-form-webhook
// (set this on ALL THREE static forms — MovieRequest/SeasonRequest/SeriesRequest)

const crypto = require('crypto');

// Vercel needs the RAW request body (byte-for-byte) to verify the
// signature correctly.
module.exports.config = {
  api: { bodyParser: false },
};

// Keep in sync with xwerse-config.js's REQUEST_PRICES and
// api/create-request-pending.js.
const PRICE_TO_TYPE = {
  9:  'movie',
  29: 'season',
  59: 'series',
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
    console.error('cashfree-payment-form-webhook: missing environment variables');
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

  // ── Verify signature (same scheme as the Orders API webhook:
  //    HMAC-SHA256(timestamp + rawBody), base64) ─────────────
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
    console.error('cashfree-payment-form-webhook: signature mismatch — rejecting');
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

  if (body.type !== 'PAYMENT_FORM_ORDER_WEBHOOK') {
    // Not a payment-forms event we care about — ack and ignore.
    res.status(200).json({ received: true, note: 'ignored event type' });
    return;
  }

  const order           = body.data?.order || {};
  const customerDetails = order.customer_details || {};
  const orderStatus     = order.order_status; // 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | ...
  const orderAmount     = Number(order.order_amount);
  const cfOrderId        = order.order_id || null;
  const customerEmail   = (customerDetails.customer_email || '').trim();

  const requestType = PRICE_TO_TYPE[orderAmount];

  if (!customerEmail || !requestType) {
    // Can't correlate this to a request — ack so Cashfree stops retrying,
    // but log it since it means either a price mismatch or a non-request
    // form got wired to this webhook by mistake.
    console.error('cashfree-payment-form-webhook: could not correlate', {
      customerEmail, orderAmount, cfOrderId,
    });
    res.status(200).json({ received: true, note: 'could not correlate to a request' });
    return;
  }

  const FAILURE_STATUSES = ['FAILED', 'EXPIRED', 'CANCELLED'];
  const isSuccess = orderStatus === 'PAID';
  const isFailure = FAILURE_STATUSES.includes(orderStatus);

  if (!isSuccess && !isFailure) {
    // Some in-between status (e.g. ACTIVE) — nothing to update yet.
    res.status(200).json({ received: true, note: `ignored status ${orderStatus}` });
    return;
  }

  const restHeaders = {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // Find the most recent still-pending request for this email + price.
    // Filtering on payment_status=eq.pending here is what makes this
    // idempotent against Cashfree webhook retries.
    const findUrl = `${SUPABASE_URL}/rest/v1/requests`
      + `?user_email=eq.${encodeURIComponent(customerEmail)}`
      + `&price=eq.${orderAmount}`
      + `&payment_status=eq.pending`
      + `&order=created_at.desc`
      + `&limit=1&select=*`;

    const getRes = await fetch(findUrl, { headers: restHeaders });
    const rows = await getRes.json();
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row) {
      // No matching pending row — most likely the user paid with a
      // different email than their site login. Log for manual admin
      // reconciliation rather than silently dropping the payment.
      console.error('cashfree-payment-form-webhook: no matching pending request', {
        customerEmail, orderAmount, requestType, cfOrderId,
      });
      res.status(200).json({ received: true, note: 'no matching pending request found' });
      return;
    }

    const newStatus = isSuccess ? 'paid' : 'failed';

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/requests?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: restHeaders,
      body: JSON.stringify({
        payment_status: newStatus,
        cashfree_payment_id: cfOrderId,
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
    }).catch((e) => console.error('cashfree-payment-form-webhook: notification insert failed', e));

    res.status(200).json({ received: true, status: newStatus, request_id: row.id });
  } catch (err) {
    console.error('cashfree-payment-form-webhook error:', err);
    // Still 200 — Cashfree retries on non-2xx, and retrying won't fix a
    // bug on our end. Log it for us to investigate instead.
    res.status(200).json({ received: true, error: 'internal error, logged' });
  }
};
