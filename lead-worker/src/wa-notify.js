/**
 * Avisos internos por WhatsApp (WATI) — fase 1
 * ---------------------------------------------------------------------------
 * Hasta ahora los avisos por WhatsApp salían del NAVEGADOR: solo existían si
 * alguien tenía el dashboard abierto, y se duplicaban si había dos pestañas.
 * Este módulo los manda desde el Worker (servidor, 24/7), con anti-duplicado
 * en KV.
 *
 *   Nuevo lead                        → Nicanor + Gustavo  (al instante)
 *   Recordatorio envío de cotización  → Nicanor            (resumen diario)
 *   Recordatorio vencimiento pedido   → Gustavo            (resumen diario)
 *   Impresión con error / finalizada  → Gustavo            (lo avisa el farm-controller)
 *
 * Correo nuevo (fase 2) y el chat con KAI (fase 3) se enchufan a WA_RUTAS.
 *
 * Config (wrangler.toml / secretos):
 *   WATI_API_URL, WATI_API_TOKEN   (secretos) — sin ellos no se envía nada
 *   WATI_TEMPLATE_NAME             (opcional) plantilla aprobada con parámetros
 *                                  {{titulo}} y {{detalle}}; se usa si el
 *                                  mensaje de sesión falla (ventana de 24 h)
 *   WA_PHONE_NICANOR, WA_PHONE_GUSTAVO
 *   WA_NOTIFY_ENABLED              "false" apaga todos los avisos
 *   WA_DIGEST_HOUR                 hora de Chile del resumen diario (def. 9)
 */

export const WA_RUTAS = {
  lead: ["nicanor", "gustavo"],
  cotizacion_envio: ["nicanor"],
  pedido_vencimiento: ["gustavo"],
  impresora: ["gustavo"],
};

const PEDIDO_CERRADO = ["Despachado", "Completado", "Cancelado"];
const MAX_ITEMS = 10;
const TZ = "America/Santiago";

export function waPhone(env, persona) {
  const raw = env[`WA_PHONE_${String(persona).toUpperCase()}`] || "";
  return String(raw).replace(/\D/g, "");
}

export function waEnabled(env) {
  return String(env.WA_NOTIFY_ENABLED ?? "true").toLowerCase() !== "false" &&
    !!env.WATI_API_URL && !!env.WATI_API_TOKEN;
}

export function waTexto({ titulo, lineas = [] }) {
  return [`🔔 *${titulo}*`, ...lineas.filter(Boolean)].join("\n");
}

// Las plantillas de Meta no aceptan saltos de línea ni tabs en los parámetros.
export function waLineaUnica(lineas = []) {
  return lineas.filter(Boolean).join(" · ").replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").slice(0, 1000);
}

async function watiPost(env, path, body) {
  const base = String(env.WATI_API_URL).replace(/\/+$/, "");
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WATI_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// WATI responde 200 con {result:false} cuando no entrega (p. ej. fuera de la
// ventana de 24 h), así que el HTTP ok no basta.
async function watiOk(r) {
  if (!r.ok) return false;
  const d = await r.json().catch(() => ({}));
  return d?.result !== false && d?.ok !== false;
}

export async function waSend(env, phone, msg) {
  if (!waEnabled(env)) return { ok: false, skipped: "wati-no-configurado" };
  if (!phone) return { ok: false, skipped: "sin-telefono" };
  const texto = waTexto(msg);
  try {
    // Sesión primero (texto con formato); la API de WATI lee messageText de la
    // query, el body se manda igual por compatibilidad con el dashboard.
    const r = await watiPost(env, `/api/v1/sendSessionMessage/${phone}?messageText=${encodeURIComponent(texto)}`, { messageText: texto });
    if (await watiOk(r)) return { ok: true, via: "session" };
    if (!env.WATI_TEMPLATE_NAME) return { ok: false, error: `sesión rechazada (HTTP ${r.status}); falta plantilla` };
    const t = await watiPost(env, `/api/v1/sendTemplateMessage?whatsappNumber=${phone}`, {
      template_name: env.WATI_TEMPLATE_NAME,
      broadcast_name: `aviso_${Date.now()}`,
      parameters: [
        { name: "titulo", value: String(msg.titulo || "Aviso").slice(0, 200) },
        { name: "detalle", value: waLineaUnica(msg.lineas) || "—" },
      ],
    });
    if (await watiOk(t)) return { ok: true, via: "template" };
    return { ok: false, error: `plantilla rechazada (HTTP ${t.status})` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Envía a cada persona de la ruta, una sola vez por dedupKey (KV `RL`).
// Si el envío falla NO se marca, así el siguiente intento lo reintenta.
export async function waNotify(env, tipo, msg, { dedupKey = "", ttl = 86400 } = {}) {
  const personas = WA_RUTAS[tipo] || [];
  const out = [];
  for (const persona of personas) {
    const key = dedupKey ? `wa:${tipo}:${dedupKey}:${persona}` : "";
    if (key && env.RL) {
      try { if (await env.RL.get(key)) { out.push({ persona, ok: true, skipped: "duplicado" }); continue; } } catch (_) {}
    }
    const res = await waSend(env, waPhone(env, persona), msg);
    if (res.ok && key && env.RL) {
      try { await env.RL.put(key, "1", { expirationTtl: Math.max(60, ttl) }); } catch (_) {}
    }
    if (!res.ok && !res.skipped) console.error(`[wa-notify] ${tipo} → ${persona}:`, res.error);
    out.push({ persona, ...res });
  }
  return out;
}

/* ── Mensajes ────────────────────────────────────────────────────────── */

const ORIGEN = { web: "Web", google_ads: "Google Ads", linkedin: "LinkedIn", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };

export function mensajeLead(norm = {}, source = "", { recurrente = false } = {}) {
  const quien = [norm.name, norm.company].filter(Boolean).join(" — ") || norm.email || norm.phone || "Sin nombre";
  const pedido = [norm.service, norm.product, norm.quantity ? `x${norm.quantity}` : ""].filter(Boolean).join(" · ");
  return {
    titulo: recurrente ? "Nuevo lead (cliente recurrente)" : "Nuevo lead",
    lineas: [
      quien,
      pedido && `Interés: ${pedido}`,
      norm.deliveryDate && `Para: ${norm.deliveryDate}`,
      `Origen: ${ORIGEN[source] || source || "—"}`,
      [norm.phone, norm.email].filter(Boolean).join(" · "),
    ],
  };
}

export function mensajeImpresora({ machine, state, filename, message, durationSec } = {}) {
  const st = String(state || "").toLowerCase();
  const titulo = st === "complete" ? "Impresión finalizada"
    : st === "paused" ? "Impresión en pausa con aviso"
    : "Impresión con ERROR";
  const dur = Number(durationSec) > 0 ? `${Math.floor(durationSec / 3600)}h ${Math.round((durationSec % 3600) / 60)}m` : "";
  return {
    titulo: `${titulo} — ${machine || "impresora"}`,
    lineas: [
      filename && `Archivo: ${filename}`,
      dur && `Duración: ${dur}`,
      message && `Detalle: ${String(message).slice(0, 300)}`,
      st === "complete" ? "Retira la pieza y confirma cama libre en el dashboard." : "Revisa la máquina en el dashboard → Máquinas.",
    ],
  };
}

/* ── Recordatorios diarios ───────────────────────────────────────────── */

export function fechaChile(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function horaChile(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(now)) % 24;
}
function diasEntre(desdeIso, hastaIso) {
  return Math.round((Date.parse(hastaIso + "T00:00:00Z") - Date.parse(desdeIso + "T00:00:00Z")) / 86400000);
}

// Misma regla que la alerta "cot-sin-enviar" del dashboard (Solicitada +48 h),
// más las que tienen fecha límite de envío hoy/mañana o ya vencida.
export function cotizacionesPorEnviar(records = [], now = new Date()) {
  const hoy = fechaChile(now), hace48h = now.getTime() - 48 * 3600 * 1000;
  return records.filter((r) => (r.fields?.["Estado cotización"] || "") === "Solicitada").map((r) => {
    const f = r.fields, lim = f["Fecha límite cotización"] || "";
    const diasLim = lim ? diasEntre(hoy, lim) : null;
    const vieja = r.createdTime && Date.parse(r.createdTime) < hace48h;
    if (!(vieja || (diasLim !== null && diasLim <= 1))) return null;
    return { id: r.id, num: f["N° Cotización"] || "—", alias: f["Alias / Título"] || "", cliente: f.Cliente, vendedor: f.Vendedor || "", diasLim };
  }).filter(Boolean).sort((a, b) => (a.diasLim ?? 99) - (b.diasLim ?? 99));
}

// Pedidos abiertos atrasados o con entrega en los próximos 2 días
// (reglas "pedido-atrasado" y "pedido-urgente" del dashboard).
export function pedidosPorVencer(records = [], now = new Date()) {
  const hoy = fechaChile(now);
  return records.map((r) => {
    const f = r.fields || {};
    if (!f["Fecha entrega"] || PEDIDO_CERRADO.includes(f["Estado pedido"] || "")) return null;
    const dias = diasEntre(hoy, f["Fecha entrega"]);
    if (dias > 2) return null;
    return { id: r.id, num: f["N° Pedido"] || "—", cliente: f.Cliente, estado: f["Estado pedido"] || "", dias };
  }).filter(Boolean).sort((a, b) => a.dias - b.dias);
}

function nombreCliente(nombres, link) {
  const id = Array.isArray(link) ? link[0] : "";
  return (id && nombres[id]) || "";
}
function mas(lista) {
  return lista.length > MAX_ITEMS ? [`…y ${lista.length - MAX_ITEMS} más en el dashboard.`] : [];
}

export function mensajeCotizaciones(items, nombres = {}) {
  return {
    titulo: `Cotizaciones por enviar (${items.length})`,
    lineas: [
      ...items.slice(0, MAX_ITEMS).map((c) => {
        const cli = nombreCliente(nombres, c.cliente);
        const plazo = c.diasLim === null ? "solicitada hace +48 h"
          : c.diasLim < 0 ? `límite vencido hace ${-c.diasLim}d`
          : c.diasLim === 0 ? "límite HOY" : "límite mañana";
        return `• ${c.num}${c.alias ? " " + c.alias : ""}${cli ? " (" + cli + ")" : ""} — ${plazo}${c.vendedor ? " · " + c.vendedor : ""}`;
      }),
      ...mas(items),
    ],
  };
}

export function mensajePedidos(items, nombres = {}) {
  return {
    titulo: `Pedidos por vencer (${items.length})`,
    lineas: [
      ...items.slice(0, MAX_ITEMS).map((p) => {
        const cli = nombreCliente(nombres, p.cliente);
        const cuando = p.dias < 0 ? `ATRASADO ${-p.dias}d` : p.dias === 0 ? "entrega HOY" : p.dias === 1 ? "entrega mañana" : `entrega en ${p.dias}d`;
        return `• ${p.num}${cli ? " (" + cli + ")" : ""} — ${cuando}${p.estado ? " · " + p.estado : ""}`;
      }),
      ...mas(items),
    ],
  };
}

async function airtableList(env, table, { filterByFormula, fields = [] } = {}) {
  const q = new URLSearchParams();
  if (filterByFormula) q.set("filterByFormula", filterByFormula);
  fields.forEach((f) => q.append("fields[]", f));
  q.set("pageSize", "100");
  let all = [], offset = null;
  do {
    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?${q}${offset ? "&offset=" + encodeURIComponent(offset) : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
    if (!r.ok) throw new Error(`Airtable ${table} ${r.status}`);
    const d = await r.json();
    all = all.concat(d.records || []);
    offset = d.offset || null;
  } while (offset && all.length < 1000);
  return all;
}

async function nombresClientes(env, items) {
  const ids = [...new Set(items.flatMap((i) => (Array.isArray(i.cliente) ? i.cliente.slice(0, 1) : [])))]
    .filter((id) => /^rec[A-Za-z0-9]{14}$/.test(id)).slice(0, 40);
  if (!ids.length) return {};
  try {
    const recs = await airtableList(env, "Clientes", {
      filterByFormula: `OR(${ids.map((id) => `RECORD_ID()='${id}'`).join(",")})`,
      fields: ["Empresa", "Contacto"],
    });
    return Object.fromEntries(recs.map((r) => [r.id, r.fields?.Empresa || r.fields?.Contacto || ""]));
  } catch (_) {
    return {};
  }
}

// Corre en el cron horario; solo actúa a la hora del resumen (hora de Chile)
// y una vez por día (dedup por fecha en KV).
export async function waDailyReminders(env, now = new Date(), { force = false } = {}) {
  if (!waEnabled(env) || !env.AIRTABLE_TOKEN) return { skipped: "sin-config" };
  const hora = Number(env.WA_DIGEST_HOUR ?? 9);
  if (!force && horaChile(now) !== hora) return { skipped: "fuera-de-hora" };
  const dia = fechaChile(now), res = {};

  const cots = cotizacionesPorEnviar(await airtableList(env, "Cotizaciones", {
    filterByFormula: "{Estado cotización}='Solicitada'",
    fields: ["N° Cotización", "Alias / Título", "Cliente", "Estado cotización", "Fecha límite cotización", "Vendedor"],
  }), now);
  if (cots.length) {
    res.cotizaciones = await waNotify(env, "cotizacion_envio", mensajeCotizaciones(cots, await nombresClientes(env, cots)), { dedupKey: dia, ttl: 30 * 3600 });
  }

  const peds = pedidosPorVencer(await airtableList(env, "Pedidos", {
    filterByFormula: "AND({Fecha entrega}!='',{Estado pedido}!='Despachado',{Estado pedido}!='Completado',{Estado pedido}!='Cancelado')",
    fields: ["N° Pedido", "Cliente", "Estado pedido", "Fecha entrega"],
  }), now);
  if (peds.length) {
    res.pedidos = await waNotify(env, "pedido_vencimiento", mensajePedidos(peds, await nombresClientes(env, peds)), { dedupKey: dia, ttl: 30 * 3600 });
  }
  return res;
}
