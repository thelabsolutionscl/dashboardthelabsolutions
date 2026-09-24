/**
 * Avisos internos por WhatsApp (API oficial de Meta, Cloud API) — fase 1
 * ---------------------------------------------------------------------------
 * Hasta ahora los avisos por WhatsApp salían del NAVEGADOR: solo existían si
 * alguien tenía el dashboard abierto, y se duplicaban si había dos pestañas.
 * Este módulo los manda desde el Worker (servidor, 24/7), con anti-duplicado
 * en KV, directo por la Cloud API de Meta (sin intermediario ni mensualidad).
 *
 *   Nuevo lead                        → Nicanor + Gustavo  (al instante)
 *   Recordatorio envío de cotización  → Nicanor            (resumen diario)
 *   Recordatorio vencimiento pedido   → Gustavo            (resumen diario)
 *   Impresión con error / finalizada  → Gustavo            (lo avisa el farm-controller)
 *
 * Ventana de 24 h: WhatsApp solo entrega texto libre si la persona escribió al
 * número en las últimas 24 h. El webhook (/whatsapp/webhook) anota en KV cuándo
 * escribió cada uno; dentro de la ventana va texto (gratis), fuera va la
 * plantilla aprobada (utility, centavos). La Cloud API acepta el texto aunque
 * no lo vaya a entregar, por eso hay que decidirlo antes de enviar.
 *
 * Correo nuevo (fase 2) y el chat con KAI (fase 3) se enchufan a WA_RUTAS.
 *
 * Config (wrangler.toml / secretos):
 *   WA_PHONE_NUMBER_ID             id del número KAI TLS en Meta (no secreto)
 *   WA_ACCESS_TOKEN                (secreto) token permanente de usuario del sistema
 *   WA_APP_SECRET                  (secreto) firma de los webhooks de Meta
 *   WA_VERIFY_TOKEN                (secreto) verificación inicial del webhook
 *   WA_TEMPLATE_NAME / WA_TEMPLATE_LANG  plantilla utility con {{1}} título y
 *                                  {{2}} detalle; vacío = solo texto
 *   WA_PHONE_NICANOR, WA_PHONE_GUSTAVO
 *   WA_NOTIFY_ENABLED              "false" apaga todos los avisos
 *   WA_DIGEST_HOUR                 hora de Chile del resumen diario (def. 9)
 */

const GRAPH = "https://graph.facebook.com/v21.0";
const VENTANA_MS = 23.5 * 3600 * 1000; // margen bajo las 24 h de Meta

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
    !!env.WA_PHONE_NUMBER_ID && !!env.WA_ACCESS_TOKEN;
}

export function waTexto({ titulo, lineas = [] }) {
  return [`🔔 *${titulo}*`, ...lineas.filter(Boolean)].join("\n");
}

// Las plantillas de Meta no aceptan saltos de línea ni tabs en los parámetros.
export function waLineaUnica(lineas = []) {
  return lineas.filter(Boolean).join(" · ").replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").slice(0, 1000);
}

async function graphSend(env, payload) {
  const r = await fetch(`${GRAPH}/${env.WA_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.ok && d?.messages?.[0]?.id) return { ok: true, id: d.messages[0].id };
  return { ok: false, error: d?.error?.message || `HTTP ${r.status}` };
}

const INBOUND_KEY = (phone) => `wa:inbound:${phone}`;

// ¿La persona escribió al número en las últimas ~24 h? (lo anota el webhook)
export async function waEnVentana(env, phone, now = Date.now()) {
  if (!env.RL) return false;
  try {
    const t = Number(await env.RL.get(INBOUND_KEY(phone)));
    return t > 0 && now - t < VENTANA_MS;
  } catch (_) {
    return false;
  }
}

export async function waSend(env, phone, msg) {
  if (!waEnabled(env)) return { ok: false, skipped: "whatsapp-no-configurado" };
  if (!phone) return { ok: false, skipped: "sin-telefono" };
  try {
    const ventana = await waEnVentana(env, phone);
    if (ventana || !env.WA_TEMPLATE_NAME) {
      // Sin plantilla todavía (recién creada, esperando a Meta) se intenta el
      // texto igual: llega si la persona escribió hace poco.
      const r = await graphSend(env, { to: phone, type: "text", text: { body: waTexto(msg).slice(0, 4000), preview_url: false } });
      return r.ok ? { ok: true, via: ventana ? "texto" : "texto-sin-ventana" } : r;
    }
    const r = await graphSend(env, {
      to: phone,
      type: "template",
      template: {
        name: env.WA_TEMPLATE_NAME,
        language: { code: env.WA_TEMPLATE_LANG || "es" },
        components: [{ type: "body", parameters: [
          { type: "text", text: String(msg.titulo || "Aviso").replace(/[\r\n\t]+/g, " ").slice(0, 200) },
          { type: "text", text: waLineaUnica(msg.lineas) || "—" },
        ] }],
      },
    });
    return r.ok ? { ok: true, via: "plantilla" } : r;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ── Webhook de Meta ─────────────────────────────────────────────────────
 * GET  = verificación al configurarlo en Meta (hub.challenge).
 * POST = mensajes y estados. Firmado con WA_APP_SECRET (X-Hub-Signature-256);
 * sin firma válida se rechaza. Por ahora solo anota la ventana de 24 h de
 * cada remitente y registra los envíos fallidos; el chat con KAI (fase 3)
 * se engancha aquí.
 */
export function waWebhookVerify(env, url) {
  const q = url.searchParams;
  if (q.get("hub.mode") === "subscribe" && env.WA_VERIFY_TOKEN && q.get("hub.verify_token") === env.WA_VERIFY_TOKEN) {
    return new Response(q.get("hub.challenge") || "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function waWebhookFirmaValida(env, raw, header) {
  if (!env.WA_APP_SECRET || !header) return false;
  const esperado = "sha256=" + (await hmacHex(env.WA_APP_SECRET, raw));
  if (esperado.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

export async function waWebhookEvento(env, body, now = Date.now()) {
  const out = { mensajes: 0, fallidos: 0 };
  for (const entry of body?.entry || []) {
    for (const ch of entry?.changes || []) {
      const v = ch?.value || {};
      for (const m of v.messages || []) {
        const from = String(m.from || "").replace(/\D/g, "");
        if (!from) continue;
        out.mensajes++;
        if (env.RL) await env.RL.put(INBOUND_KEY(from), String(now), { expirationTtl: 86400 }).catch(() => {});
      }
      for (const st of v.statuses || []) {
        if (st.status !== "failed") continue;
        out.fallidos++;
        const err = st.errors?.[0] || {};
        console.error(`[wa-notify] no entregado a ${st.recipient_id}: ${err.code || ""} ${err.title || err.message || ""}`);
      }
    }
  }
  return out;
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
