103a104
>   const noVolumeWarning = 'RIESGO DE PÉRDIDA DE DATOS: no hay volumen persistente de Railway montado (RAILWAY_VOLUME_MOUNT_PATH ausente). La base de datos SQLite vive dentro del contenedor y SE BORRARÁ en el próximo deploy/reinicio. Solución: Railway dashboard → Command Palette ⌘K → "Create Volume", móntalo en /data, redeploy.';
106a108,113
>   // BLINDAJE DE DATOS: antes esto solo se veía en logs de consola, que casi
>   // nadie mira en producción — el sistema "sabía" que iba a perder todos los
>   // datos y no lo comunicaba por ningún canal monitoreable. Ahora se
>   // registra también en bootIssues, así que /health devuelve status
>   // "degraded" con este warning explícito hasta que se adjunte el volumen.
>   bootIssues.push(noVolumeWarning);
237a245,267
> // BLINDAJE DE DATOS — POLÍTICA DE BORRADO LÓGICO OBLIGATORIA: ningún borrado
> // manual (agentes/recursos, memoria de agente, API keys) debe eliminar la
> // fila físicamente nunca. Se añaden columnas is_deleted/deleted_at/deleted_reason
> // a las tablas afectadas; los endpoints DELETE pasan a hacer UPDATE, y las
> // consultas SELECT existentes se filtran para no mostrar lo archivado.
> try {
>   for (const table of ['resources', 'agent_memory', 'api_keys', 'prompt_cache']) {
>     const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
>     if (!cols.includes('is_deleted')) {
>       db.exec(`ALTER TABLE ${table} ADD COLUMN is_deleted INTEGER DEFAULT 0`);
>     }
>     if (!cols.includes('deleted_at')) {
>       db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`);
>     }
>     if (!cols.includes('deleted_reason')) {
>       db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_reason TEXT`);
>     }
>   }
> } catch (err) {
>   console.error('❌ No se pudo verificar/migrar las columnas de soft delete:', err.message);
>   bootIssues.push(`Migración soft-delete falló: ${err.message}`);
> }
> 
389c419
<   const existentes = db.prepare("SELECT name FROM resources WHERE user_id = ? AND type = 'agente'").all(user.id);
---
>   const existentes = db.prepare("SELECT name FROM resources WHERE user_id = ? AND type = 'agente' AND is_deleted = 0").all(user.id);
412a443,453
>     // BLINDAJE DE DATOS: si esto se dispara en producción y NO es el primer
>     // arranque (es decir, ya existía al menos 1 agente, aunque fuera de
>     // otro tipo/nombre), es una señal de que la base de datos acaba de
>     // perder datos que antes existían (ver aviso de volumen persistente más
>     // arriba) y se está enmascarando el hueco con prompts placeholder
>     // genéricos, en vez de con un panel vacío. Se hace visible en /health
>     // para que no pase desapercibido como "los agentes ya estaban así".
>     if (process.env.NODE_ENV === 'production') {
>       const seedAlert = `Se sembraron ${creados} agente(s) por defecto para ${email} en este arranque — si ya tenías agentes personalizados con otros prompts, es probable que la base de datos se haya reiniciado (ver aviso de volumen persistente) y estos placeholders NO son tu configuración real.`;
>       bootIssues.push(seedAlert);
>     }
642c683
<     agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(agentId, authSub, 'agente');
---
>     agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ? AND is_deleted = 0').get(agentId, authSub, 'agente');
655c696
<     const historial = db.prepare('SELECT role, content FROM agent_memory WHERE agente_id = ? ORDER BY created_at ASC LIMIT 50').all(agentId);
---
>     const historial = db.prepare('SELECT role, content FROM agent_memory WHERE agente_id = ? AND is_deleted = 0 ORDER BY created_at ASC LIMIT 50').all(agentId);
842c883
<   const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(req.params.id, req.auth.sub, 'agente');
---
>   const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ? AND is_deleted = 0').get(req.params.id, req.auth.sub, 'agente');
845,846c886,887
<   const mensajes = db.prepare('SELECT id, role, content, created_at FROM agent_memory WHERE agente_id = ? ORDER BY created_at ASC').all(req.params.id);
<   const cacheActiva = db.prepare('SELECT COUNT(*) as count FROM prompt_cache WHERE agente_id = ? AND expires_at > ?').get(req.params.id, Date.now()).count;
---
>   const mensajes = db.prepare('SELECT id, role, content, created_at FROM agent_memory WHERE agente_id = ? AND is_deleted = 0 ORDER BY created_at ASC').all(req.params.id);
>   const cacheActiva = db.prepare('SELECT COUNT(*) as count FROM prompt_cache WHERE agente_id = ? AND is_deleted = 0 AND expires_at > ?').get(req.params.id, Date.now()).count;
852c893
<   const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(req.params.id, req.auth.sub, 'agente');
---
>   const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ? AND is_deleted = 0').get(req.params.id, req.auth.sub, 'agente');
866c907
<   const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ?').get(req.params.id, req.auth.sub, 'agente');
---
>   const agente = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND type = ? AND is_deleted = 0').get(req.params.id, req.auth.sub, 'agente');
869,870c910,913
<   db.prepare('DELETE FROM agent_memory WHERE agente_id = ?').run(req.params.id);
<   db.prepare('DELETE FROM prompt_cache WHERE agente_id = ?').run(req.params.id);
---
>   console.warn(`⚠️ [audit] soft-delete manual: memoria del agente ${req.params.id} por usuario ${req.auth.sub} (ruta DELETE /api/agentes/:id/memoria)`);
>   const now = new Date().toISOString();
>   db.prepare('UPDATE agent_memory SET is_deleted = 1, deleted_at = ?, deleted_reason = ? WHERE agente_id = ? AND is_deleted = 0').run(now, 'manual-delete', req.params.id);
>   db.prepare('UPDATE prompt_cache SET is_deleted = 1, deleted_at = ?, deleted_reason = ? WHERE agente_id = ? AND is_deleted = 0').run(now, 'manual-delete', req.params.id);
982c1025
<     'SELECT id, name, key_prefix, last_used_at, revoked, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
---
>     'SELECT id, name, key_prefix, last_used_at, revoked, created_at FROM api_keys WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC'
1012c1055
<   const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
---
>   const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.auth.sub);
1014c1057,1058
<   db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
---
>   console.warn(`⚠️ [audit] soft-delete manual: api_key ${req.params.id} por usuario ${req.auth.sub} (ruta DELETE /api/keys/:id)`);
>   db.prepare('UPDATE api_keys SET revoked = 1, is_deleted = 1, deleted_at = ?, deleted_reason = ? WHERE id = ?').run(new Date().toISOString(), 'manual-delete', req.params.id);
1023,1024c1067,1068
<     ? db.prepare('SELECT * FROM resources WHERE user_id = ? AND type = ? ORDER BY created_at DESC').all(req.auth.sub, type)
<     : db.prepare('SELECT * FROM resources WHERE user_id = ? ORDER BY created_at DESC').all(req.auth.sub);
---
>     ? db.prepare('SELECT * FROM resources WHERE user_id = ? AND type = ? AND is_deleted = 0 ORDER BY created_at DESC').all(req.auth.sub, type)
>     : db.prepare('SELECT * FROM resources WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC').all(req.auth.sub);
1051c1095
<   const row = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
---
>   const row = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.auth.sub);
1064c1108
<   const row = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
---
>   const row = db.prepare('SELECT * FROM resources WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.auth.sub);
1066c1110,1112
<   db.prepare('DELETE FROM resources WHERE id = ?').run(row.id);
---
>   console.warn(`⚠️ [audit] soft-delete manual: resource ${row.id} (type=${row.type}) por usuario ${req.auth.sub} (ruta DELETE /api/resources/:id)`);
>   const now = new Date().toISOString();
>   db.prepare('UPDATE resources SET is_deleted = 1, deleted_at = ?, deleted_reason = ? WHERE id = ?').run(now, 'manual-delete', row.id);
1068,1069c1114,1115
<     db.prepare('DELETE FROM agent_memory WHERE agente_id = ?').run(row.id);
<     db.prepare('DELETE FROM prompt_cache WHERE agente_id = ?').run(row.id);
---
>     db.prepare('UPDATE agent_memory SET is_deleted = 1, deleted_at = ?, deleted_reason = ? WHERE agente_id = ? AND is_deleted = 0').run(now, 'manual-delete', row.id);
>     db.prepare('UPDATE prompt_cache SET is_deleted = 1, deleted_at = ?, deleted_reason = ? WHERE agente_id = ? AND is_deleted = 0').run(now, 'manual-delete', row.id);
1084c1130
<     'SELECT type, COUNT(*) as count FROM resources WHERE user_id = ? GROUP BY type'
---
>     'SELECT type, COUNT(*) as count FROM resources WHERE user_id = ? AND is_deleted = 0 GROUP BY type'
1091c1137
<   const keysCount = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE user_id = ? AND revoked = 0').get(user.id).count;
---
>   const keysCount = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE user_id = ? AND revoked = 0 AND is_deleted = 0').get(user.id).count;
1414c1460
<   const porId = db.prepare("SELECT id FROM resources WHERE id = ? AND user_id = ? AND type = 'agente'").get(slug, userId);
---
>   const porId = db.prepare("SELECT id FROM resources WHERE id = ? AND user_id = ? AND type = 'agente' AND is_deleted = 0").get(slug, userId);
1416c1462
<   const porNombre = db.prepare("SELECT id FROM resources WHERE user_id = ? AND type = 'agente' AND name = ?").get(userId, slug);
---
>   const porNombre = db.prepare("SELECT id FROM resources WHERE user_id = ? AND type = 'agente' AND name = ? AND is_deleted = 0").get(userId, slug);
