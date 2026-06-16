// netlify/functions/charge.js
// ─────────────────────────────────────────────────────────────
// Receives the Clover card token from the website, then uses
// your private key to charge the card via Clover's Ecommerce API.
//
// SETUP:
//  1. In your Netlify dashboard → Site Settings → Environment Variables
//     Add:  CLOVER_PRIVATE_KEY = your_private_key_here
//           CLOVER_MERCHANT_ID = your_merchant_id_here
//  2. Deploy this file to netlify/functions/charge.js in your repo
//  3. The website will POST to /.netlify/functions/charge automatically
// ─────────────────────────────────────────────────────────────

exports.handler = async function(event) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { token, amount, name, phone, note, items } = JSON.parse(event.body);

    if (!token || !amount) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Missing token or amount' })
      };
    }

    // ── CLOVER CHARGE API ──────────────────────────────────
    // Your private key lives here safely — never in the HTML
    const PRIVATE_KEY  = process.env.CLOVER_PRIVATE_KEY;
    const MERCHANT_ID  = process.env.CLOVER_MERCHANT_ID;

    if (!PRIVATE_KEY || !MERCHANT_ID) {
      console.error('Missing Clover env vars');
      return {
        statusCode: 500,
        body: JSON.stringify({ success: false, error: 'Server config error' })
      };
    }

    // Build the order note for the kitchen
    const orderNote = [
      name ? `Customer: ${name}` : '',
      phone ? `Phone: ${phone}` : '',
      items ? `Items: ${items}` : '',
      note ? `Note: ${note}` : ''
    ].filter(Boolean).join(' | ');

    // Call Clover's Ecommerce charge endpoint
    const response = await fetch(
      `https://scl.clover.com/v1/charges`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PRIVATE_KEY}`,
          'Content-Type': 'application/json',
          'X-Clover-Merchant-Id': MERCHANT_ID
        },
        body: JSON.stringify({
          amount: amount,          // in cents (e.g. 1299 = $12.99)
          currency: 'usd',
          source: token,           // the token from Clover iFrame
          description: orderNote,
          capture: true            // charge immediately (vs authorize-only)
        })
      }
    );

    const charge = await response.json();

    if (charge.id && charge.status === 'succeeded') {
      console.log(`✅ Charge succeeded: ${charge.id} — $${(amount/100).toFixed(2)} — ${orderNote}`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          chargeId: charge.id,
          amount: amount
        })
      };
    } else {
      console.error('Clover charge failed:', charge);
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: charge.error?.message || 'Payment declined. Please try a different card.'
        })
      };
    }

  } catch (err) {
    console.error('Charge function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Server error. Please try again.' })
    };
  }
};
