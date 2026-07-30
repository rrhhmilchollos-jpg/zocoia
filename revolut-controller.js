/**
 * revolut-controller.js
 * 
 * Integración nativa con Revolut Merchant API para pagos y suscripciones.
 */

import fetch from 'node-fetch';

const REVOLUT_API_BASE = process.env.REVOLUT_MODE === 'sandbox' 
  ? 'https://sandbox-merchant.revolut.com/api/1.0' 
  : 'https://merchant.revolut.com/api/1.0';

const REVOLUT_SECRET_KEY = process.env.REVOLUT_SECRET_KEY;

export async function createRevolutOrder(amount, currency = 'EUR', customerEmail = '') {
  try {
    const response = await fetch(`${REVOLUT_API_BASE}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REVOLUT_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100), // Revolut usa céntimos
        currency,
        customer_email: customerEmail,
        capture_mode: 'AUTOMATIC'
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Error al crear orden en Revolut');
    
    return {
      id: data.id,
      public_id: data.public_id,
      token: data.token // A veces llamado token en algunas versiones del SDK
    };
  } catch (err) {
    console.error('[Revolut] Error:', err.message);
    throw err;
  }
}

export async function verifyRevolutOrder(orderId) {
  try {
    const response = await fetch(`${REVOLUT_API_BASE}/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${REVOLUT_SECRET_KEY}`
      }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Error al verificar orden en Revolut');
    
    return {
      status: data.state, // 'completed', 'pending', etc.
      amount: data.amount / 100,
      currency: data.currency
    };
  } catch (err) {
    console.error('[Revolut Verify] Error:', err.message);
    throw err;
  }
}

export function registerRevolutRoutes(app, db, authMiddleware) {
  // Crear orden de pago
  app.post('/api/payments/revolut/create', authMiddleware, async (req, res) => {
    try {
      const { amount, currency } = req.body;
      const order = await createRevolutOrder(amount, currency, req.auth.email);
      
      // Guardar orden pendiente en DB
      db.prepare("INSERT INTO payments (id, user_id, amount, currency, status, gateway) VALUES (?, ?, ?, ?, 'pending', 'revolut')")
        .run(order.id, req.auth.sub, amount, currency || 'EUR');
        
      res.json(order);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Confirmar pago (Webhook o Polling)
  app.post('/api/payments/revolut/confirm', authMiddleware, async (req, res) => {
    try {
      const { orderId } = req.body;
      const verification = await verifyRevolutOrder(orderId);
      
      if (verification.status === 'completed') {
        // Actualizar créditos o estado de cuenta
        db.prepare("UPDATE payments SET status = 'completed' WHERE id = ?").run(orderId);
        
        // Ejemplo: añadir créditos (asumiendo 1€ = 100 créditos)
        const creditsToAdd = verification.amount * 100;
        db.prepare("UPDATE users SET credits = credits + ? WHERE id = ?").run(creditsToAdd, req.auth.sub);
        
        res.json({ success: true, creditsAdded: creditsToAdd });
      } else {
        res.json({ success: false, status: verification.status });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  // Webhook real de Revolut
  app.post('/api/webhooks/revolut', async (req, res) => {
    // Implementar validación de firma de Revolut aquí
    const event = req.body;
    console.log('[Revolut Webhook]', event.event);
    
    if (event.event === 'ORDER_COMPLETED') {
      const orderId = event.order_id;
      // Lógica de actualización de DB similar a /confirm
    }
    
    res.sendStatus(200);
  });
}
