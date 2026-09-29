import { accessAuthorize } from './access-auth.js';
const AIRTABLE_BASE = 'https://api.airtable.com';
const ANTHROPIC_BASE = 'https://api.anthropic.com';
const OPENAI_BASE = 'https://api.openai.com';
// Defensa de costo en el servidor: aunque alguien manipule el JavaScript del
// navegador, el proxy nunca permite Opus, Fable ni modelos futuros no revisados.
const ANTHROPIC_ALLOWED_MODELS = new Set([
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
]);
const ANTHROPIC_MAX_OUTPUT_TOKENS = 4000;
const ANTHROPIC_DAILY_BUDGET_USD_DEFAULT = 0.50;
const ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT = 0.10;

// OpenAI comparte el MISMO presupuesto global diario que Anthropic. El objetivo
// no es estimar la factura al centavo sino impedir que una credencial expuesta
// pueda producir gasto ilimitado. Los importes son reservas conservadoras.
const OPENAI_ALLOWED_CHAT_MODELS = new Set(['gpt-4o-mini']);
const OPENAI_ALLOWED_IMAGE_MODELS = new Set(['gpt-image-1']);
const OPENAI_MAX_CHAT_OUTPUT_TOKENS = 300;
const OPENAI_ESTIMATED_COST_USD = {
  chat: 0.01,
  imageGenerationLow: 0.03,
  imageEditLow: 0.08,
};

// Una reserva representa una llamada en curso. El cliente corta las llamadas a los 60 s,
// así que cualquier reserva de más de 2 min es huérfana y no debe bloquear el día.
const AI_RESERVATION_STALE_MS = 2 * 60 * 1000;
const ANTHROPIC_PRICES = {
  haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.10 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
};

// Solo se aceptan peticiones desde estos orígenes (el dashboard). Esto reduce
// abuso desde otros sitios en un navegador, pero NO es autenticación de usuario:
// APP_KEY puede estar en el cliente y un cliente HTTP puede falsificar Origin.
// Por eso las rutas caras tienen allowlist + presupuesto y Airtable requiere una
// futura capa de autorización server-side por usuario/rol.
const ALLOWED_ORIGINS = [
  'https://dashboard.thelab.solutions',
  'https://thelabsolutionscl.github.io',
];
const CORS_BASE = {
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-App-Key,X-AI-Agent,anthropic-version,x-api-key',
  'Vary': 'Origin',
};
// Solo el bootstrap de esquemas que realmente usa TLS. Una APP_KEY visible
// no debe poder borrar, renombrar ni inventar tablas/campos administrativos.
// Al introducir otro campo legítimo, revisar esta lista en código y sus pruebas.
const SCHEMA_BOOTSTRAP_TABLES = new Set(['Maquinas','Maquinas_Eventos','Maquinas_Mant','Equipo_Eventos','Facturas','Inventario']);
const SCHEMA_BOOTSTRAP_FIELDS = Object.freeze({
  "cam": ["singleLineText"],
  "Cliente": ["singleLineText"],
  "Cliente ID": ["singleLineText"],
  "color": ["singleLineText"],
  "Consumo materiales": ["multilineText"],
  "Costo mano de obra (CLP)": ["currency"],
  "Costo material real (CLP)": ["currency"],
  "Costo real total (CLP)": ["currency"],
  "desc": ["singleLineText"],
  "Detalle JSON": ["multilineText"],
  "estado": ["singleLineText"],
  "Estado Pago": ["singleLineText"],
  "Estado SII": ["singleLineText"],
  "Exento": ["number"],
  "fecha": ["date"],
  "Fecha": ["date"],
  "Fecha de entrega": ["date"],
  "Fecha límite cotización": ["date"],
  "Fecha Vencimiento": ["date"],
  "Ficha Propuesta": ["multilineText"],
  "Ficha Tecnica": ["multilineText"],
  "Folio": ["number"],
  "Forma de pago": ["singleSelect"],
  "Historial fechas calendario": ["multilineText"],
  "hora_fin": ["singleLineText"],
  "hora_inicio": ["singleLineText"],
  "Horas máquina reales": ["number"],
  "id": ["singleLineText"],
  "ip": ["singleLineText"],
  "IVA": ["number"],
  "Máquina asignada": ["singleLineText"],
  "maquina_id": ["singleLineText"],
  "Material": ["singleLineText"],
  "modelo": ["singleLineText"],
  "N° Cotización": ["singleLineText"],
  "N° Pedido": ["singleLineText"],
  "Neto": ["number"],
  "nombre": ["singleLineText"],
  "notas": ["multilineText"],
  "Notas": ["singleLineText"],
  "num": ["number"],
  "numG": ["number"],
  "pedido_id": ["singleLineText"],
  "persona_id": ["singleLineText"],
  "print_hours": ["number"],
  "Punto de reorden": ["number"],
  "repuestos": ["multilineText"],
  "Stock actual": ["number"],
  "SUBTOTAL": ["currency"],
  "tiempo": ["number"],
  "Tiempo de producción": ["number"],
  "Tiempo de producción máx": ["number"],
  "tipo": ["singleLineText"],
  "Tipo días producción": ["singleLineText"],
  "Tipo DTE": ["singleLineText"],
  "Total": ["number"],
  "TOTAL CON IVA": ["currency"],
  "Track ID": ["singleLineText"],
  "ts": ["number"],
  "Unidad": ["singleLineText"],
});
const SCHEMA_FIELD_TYPES = new Set(['singleLineText','multilineText','number','currency','date','singleSelect','multipleSelects','multipleRecordLinks','checkbox','url','email','phoneNumber','attachment','dateTime']);
function schemaFieldAllowed(field) {
  if (!field || typeof field.name !== 'string' || !SCHEMA_FIELD_TYPES.has(field.type)) return false;
  const exact = SCHEMA_BOOTSTRAP_FIELDS[field.name];
  if (exact) return exact.includes(field.type);
  const item = /^(ITEM|UNIDADES|COSTO NETO|VALOR NETO)([1-9]|1[0-9]|20)$/.exec(field.name);
  if (!item) return false;
  return field.type === ({ITEM:'singleLineText', UNIDADES:'number', 'COSTO NETO':'currency', 'VALOR NETO':'currency'})[item[1]];
}
// Headers CORS reflejando el origen permitido (si no, el principal).
function cors(origin) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { 'Access-Control-Allow-Origin': allow, ...CORS_BASE };
}


/**
 * Contador de costo Anthropic con serialización real.
 *
 * KV se mantiene únicamente para migrar el saldo del día del guard anterior.
 * Todas las decisiones nuevas de presupuesto pasan por UNA instancia de este
 * Durable Object, evitando el read -> modify -> write concurrente de KV.
 */
export class AiBudgetGuard {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this._queue = Promise.resolve();
  }

  fetch(request) {
    // Una sola cola por Durable Object: reserva/reconciliación/lectura nunca
    // observan el mismo saldo en paralelo.
    const run = this._queue.then(() => this._handle(request));
    this._queue = run.catch(() => {});
    return run;
  }

  async _handle(request) {
    if (request.method !== 'POST') return this._json({ error: 'Method not allowed' }, 405);
    let payload = {};
    try { payload = await request.json(); }
    catch (_) { return this._json({ error: 'Invalid budget payload' }, 400); }

    const url = new URL(request.url);
    const date = String(payload.date || aiChileDate()).slice(0, 10);
    const budget = Math.max(0.05, Number(payload.budget_usd) || ANTHROPIC_DAILY_BUDGET_USD_DEFAULT);
    const perRequest = Math.max(0.01, Number(payload.request_budget_usd) || ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT);
    const maxConcurrent = Math.max(1, Math.min(4, Number(payload.max_concurrent) || 1));
    const loaded = await this._load(date);
    const row = loaded.row;

    if (url.pathname === '/usage') {
      return this._json(this._snapshot(date, budget, perRequest, row));
    }

    if (url.pathname === '/reserve') {
      const estimate = Math.max(0, Number(payload.estimated_request_usd) || 0);
      const source = sanitizeAiSource(payload.source || 'dashboard');
      const model = String(payload.model || '');

      if (estimate > perRequest) {
        const snap = this._snapshot(date, budget, perRequest, row);
        return this._json({
          ok: false, status: 429, error: 'AI request exceeds per-request cost limit',
          budget_usd: budget, used_usd: snap.used_usd, estimated_request_usd: estimate,
        });
      }

      const active = Object.keys(row.reservations || {}).length;
      if (active >= maxConcurrent) {
        const snap = this._snapshot(date, budget, perRequest, row);
        return this._json({
          ok: false, status: 429, error: 'Too many concurrent AI requests',
          budget_usd: budget, used_usd: snap.used_usd, estimated_request_usd: estimate,
        });
      }

      const snap = this._snapshot(date, budget, perRequest, row);
      if (snap.used_usd + estimate > budget) {
        return this._json({
          ok: false, status: 429, error: 'Daily AI budget reached',
          budget_usd: budget, used_usd: snap.used_usd, estimated_request_usd: estimate,
        });
      }

      const reservationId = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
        ? globalThis.crypto.randomUUID()
        : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
      row.reservations = row.reservations || {};
      row.reservations[reservationId] = {
        estimate, source, model, at: new Date().toISOString(),
      };
      row.requests = Math.max(0, Number(row.requests) || 0) + 1;
      row.by_source = row.by_source || {};
      const src = row.by_source[source] || { requests: 0, spent_usd: 0 };
      src.requests = Math.max(0, Number(src.requests) || 0) + 1;
      src.spent_usd = Math.max(0, Number(src.spent_usd) || 0);
      row.by_source[source] = src;
      row.updated_at = new Date().toISOString();
      await this._save(loaded.key, row);

      return this._json({
        ok: true, date, reservation_id: reservationId, source, estimate, model,
        budget_usd: budget, used_usd: snap.used_usd, estimated_request_usd: estimate,
      });
    }

    if (url.pathname === '/release') {
      const reservationId = String(payload.reservation_id || '');
      row.reservations = row.reservations || {};
      row.finalized = row.finalized || {};
      if (!row.finalized[reservationId]) {
        delete row.reservations[reservationId];
        row.finalized[reservationId] = { kind: 'release', at: new Date().toISOString() };
      }
      row.last_release_reason = String(payload.reason || 'no_usage').slice(0, 80);
      row.updated_at = new Date().toISOString();
      await this._save(loaded.key, row);
      return this._json({ ok: true });
    }

    if (url.pathname === '/reconcile') {
      const reservationId = String(payload.reservation_id || '');
      row.reservations = row.reservations || {};
      row.finalized = row.finalized || {};

      // Idempotencia: un waitUntil repetido o una entrega duplicada no cobra dos veces.
      if (row.finalized[reservationId]) return this._json({ ok: true, already_finalized: true });

      const reservation = row.reservations[reservationId] || null;
      const actual = Math.max(0, Number(payload.actual_usd) || 0);
      const source = sanitizeAiSource((reservation && reservation.source) || payload.source || 'dashboard');
      delete row.reservations[reservationId];

      row.spent_usd = Math.max(0, Number(row.spent_usd) || 0) + actual;
      row.by_source = row.by_source || {};
      const src = row.by_source[source] || { requests: 0, spent_usd: 0 };
      src.spent_usd = Math.max(0, Number(src.spent_usd) || 0) + actual;
      src.requests = Math.max(0, Number(src.requests) || 0);
      row.by_source[source] = src;
      row.finalized[reservationId] = { kind: 'reconcile', at: new Date().toISOString() };
      row.updated_at = new Date().toISOString();
      await this._save(loaded.key, row);
      return this._json({ ok: true, actual_usd: actual });
    }

    return this._json({ error: 'Unknown budget operation' }, 404);
  }

  async _load(date) {
    const key = 'anthropic-budget:' + date;
    let row = await this.state.storage.get(key);

    // Primer acceso después del deploy: migra el saldo KV del día de forma
    // conservadora. Las reservas agregadas antiguas se consideran ya gastadas,
    // así el cambio de guard NO regala presupuesto adicional a mitad del día.
    if (!row || typeof row !== 'object') {
      row = { spent_usd: 0, requests: 0, by_source: {}, reservations: {}, finalized: {} };
      try {
        const legacyRaw = this.env && this.env.AI_BUDGET ? await this.env.AI_BUDGET.get(key) : null;
        const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
        if (legacy && typeof legacy === 'object') {
          row.spent_usd = Math.max(0, Number(legacy.spent_usd) || 0) +
            Math.max(0, Number(legacy.reserved_usd) || 0);
          row.requests = Math.max(0, Number(legacy.requests) || 0);
          row.by_source = {};
          for (const [name, value] of Object.entries(legacy.by_source || {})) {
            row.by_source[sanitizeAiSource(name)] = {
              requests: Math.max(0, Number(value && value.requests) || 0),
              spent_usd: Math.max(0, Number(value && value.spent_usd) || 0) +
                Math.max(0, Number(value && value.reserved_usd) || 0),
            };
          }
          row.migrated_from_kv = true;
          row.migrated_at = new Date().toISOString();
        }
      } catch (_) {}
    }

    row.reservations = row.reservations || {};
    row.finalized = row.finalized || {};
    row.by_source = row.by_source || {};

    const now = Date.now();
    let dirty = false;
    for (const [id, reservation] of Object.entries(row.reservations)) {
      const at = Date.parse(reservation && reservation.at || '');
      if (!Number.isFinite(at) || now - at > AI_RESERVATION_STALE_MS) {
        delete row.reservations[id];
        dirty = true;
      }
    }
    for (const [id, finalized] of Object.entries(row.finalized)) {
      const at = Date.parse(finalized && finalized.at || '');
      if (!Number.isFinite(at) || now - at > 24 * 60 * 60 * 1000) {
        delete row.finalized[id];
        dirty = true;
      }
    }
    if (dirty) {
      row.recovered_stale_reservation_at = new Date().toISOString();
      row.updated_at = row.recovered_stale_reservation_at;
    }
    if (dirty || row.migrated_from_kv) await this._save(key, row);
    return { key, row };
  }

  async _save(key, row) {
    await this.state.storage.put(key, row);
  }

  _snapshot(date, budget, perRequest, row) {
    let reserved = 0;
    const bySource = {};
    for (const [name, src] of Object.entries(row.by_source || {})) {
      bySource[name] = {
        requests: Math.max(0, Number(src && src.requests) || 0),
        spent_usd: Math.max(0, Number(src && src.spent_usd) || 0),
        reserved_usd: 0,
      };
    }
    for (const reservation of Object.values(row.reservations || {})) {
      const estimate = Math.max(0, Number(reservation && reservation.estimate) || 0);
      reserved += estimate;
      const source = sanitizeAiSource(reservation && reservation.source || 'dashboard');
      bySource[source] = bySource[source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
      bySource[source].reserved_usd += estimate;
    }
    const spent = Math.max(0, Number(row.spent_usd) || 0);
    return {
      configured: true, atomic: true, date, budget_usd: budget, request_budget_usd: perRequest,
      spent_usd: spent, reserved_usd: reserved, used_usd: spent + reserved,
      remaining_usd: Math.max(0, budget - spent - reserved),
      requests: Math.max(0, Number(row.requests) || 0),
      by_source: bySource, updated_at: row.updated_at || null,
    };
  }

  _json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Serializa TODAS las altas de Pedidos/Cotizaciones recibidas por este proxy.
 * El GET y el POST se ejecutan dentro de la misma cola del mismo Durable
 * Object (nombre global): dos equipos nunca pasan la comprobación a la vez.
 * Ante respuesta ambigua no repetimos el POST: dejamos una marca persistente
 * que se resuelve leyendo Airtable o mediante conciliación administrativa.
 *
 * Contiene duplicados por rutas del proxy. No sustituye identidad server-side
 * ni evita escrituras hechas fuera de este Worker con otro PAT.
 */
export class CrmMutationGuard {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this._queue = Promise.resolve();
  }
  fetch(request) {
    const run = this._queue.then(() => this._handle(request));
    this._queue = run.catch(() => {});
    return run;
  }
  _json(data, status) {
    return new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  }
  async _readAll(table) {
    const records = [], seen = new Set();
    let offset = '';
    for (let page = 0; page < 100; page++) {
      const url = AIRTABLE_BASE + '/v0/app1YtD74AqiPWQhy/' + encodeURIComponent(table) +
        '?pageSize=100' + (offset ? '&offset=' + encodeURIComponent(offset) : '');
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + this.env.AIRTABLE_TOKEN } });
      if (!res.ok) throw new Error('Airtable read ' + res.status);
      const j = await res.json();
      if (!j || !Array.isArray(j.records) ||
          j.records.some(r => !r || typeof r.id !== 'string' || !r.fields || typeof r.fields !== 'object'))
        throw new Error('Airtable malformed records');
      records.push(...j.records);
      if (!j.offset) return records;
      if (typeof j.offset !== 'string' || seen.has(j.offset)) throw new Error('Airtable invalid pagination');
      seen.add(j.offset);
      offset = j.offset;
    }
    throw new Error('Airtable pagination limit: refusing partial deduplication');
  }
  async _handle(request) {
    if (request.method !== 'POST') return this._json({ error: 'Method not allowed' }, 405);
    if (!this.env.AIRTABLE_TOKEN) return this._json({ error: 'CRM write guard misconfigured' }, 503);
    let data;
    try { data = await request.json(); }
    catch (_) { return this._json({ error: 'Invalid JSON' }, 400); }
    const table = data && data.table;
    if (!['Pedidos','Cotizaciones','Facturas'].includes(table) || !data.body ||
        typeof data.body !== 'object' || Array.isArray(data.body) ||
        !data.body.fields || typeof data.body.fields !== 'object' ||
        Array.isArray(data.body.fields) || data.body.records) {
      return this._json({ error: 'Only single-record CRM creates are allowed' }, 400);
    }
    // Facturas: un único Durable Object serializa la lectura remota y el POST
    // para TODOS los navegadores. La reserva permanece ante timeout/5xx.
    if (table === 'Facturas') {
      const fields = data.body.fields;
      const tipo = String(fields['Tipo DTE'] || '').trim();
      const folio = Number(fields.Folio);
      const fecha = String(fields.Fecha || '').slice(0, 10);
      if (!/^(33|39|52|56|61)$/.test(tipo) || !Number.isSafeInteger(folio) ||
          folio < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
          !Number.isFinite(Date.parse(fecha + 'T12:00:00Z'))) {
        return this._json({ error: 'Factura requiere tipo, folio y fecha válidos' }, 422);
      }
      const year = fecha.slice(0, 4);
      const key = 'pending:factura:' + year + ':' + tipo + ':' + folio;
      let remote, marker;
      try {
        remote = await this._readAll('Facturas');
        marker = await this.state.storage.get(key);
      } catch (_) {
        return this._json({ error: 'No fue posible comprobar la unicidad de Facturas' }, 503);
      }
      const same = remote.find(r => {
        const f = r.fields || {};
        return String(f['Tipo DTE'] || '').trim() === tipo &&
          Number(f.Folio) === folio && String(f.Fecha || '').slice(0, 4) === year;
      });
      if (same) {
        // NO sobrescribir datos de pago, vencimiento o cliente de una
        // factura existente: devolverla para conciliación explícita.
        return this._json(same, 200);
      }
      if (marker) return this._json({
        error: 'Un alta anterior de este DTE sigue pendiente de conciliación en Airtable',
        code: 'FACTURA_PENDING_RECONCILIATION', tipo, folio, year,
      }, 503);
      const reservation = { tipo, folio, year, at: new Date().toISOString() };
      try { await this.state.storage.put(key, reservation); }
      catch (_) { return this._json({ error: 'No se pudo reservar el alta de Facturas' }, 503); }
      let upstream;
      try {
        upstream = await fetch(AIRTABLE_BASE + '/v0/app1YtD74AqiPWQhy/Facturas', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + this.env.AIRTABLE_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify(data.body),
        });
      } catch (_) {
        return this._json({
          error: 'Alta de Factura con resultado incierto: conciliar antes de repetir',
          code: 'FACTURA_PENDING_RECONCILIATION', tipo, folio, year,
        }, 503);
      }
      // Solo rechazos definitivos pueden liberar la reserva.
      if ([400, 401, 403, 422].includes(upstream.status)) {
        try { await this.state.storage.delete(key); } catch (_) {}
        return upstream;
      }
      if (!upstream.ok) return this._json({
        error: 'Airtable devolvió un resultado incierto al guardar Facturas',
        code: 'FACTURA_PENDING_RECONCILIATION', tipo, folio, year,
      }, 503);
      let created;
      try { created = await upstream.json(); }
      catch (_) { return this._json({
        error: 'Airtable respondió sin un registro verificable; conciliar',
        code: 'FACTURA_PENDING_RECONCILIATION', tipo, folio, year,
      }, 503); }
      if (!created || typeof created.id !== 'string') return this._json({
        error: 'Airtable no confirmó el identificador de la Factura; conciliar',
        code: 'FACTURA_PENDING_RECONCILIATION', tipo, folio, year,
      }, 503);
      try { await this.state.storage.put(key, { ...reservation, record_id: created.id, completed: true }); }
      catch (_) { /* En un resultado incierto, nunca liberar el bloqueo. */ }
      return this._json(created, 200);
    }
    const numberField = table === 'Pedidos' ? 'N° Pedido' : 'N° Cotización';
    const number = String(data.body.fields[numberField] || '').trim();
    if (!number || number.length > 32 || !/^[A-Za-z0-9-]+$/.test(number))
      return this._json({ error: 'Invalid CRM document number' }, 422);
    const cot = table === 'Pedidos' && Array.isArray(data.body.fields.Cotizaciones) &&
      data.body.fields.Cotizaciones.length === 1 && /^rec[A-Za-z0-9]+$/.test(data.body.fields.Cotizaciones[0])
      ? data.body.fields.Cotizaciones[0] : '';
    // Identidad natural de contratos recurrentes: dos navegadores pueden
    // proponer N° distintos para EL MISMO contrato/mes. No deduplicar por
    // cliente+importe: un cliente puede contratar varios trabajos iguales.
    const recurrence = table === 'Pedidos' ? String(data.body.fields['Notas pedido'] || '').trim() : '';
    const retainer = /^Retainer [A-Za-z0-9_-]{1,100} \d{4}-\d{2}$/.test(recurrence) ? recurrence : '';
    const keyNum = 'pending:' + table + ':' + number;
    const keyCot = cot ? 'pending:cot:' + cot : '';
    const keyRet = retainer ? 'pending:retainer:' + retainer : '';
    let remote, pendingNum, pendingCot, pendingRet;
    try {
      // La lectura incluye TODO el universo actual; si falla, nunca autorizar un POST.
      remote = await this._readAll(table);
      pendingNum = await this.state.storage.get(keyNum);
      if (keyCot) pendingCot = await this.state.storage.get(keyCot);
      if (keyRet) pendingRet = await this.state.storage.get(keyRet);
    } catch (_) { return this._json({ error: 'Cannot verify CRM uniqueness; creation suspended' }, 503); }
    // Si la otra pestaña ya creó el pedido para la misma cotización, adoptar
    // el registro real independientemente de qué número estimó el cliente.
    if (cot) {
      const existing = remote.find(r => Array.isArray(r.fields.Cotizaciones) && r.fields.Cotizaciones.includes(cot));
      if (existing) return this._json(existing, 200);
    }
    if (retainer) {
      const existing = remote.find(r => String(r.fields['Notas pedido'] || '').trim() === retainer);
      if (existing) return this._json(existing, 200);
    }
    if (remote.some(r => String(r.fields[numberField] || '').trim() === number)) {
      return this._json({ error: 'CRM document number already exists', code: 'CRM_NUMBER_CONFLICT' }, 409);
    }
    // Un POST anterior pudo haberse grabado pese al timeout. Bloquear nuevos
    // intentos (incluso con otro número para la misma cotización) hasta reconciliar.
    if (pendingNum || pendingCot || pendingRet) return this._json({
      error: 'Previous CRM creation has an uncertain outcome; reconcile Airtable before retrying',
      code: 'CRM_PENDING_RECONCILIATION',
    }, 503);

    const marker = { created: new Date().toISOString(), table, number, cot, retainer };
    try {
      await this.state.storage.put(keyNum, marker);
      if (keyCot) await this.state.storage.put(keyCot, marker);
      if (keyRet) await this.state.storage.put(keyRet, marker);
    } catch (_) { return this._json({ error: 'Cannot reserve CRM document' }, 503); }

    let upstream;
    try {
      const headers = { Authorization: 'Bearer ' + this.env.AIRTABLE_TOKEN, 'Content-Type': 'application/json' };
      const target = AIRTABLE_BASE + '/v0/app1YtD74AqiPWQhy/' + encodeURIComponent(table) +
        (typeof data.search === 'string' && data.search.length < 500 ? data.search : '');
      upstream = await fetch(target, { method: 'POST', headers, body: JSON.stringify(data.body) });
    } catch (_) {
      return this._json({ error: 'CRM POST outcome unknown: reconcile before retrying', code: 'CRM_PENDING_RECONCILIATION' }, 503);
    }
    // Un 422 es un rechazo confirmado del esquema: liberar la reserva para
    // que el cliente pueda quitar el campo incompatible y volver a intentar.
    if (upstream.status === 400 || upstream.status === 401 ||
        upstream.status === 403 || upstream.status === 422) {
      try {
        await this.state.storage.delete(keyNum);
        if (keyCot) await this.state.storage.delete(keyCot);
        if (keyRet) await this.state.storage.delete(keyRet);
      } catch (_) { /* ante fallo de storage, mantener bloqueado > duplicar */ }
      return upstream;
    }
    if (!upstream.ok) return this._json({
      error: 'CRM POST returned an uncertain status: reconcile before retrying',
      code: 'CRM_PENDING_RECONCILIATION',
    }, 503);
    let created;
    try { created = await upstream.clone().json(); }
    catch (_) {
      return this._json({ error: 'CRM POST succeeded but response was unreadable: reconcile first', code: 'CRM_PENDING_RECONCILIATION' }, 503);
    }
    if (!created || typeof created.id !== 'string') {
      return this._json({ error: 'CRM POST returned no record id: reconcile first', code: 'CRM_PENDING_RECONCILIATION' }, 503);
    }
    // Mantener tombstones en storage para bloquear reintentos sobre un snapshot
    // Airtable retrasado; la lectura remota puede confirmar y adoptar el registro.
    try {
      const done = { ...marker, record_id: created.id, committed: true };
      await this.state.storage.put(keyNum, done);
      if (keyCot) await this.state.storage.put(keyCot, done);
      if (keyRet) await this.state.storage.put(keyRet, done);
    } catch (_) { /* el registro ya se creó; la lectura autoritativa manda */ }
    return this._json(created, upstream.status);
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const CORS = cors(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, proxy: 'thelab-proxy', anthropic: !!env.ANTHROPIC_TOKEN, openai: !!env.OPENAI_TOKEN, airtable: !!env.AIRTABLE_TOKEN }, 200, CORS);
    }

    // Login is a top-level browser navigation. Cloudflare Access handles the
    // identity provider redirect at the edge; the Worker verifies the signed
    // assertion independently, then returns to the fixed dashboard origin.
    // No APP_KEY, query-string return URLs, or client-controlled redirects.
    if(url.pathname==='/access/session'){
      if(request.method!=='GET'||url.search)
        return json({error:'Access login path not allowed'},405,CORS);
      const signed=await accessAuthorize(request,env,'/access/me');
      if(signed.response||!signed.identity)
        return json({error:'Cloudflare Access must be activated before login'},503,CORS);
      return new Response(null,{status:302,headers:{
        Location:'https://dashboard.thelab.solutions/',
        'Cache-Control':'no-store','Referrer-Policy':'no-referrer'
      }});
    }

    // Allowlist de origen: solo se aceptan peticiones cuyo Origin esté en la lista.
    // Antes el chequeo era `if (origin && ...)`, así que una petición SIN header
    // Origin (curl, un script, server-to-server) se lo saltaba por completo. Exigir
    // un Origin permitido bloquea abuso casual desde navegadores ajenos, pero no
    // convierte APP_KEY en identidad: clientes HTTP pueden enviar ese header.
    // /health queda libre más arriba para los monitores.
    const leadServiceRoute=url.pathname==='/service/lead/anthropic/v1/messages';
    if (leadServiceRoute && url.search)
      return json({error:'Lead service query parameters not allowed'},400,CORS);
    if (!leadServiceRoute && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'Forbidden origin' }, 403, CORS);
    }

    // Auth — la passphrase nunca sale al cliente como un token de servicio real
    const appKey = request.headers.get('X-App-Key');
    if (!leadServiceRoute && (!appKey || appKey !== env.APP_KEY)) {
      return json({ error: 'Unauthorized' }, 403, CORS);
    }
    // After configuration, the shared app key is only a compatibility check.
    // Cloudflare Access signs each user's identity, and role decisions happen
    // on the server; a forged Origin or copied APP_KEY cannot grant rights.
    const authorized=await accessAuthorize(request,env,
      leadServiceRoute?'/service/lead/anthropic/v1/messages':
      url.pathname.startsWith('/v0/')||url.pathname.startsWith('/anthropic/')||
      url.pathname.startsWith('/openai/')||url.pathname.startsWith('/seo-')||url.pathname.startsWith('/sii/')||url.pathname.startsWith('/portal-admin/')||url.pathname.startsWith('/printer/')||url.pathname==='/access/me'
        ?url.pathname:'/v0'+url.pathname);
    if(authorized.response){
      const headers=new Headers(authorized.response.headers);
      Object.entries(CORS).forEach(([k,v])=>headers.set(k,v));
      return new Response(authorized.response.body,{status:authorized.response.status,headers});
    }
    if(url.pathname==='/access/me'){
      if(request.method!=='GET'||url.search)return json({error:'Method not allowed'},405,CORS);
      return json(authorized.identity
        ?{enabled:true,authenticated:true,role:authorized.identity.role,email:authorized.identity.email}
        :{enabled:false,authenticated:false},200,{...CORS,'Cache-Control':'no-store'});
    }
    if(authorized.identity&&request.method!=='GET'){
      console.log('[Access audit]',JSON.stringify({
        email:authorized.identity.email,role:authorized.identity.role,
        method:request.method,path:url.pathname.slice(0,180),
      }));
    }


    // The lead Worker's privileged portal key never reaches Pages. This
    // bridge is disabled in legacy APP_KEY-only mode, and grants ONLY the
    // two explicit portal administration actions to verified humans.
    if(url.pathname.startsWith('/portal-admin/')){
      if(!authorized.identity)
        return json({error:'Portal requires a signed Access user session',code:'ACCESS_REQUIRED'},503,CORS);
      const action=url.pathname.slice('/portal-admin/'.length);
      if(request.method!=='POST'||url.search||!['link','revocar'].includes(action))
        return json({error:'Portal admin route not allowed'},404,CORS);
      if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
        return json({error:'Portal request must be JSON'},415,CORS);
      const size=Number(request.headers.get('Content-Length')||0);
      if(size>2048)return json({error:'Portal request too large'},413,CORS);
      let payload;
      try {
        const raw=await request.text();
        if(raw.length>2048)throw new Error('Payload too large');
        payload=JSON.parse(raw);
      }catch(_){return json({error:'Invalid portal JSON'},400,CORS);}
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||
         !/^rec[A-Za-z0-9]{8,32}$/.test(payload.clienteId||'')||
         !Object.keys(payload).every(k=>k==='clienteId'||(action==='link'&&k==='dias'))||
         (action==='link'&&payload.dias!==undefined&&
           (!Number.isInteger(payload.dias)||payload.dias<1||payload.dias>365)))
        return json({error:'Invalid portal client or expiry'},400,CORS);
      let lead;
      try {
        lead=new URL(String(env.LEAD_WORKER_URL||''));
        if(lead.protocol!=='https:'||lead.username||lead.password||lead.port||
           lead.pathname!=='/'||lead.search||lead.hash||
           !(/^thelab-leads-worker\.[a-z0-9-]+\.workers\.dev$/.test(lead.hostname)||
             ['leads.thelab.solutions','portal.thelab.solutions'].includes(lead.hostname)))
          throw new Error('Untrusted lead worker origin');
      }catch(_){return json({error:'Lead Worker URL is not configured safely'},503,CORS);}
      if(typeof env.PORTAL_ADMIN_KEY!=='string'||env.PORTAL_ADMIN_KEY.length<16)
        return json({error:'Portal backend credential missing'},503,CORS);
      const body=JSON.stringify(action==='link'
        ?{clienteId:payload.clienteId,dias:payload.dias||30}
        :{clienteId:payload.clienteId});
      try {
        const upstream=await fetch(lead.origin+'/portal/'+action,{
          method:'POST',redirect:'manual',
          headers:{'Content-Type':'application/json','X-Portal-Admin-Key':env.PORTAL_ADMIN_KEY},
          body
        });
        if(upstream.status>=300&&upstream.status<400)
          return json({error:'Unexpected portal backend redirect; check result before retry'},502,CORS);
        const reply=await upstream.text();
        if(reply.length>16000||
           !String(upstream.headers.get('Content-Type')||'').toLowerCase().includes('application/json'))
          return json({error:'Invalid portal backend response; check result before retry'},502,CORS);
        return new Response(reply,{status:upstream.status,
          headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
      }catch(_){
        return json({error:'Portal backend response uncertain; check the client before retrying'},502,CORS);
      }
    }

    // Issue temporary, role-scoped Farm Controller tickets from server-held
    // credentials only. Never expose any BRIDGE_* master token to Pages.
    // Unknown paths, redirects, missing role-specific keys fail closed.
    if(url.pathname.startsWith('/printer/')){
      if(!authorized.identity)
        return json({error:'Printer tickets require an authenticated user session',
          code:'ACCESS_REQUIRED'},503,CORS);
      if(url.pathname!=='/printer/session'||request.method!=='POST'||url.search||
         Number(request.headers.get('Content-Length')||0)>0)
        return json({error:'Printer ticket route not allowed'},404,CORS);
      const role=authorized.identity.role==='admin'?'admin':
        authorized.identity.role==='operator'?'operator':'viewer';
      const secretName={viewer:'PRINTER_VIEWER_TOKEN',
        operator:'PRINTER_OPERATOR_TOKEN',admin:'PRINTER_ADMIN_TOKEN'}[role];
      const secret=env[secretName];
      if(typeof secret!=='string'||secret.length<24)
        return json({error:'Farm '+role+' credential is not configured'},503,CORS);
      const farmOrigin='https://printers.thelab.solutions';
      try {
        const upstream=await fetch(farmOrigin+'/farm/session',{
          method:'POST',redirect:'manual',
          headers:{'X-Bridge-Token':secret,'Accept':'application/json'}
        });
        if(upstream.status!==201)return json({
          error:'Farm Controller did not issue a ticket; check its role tokens',
          code:'FARM_SESSION_UNAVAILABLE'
        },502,CORS);
        if(Number(upstream.headers.get('Content-Length')||0)>8192)
          return json({error:'Oversized farm session response'},502,CORS);
        const raw=await upstream.text();
        if(raw.length>8192||
           !String(upstream.headers.get('Content-Type')||'').toLowerCase().includes('application/json'))
          return json({error:'Unexpected farm session response'},502,CORS);
        const data=JSON.parse(raw);
        const expiresAt=Number(data.expiresAt),now=Date.now();
        if(data.ok!==true||data.role!==role||
           typeof data.token!=='string'||!/^[A-Za-z0-9_-]{24,200}$/.test(data.token)||
           !Number.isFinite(expiresAt)||expiresAt<=now+5000||expiresAt>now+31*60*1000)
          return json({error:'Farm Controller returned an invalid role or expiry'},502,CORS);
        return json({ok:true,token:data.token,role,expiresAt},200,
          {...CORS,'Cache-Control':'no-store','Pragma':'no-cache'});
      }catch(_){
        return json({error:'Farm Controller ticket unavailable'},502,CORS);
      }
    }

    // Proxied SII is deliberately unavailable in legacy APP_KEY-only mode.
    // Access validates the signed user's identity and requires finance/admin
    // for emit/folio; /caf is admin-only. Never forward arbitrary paths.
    if (url.pathname.startsWith('/sii/')) {
      if (!authorized.identity) {
        return json({error:'SII requires an authenticated user session',code:'ACCESS_REQUIRED'},503,CORS);
      }
      const route=url.pathname.slice('/sii'.length);
      const permitted=(route==='/emit'&&request.method==='POST')||
        (route==='/caf'&&request.method==='PUT')||
        (/^\/folio\/(33|39|52|56|61)$/.test(route)&&request.method==='GET');
      if (!permitted || url.search) return json({error:'SII proxy route not allowed'},404,CORS);
      let target;
      try {
        target=new URL(String(env.SII_WORKER_URL||''));
        if(target.protocol!=='https:'||target.username||target.password||target.search||
           target.hash||target.pathname!=='/'||
           !(target.hostname.endsWith('.workers.dev')||target.hostname==='sii.thelab.solutions'))
          throw new Error('Invalid SII backend origin');
      } catch (_) {
        return json({error:'SII backend URL is not configured safely'},503,CORS);
      }
      if(!env.SII_WORKER_KEY)
        return json({error:'SII backend secret is not configured'},503,CORS);
      let body;
      if(request.method!=='GET'){
        if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
          return json({error:'SII only accepts JSON'},415,CORS);
        body=await request.text();
        if(body.length>256000)return json({error:'SII payload exceeds limit'},413,CORS);
        try { JSON.parse(body); } catch (_) { return json({error:'Invalid SII JSON'},400,CORS); }
      }
      try {
        const upstream=await fetch(target.origin+route,{
          method:request.method,redirect:'manual',
          headers:{'Content-Type':'application/json','X-Worker-Key':env.SII_WORKER_KEY},
          ...(body===undefined?{}:{body})
        });
        // Never follow a redirect to another site with the privileged key.
        if(upstream.status>=300&&upstream.status<400)
          return json({error:'Unexpected SII redirect; document status uncertain',
            code:'DTE_PENDING_RECONCILIATION'},502,CORS);
        const replyText=await upstream.text();
        if(replyText.length>1000000||!String(upstream.headers.get('Content-Type')||'').toLowerCase().includes('application/json'))
          return json({error:'Unexpected SII response; reconcile before retrying',
            code:'DTE_PENDING_RECONCILIATION'},502,CORS);
        return new Response(replyText,{status:upstream.status,headers:{...CORS,'Content-Type':'application/json'}});
      } catch (_) {
        return json({error:'SII response unavailable; check existing folio before reissuing',
          code:'DTE_PENDING_RECONCILIATION'},502,CORS);
      }
    }

    if (url.pathname === '/anthropic/usage') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, CORS);
      const usage = await readAiBudget(env);
      return json(usage, 200, CORS);
    }

    // ── SEO fetch — trae el HTML de una página del PROPIO sitio para auditarla ──
    // Restringido a thelab.solutions (sin SSRF). Evita el CORS del navegador.
    if (url.pathname === '/seo-fetch') {
      // El hostname inicial NO basta: "redirect:follow" permitía salir a
      // destinos ajenos al sitio (open redirect → SSRF). Validar cada salto,
      // no enviar credenciales ni traer respuestas sin límite de bytes.
      const validSeoUrl = t => t.protocol === 'https:' &&
        (t.hostname === 'thelab.solutions' || t.hostname === 'www.thelab.solutions') &&
        !t.username && !t.password && !t.port;
      let target;
      try { target = new URL(url.searchParams.get('url') || ''); }
      catch (_) { return json({ error: 'URL inválida' }, 400, CORS); }
      if (!validSeoUrl(target)) return json({ error: 'Solo se permite auditar thelab.solutions' }, 403, CORS);
      const maxBytes = 2 * 1024 * 1024;
      try {
        for (let hop = 0; hop < 4; hop++) {
          const up = await fetch(target.toString(), {
            headers: { 'User-Agent': 'TheLab-SEO-Auditor/1.0' },
            redirect: 'manual',
          });
          if ([301,302,303,307,308].includes(up.status)) {
            const location = up.headers.get('Location');
            if (!location) return json({ error: 'Redirección sin destino' }, 502, CORS);
            let next;
            try { next = new URL(location, target); }
            catch (_) { return json({ error: 'Redirección inválida' }, 502, CORS); }
            if (!validSeoUrl(next)) return json({ error: 'Redirección fuera del dominio permitido' }, 403, CORS);
            target = next;
            continue;
          }
          if (Number(up.headers.get('Content-Length') || 0) > maxBytes) {
            return json({ error: 'Respuesta SEO demasiado grande' }, 413, CORS);
          }
          let html = '';
          if (up.body && typeof up.body.getReader === 'function') {
            const reader = up.body.getReader();
            const decoder = new TextDecoder();
            let total = 0;
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              total += chunk.value.byteLength;
              if (total > maxBytes) {
                await reader.cancel().catch(() => {});
                return json({ error: 'Respuesta SEO demasiado grande' }, 413, CORS);
              }
              html += decoder.decode(chunk.value, { stream: true });
            }
            html += decoder.decode();
          } else {
            html = await up.text();
            if (new TextEncoder().encode(html).byteLength > maxBytes)
              return json({ error: 'Respuesta SEO demasiado grande' }, 413, CORS);
          }
          return json({ ok: true, status: up.status, finalUrl: target.toString(), html }, 200, CORS);
        }
        return json({ error: 'Demasiadas redirecciones SEO' }, 502, CORS);
      } catch (e) {
        return json({ error: 'No se pudo traer la página: ' + (e && e.message || e) }, 502, CORS);
      }
    }

    // Latido para la "Oficina Virtual": marca este Worker como Activo en la tabla
    // Automations. Best-effort, throttled y fuera del camino crítico (waitUntil),
    // por lo que no añade latencia ni puede romper la respuesta.
    if (ctx && env.AIRTABLE_TOKEN) ctx.waitUntil(heartbeat(env).catch(() => {}));

    // ── Anthropic (Claude) — la API key vive como secreto del Worker ──
    // El dashboard llama a:  <worker>/anthropic/v1/messages
    if (url.pathname === '/anthropic/v1/messages' || leadServiceRoute) {
      if (!env.ANTHROPIC_TOKEN) {
        return json({ error: 'Worker misconfigured: missing ANTHROPIC_TOKEN secret' }, 500, CORS);
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, CORS);
      let payload;
      try { payload = await readAnthropicJson(request); }
      catch (_) { return json({ error: 'Invalid Anthropic JSON body' }, 400, CORS); }
      if (!payload || !ANTHROPIC_ALLOWED_MODELS.has(payload.model)) {
        return json({ error: 'Anthropic model not allowed by cost policy' }, 403, CORS);
      }
      const maxTokens = Number(payload.max_tokens);
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > ANTHROPIC_MAX_OUTPUT_TOKENS) {
        return json({ error: `max_tokens must be between 1 and ${ANTHROPIC_MAX_OUTPUT_TOKENS}` }, 400, CORS);
      }
      const source = leadServiceRoute?'lead-worker':
        sanitizeAiSource(request.headers.get('X-AI-Agent') || 'dashboard');
      const reservation = await reserveAiBudget(env, payload, source);
      if (!reservation.ok) {
        return json({
          error: reservation.error,
          code: 'AI_BUDGET_LIMIT',
          budget_usd: reservation.budget_usd,
          used_usd: reservation.used_usd,
          estimated_request_usd: reservation.estimated_request_usd,
        }, reservation.status || 429, CORS);
      }
      const target = ANTHROPIC_BASE + '/v1/messages' + (leadServiceRoute?'':url.search);
      const headers = new Headers();
      headers.set('x-api-key', env.ANTHROPIC_TOKEN);
      headers.set('anthropic-version', request.headers.get('anthropic-version') || '2023-06-01');
      headers.set('Content-Type', 'application/json');
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: JSON.stringify(payload),
      });
      const usageCopy = upstream.clone();
      const reconciliation = reconcileAiBudget(env, reservation, usageCopy).catch(() => {});
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(reconciliation);
      else await reconciliation;
      const respHeaders = new Headers(upstream.headers);
      Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));
      return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    }

    // No funciona como proxy Anthropic genérico: solo Messages está expuesto.
    if (url.pathname.startsWith('/anthropic/')) return json({ error: 'Anthropic endpoint not allowed' }, 404, CORS);

    // ── OpenAI (visión + imágenes) ─────────────────────────────────────
    // Nunca funciona como proxy genérico. Solo admite las tres operaciones que usa
    // el dashboard, con modelos/parámetros acotados y el MISMO hard cap global de IA.
    // Así, copiar APP_KEY no permite elegir modelos caros ni generar sin límite.
    if (url.pathname === '/openai/usage') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, CORS);
      return json(await readAiBudget(env), 200, CORS);
    }

    if (url.pathname.startsWith('/openai/')) {
      if (!env.OPENAI_TOKEN) {
        return json({ error: 'Worker misconfigured: missing OPENAI_TOKEN secret' }, 500, CORS);
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, CORS);

      let estimate = 0;
      let source = 'openai';
      const ct = request.headers.get('Content-Type') || '';
      const clientSource = sanitizeAiSource(request.headers.get('X-AI-Agent') || '');

      if (url.pathname === '/openai/v1/chat/completions') {
        let payload;
        try { payload = await readOpenAiJson(request); }
        catch (_) { return json({ error: 'Invalid OpenAI JSON body' }, 400, CORS); }
        if (!OPENAI_ALLOWED_CHAT_MODELS.has(payload?.model)) {
          return json({ error: 'OpenAI chat model not allowed by cost policy' }, 403, CORS);
        }
        const maxTokens = Number(payload.max_tokens);
        if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > OPENAI_MAX_CHAT_OUTPUT_TOKENS) {
          return json({ error: `max_tokens must be between 1 and ${OPENAI_MAX_CHAT_OUTPUT_TOKENS}` }, 400, CORS);
        }
        if (payload.stream) return json({ error: 'Streaming is not allowed on this OpenAI route' }, 400, CORS);
        estimate = OPENAI_ESTIMATED_COST_USD.chat;
        source = clientSource || 'openai-chat';
      } else if (url.pathname === '/openai/v1/images/generations') {
        let payload;
        try { payload = await readOpenAiJson(request); }
        catch (_) { return json({ error: 'Invalid OpenAI image JSON body' }, 400, CORS); }
        if (!OPENAI_ALLOWED_IMAGE_MODELS.has(payload?.model)) {
          return json({ error: 'OpenAI image model not allowed by cost policy' }, 403, CORS);
        }
        if (Number(payload.n || 1) !== 1 || payload.size !== '1024x1024' || payload.quality !== 'low') {
          return json({ error: 'OpenAI image generation must use n=1, 1024x1024, quality=low' }, 400, CORS);
        }
        estimate = OPENAI_ESTIMATED_COST_USD.imageGenerationLow;
        source = clientSource || 'openai-image-generation';
      } else if (url.pathname === '/openai/v1/images/edits') {
        if (!ct.toLowerCase().includes('multipart/form-data')) {
          return json({ error: 'OpenAI image edit requires multipart/form-data' }, 400, CORS);
        }
        let form;
        try {
          if (!request.clone || typeof request.clone !== 'function') throw new Error('clone unavailable');
          form = await request.clone().formData();
        } catch (_) {
          return json({ error: 'Invalid OpenAI image edit body' }, 400, CORS);
        }
        const model = String(form.get('model') || '');
        const n = Number(form.get('n') || 1);
        const size = String(form.get('size') || '');
        const quality = String(form.get('quality') || '');
        const image = form.get('image');
        if (!OPENAI_ALLOWED_IMAGE_MODELS.has(model)) {
          return json({ error: 'OpenAI image model not allowed by cost policy' }, 403, CORS);
        }
        if (n !== 1 || size !== '1024x1024' || quality !== 'low') {
          return json({ error: 'OpenAI image edit must use n=1, 1024x1024, quality=low' }, 400, CORS);
        }
        if (!image || typeof image.size !== 'number' || image.size > 6 * 1024 * 1024) {
          return json({ error: 'OpenAI edit image is missing or exceeds 6 MB' }, 413, CORS);
        }
        estimate = OPENAI_ESTIMATED_COST_USD.imageEditLow;
        source = clientSource || 'openai-image-edit';
      } else {
        return json({ error: 'OpenAI endpoint not allowed' }, 404, CORS);
      }

      const reservation = await reserveAiBudget(env, { model: 'openai-budget-envelope' }, source, estimate);
      if (!reservation.ok) {
        return json({
          error: reservation.error,
          code: 'AI_BUDGET_LIMIT',
          budget_usd: reservation.budget_usd,
          used_usd: reservation.used_usd,
          estimated_request_usd: reservation.estimated_request_usd,
        }, reservation.status || 429, CORS);
      }

      const target = OPENAI_BASE + url.pathname.replace(/^\/openai/, '') + url.search;
      const headers = new Headers();
      headers.set('Authorization', 'Bearer ' + env.OPENAI_TOKEN);
      if (ct) headers.set('Content-Type', ct);
      const upstream = await fetch(target, {
        method: 'POST',
        headers,
        body: request.body,
      });
      const accounting = finalizeEstimatedAiBudget(env, reservation, upstream.ok, 'openai_http_' + upstream.status).catch(() => {});
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(accounting);
      else await accounting;

      const respHeaders = new Headers(upstream.headers);
      Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));
      return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    }

    // ── Airtable (default) — el PAT vive como secreto del Worker ──
    if (!env.AIRTABLE_TOKEN) {
      return json({ error: 'Worker misconfigured: missing AIRTABLE_TOKEN secret' }, 500);
    }
    // Reducir el alcance de un APP_KEY copiado del HTML: este Worker sólo debe
    // operar sobre la base TLS, nunca convertirse en un proxy para otras bases
    // a las que el PAT del servidor también pudiera tener acceso.
    // Esto es contención, NO autenticación ni RBAC (APP_KEY es visible).
    const allowedBase = 'app1YtD74AqiPWQhy';
    const path = url.pathname.startsWith('/v0/') ? url.pathname : '/v0' + url.pathname;
    const dataPrefix = '/v0/' + allowedBase + '/';
    const metaPrefix = '/v0/meta/bases/' + allowedBase + '/';
    if (!(path.startsWith(dataPrefix) || path.startsWith(metaPrefix))) {
      return json({ error: 'Airtable base or route not allowed' }, 403, CORS);
    }
    if (!['GET','POST','PATCH','DELETE'].includes(request.method)) {
      return json({ error: 'Method not allowed' }, 405, CORS);
    }
    // El POST de Pedidos/Cotizaciones DEBE pasar por CrmMutationGuard. Airtable
    // permite referirse a una tabla por nombre O tblId y algunos routers
    // aceptan segmentos URL codificados: /%50edidos o /tbl... no deben saltarse
    // el guard por no coincidir literalmente con /Pedidos. El HTML legítimo
    // siempre usa encodeURIComponent(table), por lo que la ruta canónica se
    // puede exigir sin romper sus escrituras.
    if (path.startsWith(dataPrefix) && request.method !== 'GET') {
      const segment = path.slice(dataPrefix.length).split('/')[0];
      let table;
      try { table = decodeURIComponent(segment); }
      catch (_) { return json({ error: 'Invalid Airtable table path' }, 400, CORS); }
      if (!table || table.includes('%') || table.includes('/') || table.includes('\\') ||
          /^tbl[A-Za-z0-9]{14}$/.test(table) || segment !== encodeURIComponent(table)) {
        return json({ error: 'Noncanonical Airtable table path' }, 403, CORS);
      }
      // Airtable no debe interpretar una variante de caja como tabla crítica
      // mientras el Worker la trata como una tabla no protegida.
      const critical = table.toLowerCase();
      if ((critical === 'pedidos' || critical === 'cotizaciones' || critical === 'facturas') &&
          (table !== (critical === 'pedidos' ? 'Pedidos' : critical === 'cotizaciones' ? 'Cotizaciones' : 'Facturas') ||
           (request.method === 'POST' && path !== dataPrefix + table))) {
        return json({ error: 'CRM and Facturas creates require canonical guarded path' }, 403, CORS);
      }
    }
    // La APP_KEY publicada no autoriza operaciones genéricas sobre el esquema.
    // Conservar únicamente lectura y bootstrap de tablas/campos TLS conocidos.
    if (path.startsWith(metaPrefix)) {
      const tableList = metaPrefix + 'tables';
      if (request.method === 'GET' && path === tableList) {
        // Necesario para comprobar qué campos ya existen.
      } else if (request.method === 'POST') {
        const createTable = path === tableList;
        const fieldMatch = new RegExp('^' + tableList + '/(tbl[A-Za-z0-9]{14})/fields$').exec(path);
        if (!createTable && !fieldMatch) return json({ error: 'Schema operation not allowed' }, 403, CORS);
        let body;
        try { body = await readOpenAiJson(request); }
        catch (_) { return json({ error: 'Invalid schema JSON' }, 400, CORS); }
        if (createTable) {
          if (!body || !SCHEMA_BOOTSTRAP_TABLES.has(body.name) ||
            !Array.isArray(body.fields) || body.fields.length < 1 || body.fields.length > 30 ||
            !body.fields.every(schemaFieldAllowed)) {
            return json({ error: 'Schema table creation not allowed' }, 403, CORS);
          }
        } else if (!schemaFieldAllowed(body)) {
          return json({ error: 'Schema field creation not allowed' }, 403, CORS);
        }
        // Nunca hacer un alta sin comprobar el esquema: evita duplicados,
        // valida el tblId real y falla cerrado si la metadata no responde.
        let meta;
        try {
          const check = await fetch(AIRTABLE_BASE + tableList, {
            headers: { Authorization: 'Bearer ' + env.AIRTABLE_TOKEN }
          });
          if (!check.ok) return json({ error: 'Cannot verify schema' }, 502, CORS);
          meta = await check.json();
        } catch (_) { return json({ error: 'Cannot verify schema' }, 502, CORS); }
        if (!meta || !Array.isArray(meta.tables)) return json({ error: 'Invalid schema' }, 502, CORS);
        if (createTable) {
          if (meta.tables.some(t => t.name === body.name)) return json({ error: 'Table already exists' }, 409, CORS);
        } else {
          const found = meta.tables.find(t => t.id === fieldMatch[1]);
          if (!found || !['Cotizaciones','Pedidos','Maquinas','Maquinas_Eventos','Maquinas_Mant'].includes(found.name)) {
            return json({ error: 'Schema table not allowed' }, 403, CORS);
          }
          if ((found.fields || []).some(f => f.name === body.name)) return json({ error: 'Field already exists' }, 409, CORS);
        }
      } else {
        return json({ error: 'Schema operation not allowed' }, 403, CORS);
      }
    }
    // Las creaciones de Pedidos/Cotizaciones/Facturas no pueden depender de un
    // check-then-POST en dos navegadores. Serializar ambas en el mismo DO.
    if (request.method === 'POST' &&
        (path === dataPrefix + 'Pedidos' || path === dataPrefix + 'Cotizaciones' || path === dataPrefix + 'Facturas')) {
      if (!env.CRM_MUTATION_GUARD) {
        return json({ error: 'CRM/Facturas write guard unavailable; creation suspended' }, 503, CORS);
      }
      let body;
      try { body = await readOpenAiJson(request); }
      catch (_) { return json({ error: 'Invalid guarded create JSON body' }, 400, CORS); }
      try {
        const id = env.CRM_MUTATION_GUARD.idFromName('tls-crm-global');
        const guard = env.CRM_MUTATION_GUARD.get(id);
        const guarded = await guard.fetch('https://crm-write.internal/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            table: path.slice(dataPrefix.length), body, search: url.search,
          }),
        });
        const respHeaders = new Headers(guarded.headers);
        Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));
        return new Response(guarded.body, { status: guarded.status, headers: respHeaders });
      } catch (_) {
        return json({ error: 'CRM write guard unavailable; creation suspended' }, 503, CORS);
      }
    }
    const target = AIRTABLE_BASE + path + url.search;

    const headers = new Headers();
    headers.set('Authorization', 'Bearer ' + env.AIRTABLE_TOKEN);
    const ct = request.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    });

    const respHeaders = new Headers(upstream.headers);
    Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));

    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  },
};


function sanitizeAiSource(value) {
  return String(value || 'dashboard').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 48) || 'dashboard';
}
function aiChileDate() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  catch (_) { return new Date().toISOString().slice(0, 10); }
}
function aiPrice(model) {
  return String(model || '').toLowerCase().includes('haiku') ? ANTHROPIC_PRICES.haiku : ANTHROPIC_PRICES.sonnet;
}
function aiCostUsd(model, usage) {
  const p = aiPrice(model), u = usage || {}, n = (k) => Math.max(0, Number(u[k]) || 0);
  return (n('input_tokens') * p.input +
    n('output_tokens') * p.output +
    n('cache_creation_input_tokens') * p.cacheWrite +
    n('cache_read_input_tokens') * p.cacheRead) / 1000000;
}
function estimateAiRequestUsd(payload) {
  const model = payload && payload.model;
  const p = aiPrice(model);
  const inputObj = { system: payload?.system || '', messages: payload?.messages || [], tools: payload?.tools || [] };
  const chars = JSON.stringify(inputObj).length;
  // 3 chars/token intentionally over-reserves versus the common ~4 chars/token.
  const inputTokens = Math.ceil(chars / 3);
  const outputTokens = Math.max(0, Number(payload?.max_tokens) || 0);
  // Reserva al peor precio posible del input: el primer uso de prompt caching
  // puede cobrarse como cache write, que es más caro que input normal.
  // Con max_tokens como techo de salida, la reserva queda deliberadamente >=
  // al costo facturable esperable de la solicitud.
  const inputRate = Math.max(p.input, p.cacheWrite);
  return (inputTokens * inputRate + outputTokens * p.output) / 1000000;
}

async function aiBudgetGuardCall(env, pathname, payload) {
  if (!env.AI_BUDGET_GUARD) throw new Error('AI budget Durable Object unavailable');
  const id = env.AI_BUDGET_GUARD.idFromName('anthropic-global-budget');
  const stub = env.AI_BUDGET_GUARD.get(id);
  const response = await stub.fetch('https://ai-budget.internal' + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!response.ok) throw new Error('AI budget guard HTTP ' + response.status);
  return response.json();
}

async function readAiBudget(env) {
  const budget = Math.max(0.05, Number(env.ANTHROPIC_DAILY_BUDGET_USD || ANTHROPIC_DAILY_BUDGET_USD_DEFAULT));
  const perRequest = Math.max(0.01, Number(env.ANTHROPIC_REQUEST_BUDGET_USD || ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT));
  const guardDate = aiChileDate();
  if (env.AI_BUDGET_GUARD) {
    try {
      return await aiBudgetGuardCall(env, '/usage', {
        date: guardDate, budget_usd: budget, request_budget_usd: perRequest,
      });
    } catch (_) {
      return { configured: false, atomic: false, date: guardDate, budget_usd: budget,
        request_budget_usd: perRequest, spent_usd: 0, reserved_usd: 0, used_usd: 0,
        remaining_usd: 0, requests: 0, by_source: {} };
    }
  }
  // Solo las pruebas unitarias pueden usar el ledger KV legado. Producción falla
  // cerrado si el Durable Object no está enlazado.
  if (!env.__TEST_ALLOW_KV_BUDGET) {
    return { configured: false, atomic: false, date: guardDate, budget_usd: budget,
      request_budget_usd: perRequest, spent_usd: 0, reserved_usd: 0, used_usd: 0,
      remaining_usd: 0, requests: 0, by_source: {} };
  }
  const key = 'anthropic-budget:' + guardDate;
  if (!env.AI_BUDGET) {
    return { configured: false, date: aiChileDate(), budget_usd: budget, request_budget_usd: perRequest,
      spent_usd: 0, reserved_usd: 0, used_usd: 0, remaining_usd: 0, requests: 0, by_source: {} };
  }
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(key)) || '{}'); } catch (_) {}
  const spent = Math.max(0, Number(row.spent_usd) || 0);
  let reserved = Math.max(0, Number(row.reserved_usd) || 0);
  // Autorreparación: antes una respuesta 4xx/5xx de Anthropic podía dejar la reserva
  // atrapada hasta 48 h. Eso hacía que, incluso después de recargar créditos,
  // el dashboard siguiera respondiendo AI_BUDGET_LIMIT. Las reservas viejas no son gasto.
  const reservationAt = Date.parse(row.reserved_at || row.updated_at || '');
  if (reserved > 0 && (!Number.isFinite(reservationAt) || Date.now() - reservationAt > AI_RESERVATION_STALE_MS)) {
    reserved = 0;
    row.reserved_usd = 0;
    row.by_source = row.by_source || {};
    for (const src of Object.values(row.by_source)) if (src && typeof src === 'object') src.reserved_usd = 0;
    row.reserved_at = null;
    row.recovered_stale_reservation_at = new Date().toISOString();
    row.updated_at = row.recovered_stale_reservation_at;
    await env.AI_BUDGET.put(key, JSON.stringify(row), { expirationTtl: 172800 });
  }
  return {
    configured: true, date: aiChileDate(), budget_usd: budget, request_budget_usd: perRequest,
    spent_usd: spent, reserved_usd: reserved, used_usd: spent + reserved,
    remaining_usd: Math.max(0, budget - spent - reserved),
    requests: Math.max(0, Number(row.requests) || 0), by_source: row.by_source || {},
    updated_at: row.updated_at || null,
  };
}
async function reserveAiBudget(env, payload, source, fixedEstimate = null) {
  const estimate = Number.isFinite(Number(fixedEstimate)) && fixedEstimate !== null
    ? Math.max(0, Number(fixedEstimate))
    : estimateAiRequestUsd(payload);
  const budget = Math.max(0.05, Number(env.ANTHROPIC_DAILY_BUDGET_USD || ANTHROPIC_DAILY_BUDGET_USD_DEFAULT));
  const perRequest = Math.max(0.01, Number(env.ANTHROPIC_REQUEST_BUDGET_USD || ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT));
  if (env.AI_BUDGET_GUARD) {
    try {
      return await aiBudgetGuardCall(env, '/reserve', {
        date: aiChileDate(), budget_usd: budget, request_budget_usd: perRequest,
        max_concurrent: 1, estimated_request_usd: estimate, source, model: payload && payload.model,
      });
    } catch (_) {
      return { ok: false, status: 503, error: 'AI cost guard unavailable',
        budget_usd: budget, used_usd: 0, estimated_request_usd: estimate };
    }
  }
  if (!env.__TEST_ALLOW_KV_BUDGET) {
    return { ok: false, status: 503, error: 'AI cost guard unavailable',
      budget_usd: budget, used_usd: 0, estimated_request_usd: estimate };
  }
  const snap = await readAiBudget(env);
  if (!snap.configured) return { ok: false, status: 503, error: 'AI cost guard unavailable', budget_usd: snap.budget_usd, used_usd: 0, estimated_request_usd: estimate };
  if (estimate > snap.request_budget_usd) return { ok: false, status: 429, error: 'AI request exceeds per-request cost limit', budget_usd: snap.budget_usd, used_usd: snap.used_usd, estimated_request_usd: estimate };
  if (snap.used_usd + estimate > snap.budget_usd) return { ok: false, status: 429, error: 'Daily AI budget reached', budget_usd: snap.budget_usd, used_usd: snap.used_usd, estimated_request_usd: estimate };

  const key = 'anthropic-budget:' + snap.date;
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(key)) || '{}'); } catch (_) {}
  row.spent_usd = Math.max(0, Number(row.spent_usd) || 0);
  row.reserved_usd = Math.max(0, Number(row.reserved_usd) || 0) + estimate;
  row.requests = Math.max(0, Number(row.requests) || 0) + 1;
  row.by_source = row.by_source || {};
  const src = row.by_source[source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
  src.requests = Math.max(0, Number(src.requests) || 0) + 1;
  src.reserved_usd = Math.max(0, Number(src.reserved_usd) || 0) + estimate;
  row.by_source[source] = src;
  row.updated_at = new Date().toISOString();
  row.reserved_at = row.updated_at;
  await env.AI_BUDGET.put(key, JSON.stringify(row), { expirationTtl: 172800 });
  return { ok: true, key, source, estimate, model: payload.model, budget_usd: snap.budget_usd, used_usd: snap.used_usd, estimated_request_usd: estimate };
}
async function parseAnthropicUsage(response) {
  if (!response || !response.ok) return null;
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const txt = await response.text();
    let model = '', usage = {};
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(t.slice(5).trim()); } catch (_) { continue; }
      if (ev.type === 'message_start' && ev.message) {
        model = ev.message.model || model;
        usage = { ...usage, ...(ev.message.usage || {}) };
      } else if (ev.type === 'message_delta' && ev.usage) {
        usage = { ...usage, ...ev.usage };
      }
    }
    return Object.keys(usage).length ? { model, usage } : null;
  }
  try {
    const j = await response.json();
    return j && j.usage ? { model: j.model || '', usage: j.usage } : null;
  } catch (_) { return null; }
}
async function releaseAiReservation(env, reservation, reason) {
  if (!reservation?.ok) return;
  if (env.AI_BUDGET_GUARD) {
    try {
      await aiBudgetGuardCall(env, '/release', {
        date: reservation.date || aiChileDate(),
        reservation_id: reservation.reservation_id || '',
        reason: String(reason || 'no_usage').slice(0, 80),
      });
    } catch (_) {}
    return;
  }
  if (!env.__TEST_ALLOW_KV_BUDGET || !env.AI_BUDGET) return;
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(reservation.key)) || '{}'); } catch (_) {}
  row.reserved_usd = Math.max(0, (Number(row.reserved_usd) || 0) - reservation.estimate);
  row.by_source = row.by_source || {};
  const src = row.by_source[reservation.source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
  src.reserved_usd = Math.max(0, (Number(src.reserved_usd) || 0) - reservation.estimate);
  row.by_source[reservation.source] = src;
  if (row.reserved_usd <= 1e-9) row.reserved_at = null;
  row.last_release_reason = String(reason || 'no_usage').slice(0, 80);
  row.updated_at = new Date().toISOString();
  await env.AI_BUDGET.put(reservation.key, JSON.stringify(row), { expirationTtl: 172800 });
}
async function reconcileAiBudget(env, reservation, response) {
  if (!reservation?.ok) return;
  if (env.AI_BUDGET_GUARD) {
    if (!response || !response.ok) {
      await releaseAiReservation(env, reservation, 'upstream_http_' + (response?.status || 'unknown'));
      return;
    }
    const parsedAtomic = await parseAnthropicUsage(response);
    // Un 2xx sin usage conserva su reserva; el guard la vence a los 2 min.
    if (!parsedAtomic) return;
    const actualAtomic = aiCostUsd(parsedAtomic.model || reservation.model, parsedAtomic.usage);
    try {
      await aiBudgetGuardCall(env, '/reconcile', {
        date: reservation.date || aiChileDate(),
        reservation_id: reservation.reservation_id || '',
        actual_usd: actualAtomic,
        source: reservation.source || 'dashboard',
      });
    } catch (_) {}
    return;
  }
  if (!env.__TEST_ALLOW_KV_BUDGET || !env.AI_BUDGET) return;
  // Un 4xx/5xx es un rechazo confirmado por Anthropic: no hubo una generación
  // facturable que justifique mantener la reserva. Liberarla permite reintentar
  // después de recargar créditos o resolver un rate limit.
  if (!response || !response.ok) {
    await releaseAiReservation(env, reservation, 'upstream_http_' + (response?.status || 'unknown'));
    return;
  }
  const parsed = await parseAnthropicUsage(response);
  // Si un 2xx excepcional no trae usage, conservamos la reserva por seguridad;
  // readAiBudget la recupera automáticamente si queda huérfana >2 min.
  if (!parsed) return;
  const actual = aiCostUsd(parsed.model || reservation.model, parsed.usage);
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(reservation.key)) || '{}'); } catch (_) {}
  row.spent_usd = Math.max(0, Number(row.spent_usd) || 0) + actual;
  row.reserved_usd = Math.max(0, (Number(row.reserved_usd) || 0) - reservation.estimate);
  row.by_source = row.by_source || {};
  const src = row.by_source[reservation.source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
  src.spent_usd = Math.max(0, Number(src.spent_usd) || 0) + actual;
  src.reserved_usd = Math.max(0, (Number(src.reserved_usd) || 0) - reservation.estimate);
  row.by_source[reservation.source] = src;
  if (row.reserved_usd <= 1e-9) row.reserved_at = null;
  row.updated_at = new Date().toISOString();
  await env.AI_BUDGET.put(reservation.key, JSON.stringify(row), { expirationTtl: 172800 });
}

async function finalizeEstimatedAiBudget(env, reservation, success, reason) {
  if (!reservation?.ok) return;
  if (!success) {
    await releaseAiReservation(env, reservation, reason || 'upstream_error');
    return;
  }
  if (env.AI_BUDGET_GUARD) {
    try {
      await aiBudgetGuardCall(env, '/reconcile', {
        date: reservation.date || aiChileDate(),
        reservation_id: reservation.reservation_id || '',
        actual_usd: reservation.estimate,
        source: reservation.source || 'dashboard',
      });
    } catch (_) {}
    return;
  }
  if (!env.__TEST_ALLOW_KV_BUDGET || !env.AI_BUDGET) return;
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(reservation.key)) || '{}'); } catch (_) {}
  const actual = Math.max(0, Number(reservation.estimate) || 0);
  row.spent_usd = Math.max(0, Number(row.spent_usd) || 0) + actual;
  row.reserved_usd = Math.max(0, (Number(row.reserved_usd) || 0) - actual);
  row.by_source = row.by_source || {};
  const src = row.by_source[reservation.source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
  src.spent_usd = Math.max(0, Number(src.spent_usd) || 0) + actual;
  src.reserved_usd = Math.max(0, (Number(src.reserved_usd) || 0) - actual);
  row.by_source[reservation.source] = src;
  if (row.reserved_usd <= 1e-9) row.reserved_at = null;
  row.updated_at = new Date().toISOString();
  await env.AI_BUDGET.put(reservation.key, JSON.stringify(row), { expirationTtl: 172800 });
}

async function readOpenAiJson(request) {
  if (request && typeof request.clone === 'function') return request.clone().json();
  if (typeof request.body === 'string') return JSON.parse(request.body);
  if (request.body && typeof request.body.text === 'function') return JSON.parse(await request.body.text());
  throw new Error('body unavailable');
}

async function readAnthropicJson(request) {
  // Request real de Cloudflare: clone evita consumir el stream que luego se
  // reenvía. El fallback string mantiene simples las pruebas unitarias.
  if (request && typeof request.clone === 'function') return request.clone().json();
  if (typeof request.body === 'string') return JSON.parse(request.body);
  if (request.body && typeof request.body.text === 'function') return JSON.parse(await request.body.text());
  throw new Error('body unavailable');
}

function json(data, status = 200, corsHeaders = cors('')) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// ── Heartbeat hacia la tabla Automations ──────────────────────────────
// Actualiza la fila ID="airtable-proxy" con Estado=Activo y la hora actual,
// como máximo una vez cada 5 min (throttle por isolate). Totalmente opcional:
// si la base/tabla no existen o el token no puede escribir, falla en silencio.
let _lastBeat = 0;
const HEARTBEAT_ID = 'airtable-proxy';
const HEARTBEAT_TABLE = 'Automations';
const HEARTBEAT_MIN_MS = 5 * 60 * 1000;

async function heartbeat(env) {
  const now = Date.now();
  if (now - _lastBeat < HEARTBEAT_MIN_MS) return;
  _lastBeat = now;

  const base = env.HEARTBEAT_BASE || 'app1YtD74AqiPWQhy';
  const auth = { Authorization: 'Bearer ' + env.AIRTABLE_TOKEN };
  const tbl = `${AIRTABLE_BASE}/v0/${base}/${encodeURIComponent(HEARTBEAT_TABLE)}`;

  // 1) Buscar la fila del proxy por su ID técnico
  const q = `${tbl}?maxRecords=1&filterByFormula=${encodeURIComponent(`{ID}='${HEARTBEAT_ID}'`)}`;
  const found = await fetch(q, { headers: auth });
  if (!found.ok) return;
  const data = await found.json();
  const rec = data.records && data.records[0];
  if (!rec) return;

  // 2) Marcar como Activo con la hora actual; EjecucionesHoy con reseteo diario
  const f = rec.fields || {};
  const sameDay = f.UltimaEjecucion && new Date(f.UltimaEjecucion).toDateString() === new Date().toDateString();
  const ej = (sameDay ? (Number(f.EjecucionesHoy) || 0) : 0) + 1;
  await fetch(`${tbl}/${rec.id}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        Estado: 'Activo',
        UltimaEjecucion: new Date().toISOString(),
        EjecucionesHoy: ej,
        TareaActual: 'Proxy seguro Airtable + Claude operativo',
      },
      typecast: true,
    }),
  });
}
