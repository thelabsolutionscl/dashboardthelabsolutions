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
 * Nada se pierde en silencio: si un aviso no se pudo entregar (error al enviar,
 * o Meta avisa después por el webhook que falló), queda en una bandeja de
 * pendientes por persona y se le entrega apenas le escriba al número.
 *
 * Correo nuevo (fase 2) y el chat con KAI (fase 3) se enchufan a WA_RUTAS.
 *
 * Config (wrangler.toml / secretos):
 *   WA_PHONE_NUMBER_ID             id del número KAI TLS en Meta (no secreto)
 *   WA_GRAPH_VERSION               versión de la Graph API (def. v25.0, vigente
 *                                  hasta 2028; Meta retira cada versión ~2 años)
 *   WA_ACCESS_TOKEN                (secreto) token permanente de usuario del sistema
 *   WA_APP_SECRET                  (secreto) firma de los webhooks de Meta
 *   WA_VERIFY_TOKEN                (secreto) verificación inicial del webhook
 *   WA_TEMPLATE_NAME / WA_TEMPLATE_LANG  plantilla utility con {{1}} título y
 *                                  {{2}} detalle; vacío = solo texto
 *   WA_PHONE_NICANOR, WA_PHONE_GUSTAVO
 *   WA_NOTIFY_ENABLED              "false" apaga todos los avisos
 *   WA_DIGEST_HOUR                 hora de Chile del resumen diario (def. 9)
 */

const GRAPH_VERSION_DEFAULT = "v25.0";
const VENTANA_MS = 23.5 * 3600 * 1000; // margen bajo las 24 h de Meta
const TEXTO_MAX = 3800; // Meta acepta 4096 en un texto; margen para el encabezado
// Meta limita el cuerpo de la plantilla a 1024 caracteres (texto fijo + parámetros).
const PARAM_TITULO_MAX = 120;
const PARAM_DETALLE_MAX = 700;
const PEND_MAX = 15;
const PEND_TTL = 7 * 86400;

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

// Las plantillas de Meta no aceptan saltos de línea, tabs ni más de 4 espacios
// seguidos en los parámetros.
export function waLineaUnica(lineas = [], max = PARAM_DETALLE_MAX) {
  const t = lineas.filter(Boolean).join(" · ").replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

async function graphSend(env, payload) {
  const version = /^v\d+\.\d+$/.test(env.WA_GRAPH_VERSION || "") ? env.WA_GRAPH_VERSION : GRAPH_VERSION_DEFAULT;
  const r = await fetch(`https://graph.facebook.com/${version}/${env.WA_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.ok && d?.messages?.[0]?.id) return { ok: true, id: d.messages[0].id };
  return { ok: false, error: d?.error?.message || `HTTP ${r.status}` };
}

const INBOUND_KEY = (phone) => `wa:inbound:${phone}`;
const MSG_KEY = (id) => `wa:msg:${id}`;
const PEND_KEY = (phone) => `wa:pend:${phone}`;

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

async function enviarTexto(env, phone, texto) {
  return graphSend(env, { to: phone, type: "text", text: { body: texto.slice(0, 4096), preview_url: false } });
}

export async function waSend(env, phone, msg) {
  if (!waEnabled(env)) return { ok: false, skipped: "whatsapp-no-configurado" };
  if (!phone) return { ok: false, skipped: "sin-telefono" };
  const texto = waTexto(msg).slice(0, TEXTO_MAX);
  try {
    const ventana = await waEnVentana(env, phone);
    let r, via;
    if (ventana || !env.WA_TEMPLATE_NAME) {
      // Sin plantilla todavía (recién creada, esperando a Meta) se intenta el
      // texto igual: llega si la persona escribió hace poco. Si no llega, Meta
      // lo informa por el webhook y el aviso pasa a pendientes.
      r = await enviarTexto(env, phone, texto);
      via = ventana ? "texto" : "texto-sin-ventana";
    } else {
      r = await graphSend(env, {
        to: phone,
        type: "template",
        template: {
          name: env.WA_TEMPLATE_NAME,
          language: { code: env.WA_TEMPLATE_LANG || "es" },
          components: [{ type: "body", parameters: [
            { type: "text", text: waLineaUnica([msg.titulo || "Aviso"], PARAM_TITULO_MAX) },
            { type: "text", text: waLineaUnica(msg.lineas) || "—" },
          ] }],
        },
      });
      via = "plantilla";
    }
    if (!r.ok) return { ...r, texto };
    // Fuera de ventana el "ok" de Meta no garantiza la entrega: se guarda el
    // texto por si el webhook avisa después que falló.
    if (via !== "texto" && env.RL) {
      await env.RL.put(MSG_KEY(r.id), JSON.stringify({ to: phone, texto }), { expirationTtl: 2 * 86400 }).catch(() => {});
    }
    return { ok: true, via, id: r.id };
  } catch (e) {
    return { ok: false, error: e.message, texto };
  }
}

export async function waGuardarPendiente(env, phone, texto, now = Date.now()) {
  if (!env.RL || !phone || !texto) return false;
  try {
    const lista = JSON.parse((await env.RL.get(PEND_KEY(phone))) || "[]");
    lista.push({ texto, ts: now });
    await env.RL.put(PEND_KEY(phone), JSON.stringify(lista.slice(-PEND_MAX)), { expirationTtl: PEND_TTL });
    return true;
  } catch (_) {
    return false;
  }
}

// La persona acaba de escribir (ventana abierta): le entrega lo que no le llegó.
export async function waEntregarPendientes(env, phone) {
  if (!env.RL || !waEnabled(env)) return 0;
  let lista;
  try { lista = JSON.parse((await env.RL.get(PEND_KEY(phone))) || "[]"); } catch (_) { return 0; }
  if (!lista.length) return 0;
  const bloques = [];
  let actual = `📬 *Avisos que no te llegaron (${lista.length})*`;
  for (const p of lista) {
    const hora = new Intl.DateTimeFormat("es-CL", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(p.ts));
    const item = `\n\n— ${hora} —\n${p.texto}`;
    if (actual.length + item.length > TEXTO_MAX) { bloques.push(actual); actual = item.trim(); } else actual += item;
  }
  bloques.push(actual);
  for (const b of bloques) {
    const r = await enviarTexto(env, phone, b);
    if (!r.ok) { console.error(`[wa-notify] pendientes a ${phone}:`, r.error); return 0; }
  }
  await env.RL.delete(PEND_KEY(phone)).catch(() => {});
  return lista.length;
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
  if (q.get("hub.mode") === "subscribe" && env.WA_VERIFY_TOKEN && igualSeguro(q.get("hub.verify_token") || "", env.WA_VERIFY_TOKEN)) {
    return new Response(q.get("hub.challenge") || "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function igualSeguro(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function waWebhookFirmaValida(env, raw, header) {
  if (!env.WA_APP_SECRET || !header) return false;
  return igualSeguro("sha256=" + (await hmacHex(env.WA_APP_SECRET, raw)), header);
}

export async function waWebhookEvento(env, body, now = Date.now()) {
  const out = { mensajes: 0, fallidos: 0, pendientesEntregados: 0 };
  const remitentes = new Set();
  for (const entry of body?.entry || []) {
    for (const ch of entry?.changes || []) {
      const v = ch?.value || {};
      for (const m of v.messages || []) {
        const from = String(m.from || "").replace(/\D/g, "");
        if (!from) continue;
        out.mensajes++;
        remitentes.add(from);
        if (env.RL) await env.RL.put(INBOUND_KEY(from), String(now), { expirationTtl: 86400 }).catch(() => {});
      }
      for (const st of v.statuses || []) {
        if (st.status !== "failed") continue;
        out.fallidos++;
        const err = st.errors?.[0] || {};
        console.error(`[wa-notify] no entregado a ${st.recipient_id}: ${err.code || ""} ${err.title || err.message || ""}`);
        // Si era un aviso nuestro, pasa a pendientes para entregarlo cuando escriba.
        if (!env.RL || !st.id) continue;
        const guardado = await env.RL.get(MSG_KEY(st.id)).catch(() => null);
        if (!guardado) continue;
        try {
          const { to, texto } = JSON.parse(guardado);
          await waGuardarPendiente(env, to, texto, now);
        } catch (_) {}
        await env.RL.delete(MSG_KEY(st.id)).catch(() => {});
      }
    }
  }
  for (const phone of remitentes) out.pendientesEntregados += await waEntregarPendientes(env, phone);
  return out;
}

// Envía a cada persona de la ruta, una sola vez por dedupKey (KV `RL`).
// Si el envío falla, el aviso queda en pendientes (se entrega cuando la persona
// escriba al número) y se marca igual: un reintento no debe duplicarlo.
export async function waNotify(env, tipo, msg, { dedupKey = "", ttl = 86400 } = {}) {
  const personas = WA_RUTAS[tipo] || [];
  const out = [];
  for (const persona of personas) {
    const key = dedupKey ? `wa:${tipo}:${dedupKey}:${persona}` : "";
    if (key && env.RL) {
      try { if (await env.RL.get(key)) { out.push({ persona, ok: true, skipped: "duplicado" }); continue; } } catch (_) {}
    }
    const phone = waPhone(env, persona);
    const { texto, ...res } = await waSend(env, phone, msg);
    if (!res.ok && !res.skipped) {
      console.error(`[wa-notify] ${tipo} → ${persona}:`, res.error);
      res.pendiente = await waGuardarPendiente(env, phone, texto);
    }
    if ((res.ok || res.pendiente) && key && env.RL) {
      try { await env.RL.put(key, "1", { expirationTtl: Math.max(60, ttl) }); } catch (_) {}
    }
    out.push({ persona, ...res });
  }
  return out;
}

/* ── Mensajes ────────────────────────────────────────────────────────── */

const ORIGEN = {
  web: "Web", google_ads: "Google Ads", linkedin: "LinkedIn", redes: "Redes sociales",
  instagram: "Instagram", ig: "Instagram", facebook: "Facebook", fb: "Facebook", tiktok: "TikTok", tt: "TikTok",
};

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
    : st === "offline" ? "Impresora sin conexión mientras imprimía"
    : "Impresión con ERROR";
  const min = Math.round(Number(durationSec) / 60);
  const dur = min > 0 ? (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`) : "";
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

export function horaResumen(env) {
  const h = Number.parseInt(String(env.WA_DIGEST_HOUR ?? "").trim(), 10);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 9;
}

// Horas de gracia tras la hora del resumen: si el cron no corrió o Airtable
// falló, se reintenta en las siguientes pasadas (el dedup por día evita repetir).
const RESUMEN_GRACIA_H = 3;

// Corre en el cron horario; solo actúa desde la hora del resumen (hora de
// Chile) y una vez por día y tipo (dedup por fecha en KV).
export async function waDailyReminders(env, now = new Date(), { force = false } = {}) {
  if (!waEnabled(env) || !env.AIRTABLE_TOKEN) return { skipped: "sin-config" };
  const desde = (horaChile(now) - horaResumen(env) + 24) % 24;
  if (!force && desde >= RESUMEN_GRACIA_H) return { skipped: "fuera-de-hora" };
  const dia = fechaChile(now), res = {};
  // Ya salió hoy a todos los de la ruta → no vuelve a consultar Airtable.
  const hecho = async (tipo) => {
    if (!env.RL) return false;
    for (const persona of WA_RUTAS[tipo]) {
      if (!(await env.RL.get(`wa:${tipo}:${dia}:${persona}`).catch(() => null))) return false;
    }
    return true;
  };

  // Cada resumen por separado: si una tabla falla, el otro sale igual.
  if (!(await hecho("cotizacion_envio"))) {
    try {
      const cots = cotizacionesPorEnviar(await airtableList(env, "Cotizaciones", {
        filterByFormula: "{Estado cotización}='Solicitada'",
        fields: ["N° Cotización", "Alias / Título", "Cliente", "Estado cotización", "Fecha límite cotización", "Vendedor"],
      }), now);
      if (cots.length) {
        res.cotizaciones = await waNotify(env, "cotizacion_envio", mensajeCotizaciones(cots, await nombresClientes(env, cots)), { dedupKey: dia, ttl: 30 * 3600 });
      }
    } catch (e) {
      res.cotizaciones = { error: e.message };
      console.error("[wa-notify] resumen cotizaciones:", e.message);
    }
  }

  if (!(await hecho("pedido_vencimiento"))) {
    try {
      const peds = pedidosPorVencer(await airtableList(env, "Pedidos", {
        filterByFormula: "AND(NOT({Fecha entrega}=BLANK()),{Estado pedido}!='Despachado',{Estado pedido}!='Completado',{Estado pedido}!='Cancelado')",
        fields: ["N° Pedido", "Cliente", "Estado pedido", "Fecha entrega"],
      }), now);
      if (peds.length) {
        res.pedidos = await waNotify(env, "pedido_vencimiento", mensajePedidos(peds, await nombresClientes(env, peds)), { dedupKey: dia, ttl: 30 * 3600 });
      }
    } catch (e) {
      res.pedidos = { error: e.message };
      console.error("[wa-notify] resumen pedidos:", e.message);
    }
  }
  return res;
}
