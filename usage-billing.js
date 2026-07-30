/**
 * usage-billing.js
 * 
 * Lógica de facturación por servicio (clon de Railway).
 * Calcula el coste basado en el tiempo de ejecución y recursos asignados.
 */

const CPU_HOUR_PRICE = 0.0002; // Ejemplo: /usr/bin/bash.0002 por CPU-hora
const RAM_GB_HOUR_PRICE = 0.0001; // Ejemplo: /usr/bin/bash.0001 por GB-RAM-hora

export function calculateServiceCost(resources, startTime, endTime) {
  const durationHours = (endTime - startTime) / (1000 * 60 * 60);
  const cpuCost = resources.cpu * CPU_HOUR_PRICE * durationHours;
  const ramCost = resources.ram * RAM_GB_HOUR_PRICE * durationHours;
  
  return Number((cpuCost + ramCost).toFixed(6));
}

export function registerBillingRoutes(app, db, authMiddleware) {
  // Obtener uso actual y coste estimado
  app.get('/api/billing/usage', authMiddleware, async (req, res) => {
    try {
      const usage = db.prepare(`
        SELECT r.name, r.type, u.amount, u.created_at 
        FROM usage_log u
        JOIN resources r ON r.id = u.description -- Asumiendo que guardamos el ID del recurso en description
        WHERE u.user_id = ? AND u.kind = 'gasto_servicio'
        ORDER BY u.created_at DESC
      `).all(req.auth.sub);
      
      const totalCost = usage.reduce((sum, item) => sum + item.amount, 0);
      
      res.json({ usage, totalCost });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint para que el orquestador (Coolify/Docker) notifique el fin de un servicio
  app.post('/api/billing/report-usage', async (req, res) => {
    // Este endpoint debería estar protegido por una clave de API interna
    try {
      const { userId, resourceId, cpu, ram, startTime, endTime } = req.body;
      
      const cost = calculateServiceCost({ cpu, ram }, new Date(startTime), new Date(endTime));
      
      db.prepare("INSERT INTO usage_log (id, user_id, amount, kind, description) VALUES (?, ?, ?, 'gasto_servicio', ?)")
        .run(crypto.randomUUID(), userId, cost, resourceId);
        
      // Descontar del saldo del usuario
      db.prepare("UPDATE users SET creditos = creditos - ? WHERE id = ?").run(cost, userId);
      
      res.json({ success: true, cost });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
