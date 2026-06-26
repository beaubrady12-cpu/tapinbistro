exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { token, amount, name, phone, note, items } = JSON.parse(event.body);

    if (!token || !amount) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing token or amount' }) };
    }

    const PRIVATE_KEY = process.env.CLOVER_PRIVATE_KEY;
    const MERCHANT_ID = process.env.CLOVER_MERCHANT_ID;

    if (!PRIVATE_KEY || !MERCHANT_ID) {
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server config error' }) };
    }

    const headers = {
      'Authorization': `Bearer ${PRIVATE_KEY}`,
      'Content-Type': 'application/json'
    };

    const BASE = `https://api.clover.com/v3/merchants/${MERCHANT_ID}`;

    // ── STEP 1: Create the order ───────────────────────────────────────────────
    const orderNote = [
      name ? `Customer: ${name}` : '',
      phone ? `Phone: ${phone}` : '',
      note ? `Note: ${note}` : ''
    ].filter(Boolean).join(' | ');

    const orderRes = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        state: 'open',
        note: orderNote,
        orderType: { id: 'CUSTOM' }
      })
    });

    const order = await orderRes.json();

    if (!order.id) {
      console.error('Order creation failed:', order);
      // Fall back to charge-only if order creation fails
      return await chargeOnly(token, amount, orderNote, headers);
    }

    // ── STEP 2: Add line items to the order ───────────────────────────────────
    if (items && Array.isArray(items)) {
      for (const item of items) {
        for (let q = 0; q < item.qty; q++) {
          await fetch(`${BASE}/orders/${order.id}/line_items`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              name: item.name,
              price: item.price,
              unitQty: 1
            })
          });
        }
      }
    }

    // ── STEP 3: Charge the card and link to order ─────────────────────────────
    const chargeRes = await fetch(`https://scl.clover.com/v1/charges`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PRIVATE_KEY}`,
        'Content-Type': 'application/json',
        'X-Clover-Merchant-Id': MERCHANT_ID
      },
      body: JSON.stringify({
        amount,
        currency: 'usd',
        source: token,
        description: orderNote,
        capture: true,
        order: { id: order.id }
      })
    });

    const charge = await chargeRes.json();

    if (charge.id && charge.status === 'succeeded') {
      console.log(`✅ Order ${order.id} created and charged: $${(amount/100).toFixed(2)}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, chargeId: charge.id, orderId: order.id, amount })
      };
    } else {
      console.error('Charge failed:', charge);
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: charge.error?.message || 'Payment declined. Please try a different card.' })
      };
    }

  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server error. Please try again.' }) };
  }
};

// Fallback if order creation fails — still processes payment
async function chargeOnly(token, amount, note, hdrs) {
  const res = await fetch('https://scl.clover.com/v1/charges', {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify({ amount, currency: 'usd', source: token, description: note, capture: true })
  });
  const charge = await res.json();
  if (charge.id && charge.status === 'succeeded') {
    return { statusCode: 200, body: JSON.stringify({ success: true, chargeId: charge.id, amount }) };
  }
  return { statusCode: 400, body: JSON.stringify({ success: false, error: charge.error?.message || 'Payment declined.' }) };
}
