exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { token, amount, name, phone, note, items } = JSON.parse(event.body);

    if (!token || !amount) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing token or amount' }) };
    }

    const PRIVATE_KEY  = process.env.CLOVER_PRIVATE_KEY;
    const API_TOKEN    = process.env.CLOVER_API_TOKEN;
    const MERCHANT_ID  = process.env.CLOVER_MERCHANT_ID;

    if (!PRIVATE_KEY || !MERCHANT_ID || !API_TOKEN) {
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server config error' }) };
    }

    const BASE = `https://api.clover.com/v3/merchants/${MERCHANT_ID}`;
    const apiHeaders = {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    };

    // STEP 1: Check business hours
    try {
      const hoursRes = await fetch(`${BASE}?expand=hours`, { headers: apiHeaders });
      const merchant = await hoursRes.json();
      const hours = merchant?.hours?.elements;

      if (hours && hours.length > 0) {
        const now = new Date();
        const dayNames = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
        const today = dayNames[now.getDay()];
        const todayHours = hours.find(h => h.day === today);

        if (todayHours) {
          const toMins = t => Math.floor(t/100)*60 + (t%100);
          const nowMins = now.getHours()*60 + now.getMinutes();
          const open = toMins(todayHours.start || 0);
          const close = toMins(todayHours.end || 0);

          if (close > 0 && (nowMins < open || nowMins >= close)) {
            return {
              statusCode: 400,
              body: JSON.stringify({ success: false, error: "We're currently closed. Please order during business hours." })
            };
          }
        }
      }
    } catch(e) {
      console.warn('Hours check failed, proceeding:', e.message);
    }

    // STEP 2: Create Clover order
    const orderNote = [
      name  ? `Customer: ${name}`  : '',
      phone ? `Phone: ${phone}`    : '',
      note  ? `Note: ${note}`      : ''
    ].filter(Boolean).join(' | ');

    const orderRes = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({ state: 'open', note: orderNote })
    });

    const order = await orderRes.json();
    console.log('Order creation:', JSON.stringify(order));

    // STEP 3: Add line items
    if (order.id && items && Array.isArray(items)) {
      for (const item of items) {
        for (let q = 0; q < item.qty; q++) {
          await fetch(`${BASE}/orders/${order.id}/line_items`, {
            method: 'POST',
            headers: apiHeaders,
            body: JSON.stringify({ name: item.name, price: item.price, unitQty: 1 })
          });
        }
      }
    }

    // STEP 4: Charge the card
    const chargeBody = {
      amount, currency: 'usd', source: token, description: orderNote, capture: true
    };
    if (order.id) chargeBody.order = { id: order.id };

    const chargeRes = await fetch('https://scl.clover.com/v1/charges', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PRIVATE_KEY}`,
        'Content-Type': 'application/json',
        'X-Clover-Merchant-Id': MERCHANT_ID
      },
      body: JSON.stringify(chargeBody)
    });

    const charge = await chargeRes.json();

    if (charge.id && charge.status === 'succeeded') {
      console.log(`✅ Order ${order.id || 'none'} — Charge ${charge.id} — $${(amount/100).toFixed(2)}`);
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
