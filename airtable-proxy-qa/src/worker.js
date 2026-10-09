/*
 * Isolated, READ-ONLY RBAC QA Worker. Never deploy over airtable-proxy.
 * Access JWT verification is shared with production, but credentials,
 * Airtable base, route, and deployment are completely separate.
 */
import { accessAuthorize } from '../../airtable-proxy/src/access-auth.js';

const QA_BASE_ID = 'app55FbVNr3yhTlbL';
const QA_HOST = 'qa-proxy.thelab.solutions';
const QA_TABLES = Object.freeze({
  Clientes: ['Empresa', 'Contacto', 'Email', 'Teléfono', 'Vendedor', 'Notas followup', 'Estado cuenta'],
  Cotizaciones: ['N° Cotización', 'Vendedor', 'Estado cotización', 'Notas cotización', 'Fecha cotización'],
  Pedidos: ['N° Pedido', 'Vendedor', 'Estado pedido', 'Notas pedido', 'Fecha ingreso']
});
const QA_SELLERS = new Set(['florencia', 'nicanor', 'gustavo']);
const ALLOWED_ROLES = new Set(['admin', 'sales']);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function ready(env, host) {
  // Explicit environment and fixed base: this app cannot silently read the live CRM.
  return host === QA_HOST
    && env?.QA_MODE === 'true'
    && env?.QA_BASE_ID === QA_BASE_ID
    && env?.ACCESS_ENFORCE === 'true'
    && typeof env?.QA_AIRTABLE_TOKEN === 'string'
    && env.QA_AIRTABLE_TOKEN.length >= 20;
}

function project(record, table) {
  const allowed = QA_TABLES[table];
  const fields = Object.fromEntries(
    allowed.filter(k => Object.hasOwn(record.fields || {}, k))
      .map(k => [k, record.fields[k]])
  );
  // Never expose linked-record IDs, unknown columns, or Airtable metadata.
  return { id: record.id, fields };
}

function ownerMatches(record, identity) {
  return identity.role === 'admin' ||
    (identity.role === 'sales' && QA_SELLERS.has(identity.seller) &&
     record?.fields?.Vendedor === identity.seller);
}

async function airtableGet(env, table, id, seller) {
  const endpoint = new URL(
    'https://api.airtable.com/v0/' + QA_BASE_ID + '/' + encodeURIComponent(table) +
    (id ? '/' + id : '')
  );
  if (!id) {
    for (const field of QA_TABLES[table]) endpoint.searchParams.append('fields[]', field);
    endpoint.searchParams.set('pageSize', '100');
    if (seller) endpoint.searchParams.set('filterByFormula', "{Vendedor}='" + seller + "'");
  }
  const result = await fetch(endpoint.toString(), {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + env.QA_AIRTABLE_TOKEN },
    redirect: 'error'
  });
  if (result.status === 404) return { notFound: true };
  if (!result.ok) throw new Error('QA Airtable request failed');
  const body = await result.json();
  if (!body || typeof body !== 'object') throw new Error('Invalid Airtable response');
  return body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // No public health, no bypass by direct workers.dev, and no legacy shared key.
    if (!ready(env, url.hostname)) return json({ error: 'QA environment not configured' }, 503);
    if (request.method !== 'GET') return json({ error: 'Read-only QA worker' }, 405);
    if (url.search || url.hash) return json({ error: 'Query parameters not supported' }, 400);

    let identity;
    try {
      const result = await accessAuthorize(request, env, '/access/me');
      if (result?.response) return result.response;
      if (result?.legacy || !result?.identity) return json({ error: 'Signed session required' }, 401);
      identity = result.identity;
    } catch (_) {
      return json({ error: 'Signed session required' }, 401);
    }
    if (!ALLOWED_ROLES.has(identity.role)) return json({ error: 'Forbidden' }, 403);
    if (identity.role === 'sales' && !QA_SELLERS.has(identity.seller))
      return json({ error: 'Seller mapping required' }, 403);

    if (url.pathname === '/access/me') {
      return json({ email: identity.email, role: identity.role,
        ...(identity.role === 'sales' ? { seller: identity.seller } : {}) });
    }
    const match = /^\/crm\/(Clientes|Cotizaciones|Pedidos)(?:\/(rec[A-Za-z0-9]{14}))?$/.exec(url.pathname);
    if (!match) return json({ error: 'Not found' }, 404);

    const [, table, id] = match;
    try {
      const response = await airtableGet(env, table, id, identity.role === 'sales' && !id ? identity.seller : null);
      if (response.notFound) return json({ error: 'Not found' }, 404);
      if (id) {
        if (!response.fields || response.id !== id || !ownerMatches(response, identity))
          return json({ error: 'Not found' }, 404);
        return json(project(response, table));
      }
      if (!Array.isArray(response.records)) throw new Error('Invalid list result');
      return json({
        records: response.records.filter(record => ownerMatches(record, identity))
          .map(record => project(record, table)),
        // A deliberately limited QA fixture endpoint; no offset handling.
        truncated: Boolean(response.offset)
      });
    } catch (_) {
      return json({ error: 'QA upstream unavailable' }, 502);
    }
  }
};
