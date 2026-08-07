/**
 * thelab-leads-worker
 * ---------------------------------------------------------------------------
 * Endpoint público de captación de leads para The Lab Solutions.
 *
 *   Web / Google Ads / LinkedIn
 *        │  POST  (+ anti-bot)
 *        ▼
 *   este Worker
 *        ├─→ Airtable: crea Cliente   (tolerante a campos inexistentes)
 *        ├─→ Airtable: crea tarea en  Agent_Queue (estado Pendiente)
 *        └─→ (opcional) procesa LEAD_AGENT con Claude y deja el lead pre-scoreado
 *
 * Rutas:
 *   GET  /health
 *   POST /lead                  (web pública — clave X-Public-Lead-Key + Turnstile opcional)
 *   POST /newsletter            (alta de suscriptor desde la web — misma clave + anti-bot)
 *   GET  /newsletter/confirm    (doble opt-in: confirma la suscripción vía token HMAC)
 *   GET  /newsletter/unsubscribe(baja de la lista — token HMAC opcional)
 *   POST /portal/link           (dashboard — emite el link del portal, clave PORTAL_ADMIN_KEY)
 *   POST /portal/revocar        (dashboard — invalida los links de un cliente)
 *   GET  /portal                (cliente — pedidos y cotizaciones, token firmado)
 *   GET  /portal/cotizacion     (cliente — su cotización como documento imprimible)
 *   POST /portal/cotizacion/decision (cliente — aprueba/rechaza su cotización)
 *   POST /webhooks/google-ads   (Google Lead Form — clave GOOGLE_ADS_WEBHOOK_KEY)
 *   POST /webhooks/linkedin     (LinkedIn vía Make/Zapier — clave LINKEDIN_WEBHOOK_KEY)
 *   POST /webhooks/social       (Instagram/Facebook/TikTok comentarios+DMs vía Make — clave SOCIAL_WEBHOOK_KEY)
 *
 * NINGÚN secreto vive en este archivo. Todo viene de `env` (wrangler secret put).
 */

const AIRTABLE_API = "https://api.airtable.com/v0";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // Latido para la "Oficina Virtual" del dashboard (best-effort, no bloquea).
      if (ctx && env.AIRTABLE_TOKEN && env.AIRTABLE_BASE_ID) {
        ctx.waitUntil(ofHeartbeat(env, "lead-worker").catch(() => {}));
      }

      // ── GET/HEAD /health ───────────────────────────────────────────
      // HEAD lo usan los monitores de uptime (p. ej. UptimeRobot free) que
      // solo hacen HEAD; sin esto devolvía 404 y marcaba "caído" en falso.
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/health") {
        if (request.method === "HEAD") return new Response(null, { status: 200, headers: cors });
        return json(
          {
            ok: true,
            service: "thelab-airtable-proxy",
            time: new Date().toISOString(),
            airtable: !!env.AIRTABLE_TOKEN,
            autoProcess: env.AUTO_PROCESS_LEADS === "true",
          },
          200,
          cors
        );
      }

      if (request.method === "POST" && url.pathname === "/lead") {
        return await handleLead(request, env, ctx, cors);
      }

      if (request.method === "POST" && url.pathname === "/proveedor") {
        return await handleProveedor(request, env, ctx, cors);
      }

      // Portal del cliente (token firmado con vencimiento). El link lo emite el
      // dashboard contra /portal/link; la página y la decisión se sirven acá.
      if (request.method === "POST" && url.pathname === "/portal/link") {
        return await handlePortalLink(request, env, cors);
      }

      if (request.method === "GET" && url.pathname === "/portal") {
        return await handlePortal(request, env);
      }

      if (request.method === "POST" && url.pathname === "/portal/revocar") {
        return await handlePortalRevocar(request, env, cors);
      }

      if (request.method === "GET" && url.pathname === "/portal/cotizacion") {
        return await handlePortalCotizacion(request, env);
      }

      if (request.method === "POST" && url.pathname === "/portal/cotizacion/decision") {
        return await handlePortalCotDecision(request, env, ctx, cors);
      }

      // Encuesta de satisfacción post-entrega (NPS/CSAT). El cliente llega desde
      // el mensaje post-entrega: GET muestra/registra la calificación (página
      // HTML), POST guarda el comentario opcional.
      if (url.pathname === "/nps") {
        return await handleNps(request, env, ctx, cors);
      }

      // Comprobante de entrega (POD): el cliente confirma la recepción con un clic.
      if (url.pathname === "/pod") {
        return await handlePod(request, env, ctx, cors);
      }

      // Portal de seguimiento: el cliente ve el estado de su pedido (solo lectura).
      if (request.method === "GET" && url.pathname === "/pedido") {
        return await handlePedidoEstado(request, env);
      }

      if (request.method === "GET" && url.pathname === "/blog") {
        return await handleBlogList(request, env, cors);
      }

      if (request.method === "GET" && url.pathname.startsWith("/blog/")) {
        return await handleBlogPost(env, cors, decodeURIComponent(url.pathname.slice(6)));
      }

      if (request.method === "POST" && url.pathname === "/newsletter") {
        return await handleNewsletter(request, env, ctx, cors);
      }

      if (request.method === "GET" && url.pathname === "/newsletter/confirm") {
        return await handleNewsletterConfirm(request, env);
      }

      if (request.method === "GET" && url.pathname === "/newsletter/unsubscribe") {
        return await handleNewsletterUnsubscribe(request, env);
      }

      if (request.method === "POST" && url.pathname === "/webhooks/google-ads") {
        return await handleGoogleAds(request, env, ctx, cors);
      }

      if (request.method === "POST" && url.pathname === "/webhooks/linkedin") {
        return await handleLinkedin(request, env, ctx, cors);
      }

      if (request.method === "POST" && url.pathname === "/webhooks/social") {
        return await handleSocial(request, env, ctx, cors);
      }

      // Piloto automático de Google Ads: aprobación/rechazo desde el email
      if (url.pathname === "/ads/decision") {
        return await handleAdsDecision(request, env);
      }

      // Disparo manual del piloto (para probar sin esperar el cron semanal).
      // Requiere ADS_APPROVAL_SECRET (sin fallback: PUBLIC_LEAD_KEY viaja en el
      // bundle de la web y no sirve para autorizar cambios de campañas).
      if (request.method === "POST" && url.pathname === "/ads/autopilot/run") {
        const key = request.headers.get("X-Autopilot-Key") || "";
        const expected = env.ADS_APPROVAL_SECRET || "";
        if (!expected || !timingSafeEqual(key, expected)) {
          return json({ ok: false, error: "No autorizado" }, 401, cors);
        }
        const res = await adsAutopilotRun(env, { force: true });
        return json({ ok: true, ...res }, 200, cors);
      }

      return json({ ok: false, error: "Ruta no encontrada" }, 404, cors);
    } catch (e) {
      console.error("[leads-worker]", e?.stack || e?.message || String(e));
      return json({ ok: false, error: "Error interno" }, 500, cors);
    }
  },

  // Crons: cada hora reintenta dead-letters; el lunes corre el piloto de Ads
  async scheduled(event, env, ctx) {
    if (event.cron === "0 12 * * 1") {
      ctx.waitUntil(adsAutopilotRun(env, {}).catch((e) => console.error("[ads-autopilot]", e.message)));
      return;
    }
    ctx.waitUntil(retryDeadLetters(env));
    // Una vez al día (07:17 UTC ≈ madrugada en Chile): poda de la cola de agentes
    if (new Date(event.scheduledTime || Date.now()).getUTCHours() === 7) {
      ctx.waitUntil(cleanupAgentQueue(env));
    }
  },
};

/* ════════════════════════════════════════════════════════════════════════
 * Limpieza de Agent_Queue: las tareas "Completado" con más de
 * CLEANUP_QUEUE_DAYS días (30 por defecto; "0" desactiva) se borran solas.
 * La cola queda como semáforo: casi vacía = todo bien. Pendiente, Procesando
 * y Error se conservan SIEMPRE — son las que piden atención humana.
 * ══════════════════════════════════════════════════════════════════════ */
async function cleanupAgentQueue(env) {
  try {
    if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return;
    const days = parseInt(env.CLEANUP_QUEUE_DAYS ?? "30", 10);
    if (!days || days < 1) return;
    const formula = `AND({Estado}='Completado', IS_BEFORE({Fecha creación}, DATEADD(NOW(), -${days}, 'days')))`;
    const H = { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` };
    let borradas = 0;
    // Borra-y-repite: al eliminar la página, la consulta siguiente trae lo que
    // queda (sin cursores que invalidar). Tope de 10 rondas = 1000 filas/día.
    for (let round = 0; round < 10; round++) {
      const q = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
      q.append("fields[]", "Estado");
      const r = await fetch(`${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/Agent_Queue?${q}`, { headers: H });
      if (!r.ok) { console.error("[cleanup-queue] list:", r.status, (await r.text()).slice(0, 200)); return; }
      const ids = ((await r.json()).records || []).map((x) => x.id);
      if (!ids.length) break;
      for (let i = 0; i < ids.length; i += 10) {
        const del = new URLSearchParams();
        ids.slice(i, i + 10).forEach((id) => del.append("records[]", id));
        const dr = await fetch(`${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/Agent_Queue?${del}`, { method: "DELETE", headers: H });
        if (!dr.ok) { console.error("[cleanup-queue] delete:", dr.status, (await dr.text()).slice(0, 200)); return; }
        borradas += ids.slice(i, i + 10).length;
      }
    }
    if (borradas) console.log(`[cleanup-queue] ${borradas} tareas Completado de +${days} días eliminadas`);
  } catch (e) {
    console.error("[cleanup-queue]", e.message);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * PORTAL DEL CLIENTE  (páginas servidas por el Worker, no por el dashboard)
 *
 *   POST /portal/link                 el dashboard pide el link de un cliente
 *   GET  /portal?t=<token>            página del cliente: pedidos + cotizaciones
 *   POST /portal/cotizacion/decision  el cliente aprueba/rechaza una cotización
 *
 * Token:  recIdCliente . vencimiento(base36) . HMAC-SHA256
 * Sin el secreto no se puede forjar, y deja de servir en la fecha de vencimiento.
 * Los datos se leen ACÁ con el token de Airtable del servidor: el navegador del
 * cliente no recibe credenciales ni más registros que los suyos.
 * ══════════════════════════════════════════════════════════════════════ */
const PORTAL_DIAS_DEFAULT = 30;
const PORTAL_STAGES = ["Confirmado", "En producción", "Listo para despacho", "Despachado", "Completado"];
const PORTAL_COT_ABIERTAS = ["Enviada", "Solicitada"];

// Secreto de firma. NUNCA PUBLIC_LEAD_KEY: esa viaja en el bundle de la web y
// permitiría a cualquiera firmarse un token para el cliente que quisiera.
function portalSecret(env) {
  return env.PORTAL_SECRET || env.NEWSLETTER_SECRET || env.AIRTABLE_TOKEN || "";
}
// Revocación por cliente: en el KV vive un contador por cliente que entra en la
// firma. Al revocar sube en 1 y todos los links que ya circulaban dejan de
// validar, sin tocar los de los demás clientes. La versión 0 firma el mensaje
// sin sufijo, así los links emitidos antes de existir esto siguen sirviendo
// hasta su primera revocación (o hasta que venzan).
const PORTAL_REV_KEY = (clienteId) => `portalrev:${clienteId}`;
async function portalVersion(env, clienteId) {
  if (!env.RL) return 0;
  try { return parseInt((await env.RL.get(PORTAL_REV_KEY(clienteId))) || "0", 10) || 0; }
  catch (e) { return 0; }
}
async function portalSign(env, clienteId, exp, version) {
  const v = Number(version) || 0;
  return await hmacB64u(portalSecret(env), `portal:${clienteId}:${exp}` + (v > 0 ? `:v${v}` : ""));
}
async function portalMakeToken(env, clienteId, dias) {
  const exp = Math.floor(Date.now() / 1000) + Math.round(dias * 86400);
  const v = await portalVersion(env, clienteId);
  return { token: `${clienteId}.${exp.toString(36)}.${await portalSign(env, clienteId, exp, v)}`, exp };
}
// Devuelve null si la firma no cuadra (inválido o revocado); { vencido: true }
// distingue el enlace caducado para poder decirle al cliente qué le pasó.
async function portalVerifyToken(env, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !portalSecret(env)) return null;
  const [clienteId, expB36, sig] = parts;
  if (!isRecId(clienteId)) return null;
  const exp = parseInt(expB36, 36);
  if (!Number.isFinite(exp)) return null;
  const v = await portalVersion(env, clienteId);
  if (!timingSafeEqual(sig, await portalSign(env, clienteId, exp, v))) return null;
  return { clienteId, exp, vencido: exp * 1000 < Date.now() };
}

/* ── POST /portal/revocar ── corta los links de UN cliente ──────────────── */
async function handlePortalRevocar(request, env, cors) {
  const expected = env.PORTAL_ADMIN_KEY || "";
  const key = request.headers.get("X-Portal-Admin-Key") || "";
  if (!expected || !timingSafeEqual(key, expected)) {
    return json({ ok: false, error: "No autorizado" }, 401, cors);
  }
  // Sin KV no hay dónde guardar el contador: mejor decirlo que fingir que se revocó.
  if (!env.RL) return json({ ok: false, error: "Revocación no disponible: al Worker le falta el KV (binding RL)" }, 501, cors);
  const body = await readJson(request);
  const clienteId = str(body && body.clienteId);
  if (!isRecId(clienteId)) return json({ ok: false, error: "Cliente inválido" }, 400, cors);
  const v = (await portalVersion(env, clienteId)) + 1;
  try {
    await env.RL.put(PORTAL_REV_KEY(clienteId), String(v));
  } catch (e) {
    return json({ ok: false, error: "No se pudo revocar" }, 502, cors);
  }
  return json({ ok: true, version: v }, 200, cors);
}

/* ── POST /portal/link ── solo el dashboard (clave PORTAL_ADMIN_KEY) ────── */
async function handlePortalLink(request, env, cors) {
  const expected = env.PORTAL_ADMIN_KEY || "";
  const key = request.headers.get("X-Portal-Admin-Key") || "";
  if (!expected || !timingSafeEqual(key, expected)) {
    return json({ ok: false, error: "No autorizado" }, 401, cors);
  }
  if (!portalSecret(env)) return json({ ok: false, error: "Portal sin configurar (falta PORTAL_SECRET)" }, 500, cors);
  const body = await readJson(request);
  const clienteId = str(body && body.clienteId);
  if (!isRecId(clienteId)) return json({ ok: false, error: "Cliente inválido" }, 400, cors);
  let dias = parseInt((body && body.dias) ?? PORTAL_DIAS_DEFAULT, 10);
  if (!Number.isFinite(dias) || dias < 1) dias = PORTAL_DIAS_DEFAULT;
  if (dias > 365) dias = 365;
  const { token, exp } = await portalMakeToken(env, clienteId, dias);
  const base = (env.WORKER_PUBLIC_URL || new URL(request.url).origin).replace(/\/+$/, "");
  return json({ ok: true, url: `${base}/portal?t=${token}`, dias, expira: portalFecha(new Date(exp * 1000).toISOString().slice(0, 10)) }, 200, cors);
}

/* ── GET /portal?t=… ── la página que ve el cliente ─────────────────────── */
async function handlePortal(request, env) {
  const url = new URL(request.url);
  const tok = await portalVerifyToken(env, url.searchParams.get("t"));
  if (!tok) return htmlPage("Enlace inválido", "Este enlace no es válido. Escríbenos a hola@thelab.solutions y te enviamos uno nuevo.", false);
  if (tok.vencido) return htmlPage("Enlace vencido", "Este enlace de seguimiento ya venció. Escríbenos a hola@thelab.solutions y te enviamos uno nuevo al tiro.", false);
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return htmlPage("No disponible", "El portal no está disponible en este momento. Intenta más tarde.", false);

  const cliente = await portalGetRecord(env, "Clientes", tok.clienteId);
  if (!cliente) return htmlPage("No disponible", "No pudimos cargar tus datos ahora. Intenta más tarde o escríbenos a hola@thelab.solutions.", false);
  const f = cliente.fields || {};
  const [pedidos, cots] = await Promise.all([
    portalGetLinked(env, "Pedidos", f["Pedidos"]),
    portalGetLinked(env, "Cotizaciones", f["Cotizaciones"]),
  ]);
  return portalPage({
    token: url.searchParams.get("t") || "",
    nombre: f["Empresa"] || f["Contacto"] || "Cliente",
    pedidos,
    cots: cots.filter((c) => PORTAL_COT_ABIERTAS.includes((c.fields || {})["Estado cotización"] || "")),
  });
}

/* ── POST /portal/cotizacion/decision ── aprobar / rechazar ─────────────── */
async function handlePortalCotDecision(request, env, ctx, cors) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido" }, 400, cors);
  const tok = await portalVerifyToken(env, body.t);
  if (!tok) return json({ ok: false, error: "Enlace inválido" }, 401, cors);
  if (tok.vencido) return json({ ok: false, error: "Este enlace venció. Escríbenos a hola@thelab.solutions." }, 401, cors);
  const cotId = str(body.cot);
  if (!isRecId(cotId)) return json({ ok: false, error: "Cotización inválida" }, 400, cors);
  const decision = String(body.decision || "");
  if (decision !== "Aprobada" && decision !== "Rechazada") return json({ ok: false, error: "Decisión inválida" }, 400, cors);
  if (await rateLimited(env, request, "portal-dec", 40, 3600)) return json({ ok: false, error: "Demasiados intentos, intenta más tarde" }, 429, cors);
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return json({ ok: false, error: "No configurado" }, 500, cors);

  const rec = await portalGetRecord(env, "Cotizaciones", cotId);
  if (!rec) return json({ ok: false, error: "Cotización no encontrada" }, 404, cors);
  // La cotización tiene que ser de ESTE cliente: con el token de uno no se
  // decide sobre la cotización de otro.
  const dueño = (rec.fields || {})["Cliente"];
  const esSuya = Array.isArray(dueño) ? dueño.includes(tok.clienteId) : dueño === tok.clienteId;
  if (!esSuya) return json({ ok: false, error: "No autorizado" }, 403, cors);

  const estado = (rec.fields || {})["Estado cotización"] || "";
  if (!PORTAL_COT_ABIERTAS.includes(estado)) {
    // Ya fue decidida (doble clic, pestaña vieja): idempotente, no es error.
    return json({ ok: true, alreadyDecided: true, estado }, 200, cors);
  }

  const comentario = String(body.comentario || "").slice(0, 2000);
  const fields = { "Estado cotización": decision };
  if (decision === "Aprobada") fields["Fecha aprobación"] = today();
  // El comentario va a "Notas cotización" (texto largo) y NO a "Motivo rechazo":
  // ese campo es un single select y con typecast cada texto libre del cliente le
  // creaba una opción nueva. La clasificación la hace el equipo desde el dashboard.
  if (decision === "Rechazada" && comentario) {
    const previas = str((rec.fields || {})["Notas cotización"]);
    fields["Notas cotización"] = (previas ? previas + "\n\n" : "") + `[${today()}] Rechazo del cliente (portal): ${comentario}`;
  }
  try {
    await airtableUpdateTolerant(env, "Cotizaciones", cotId, fields);
  } catch (e) {
    return json({ ok: false, error: "No se pudo registrar" }, 502, cors);
  }

  // Aviso al equipo (best-effort, no bloquea la respuesta)
  const numCot = (rec.fields || {})["N° Cotización"] || cotId;
  ctx.waitUntil(sendCotDecisionAlert(env, { numCot, decision, comentario }));

  return json({ ok: true, decision }, 200, cors);
}

/* ══════════════════════════════════════════════════════════════════════
 * GET /portal/cotizacion?t=<token>&cot=<recId>
 * La cotización como documento imprimible (el cliente la ve y la guarda en PDF
 * con el botón, que dispara el diálogo de impresión del navegador).
 *
 * CUIDADO al tocar los campos que se muestran acá:
 *   · "Detalle JSON" trae costoUnit y el desglose de costos por ítem.
 *   · "Detalle productos" trae "Costo: $…" escrito en el texto.
 *   · "Subtotal (CLP)" NO es un subtotal de venta: guarda la suma de COSTOS.
 * De ahí solo puede salir desc, und y ventaUnit. Nada más. El total que manda
 * es "Total final (CLP)" (IVA incluido); si no cuadra con los ítems, la
 * diferencia se muestra como ajuste para que las cuentas cierren siempre.
 * ══════════════════════════════════════════════════════════════════════ */
async function handlePortalCotizacion(request, env) {
  const url = new URL(request.url);
  const tok = await portalVerifyToken(env, url.searchParams.get("t"));
  if (!tok) return htmlPage("Enlace inválido", "Este enlace no es válido. Escríbenos a hola@thelab.solutions y te enviamos uno nuevo.", false);
  if (tok.vencido) return htmlPage("Enlace vencido", "Este enlace ya venció. Escríbenos a hola@thelab.solutions y te enviamos uno nuevo al tiro.", false);
  const cotId = str(url.searchParams.get("cot"));
  if (!isRecId(cotId)) return htmlPage("Cotización no encontrada", "No pudimos encontrar esta cotización.", false);
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return htmlPage("No disponible", "No está disponible en este momento. Intenta más tarde.", false);

  const rec = await portalGetRecord(env, "Cotizaciones", cotId);
  if (!rec) return htmlPage("Cotización no encontrada", "No pudimos encontrar esta cotización.", false);
  const dueño = (rec.fields || {})["Cliente"];
  const esSuya = Array.isArray(dueño) ? dueño.includes(tok.clienteId) : dueño === tok.clienteId;
  if (!esSuya) return htmlPage("No disponible", "Esta cotización no corresponde a tu cuenta.", false);

  const cliente = await portalGetRecord(env, "Clientes", tok.clienteId);
  return portalCotizacionPage(rec, (cliente && cliente.fields) || {}, url.searchParams.get("t") || "");
}

// Solo descripción, cantidad y precio de venta: ver la advertencia de arriba.
// ── La cotización, calcada de buildCotizacionDoc() (js/pdf-fichas.js) ──────
// Es EL MISMO documento que sale de la sección Cotizaciones del dashboard. Si
// cambias uno, cambia el otro: el cliente no puede recibir dos versiones
// distintas del mismo papel.
const COT_FORMA_PAGO_DESC = {
  "AL CONTADO": "Pago total al momento de confirmar el pedido, vía transferencia bancaria, vale vista o cheque al día.",
  "30 DÍAS DESDE OC": "Pago total a 30 días desde la emisión de la Orden de Compra, vía transferencia bancaria.",
  "45 DÍAS DESDE OC": "Pago total a 45 días desde la emisión de la Orden de Compra, vía transferencia bancaria.",
  "70% ABONO Y 30% CONTRA ENTREGA": "70% de abono al confirmar el pedido (Facturable inmediatamente), 30% restante contra entrega y conformidad de recepción, vía transferencia bancaria, vale vista o cheque al día.",
  "50% ABONO Y 50% 30 DÍAS": "50% de abono al confirmar el pedido (Facturable inmediatamente), 50% restante a 30 días desde la Orden de Compra, vía transferencia bancaria.",
};
function cotFechaLarga(iso) {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return String(iso);
  try { return d.toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" }); }
  catch (e) { return String(iso); }
}
function cotPlazoTexto(f) {
  if (!f) return "";
  if (f["Fecha de entrega"]) return `Entrega estimada para el ${cotFechaLarga(f["Fecha de entrega"])}. Fecha sujeta a la confirmación del pedido y a la disponibilidad de stock.`;
  const min = f["Tiempo de producción"];
  if (!min) return "";
  const max = f["Tiempo de producción máx"];
  const tipo = String(f["Tipo días producción"] || "DÍAS HÁBILES").toLowerCase();
  const rango = max && max > min ? `${min}-${max}` : `${min}`;
  return `${rango} ${tipo} desde la confirmación del pedido. Plazo podría variar dependiendo de stock de productos, contingencias sanitarias o sociales.`;
}
// Mismo parseo de "Detalle productos" que el dashboard: de cada línea saca la
// VENTA. La diferencia: acá, si la columna elegida trae "Costo:" (línea con
// formato raro), se descarta el precio en vez de arriesgar mostrarlo.
function cotLineas(cf) {
  const detalle = str(cf["Detalle productos"]);
  if (detalle) {
    return detalle.split("\n").filter(Boolean).map((l) => {
      const parts = l.split("|").map((x) => x.trim());
      const und = parseFloat((parts[1] || "").replace(/[^\d.]/g, "")) || 1;
      const col = parts[3] || parts[2] || "";
      const ventaTotal = /costo/i.test(col) ? 0 : parseFloat(String(col).replace(/[Vv]enta:\s*/, "").replace(/\./g, "").replace(/[^0-9]/g, "")) || 0;
      return { desc: String(parts[0] || "").replace(/costo:.*/i, "").trim(), und, ventaUnit: und > 0 ? Math.round(ventaTotal / und) : ventaTotal, ventaTotal };
    });
  }
  // Cotizaciones sin el texto: se arma desde "Detalle JSON" usando SOLO
  // desc/und/ventaUnit (ese JSON también trae costoUnit y el desglose de costos).
  let crudo = [];
  try { const j = JSON.parse(cf["Detalle JSON"] || "[]"); if (Array.isArray(j)) crudo = j; } catch (e) {}
  return crudo.map((x) => {
    const und = Number(x && x.und) || 1;
    const ventaUnit = Number(x && x.ventaUnit) || 0;
    return { desc: str(x && x.desc), und, ventaUnit, ventaTotal: und * ventaUnit };
  }).filter((x) => x.desc || x.ventaTotal);
}

function portalCotizacionPage(rec, cli, token) {
  const esc = escapeHtmlW;
  const f = rec.fields || {};
  const abierta = PORTAL_COT_ABIERTAS.includes(f["Estado cotización"] || "");
  const num = f["N° Cotización"] || "—";
  // Mismo fallback que el dashboard: sin fecha emitida, va la de hoy.
  // today() y no toISOString(): el worker corre en UTC, así que una cotización
  // sin fecha propia abierta de noche salía fechada un día más adelante que el
  // mismo documento descargado desde el dashboard.
  const fecha = f["Fecha cotización"] || today();
  const vto = f["Fecha vencimiento"] || "—";
  const urgente = !!f["Urgencia (+25%)"];
  const solicitud = str(f["Solicitud cliente (texto libre)"]);
  const total = Number(f["Total final (CLP)"]) || 0;
  const neto = Math.round(total / 1.19);
  const iva = total - neto;
  const plazotxt = cotPlazoTexto(f) || "A coordinar con el cliente.";
  const formaPago = str(f["Forma de pago"]);
  const formaHtml = formaPago ? `<strong>${esc(formaPago)}:</strong> ${esc(COT_FORMA_PAGO_DESC[formaPago] || "")}` : "";

  const lineas = cotLineas(f);
  const itemsHTML = lineas.length
    ? lineas.map((l, i) => `<tr style="background:${i % 2 === 0 ? "#f9f9f9" : "#fff"}"><td style="padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:10px">${esc(l.desc)}</td><td style="padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:10px;text-align:center;color:#555">${l.und}</td><td style="padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:10px;text-align:right">${esc(portalCLP(l.ventaUnit))}</td><td style="padding:6px 10px;border-bottom:1px solid #e8e8e8;font-size:10px;text-align:right;font-weight:600">${esc(portalCLP(l.ventaTotal))}</td></tr>`).join("")
    : `<tr><td colspan="4" style="padding:12px;text-align:center;color:#999;font-size:10px">Sin detalle</td></tr>`;
  const infoRow = (label, val) => (val && val !== "—" ? `<tr><td style="padding:3px 0;font-size:10px;color:#888;width:80px;vertical-align:top">${esc(label)}</td><td style="padding:3px 0;font-size:10px;color:#1a1a1a;font-weight:500">${esc(val)}</td></tr>` : "");

  const sumaNeto = lineas.reduce((a, l) => a + (l.ventaTotal || 0), 0);
  const descPct = Math.max(0, parseFloat(f["Descuento (%)"]) || 0);
  const descMonto = sumaNeto - neto;
  const hayDesc = descPct > 0 && descMonto > 0 && sumaNeto > 0;
  const descPctTxt = Number.isInteger(descPct) ? String(descPct) : descPct.toFixed(1).replace(/\.0$/, "");
  const totalsRows =
    (hayDesc
      ? `<div class="totals-row"><span>Subtotal neto</span><span>${esc(portalCLP(sumaNeto))}</span></div>` +
        `<div class="totals-row" style="color:#c0392b"><span>Descuento (${esc(descPctTxt)}%)</span><span>−${esc(portalCLP(descMonto))}</span></div>` +
        `<div class="totals-row"><span>Neto</span><span>${esc(portalCLP(neto))}</span></div>`
      : `<div class="totals-row"><span>Neto</span><span>${esc(portalCLP(neto))}</span></div>`) +
    `<div class="totals-row iva"><span>IVA (19%)</span><span>${esc(portalCLP(iva))}</span></div>` +
    `<div class="totals-row total-final"><span>TOTAL</span><span>${esc(portalCLP(total))}</span></div>`;

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Cotización ${esc(num)}</title>
<link rel="icon" href="https://dashboard.thelab.solutions/isotipo-thelab.png">
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;background:#fff;padding:18px 24px;font-size:10px;}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:12px;border-bottom:3px solid #00d4cc;}
.logo-area img{height:28px;}.logo-area .tagline{font-size:8px;color:#aaa;margin-top:4px;letter-spacing:1.2px;text-transform:uppercase;}
.cot-meta{text-align:right;}.cot-meta h1{font-size:20px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#0a0a0a;}
.cot-meta .num{font-size:16px;font-weight:700;color:#00d4cc;font-family:monospace;margin-top:2px;}.cot-meta .fechas{font-size:9px;color:#999;margin-top:4px;line-height:1.6;}
${urgente ? ".urgente-strip{background:#ff6b35;color:#fff;text-align:center;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:5px;border-radius:5px;margin-bottom:10px;}" : ""}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}
.info-box{background:#f8f8f8;border-radius:6px;padding:10px 12px;border-top:3px solid #00d4cc;}
.info-box h3{font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin-bottom:8px;}
.info-box table{width:100%;border-collapse:collapse;}
.section-label{font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#aaa;margin:10px 0 5px;}
.solicitud-box{background:#f0fffe;border:1px solid rgba(0,212,204,0.3);border-radius:6px;padding:8px 10px;font-size:10px;color:#333;line-height:1.7;white-space:pre-line;}
.condiciones-box{background:#f8f8f8;border-radius:6px;padding:10px 12px;margin-top:10px;border-left:4px solid #00d4cc;font-size:9px;color:#333;line-height:1.7;}
table.items{width:100%;border-collapse:collapse;border:1px solid #e8e8e8;margin-top:5px;}
table.items thead tr{background:#0a0a0a;color:#fff;}
table.items thead th{padding:7px 10px;font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:left;}
table.items thead th:nth-child(2){text-align:center;}table.items thead th:nth-child(3),table.items thead th:nth-child(4){text-align:right;}
.totals{margin-top:8px;display:flex;justify-content:flex-end;}
.totals-box{min-width:220px;border:1px solid #e8e8e8;border-radius:6px;overflow:hidden;}
.totals-row{display:flex;justify-content:space-between;padding:6px 12px;font-size:10px;border-bottom:1px solid #f0f0f0;background:#fff;}
.totals-row.iva{color:#888;}.totals-row.total-final{background:#0a0a0a;color:#00d4cc;font-weight:700;font-size:12px;border-bottom:none;}
.transfer-box{margin-top:12px;border:1px solid #00d4cc;border-radius:6px;overflow:hidden;}
.transfer-title{background:#00d4cc;color:#0a0a0a;font-weight:700;text-align:center;padding:5px;letter-spacing:1.5px;text-transform:uppercase;font-size:9px;}
.transfer-box table{width:100%;border-collapse:collapse;}.transfer-box table td{padding:4px 10px;font-size:9px;}
.footer{margin-top:12px;padding-top:10px;border-top:2px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;}
.footer .left{font-size:8px;color:#bbb;line-height:1.7;}.footer .validity{background:#f8f8f8;border-radius:5px;padding:5px 10px;font-size:9px;color:#555;}
.footer .validity strong{color:#0a0a0a;}
.acciones{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.acciones .btn{border:0;border-radius:8px;padding:10px 16px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;text-decoration:none;display:inline-block}
@media print{body{padding:10px 14px;}.acciones{display:none !important}@page{margin:8mm;size:A4;}}</style></head><body>
<div class="acciones">
  <button class="btn" onclick="window.print()" style="background:#0a0a0a;color:#fff">⬇ Descargar PDF</button>
  ${abierta ? `<button class="btn" onclick="portalDecidir('${esc(rec.id)}','Aprobada')" style="background:#00d4cc;color:#0a0a0a">✓ Aprobar cotización</button>
  <button class="btn" onclick="portalDecidir('${esc(rec.id)}','Rechazada')" style="background:#fff;color:#777;border:1px solid #ddd">Rechazar</button>` : ""}
  <a class="btn" href="/portal?t=${encodeURIComponent(token)}" style="background:#fff;color:#777;border:1px solid #ddd">← Volver</a>
</div>
<div class="header"><div class="logo-area"><img loading="lazy" decoding="async" src="${LOGO_BLACK_URL}" onerror="this.style.display='none'"><div class="tagline">Impresión 3D · Neones · Trofeos</div></div>
<div class="cot-meta"><h1>Cotización</h1><div class="num">${esc(num)}</div><div class="fechas">Emitida: <strong>${esc(fecha)}</strong><br>Válida hasta: <strong>${esc(vto)}</strong></div></div></div>
${urgente ? '<div class="urgente-strip">⚡ Cotización con urgencia — se aplica recargo del 25%</div>' : ""}
<div class="info-grid">
<div class="info-box"><h3>Cliente</h3><table>${infoRow("Empresa", cli["Empresa"])}${infoRow("RUT", cli["RUT"])}${infoRow("Contacto", cli["Contacto"])}${infoRow("Teléfono", cli["Teléfono"])}${infoRow("Email", cli["Email"])}${infoRow("Dirección", cli["Dirección"])}${infoRow("Comuna", cli["Comuna"])}${infoRow("Región", cli["Región"])}</table></div>
<div class="info-box"><h3>The Lab Solutions</h3><table>${infoRow("Web", "thelab.solutions")}${infoRow("Teléfono", "+56 9 7180 6142")}${infoRow("Email", "hola@thelab.solutions")}${infoRow("Dirección", "Zaragoza 8882, Las Condes")}${infoRow("Ciudad", "Santiago, Chile")}</table></div>
</div>
${solicitud ? `<div class="section-label">Solicitud del cliente</div><div class="solicitud-box">${esc(solicitud)}</div>` : ""}
<div class="condiciones-box"><p style="margin-bottom:5px"><strong>PLAZO DE ENTREGA:</strong> ${esc(plazotxt)}</p>${formaHtml ? `<p style="margin-bottom:2px;margin-top:5px"><strong>FORMA DE PAGO:</strong></p><p style="margin-bottom:5px">${formaHtml}</p>` : ""}<p style="color:#888;font-style:italic">* Cotización válida por 10 días hábiles.</p></div>
<div class="section-label" style="margin-top:10px">Detalle de productos / servicios</div>
<table class="items"><thead><tr><th style="background:#0a0a0a;color:#fff">Descripción</th><th style="background:#0a0a0a;color:#fff;text-align:center">Cant.</th><th style="background:#0a0a0a;color:#fff;text-align:right">Precio Unit. Neto</th><th style="background:#0a0a0a;color:#fff;text-align:right">Total Neto</th></tr></thead><tbody>${itemsHTML}</tbody></table>
<div class="totals"><div class="totals-box">${totalsRows}</div></div>
<div class="transfer-box"><div class="transfer-title">Datos de Transferencia</div><table>
<tr style="border-bottom:1px solid #e8e8e8"><td style="color:#888;width:120px;font-weight:600;text-transform:uppercase;font-size:8px">Razón Social</td><td style="font-weight:500">WAST3D SPA</td></tr>
<tr style="border-bottom:1px solid #e8e8e8;background:#f9f9f9"><td style="color:#888;font-weight:600;text-transform:uppercase;font-size:8px">Banco</td><td style="font-weight:500">BANCO ESTADO</td></tr>
<tr style="border-bottom:1px solid #e8e8e8"><td style="color:#888;font-weight:600;text-transform:uppercase;font-size:8px">Tipo de Cuenta</td><td style="font-weight:500">CUENTA VISTA (CHEQUERA ELECTRÓNICA)</td></tr>
<tr style="border-bottom:1px solid #e8e8e8;background:#f9f9f9"><td style="color:#888;font-weight:600;text-transform:uppercase;font-size:8px">RUT</td><td style="font-weight:500">77.499.554-4</td></tr>
<tr style="border-bottom:1px solid #e8e8e8"><td style="color:#888;font-weight:600;text-transform:uppercase;font-size:8px">N° de Cuenta</td><td style="font-weight:500">90270420078</td></tr>
<tr style="background:#f9f9f9"><td style="color:#888;font-weight:600;text-transform:uppercase;font-size:8px">Email</td><td style="font-weight:500">PAGOS@THELAB.SOLUTIONS</td></tr>
</table></div>
<div class="footer"><div class="left">The Lab Solutions SpA · Santiago, Chile<br>hola@thelab.solutions · +56 9 7180 6142</div><div class="validity">Válida hasta: <strong>${esc(vto)}</strong></div></div>
<script>
var PORTAL_TOKEN=${JSON.stringify(token)};
${PORTAL_DECIDIR_JS}
</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

/* ── Lectura en Airtable (siempre server-side) ──────────────────────────── */
async function portalGetRecord(env, table, recId) {
  try {
    const r = await fetch(`${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}/${recId}`, {
      headers: { Authorization: "Bearer " + env.AIRTABLE_TOKEN },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}
// Los recIds vienen del propio registro del cliente (campos link), así que la
// fórmula no puede llevar nada inyectado; igual se validan uno a uno.
async function portalGetLinked(env, table, ids, max = 30) {
  const list = (Array.isArray(ids) ? ids : []).filter(isRecId).slice(-max);
  if (!list.length) return [];
  const out = [];
  for (let i = 0; i < list.length; i += 15) {
    const chunk = list.slice(i, i + 15);
    const q = new URLSearchParams({
      filterByFormula: `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`,
      pageSize: String(chunk.length),
    });
    try {
      const r = await fetch(`${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?${q}`, {
        headers: { Authorization: "Bearer " + env.AIRTABLE_TOKEN },
      });
      if (!r.ok) { console.error(`[portal] ${table}:`, r.status); continue; }
      out.push(...((await r.json()).records || []));
    } catch (e) {
      console.error(`[portal] ${table}:`, e.message);
    }
  }
  return out;
}

/* ── Formato chileno: $1.234.567 y DD-MM-AAAA ──────────────────────────── */
function portalCLP(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return "$" + Math.round(v).toLocaleString("es-CL").replace(/,/g, ".");
}
function portalFecha(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/* ── Aprobar / rechazar: lo usan la lista del portal y la hoja de la
      cotización. En la lista reemplaza la tarjeta; en la hoja avisa y vuelve. ── */
const PORTAL_DECIDIR_JS = `
async function portalDecidir(cot,decision){
  var comentario='';
  if(decision==='Rechazada'){var m=prompt('¿Nos cuentas por qué? (opcional — nos ayuda a mejorar la propuesta)');if(m===null)return;comentario=m||'';}
  else if(!confirm('¿Confirmas que APRUEBAS esta cotización? Nos ponemos en marcha de inmediato.'))return;
  var card=document.getElementById('cot-'+cot);if(card)card.style.opacity='0.55';
  var okAprob='✓ ¡Cotización aprobada! Gracias — partimos de inmediato y te contactamos con los próximos pasos.';
  var okRech='Cotización rechazada. Gracias por avisarnos; si podemos ajustar algo, escríbenos a hola@thelab.solutions.';
  try{
    var r=await fetch('/portal/cotizacion/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({t:PORTAL_TOKEN,cot:cot,decision:decision,comentario:comentario})});
    var res=await r.json().catch(function(){return null;});
    if(r.ok&&res&&res.ok){
      var txt=decision==='Aprobada'?okAprob:okRech;
      if(card){card.style.opacity='1';
        card.innerHTML=decision==='Aprobada'
          ?'<div style="font-size:14px;font-weight:700;color:#00b3a4">'+okAprob+'</div>'
          :'<div style="font-size:13px;color:#b6b6bd">'+okRech+'</div>';
      }else{alert(txt);location.href='/portal?t='+encodeURIComponent(PORTAL_TOKEN);}
    }else{if(card)card.style.opacity='1';alert((res&&res.error)||'No se pudo registrar. Escríbenos a hola@thelab.solutions y lo resolvemos.');}
  }catch(e){if(card)card.style.opacity='1';alert('Problema de conexión. Escríbenos a hola@thelab.solutions.');}
}`;

/* ── La página ─────────────────────────────────────────────────────────── */
function portalPage({ token, nombre, pedidos, cots }) {
  const esc = escapeHtmlW;
  const orden = (a, b) => String((b.fields || {})["Fecha ingreso"] || b.createdTime || "").localeCompare(String((a.fields || {})["Fecha ingreso"] || a.createdTime || ""));
  const verCot = (cotId) => `/portal/cotizacion?t=${encodeURIComponent(token)}&cot=${encodeURIComponent(cotId)}`;

  const stepper = (estado) => {
    const idx = PORTAL_STAGES.indexOf(estado);
    const pasos = PORTAL_STAGES.map((s, i) => {
      const hecho = i <= idx;
      return `<div style="flex:1;min-width:0;text-align:center">
        <div style="display:flex;align-items:center"><div style="height:3px;flex:1;background:${i === 0 ? "transparent" : i <= idx ? "#00b3a4" : "#26262b"}"></div>
        <div style="width:16px;height:16px;border-radius:50%;flex-shrink:0;background:${hecho ? "#00b3a4" : "#151518"};border:2px solid ${hecho ? "#00b3a4" : "#33343a"}"></div>
        <div style="height:3px;flex:1;background:${i === PORTAL_STAGES.length - 1 ? "transparent" : i < idx ? "#00b3a4" : "#26262b"}"></div></div>
        <div style="font-size:9px;margin-top:5px;color:${i === idx ? "#e8e8ea" : hecho ? "#8a8a92" : "#5c5c63"};font-weight:${i === idx ? "700" : "400"}">${esc(s === "Listo para despacho" ? "Listo" : s === "En producción" ? "Producción" : s)}</div>
      </div>`;
    }).join("");
    return `<div style="display:flex;margin:14px 0 4px">${pasos}</div>`;
  };

  const pedHTML = pedidos.length
    ? pedidos.slice().sort(orden).map((p) => {
        const pf = p.fields || {};
        const estado = pf["Estado pedido"] || "Confirmado";
        const cerrado = ["Despachado", "Completado"].includes(estado);
        const entrega = portalFecha(cerrado && pf["Fecha despacho"] ? pf["Fecha despacho"] : pf["Fecha entrega"]);
        const seguimiento = str(pf["N° seguimiento courier"]);
        // Cotización de origen del pedido: el cliente puede volver a verla.
        const cotDelPedido = (Array.isArray(pf["Cotizaciones"]) ? pf["Cotizaciones"] : []).filter(isRecId)[0];
        return `<div style="background:#131315;border:1px solid #26262b;border-radius:12px;padding:14px 16px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:14px;font-weight:700;letter-spacing:.02em">${esc(pf["N° Pedido"] || "—")}</span>
            <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;background:${estado === "Cancelado" ? "#3a1e20" : cerrado ? "#0f2b24" : "#1b2b33"};color:${estado === "Cancelado" ? "#e5484d" : cerrado ? "#5fdcc4" : "#7fc4e0"}">${cerrado ? "✓ " : ""}${esc(estado)}</span>
          </div>
          ${estado === "Cancelado" ? "" : stepper(estado)}
          ${entrega ? `<div style="font-size:12px;color:#8a8a92;margin-top:8px">📅 ${cerrado ? "Entregado" : "Entrega estimada"}: ${esc(entrega)}</div>` : ""}
          ${seguimiento ? `<div style="font-size:12px;color:#8a8a92;margin-top:4px">🚚 Seguimiento: ${esc(seguimiento)}</div>` : ""}
          ${cotDelPedido ? `<a href="${verCot(cotDelPedido)}" style="display:inline-block;margin-top:11px;color:#e8e8ea;border:1px solid #33343a;border-radius:8px;padding:8px 14px;font-size:12px;text-decoration:none">📄 Ver cotización</a>` : ""}
        </div>`;
      }).join("")
    : '<div style="text-align:center;padding:18px;color:#6b6b73;font-size:13px">Todavía no tienes pedidos registrados.</div>';

  const cotHTML = cots.map((c) => {
    const cf = c.fields || {};
    const total = portalCLP(cf["Total final (CLP)"]);
    const vto = portalFecha(cf["Fecha vencimiento"]);
    const titulo = str(cf["Alias / Título"]);
    return `<div id="cot-${esc(c.id)}" style="background:#131315;border:1px solid #26262b;border-radius:12px;padding:14px 16px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div><div style="font-size:14px;font-weight:700">${esc(cf["N° Cotización"] || "—")}</div>
        ${titulo ? `<div style="font-size:12px;color:#8a8a92;margin-top:2px">${esc(titulo)}</div>` : ""}</div>
        ${total ? `<div style="text-align:right"><div style="font-size:16px;font-weight:700">${esc(total)}</div><div style="font-size:10px;color:#6b6b73">IVA incluido</div></div>` : ""}
      </div>
      ${vto ? `<div style="font-size:12px;color:#8a8a92;margin-top:8px">Válida hasta ${esc(vto)}</div>` : ""}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button onclick="portalDecidir('${esc(c.id)}','Aprobada')" style="flex:1;min-width:130px;background:#00b3a4;color:#06231f;border:0;border-radius:9px;padding:11px;font-weight:700;font-size:14px;cursor:pointer">✓ Aprobar</button>
        <a href="${verCot(c.id)}" style="background:transparent;color:#e8e8ea;border:1px solid #33343a;border-radius:9px;padding:11px 16px;font-size:13px;text-decoration:none;white-space:nowrap">📄 Ver cotización</a>
        <button onclick="portalDecidir('${esc(c.id)}','Rechazada')" style="background:transparent;color:#8a8a92;border:1px solid #33343a;border-radius:9px;padding:11px 16px;font-size:13px;cursor:pointer">Rechazar</button>
      </div>
    </div>`;
  }).join("");

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Tus pedidos — The Lab Solutions</title></head>
<body style="margin:0;background:#0b0b0c;color:#e8e8ea;font-family:system-ui,Arial,sans-serif">
<div style="max-width:620px;margin:0 auto;padding:34px 20px 48px">
  ${logoHeader(false)}
  <h1 style="font-size:22px;margin:0 0 4px">${esc(nombre)}</h1>
  <div style="font-size:13px;color:#8a8a92;margin-bottom:24px">${pedidos.length} pedido${pedidos.length !== 1 ? "s" : ""}${cots.length ? ` · ${cots.length} cotización${cots.length !== 1 ? "es" : ""} por responder` : ""}</div>
  ${cotHTML ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#7a7a82;margin-bottom:10px">Cotizaciones pendientes</div>${cotHTML}<div style="height:14px"></div>` : ""}
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#7a7a82;margin-bottom:10px">Tus pedidos</div>
  ${pedHTML}
  <div style="margin-top:26px;text-align:center;font-size:11px;color:#6b6b73;line-height:1.7">¿Dudas? Escríbenos a <a href="mailto:hola@thelab.solutions" style="color:#00b3a4">hola@thelab.solutions</a><br><a href="https://thelab.solutions" style="color:#6b6b73">thelab.solutions</a></div>
</div>
<script>
var PORTAL_TOKEN=${JSON.stringify(token)};
${PORTAL_DECIDIR_JS}
</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

async function sendCotDecisionAlert(env, { numCot, decision, comentario }) {
  if (!env.RESEND_API_KEY) return;
  const from = env.RESEND_FROM || "The Lab Solutions <hola@thelab.solutions>";
  const to = env.LEADS_NOTIFY_TO || "thelabsolutionscl@gmail.com";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));
  const aprob = decision === "Aprobada";
  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.55;max-width:560px">` +
    `<h2 style="margin:0 0 12px;color:${aprob ? "#0a8f6a" : "#b00020"}">${aprob ? "✅" : "🚫"} Cotización ${esc(numCot)} ${aprob ? "APROBADA" : "RECHAZADA"} por el cliente</h2>` +
    `<p>El cliente ${aprob ? "aprobó" : "rechazó"} la cotización <strong>${esc(numCot)}</strong> desde el portal.</p>` +
    (comentario ? `<p style="background:#f6f6f6;border-radius:8px;padding:8px 12px"><strong>Comentario:</strong> ${esc(comentario)}</p>` : "") +
    `<p>${aprob ? "Ponte en marcha: confirma el anticipo y crea el pedido." : "Considera un win-back o ajustar la propuesta."}</p>` +
    `<p style="color:#666;font-size:13px;margin-top:18px">— Portal de clientes · The Lab Solutions</p></div>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: `${aprob ? "✅" : "🚫"} Cotización ${numCot} ${aprob ? "aprobada" : "rechazada"} por el cliente`, html }),
    });
  } catch (e) {
    console.error("[leads-worker] alerta decisión cotización:", e.message);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * RUTA: /nps   (encuesta de satisfacción post-entrega, 1 clic desde el mensaje)
 *   GET  /nps?p=base64(pedidoRecId)             → página con 5 caritas
 *   GET  /nps?p=...&s=1..5[&g=urlReseña]        → registra la nota y agradece
 *   POST /nps  {token, comentario}              → guarda el comentario opcional
 * Seguridad: el recId no es adivinable; la nota es del propio cliente (puede
 * corregirla reenviando). Escribe en Pedidos: "NPS score", "NPS fecha",
 * "NPS comentario" (los crea el dashboard bajo demanda).
 * ══════════════════════════════════════════════════════════════════════ */
function _npsDecodeToken(t) {
  let id;
  try { id = atob(String(t || "")); } catch (e) { return null; }
  return isRecId(id) ? id : null;
}
async function handleNps(request, env, ctx, cors) {
  const url = new URL(request.url);

  // El token es base64 del recId, sin firma: el límite por IP evita que alguien
  // pruebe tokens en masa o inunde de escrituras a Airtable. 30/h da de sobra
  // para el flujo real (abrir la página, calificar y comentar).
  if (await rateLimited(env, request, "nps", 30, 3600)) {
    if (request.method === "POST") return json({ ok: false, error: "Demasiados intentos, intenta más tarde" }, 429, cors);
    return htmlPage("Demasiados intentos", "Espera unos minutos y vuelve a abrir el enlace.", false, 429);
  }

  // POST → comentario opcional
  if (request.method === "POST") {
    const body = await readJson(request);
    if (!body) return json({ ok: false, error: "JSON inválido" }, 400, cors);
    const pedId = _npsDecodeToken(body.token);
    if (!pedId) return json({ ok: false, error: "Token inválido" }, 400, cors);
    if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return json({ ok: false, error: "No configurado" }, 500, cors);
    const comentario = String(body.comentario || "").slice(0, 2000);
    if (comentario) {
      try { await airtableUpdateTolerant(env, "Pedidos", pedId, { "NPS comentario": comentario }); } catch (e) {}
      ctx.waitUntil(sendNpsAlert(env, { pedId, comentario, comentarioOnly: true }));
    }
    return json({ ok: true }, 200, cors);
  }

  // GET
  const pedId = _npsDecodeToken(url.searchParams.get("p"));
  if (!pedId) return htmlPage("Enlace inválido", "Este enlace de encuesta no es válido o ya expiró.", false);
  const gRaw = url.searchParams.get("g") || "";
  const gUrl = /^https?:\/\//i.test(gRaw) ? gRaw : "";
  const sRaw = url.searchParams.get("s");

  // Sin score → mostrar la página de calificación
  if (sRaw == null) return npsRatingPage(pedId, gUrl);

  const score = parseInt(sRaw, 10);
  if (!(score >= 1 && score <= 5)) return htmlPage("Calificación inválida", "Elige una nota del 1 al 5.", false);
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return npsThanksPage(score, pedId, gUrl);

  try {
    await airtableUpdateTolerant(env, "Pedidos", pedId, {
      "NPS score": score,
      "NPS fecha": today(),
    });
  } catch (e) {
    // best-effort: igual agradecemos para no frustrar al cliente
  }
  ctx.waitUntil(sendNpsAlert(env, { pedId, score }));
  return npsThanksPage(score, pedId, gUrl);
}
function npsRatingPage(pedId, gUrl) {
  const tok = btoa(pedId);
  const g = gUrl ? "&g=" + encodeURIComponent(gUrl) : "";
  const faces = [
    { n: 1, e: "😞", t: "Muy malo" },
    { n: 2, e: "🙁", t: "Malo" },
    { n: 3, e: "😐", t: "Regular" },
    { n: 4, e: "🙂", t: "Bueno" },
    { n: 5, e: "😍", t: "Excelente" },
  ];
  const btns = faces.map((f) =>
    `<a href="/nps?p=${tok}&s=${f.n}${g}" style="display:flex;flex-direction:column;align-items:center;gap:6px;text-decoration:none;padding:12px 8px;border-radius:12px;background:#151518;border:1px solid #26262b;min-width:58px;transition:transform .1s">
       <span style="font-size:34px">${f.e}</span>
       <span style="font-size:10px;color:#8a8a92">${f.t}</span></a>`
  ).join("");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>¿Cómo lo hicimos? — The Lab Solutions</title></head>
<body style="margin:0;background:#0b0b0c;color:#e8e8ea;font-family:system-ui,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:480px;padding:40px 24px;text-align:center">
${logoHeader(true)}
<h1 style="font-size:22px;margin:0 0 8px">¿Cómo fue tu experiencia?</h1>
<p style="font-size:15px;line-height:1.6;color:#b6b6bd;margin:0 0 24px">Tu opinión nos toma 5 segundos y nos ayuda un montón 💙</p>
<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">${btns}</div>
</div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function npsThanksPage(score, pedId, gUrl) {
  const tok = btoa(pedId);
  const feliz = score >= 4;
  const color = feliz ? "#00b3a4" : score === 3 ? "#f5a623" : "#e5484d";
  const titulo = feliz ? "¡Gracias por tu nota! 🙌" : "Gracias, lo tomamos muy en serio";
  const msg = feliz
    ? "Nos alegra mucho que la hayas pasado bien. ¡Seguimos trabajando para ti!"
    : "Lamentamos no haber estado a la altura. Cuéntanos qué pasó y lo resolvemos:";
  // Para notas altas y con enlace de reseña: invitar a Google. Para bajas: caja de comentario.
  const extra = feliz && gUrl
    ? `<a href="${escapeHtmlW(gUrl)}" style="display:inline-block;background:#00b3a4;color:#06231f;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:14px;margin-top:8px">⭐ Déjanos una reseña en Google</a>`
    : (!feliz
      ? `<form id="cf" style="margin-top:8px;text-align:left">
           <textarea id="cm" rows="4" placeholder="¿Qué podríamos mejorar?" style="width:100%;box-sizing:border-box;background:#151518;border:1px solid #26262b;border-radius:10px;color:#e8e8ea;padding:12px;font-size:14px;font-family:inherit"></textarea>
           <button type="submit" style="width:100%;margin-top:10px;background:#00b3a4;color:#06231f;font-weight:700;border:0;padding:12px;border-radius:9px;font-size:14px;cursor:pointer">Enviar comentario</button>
         </form>
         <div id="okmsg" style="display:none;color:#00b3a4;margin-top:12px;font-weight:600">¡Gracias! Lo revisaremos enseguida.</div>
         <script>
           document.getElementById('cf').addEventListener('submit',async function(ev){ev.preventDefault();
             var t=document.getElementById('cm').value.trim();if(!t)return;
             try{await fetch('/nps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(tok)},comentario:t})});}catch(e){}
             document.getElementById('cf').style.display='none';document.getElementById('okmsg').style.display='block';});
         </script>`
      : "");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gracias — The Lab Solutions</title></head>
<body style="margin:0;background:#0b0b0c;color:#e8e8ea;font-family:system-ui,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:460px;padding:40px 24px;text-align:center">
${logoHeader(true)}
<div style="font-size:44px;margin-bottom:8px">${feliz ? "🎉" : "🙏"}</div>
<h1 style="font-size:22px;margin:0 0 12px;color:${color}">${titulo}</h1>
<p style="font-size:15px;line-height:1.6;color:#b6b6bd;margin:0 0 20px">${msg}</p>
${extra}
</div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
async function sendNpsAlert(env, { pedId, score, comentario, comentarioOnly }) {
  if (!env.RESEND_API_KEY) return;
  const from = env.RESEND_FROM || "The Lab Solutions <hola@thelab.solutions>";
  const to = env.LEADS_NOTIFY_TO || "thelabsolutionscl@gmail.com";
  // Nº de pedido para el aviso (best-effort)
  let numPed = pedId;
  try {
    const r = await fetch(`${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/Pedidos/${pedId}`, {
      headers: { Authorization: "Bearer " + env.AIRTABLE_TOKEN },
    });
    if (r.ok) { const rec = await r.json(); numPed = (rec.fields && rec.fields["N° Pedido"]) || pedId; }
  } catch (e) {}
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));
  const faces = { 1: "😞", 2: "🙁", 3: "😐", 4: "🙂", 5: "😍" };
  let subject, html;
  if (comentarioOnly) {
    subject = `💬 Comentario de satisfacción — Pedido ${numPed}`;
    html = `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.55;max-width:560px"><h2 style="margin:0 0 12px">💬 Nuevo comentario post-entrega</h2><p>Pedido <strong>${esc(numPed)}</strong>:</p><p style="background:#f6f6f6;border-radius:8px;padding:8px 12px">${esc(comentario)}</p></div>`;
  } else {
    const bajo = score <= 3;
    subject = `${faces[score] || "⭐"} Satisfacción ${score}/5 — Pedido ${numPed}${bajo ? " (requiere atención)" : ""}`;
    html = `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.55;max-width:560px"><h2 style="margin:0 0 12px;color:${bajo ? "#b00020" : "#0a8f6a"}">${faces[score] || "⭐"} El cliente calificó ${score}/5</h2><p>Pedido <strong>${esc(numPed)}</strong>.</p>${bajo ? '<p style="color:#b00020"><strong>Nota baja:</strong> contacta al cliente para recuperar la relación.</p>' : "<p>¡Buen trabajo! Buen momento para pedir una reseña o referidos.</p>"}</div>`;
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
  } catch (e) {
    console.error("[leads-worker] alerta NPS:", e.message);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * RUTA: GET /pod  (comprobante de entrega — el cliente confirma la recepción)
 *   GET /pod?p=base64(pedidoRecId)        → página con botón de confirmación
 *   GET /pod?p=...&c=1                     → registra la recepción y agradece
 * Escribe en Pedidos: "Recepción confirmada" (checkbox) y "Recepción fecha".
 * ══════════════════════════════════════════════════════════════════════ */
async function handlePod(request, env, ctx, cors) {
  const url = new URL(request.url);
  // Mismo motivo que en /nps: este enlace marca "Recepción confirmada", así que
  // no puede quedar expuesto a que se prueben tokens sin límite.
  if (await rateLimited(env, request, "pod", 30, 3600)) {
    return htmlPage("Demasiados intentos", "Espera unos minutos y vuelve a abrir el enlace.", false, 429);
  }
  const pedId = _npsDecodeToken(url.searchParams.get("p"));
  if (!pedId) return htmlPage("Enlace inválido", "Este enlace de confirmación no es válido o ya expiró.", false);
  const confirm = url.searchParams.get("c") === "1";
  if (!confirm) return podConfirmPage(pedId);
  if (env.AIRTABLE_TOKEN && env.AIRTABLE_BASE_ID) {
    try {
      await airtableUpdateTolerant(env, "Pedidos", pedId, {
        "Recepción confirmada": true,
        "Recepción fecha": today(),
      });
    } catch (e) {}
    ctx.waitUntil(sendPodAlert(env, pedId));
  }
  return htmlPage("¡Recepción confirmada! ✅", "Gracias por confirmar que recibiste tu pedido conforme. ¡Fue un gusto trabajar contigo!", true);
}
function podConfirmPage(pedId) {
  const tok = btoa(pedId);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirmar recepción — The Lab Solutions</title></head>
<body style="margin:0;background:#0b0b0c;color:#e8e8ea;font-family:system-ui,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:460px;padding:40px 24px;text-align:center">
${logoHeader(true)}
<div style="font-size:44px;margin-bottom:8px">📦</div>
<h1 style="font-size:22px;margin:0 0 12px">¿Recibiste tu pedido?</h1>
<p style="font-size:15px;line-height:1.6;color:#b6b6bd;margin:0 0 24px">Confírmanos que llegó todo en orden. Nos tomas 1 segundo y nos ayuda a cerrar el pedido.</p>
<a href="/pod?p=${tok}&c=1" style="display:inline-block;background:#00b3a4;color:#06231f;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:10px;font-size:15px">✅ Sí, lo recibí conforme</a>
</div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
async function sendPodAlert(env, pedId) {
  if (!env.RESEND_API_KEY) return;
  const from = env.RESEND_FROM || "The Lab Solutions <hola@thelab.solutions>";
  const to = env.LEADS_NOTIFY_TO || "thelabsolutionscl@gmail.com";
  let numPed = pedId;
  try {
    const r = await fetch(`${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/Pedidos/${pedId}`, { headers: { Authorization: "Bearer " + env.AIRTABLE_TOKEN } });
    if (r.ok) { const rec = await r.json(); numPed = (rec.fields && rec.fields["N° Pedido"]) || pedId; }
  } catch (e) {}
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: `✅ Entrega confirmada — Pedido ${numPed}`, html: `<div style="font-family:system-ui,Arial,sans-serif;color:#111"><h2 style="color:#0a8f6a">✅ El cliente confirmó la recepción</h2><p>Pedido <strong>${esc(numPed)}</strong> recibido conforme. Puedes cerrarlo.</p></div>` }),
    });
  } catch (e) {
    console.error("[leads-worker] alerta POD:", e.message);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * RUTA: GET /pedido?p=base64(pedidoRecId)  (portal de seguimiento, solo lectura)
 * Muestra al cliente el estado de su pedido en una línea de progreso.
 * ══════════════════════════════════════════════════════════════════════ */
async function handlePedidoEstado(request, env) {
  const url = new URL(request.url);
  // Seguimiento: el cliente recarga la página varias veces mientras espera, por
  // eso el límite es más holgado que en /nps y /pod (que son de un solo uso).
  if (await rateLimited(env, request, "pedido", 60, 3600)) {
    return htmlPage("Demasiados intentos", "Espera unos minutos y vuelve a abrir el enlace.", false, 429);
  }
  const pedId = _npsDecodeToken(url.searchParams.get("p"));
  if (!pedId) return htmlPage("Enlace inválido", "Este enlace de seguimiento no es válido o ya expiró.", false);
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return htmlPage("No disponible", "El seguimiento no está disponible en este momento.", false);
  let rec;
  try {
    const r = await fetch(`${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/Pedidos/${pedId}`, { headers: { Authorization: "Bearer " + env.AIRTABLE_TOKEN } });
    if (r.status === 404) return htmlPage("Pedido no encontrado", "No pudimos encontrar este pedido.", false);
    if (!r.ok) return htmlPage("No disponible", "No pudimos leer el estado ahora. Intenta más tarde.", false);
    rec = await r.json();
  } catch (e) {
    return htmlPage("No disponible", "Error de conexión. Intenta más tarde.", false);
  }
  const f = rec.fields || {};
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));
  const estado = f["Estado pedido"] || "Confirmado";
  if (estado === "Cancelado") return htmlPage("Pedido cancelado", "Este pedido figura como cancelado. Si crees que es un error, escríbenos.", false);
  const stages = ["Confirmado", "En producción", "Listo para despacho", "Despachado"];
  let idx = stages.indexOf(estado);
  if (idx < 0) idx = f["Recepción confirmada"] ? 3 : 0;
  const entrega = f["Fecha entrega"] || "";
  const numPed = f["N° Pedido"] || "";
  const recibido = !!f["Recepción confirmada"];
  const steps = stages.map((s, i) => {
    const done = i < idx || (i === idx);
    const active = i === idx;
    const color = done ? "#00b3a4" : "#2b323b";
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0">
      <div style="width:26px;height:26px;border-radius:50%;flex-shrink:0;background:${done ? "#00b3a4" : "#151518"};border:2px solid ${done ? "#00b3a4" : "#33343a"};display:flex;align-items:center;justify-content:center;color:${done ? "#06231f" : "#7a7a82"};font-weight:800;font-size:13px">${i < idx ? "✓" : (i + 1)}</div>
      <span style="font-size:15px;color:${active ? "#e8e8ea" : done ? "#b6b6bd" : "#6b6b73"};font-weight:${active ? "700" : "400"}">${esc(s)}${active ? " ·  ahora" : ""}</span>
    </div>`;
  }).join("");
  const pct = Math.round(((idx + 1) / stages.length) * 100);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seguimiento ${esc(numPed)} — The Lab Solutions</title></head>
<body style="margin:0;background:#0b0b0c;color:#e8e8ea;font-family:system-ui,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:440px;width:100%;padding:36px 26px">
${logoHeader(false)}
<h1 style="font-size:22px;margin:0 0 4px">Seguimiento de tu pedido</h1>
<div style="font-size:13px;color:#8a8a92;margin-bottom:20px">${numPed ? "N° " + esc(numPed) : ""}${entrega ? " · entrega estimada " + esc(entrega) : ""}</div>
<div style="height:8px;background:#151518;border-radius:5px;overflow:hidden;margin-bottom:8px"><div style="height:100%;width:${pct}%;background:#00b3a4;border-radius:5px"></div></div>
<div style="font-size:12px;color:#8a8a92;margin-bottom:18px">${pct}% del proceso</div>
<div style="border:1px solid #26262b;border-radius:14px;padding:8px 18px">${steps}</div>
${recibido ? '<div style="margin-top:16px;padding:11px 14px;background:#0f2b24;border:1px solid #1c4a3f;border-radius:10px;font-size:13px;color:#5fdcc4">✅ Recepción confirmada. ¡Gracias!</div>' : ""}
<div style="margin-top:22px;text-align:center;font-size:11px;color:#6b6b73">¿Dudas? Escríbenos por WhatsApp o a hola@thelab.solutions</div>
</div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/* ════════════════════════════════════════════════════════════════════════
 * RUTA: POST /lead   (formulario de la web pública)
 * ══════════════════════════════════════════════════════════════════════ */
async function handleLead(request, env, ctx, cors) {
  // 1) Clave compartida (anti-bot básico — NO es seguridad fuerte)
  if (env.PUBLIC_LEAD_KEY) {
    const key = request.headers.get("X-Public-Lead-Key") || "";
    if (!timingSafeEqual(key, env.PUBLIC_LEAD_KEY)) {
      return json({ ok: false, error: "No autorizado" }, 401, cors);
    }
  }

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido" }, 400, cors);

  // 2) Honeypot: si viene relleno, es un bot. Respondemos 200 para no enseñarle.
  if (body.company_website || body._hp) {
    return json({ ok: true, clienteId: null, queueId: null }, 200, cors);
  }

  // 3) Turnstile (opcional)
  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, request);
    if (!ok) return json({ ok: false, error: "Verificación anti-bot falló" }, 403, cors);
  }

  // 4) Rate-limit por IP (opcional, requiere binding KV "RL")
  const limited = await rateLimited(env, request, "lead", 8, 60);
  if (limited) return json({ ok: false, error: "Demasiadas solicitudes" }, 429, cors);

  // 5) Validación mínima
  const name = str(body.name);
  const company = str(body.company);
  const email = str(body.email);
  const phone = str(body.phone);
  if (!name && !company) {
    return json({ ok: false, error: "Falta nombre o empresa" }, 400, cors);
  }
  if (!email && !phone) {
    return json({ ok: false, error: "Falta email o teléfono" }, 400, cors);
  }

  const norm = normalizeWeb(body);

  // 6) Adjunto opcional (imagen o PDF de referencia del cotizador público).
  //    Validación estricta: tipo permitido y ≤ ~4 MB decodificado (el límite
  //    del endpoint uploadAttachment de Airtable es 5 MB).
  let attachment = null;
  if (body.attachment && body.attachment.data) {
    const a = body.attachment;
    const okType = /^(image\/(png|jpe?g|webp|gif)|application\/pdf)$/.test(a.type || "");
    const b64 = String(a.data).replace(/^data:[^;]+;base64,/, "");
    if (okType && b64.length <= 5_600_000 && /^[A-Za-z0-9+/=]+$/.test(b64)) {
      attachment = { name: (str(a.name) || "referencia").slice(0, 120), type: a.type, data: b64 };
    }
  }

  return await createLeadAndQueue(env, ctx, cors, {
    norm,
    agente: "LEAD_AGENT",
    evento: "lead.created",
    source: norm.source || "web",
    campaign: norm.utmCampaign,
    attachment,
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * RUTA: POST /proveedor   (formulario "Sé nuestro proveedor" de la web)
 * Crea un registro en la tabla Proveedores con "Estado postulación" = ENTREVISTAR.
 * El equipo lo cambia luego a APROBADO / RECHAZADO y añade "Motivo evaluación".
 * ══════════════════════════════════════════════════════════════════════ */
async function handleProveedor(request, env, ctx, cors) {
  // 1) Clave compartida (anti-bot básico)
  if (env.PUBLIC_LEAD_KEY) {
    const key = request.headers.get("X-Public-Lead-Key") || "";
    if (!timingSafeEqual(key, env.PUBLIC_LEAD_KEY)) {
      return json({ ok: false, error: "No autorizado" }, 401, cors);
    }
  }

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido" }, 400, cors);

  // 2) Honeypot
  if (body.company_website || body._hp) {
    return json({ ok: true, proveedorId: null }, 200, cors);
  }

  // 3) Turnstile (opcional)
  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, request);
    if (!ok) return json({ ok: false, error: "Verificación anti-bot falló" }, 403, cors);
  }

  // 4) Rate-limit por IP
  const limited = await rateLimited(env, request, "proveedor", 5, 60);
  if (limited) return json({ ok: false, error: "Demasiadas solicitudes" }, 429, cors);

  // 5) Validación mínima
  const nombre = str(body.name) || str(body.company);
  const email = str(body.email);
  const phone = str(body.phone);
  if (!nombre) return json({ ok: false, error: "Falta el nombre del proveedor" }, 400, cors);
  if (!email && !phone) {
    return json({ ok: false, error: "Falta email o teléfono" }, 400, cors);
  }

  const contacto = str(body.contact) || nombre;
  const categoria = str(body.categoria || body.category);
  const productos = str(body.productos || body.products);
  const website = str(body.website);
  const message = str(body.message);

  const notas = ["📥 Postulación vía formulario web (thelab.solutions/proveedores)."];
  if (message) notas.push(message);

  const fields = stripEmpty({
    Nombre: nombre,
    Contacto: contacto,
    Cargo: str(body.cargo || body.role),
    Email: email,
    Teléfono: phone,
    WhatsApp: str(body.whatsapp) || phone,
    "Sitio Web": website,
    RUT: str(body.rut),
    Comuna: str(body.comuna),
    Región: str(body.region),
    // multipleSelects → array; typecast crea la opción si no existe
    Categoría: categoria ? [categoria] : undefined,
    Productos: productos,
    Notas: notas.join("\n\n"),
    "Estado postulación": "ENTREVISTAR",
  });

  const summary = { nombre, contacto, email, phone, categoria, productos, website, message };

  try {
    const rec = await airtableCreateTolerant(env, "Proveedores", fields);
    ctx.waitUntil(sendProveedorNotification(env, summary));
    return json({ ok: true, proveedorId: rec?.id || null }, 200, cors);
  } catch (e) {
    console.error("[proveedor]", e?.stack || e?.message || String(e));
    // No perder la postulación: avisar por email aunque Airtable falle.
    ctx.waitUntil(sendProveedorNotification(env, { ...summary, failed: true }));
    return json({ ok: false, error: "No se pudo registrar la postulación" }, 502, cors);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * RUTAS: GET /blog  y  GET /blog/:slug   (lectura pública del blog desde Airtable)
 * ══════════════════════════════════════════════════════════════════════ */
async function airtableSelectBlog(env, { formula, fields, sort, maxRecords }) {
  const params = new URLSearchParams();
  if (formula) params.set("filterByFormula", formula);
  (fields || []).forEach((f) => params.append("fields[]", f));
  if (sort) {
    params.append("sort[0][field]", sort.field);
    params.append("sort[0][direction]", sort.dir || "desc");
  }
  if (maxRecords) params.set("maxRecords", String(maxRecords));
  const u = `${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent("Blog")}?${params.toString()}`;
  const r = await fetch(u, { headers: { Authorization: "Bearer " + env.AIRTABLE_TOKEN } });
  if (!r.ok) throw new Error("airtable " + r.status);
  const d = await r.json();
  return d.records || [];
}

async function handleBlogList(request, env, cors) {
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) {
    return json({ ok: false, error: "Airtable no configurado" }, 500, cors);
  }
  const u = new URL(request.url);
  const cat = str(u.searchParams.get("cat"));
  const limit = Math.min(parseInt(u.searchParams.get("limit") || "100", 10) || 100, 200);
  let formula = "{Estado}='Publicado'";
  if (cat) formula = `AND({Estado}='Publicado',{Categoría}='${cat.replace(/'/g, "\\'")}')`;
  try {
    const recs = await airtableSelectBlog(env, {
      formula,
      fields: ["Título", "Slug", "Fecha", "Extracto", "Imagen", "Categoría"],
      sort: { field: "Fecha", dir: "desc" },
      maxRecords: limit,
    });
    const posts = recs
      .map((r) => ({
        title: r.fields["Título"] || "",
        slug: r.fields["Slug"] || "",
        date: r.fields["Fecha"] || "",
        excerpt: r.fields["Extracto"] || "",
        image: r.fields["Imagen"] || "",
        categoria: r.fields["Categoría"] || "",
      }))
      .filter((p) => p.slug);
    return json({ ok: true, posts }, 200, cors);
  } catch (e) {
    return json({ ok: false, error: e.message }, 502, cors);
  }
}

async function handleBlogPost(env, cors, slug) {
  if (!slug) return json({ ok: false, error: "Falta slug" }, 400, cors);
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) {
    return json({ ok: false, error: "Airtable no configurado" }, 500, cors);
  }
  try {
    const recs = await airtableSelectBlog(env, {
      formula: `AND({Estado}='Publicado',{Slug}='${slug.replace(/'/g, "\\'")}')`,
      maxRecords: 1,
    });
    if (!recs.length) return json({ ok: false, error: "No encontrado" }, 404, cors);
    const f = recs[0].fields;
    return json(
      {
        ok: true,
        post: {
          title: f["Título"] || "",
          slug: f["Slug"] || "",
          date: f["Fecha"] || "",
          excerpt: f["Extracto"] || "",
          content: f["Contenido"] || "",
          image: f["Imagen"] || "",
          categoria: f["Categoría"] || "",
        },
      },
      200,
      cors
    );
  } catch (e) {
    return json({ ok: false, error: e.message }, 502, cors);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * RUTA: POST /newsletter   (alta de suscriptor desde la web)
 * Doble opt-in: si hay Resend configurado, NO marca "Suscrito" hasta que el
 * suscriptor confirme por email (link con token HMAC). Si no hay Resend, hace
 * alta directa (single opt-in). No encola agentes: es solo opt-in.
 * ══════════════════════════════════════════════════════════════════════ */
async function handleNewsletter(request, env, ctx, cors) {
  // 1) Clave compartida (mismo anti-bot básico que /lead)
  if (env.PUBLIC_LEAD_KEY) {
    const key = request.headers.get("X-Public-Lead-Key") || "";
    if (!timingSafeEqual(key, env.PUBLIC_LEAD_KEY)) {
      return json({ ok: false, error: "No autorizado" }, 401, cors);
    }
  }

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido" }, 400, cors);

  // 2) Honeypot: si viene relleno, es un bot. Respondemos 200 sin enseñarle.
  if (body.company_website || body._hp) {
    return json({ ok: true, subscribed: true }, 200, cors);
  }

  // 3) Turnstile (opcional)
  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, request);
    if (!ok) return json({ ok: false, error: "Verificación anti-bot falló" }, 403, cors);
  }

  // 4) Rate-limit por IP (opcional, requiere binding KV "RL")
  const limited = await rateLimited(env, request, "newsletter", 8, 60);
  if (limited) return json({ ok: false, error: "Demasiadas solicitudes" }, 429, cors);

  // 5) Validación: email obligatorio y con forma válida
  const email = str(body.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Email inválido" }, 400, cors);
  }
  const name = str(body.name);
  const company = str(body.company);
  const source = str(body.source) || "Newsletter web";

  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) {
    return json({ ok: false, error: "Airtable no configurado" }, 500, cors);
  }

  // Doble opt-in si podemos enviar el correo de confirmación (Resend) y no está deshabilitado.
  const doubleOptIn = !!env.RESEND_API_KEY && env.NEWSLETTER_DOUBLE_OPTIN !== "false";

  try {
    const existing = await airtableFindCliente(env, { email });

    if (doubleOptIn) {
      // Aseguramos que el contacto exista (sin marcar "Suscrito" todavía).
      let clienteId = existing;
      if (!existing) {
        const cliente = await airtableCreateTolerant(
          env,
          "Clientes",
          stripEmpty({
            Empresa: company || name || email,
            Contacto: name,
            Email: email,
            "Origen lead": source,
            "Email válido": true,
            "Fecha primer contacto": today(),
            "Notas internas":
              "Solicitó newsletter (pendiente de confirmar)" +
              (body.landingUrl ? ` — ${str(body.landingUrl)}` : ""),
          })
        );
        clienteId = cliente?.id || null;
      }
      const origin = new URL(request.url).origin;
      const token = await nlSign(env, "confirm", email);
      const confirmUrl = `${origin}/newsletter/confirm?e=${encodeURIComponent(email)}&t=${token}`;
      ctx.waitUntil(sendNewsletterConfirm(env, email, name, confirmUrl));
      return json({ ok: true, pending: true, clienteId }, 200, cors);
    }

    // Sin Resend → alta directa (single opt-in).
    if (existing) {
      await airtableUpdateTolerant(
        env,
        "Clientes",
        existing,
        stripEmpty({ "Suscrito newsletter": true, "Baja newsletter": false, "Email válido": true })
      );
      return json({ ok: true, subscribed: true, clienteId: existing, created: false }, 200, cors);
    }
    const cliente = await airtableCreateTolerant(
      env,
      "Clientes",
      stripEmpty({
        Empresa: company || name || email,
        Contacto: name,
        Email: email,
        "Origen lead": source,
        "Suscrito newsletter": true,
        "Email válido": true,
        "Fecha primer contacto": today(),
        "Notas internas":
          "Alta a newsletter desde la web" + (body.landingUrl ? ` (${str(body.landingUrl)})` : ""),
      })
    );
    return json({ ok: true, subscribed: true, clienteId: cliente?.id || null, created: true }, 200, cors);
  } catch (e) {
    console.error("[leads-worker] newsletter:", e.message);
    return json({ ok: false, error: "No se pudo suscribir" }, 500, cors);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * RUTA: GET /newsletter/confirm   (doble opt-in)
 * ══════════════════════════════════════════════════════════════════════ */
async function handleNewsletterConfirm(request, env) {
  const url = new URL(request.url);
  const email = str(url.searchParams.get("e"));
  const token = str(url.searchParams.get("t"));
  if (!email || !(await nlVerify(env, "confirm", email, token))) {
    return htmlPage("Enlace inválido", "Este enlace de confirmación no es válido o ya expiró. Vuelve a suscribirte en thelab.solutions.", false);
  }
  if (env.AIRTABLE_TOKEN && env.AIRTABLE_BASE_ID) {
    try {
      const id = await airtableFindCliente(env, { email });
      if (id) {
        await airtableUpdateTolerant(env, "Clientes", id, stripEmpty({ "Suscrito newsletter": true, "Baja newsletter": false, "Email válido": true }));
      } else {
        await airtableCreateTolerant(env, "Clientes", stripEmpty({ Empresa: email, Email: email, "Origen lead": "Newsletter web", "Suscrito newsletter": true, "Email válido": true, "Fecha primer contacto": today() }));
      }
    } catch (e) {
      console.error("[leads-worker] confirm:", e.message);
    }
  }
  return htmlPage("¡Suscripción confirmada! 🎉", "Gracias por confirmar. Te escribiremos con novedades, casos reales y ofertas — sin spam.", true);
}

/* ════════════════════════════════════════════════════════════════════════
 * RUTA: GET /newsletter/unsubscribe   (baja)
 * Token HMAC opcional: si viene, se valida; si no, igual se procesa la baja
 * (un opt-out nunca se bloquea).
 * ══════════════════════════════════════════════════════════════════════ */
async function handleNewsletterUnsubscribe(request, env) {
  const url = new URL(request.url);
  const email = str(url.searchParams.get("e"));
  if (!email) return htmlPage("Enlace inválido", "Falta el correo en el enlace de baja.", false);
  if (env.AIRTABLE_TOKEN && env.AIRTABLE_BASE_ID) {
    try {
      const id = await airtableFindCliente(env, { email });
      if (id) await airtableUpdateTolerant(env, "Clientes", id, stripEmpty({ "Baja newsletter": true, "Suscrito newsletter": false }));
    } catch (e) {
      console.error("[leads-worker] unsubscribe:", e.message);
    }
  }
  return htmlPage("Te diste de baja", "Ya no recibirás más correos del newsletter. Si fue un error, puedes volver a suscribirte en thelab.solutions.", true);
}

/* ── Newsletter: helpers de token HMAC (sin estado), página HTML y email ── */
function nlSecret(env) {
  return env.NEWSLETTER_SECRET || env.PUBLIC_LEAD_KEY || env.AIRTABLE_TOKEN || "thelab-newsletter";
}
async function nlSign(env, purpose, email) {
  return await hmacB64u(nlSecret(env), `${purpose}:${String(email).trim().toLowerCase()}`);
}
// HMAC-SHA256 en base64url — firma los tokens sin estado (newsletter y portal).
async function hmacB64u(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  let s = "";
  for (let i = 0; i < sig.length; i++) s += String.fromCharCode(sig[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function nlVerify(env, purpose, email, token) {
  if (!token) return false;
  return timingSafeEqual(token, await nlSign(env, purpose, email));
}
// Cabecera de marca de las páginas públicas (portal, seguimiento, NPS, POD,
// newsletter). El PNG lo sirve el dashboard; si no cargara, cae al texto de
// siempre en vez de dejar un hueco.
const LOGO_URL = "https://dashboard.thelab.solutions/logo-thelab.png";
// Versión para fondo claro (la hoja de la cotización).
const LOGO_BLACK_URL = "https://dashboard.thelab.solutions/logo-thelab-black.png";
function logoHeader(centrado) {
  return `<div style="margin-bottom:18px">
    <img src="${LOGO_URL}" alt="The Lab Solutions" style="width:200px;max-width:60%;height:auto;display:block${centrado ? ";margin:0 auto" : ""}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
    <div style="display:none;font-size:13px;letter-spacing:.18em;color:#7a7a82;text-transform:uppercase">The Lab Solutions</div>
  </div>`;
}
function escapeHtmlW(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function htmlPage(title, msg, ok, status = 200) {
  const color = ok ? "#00b3a4" : "#e5484d";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtmlW(title)} — The Lab Solutions</title></head>
<body style="margin:0;background:#0b0b0c;color:#e8e8ea;font-family:system-ui,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:460px;padding:40px 28px;text-align:center">
${logoHeader(true)}
<h1 style="font-size:22px;margin:0 0 12px;color:${color}">${escapeHtmlW(title)}</h1>
<p style="font-size:15px;line-height:1.6;color:#b6b6bd;margin:0 0 24px">${escapeHtmlW(msg)}</p>
<a href="https://thelab.solutions" style="display:inline-block;background:#00b3a4;color:#06231f;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:14px">Ir a thelab.solutions</a>
</div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
async function sendNewsletterConfirm(env, email, name, confirmUrl) {
  if (!env.RESEND_API_KEY) return;
  const from = env.RESEND_FROM || "The Lab Solutions <hola@thelab.solutions>";
  const first = name ? String(name).split(" ")[0] : "";
  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.6;max-width:520px">` +
    `<h2 style="margin:0 0 12px">Confirma tu suscripción ✅</h2>` +
    `<p>Hola ${escapeHtmlW(first)},</p>` +
    `<p>Recibimos tu solicitud para recibir el newsletter de <strong>The Lab Solutions</strong>. Para activarla, confirma tu correo:</p>` +
    `<p style="margin:22px 0"><a href="${confirmUrl}" style="background:#00b3a4;color:#06231f;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:9px">Confirmar suscripción</a></p>` +
    `<p style="color:#666;font-size:13px">Si no fuiste tú, ignora este correo y no te suscribiremos.</p>` +
    `<p style="color:#666;font-size:12px;margin-top:18px">— Equipo The Lab Solutions · fabricación digital, Santiago</p>` +
    `</div>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: "Confirma tu suscripción — The Lab Solutions", html }),
    });
  } catch (e) {
    console.error("[leads-worker] confirm email:", e.message);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * RUTA: POST /webhooks/google-ads
 * ══════════════════════════════════════════════════════════════════════ */
async function handleGoogleAds(request, env, ctx, cors) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido" }, 400, cors);

  // Google permite enviar la clave en header o en el body
  const provided =
    request.headers.get("X-Google-Ads-Webhook-Key") ||
    body.google_key ||
    body.verification_key ||
    "";
  if (!env.GOOGLE_ADS_WEBHOOK_KEY || !timingSafeEqual(provided, env.GOOGLE_ADS_WEBHOOK_KEY)) {
    return json({ ok: false, error: "No autorizado" }, 401, cors);
  }

  const norm = normalizeGoogleAds(body);
  return await createLeadAndQueue(env, ctx, cors, {
    norm,
    agente: "LEAD_AGENT",
    evento: "google_ads.lead_received",
    source: "google_ads",
    campaign: norm.utmCampaign,
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * RUTA: POST /webhooks/linkedin   (vía Make / Zapier / HubSpot)
 * ══════════════════════════════════════════════════════════════════════ */
async function handleLinkedin(request, env, ctx, cors) {
  const provided =
    request.headers.get("X-Linkedin-Webhook-Key") ||
    request.headers.get("X-Public-Lead-Key") ||
    "";
  const expected = env.LINKEDIN_WEBHOOK_KEY || env.PUBLIC_LEAD_KEY;
  if (!expected || !timingSafeEqual(provided, expected)) {
    return json({ ok: false, error: "No autorizado" }, 401, cors);
  }

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido" }, 400, cors);

  const norm = normalizeLinkedin(body);
  return await createLeadAndQueue(env, ctx, cors, {
    norm,
    agente: "LINKEDIN_AGENT",
    evento: "linkedin.lead_received",
    source: "linkedin",
    campaign: norm.campaign || norm.utmCampaign,
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * RUTA: POST /webhooks/social   (comentarios y DMs de Instagram/Facebook/TikTok
 * vía Make). Siempre registra la interacción en Social_Interactions; si viene
 * marcada como lead, además crea Cliente + Agent_Queue (mismo pipeline).
 * ══════════════════════════════════════════════════════════════════════ */
async function handleSocial(request, env, ctx, cors) {
  const provided =
    request.headers.get("X-Social-Webhook-Key") ||
    request.headers.get("X-Public-Lead-Key") ||
    "";
  const expected = env.SOCIAL_WEBHOOK_KEY || env.PUBLIC_LEAD_KEY;
  if (!expected || !timingSafeEqual(provided, expected)) {
    return json({ ok: false, error: "No autorizado" }, 401, cors);
  }

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido" }, 400, cors);

  const s = normalizeSocial(body);
  if (!s.usuario && !s.mensaje) {
    return json({ ok: false, error: "Faltan datos (usuario/mensaje)" }, 400, cors);
  }

  // 1) Siempre: registra la interacción en Social_Interactions (best-effort).
  let interactionId = null;
  try {
    const inter = await airtableCreateTolerant(
      env,
      "Social_Interactions",
      stripEmpty({
        Red: s.red,
        Tipo: s.tipo,
        Usuario: s.usuario,
        Mensaje: s.mensaje,
        Intención: s.intencion,
        "Es lead": s.esLead || undefined,
        Queja: s.queja || undefined,
        Estado: "Pendiente",
        Fecha: s.fecha,
      })
    );
    interactionId = inter?.id || null;
  } catch (e) {
    console.error("[leads-worker] Social_Interactions:", e.message);
  }

  // 2) Si viene marcada como lead, crea Cliente + Agent_Queue (sin email no hay
  //    auto-reply; el LEAD_AGENT lo pre-scorea si AUTO_PROCESS_LEADS está activo).
  if (s.esLead) {
    const norm = {
      name: s.usuario,
      company: s.usuario ? "@" + s.usuario : "Lead redes sociales",
      message: s.mensaje,
      service: s.service,
      red: s.red,
      tipo: s.tipo,
      intencion: s.intencion,
      campaign: s.campaign,
      interactionId,
    };
    return await createLeadAndQueue(env, ctx, cors, {
      norm,
      agente: "LEAD_AGENT",
      evento: "social.lead_received",
      source: s.source,
      campaign: s.campaign,
    });
  }

  return json({ ok: true, interactionId, lead: false }, 200, cors);
}

function normalizeSocial(b) {
  const redRaw = (str(b.red) || str(b.network) || "").toLowerCase();
  const redMap = {
    instagram: "Instagram", ig: "Instagram",
    facebook: "Facebook", fb: "Facebook",
    linkedin: "LinkedIn",
    tiktok: "TikTok", tt: "TikTok",
  };
  const red = redMap[redRaw] || str(b.red) || str(b.network) || "";
  const tipoRaw = (str(b.tipo) || str(b.type) || "comentario").toLowerCase();
  const tipo =
    tipoRaw.startsWith("dm") || tipoRaw.includes("message") || tipoRaw.includes("mensaje")
      ? "DM"
      : tipoRaw.includes("menc") || tipoRaw.includes("mention")
      ? "Mención"
      : "Comentario";
  const esLead = /^(s[ií]|true|1)$/i.test(String(b.esLead ?? b.es_lead ?? "").trim());
  const mensaje = str(b.mensaje) || str(b.message) || str(b.text) || str(b.comment);
  const intencion = str(b.intencion) || str(b.intent);
  return {
    red,
    tipo,
    usuario: str(b.usuario) || str(b.username) || str(b.from) || str(b.user),
    mensaje,
    intencion,
    esLead,
    queja: socialIsComplaint(mensaje, intencion),
    service: str(b.service),
    source: redRaw || "redes",
    campaign: str(b.campaign),
    fecha: str(b.fecha) || str(b.date) || new Date().toISOString(),
  };
}

// Detección simple de queja (sentimiento negativo) para disparar el aviso por WhatsApp.
// Espeja la heurística del dashboard (_redesSentiment).
function socialIsComplaint(mensaje, intencion) {
  if (/soporte|queja|reclamo/i.test(intencion || "")) return true;
  return /problema|reclamo|p[eé]simo|pesimo|terrible|malo|mala|horrible|estafa|fraude|no lleg|no me lleg|roto|rota|da[ñn]ad|atras|tarde|nunca lleg|enojad|molest|deficiente|denunci|devoluci|no funciona|no sirve/i.test(
    mensaje || ""
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * NÚCLEO: crear Cliente + tarea en Agent_Queue
 * ══════════════════════════════════════════════════════════════════════ */

// Etiqueta "oficial" de Origen lead en el CRM: los leads del sitio quedan como
// "Web" (la opción curada), no como la "web" en minúscula que generaba antes.
const ORIGEN_LABEL = { web: "Web" };
function origenLabel(source) {
  return ORIGEN_LABEL[source] || source;
}

// Mapea el lead normalizado a columnas reales de la tabla Clientes. Tolerante:
// los campos que no existan en la base se descartan en airtableCreateTolerant.
// Los datos de identidad (RUT, industria, dirección, etc.) van a sus columnas;
// el brief del proyecto (producto, cantidad, fecha, presupuesto) va a "Notas internas".
function buildClienteFields(norm, source) {
  return stripEmpty({
    Empresa: norm.company || norm.name,
    Contacto: norm.name,
    Email: norm.email,
    Teléfono: norm.phone,
    "Cargo contacto": norm.jobTitle,
    "Origen lead": origenLabel(source),
    "Industria / Rubro": norm.industry,
    "Tipo de cliente": norm.tipoCliente,
    RUT: norm.rut,
    "Sitio web": norm.website,
    Dirección: norm.address,
    Región: norm.region,
    Comuna: norm.comuna,
    "Servicio interés": norm.service,
    // Tracking estructurado para importar conversiones offline a Google Ads.
    // Columnas tolerantes: si no existen en la base, se descartan sin romper.
    GCLID: norm.gclid,
    "Campaña Ads": norm.utmCampaign,
    // Los registros nuevos entran como LEAD (categoría). El equipo los valida
    // luego marcando el campo "Validado" en el dashboard, que los pasa a CLIENTE.
    Validado: false,
    "Notas internas": buildNotes(norm),
    "Fecha primer contacto": today(),
  });
}

async function createLeadAndQueue(env, ctx, cors, { norm, agente, evento, source, campaign, attachment }) {
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) {
    return json({ ok: false, error: "Airtable no configurado" }, 500, cors);
  }

  // 1) Cliente — campos tolerantes (si no existen en la base, se descartan)
  const clienteFields = buildClienteFields(norm, source);

  let clienteId = null;
  try {
    const existing = await airtableFindCliente(env, {
      email: norm.email,
      phone: norm.phone,
    });
    if (existing) {
      // Cliente recurrente: reutiliza el registro y refresca interés/cargo
      // sin pisar notas ni la fecha de primer contacto.
      clienteId = existing;
      await airtableUpdateTolerant(
        env,
        "Clientes",
        existing,
        stripEmpty({
          "Servicio interés": norm.service,
          "Cargo contacto": norm.jobTitle,
          // Refresca el gclid/campaña si el lead recurrente llega por un clic de Ads
          // (stripEmpty descarta los vacíos → no borra un gclid previo).
          GCLID: norm.gclid,
          "Campaña Ads": norm.utmCampaign,
        })
      );
    } else {
      const cliente = await airtableCreateTolerant(env, "Clientes", clienteFields);
      clienteId = cliente?.id || null;
    }
  } catch (e) {
    console.error("[leads-worker] Clientes:", e.message);
    // No perder el lead: a buffer (KV) para reintento por cron + auto-reply igual +
    // aviso interno para rescatarlo a mano (antes fallaba en silencio).
    await bufferDeadLetter(env, { norm, agente, evento, source, campaign, reason: e.message });
    if (norm.email) ctx.waitUntil(sendLeadAutoReply(env, norm));
    ctx.waitUntil(sendLeadSaveFailedAlert(env, norm, e.message));
    return json({ ok: true, clienteId: null, queueId: null, buffered: true }, 200, cors);
  }

  // 1b) Adjunto → campo de attachments del Cliente (best-effort: si el campo
  //     no existe en la base, se loguea y el lead sigue su curso normal).
  if (attachment && clienteId && ctx) {
    ctx.waitUntil(uploadAttachmentToCliente(env, clienteId, attachment));
  }

  // 2) Agent_Queue — tabla bajo nuestro control (campos fijos)
  let queueId = null;
  const queueFields = stripEmpty({
    Evento: evento,
    Entidad: "Cliente",
    "ID entidad": clienteId,
    Agente: agente,
    Estado: "Pendiente",
    Prioridad: source === "google_ads" ? "Alta" : "Media",
    "Input JSON": JSON.stringify(norm).slice(0, 95000),
    Source: source,
    Campaign: campaign,
    "Fecha creación": new Date().toISOString(),
  });
  try {
    const q = await airtableCreateTolerant(env, "Agent_Queue", queueFields);
    queueId = q?.id || null;
  } catch (e) {
    // El cliente ya se guardó, pero la tarea del pipeline no: NO fallar en silencio.
    // Al buffer (el cron reintenta crear la tarea — el cliente ya existe, no se duplica)
    // + aviso al equipo, para que el lead no se quede sin procesar sin que nadie lo sepa.
    console.error("[leads-worker] Agent_Queue:", e.message);
    await bufferDeadLetter(env, {
      norm,
      agente,
      evento,
      source,
      campaign,
      reason: "Agent_Queue: " + e.message,
    });
    ctx.waitUntil(
      sendLeadSaveFailedAlert(env, norm, e.message, {
        title: "⚠️ Lead guardado, pero SIN tarea de seguimiento",
        intro:
          "El cliente <strong>sí</strong> quedó en el CRM, pero no se pudo crear su tarea en el " +
          "pipeline (Agent_Queue), así que no se auto-procesa ni se le asigna seguimiento al vendedor. " +
          "Quedó en el buffer de reintentos (cada hora); si en ~1 hora sigue sin tarea, créala a mano.",
        subject: `⚠️ Lead sin tarea de seguimiento: ${norm.name || norm.email || "sin nombre"}`,
      })
    );
  }

  // Auto-respuesta al lead (speed-to-lead), best-effort, no bloquea la respuesta
  if (norm.email) ctx.waitUntil(sendLeadAutoReply(env, norm));

  // 3) Procesamiento opcional con Claude (no bloquea la respuesta)
  if (
    env.AUTO_PROCESS_LEADS === "true" &&
    env.ANTHROPIC_API_KEY &&
    queueId &&
    (await autoProcessAllowed(env))
  ) {
    ctx.waitUntil(processLeadAgent(env, { clienteId, queueId, norm, agente }));
  }

  return json({ ok: true, clienteId, queueId }, 200, cors);
}

/* ════════════════════════════════════════════════════════════════════════
 * Procesamiento server-side de LEAD_AGENT / LINKEDIN_AGENT con Claude
 * ══════════════════════════════════════════════════════════════════════ */
async function processLeadAgent(env, { clienteId, queueId, norm, agente }) {
  try {
    await airtableUpdate(env, "Agent_Queue", queueId, { Estado: "Procesando" });

    const sys =
      agente === "LINKEDIN_AGENT"
        ? SYS_LINKEDIN
        : SYS_LEAD;
    const userMsg =
      "Datos del lead (JSON):\n" +
      JSON.stringify(norm, null, 2) +
      "\n\nResponde SOLO con el objeto JSON pedido, sin texto adicional.";

    const out = await callClaude(env, sys, userMsg);
    const parsed = safeJson(out) || {};

    // Actualiza el Cliente (tolerante a campos inexistentes)
    await airtableUpdateTolerant(
      env,
      "Clientes",
      clienteId,
      stripEmpty({
        "Lead Score IA": numOrNull(parsed.lead_score ?? parsed.score_b2b),
        "Servicio interés": parsed.servicio_detectado || parsed.servicio_recomendado,
        "Próxima acción IA": parsed.proxima_accion,
        "Último agente ejecutado": agente,
        "Resumen IA": parsed.resumen_crm || parsed.resumen,
      })
    );

    await airtableUpdate(env, "Agent_Queue", queueId, {
      Estado: "Completado",
      Output: out.slice(0, 95000),
      "Accion sugerida": parsed.proxima_accion || "",
      "Lead Score": numOrNull(parsed.lead_score ?? parsed.score_b2b),
      "Fecha ejecución": new Date().toISOString(),
    });
  } catch (e) {
    console.error("[leads-worker] processLeadAgent:", e.message);
    try {
      await airtableUpdate(env, "Agent_Queue", queueId, {
        Estado: "Error",
        Error: String(e.message).slice(0, 1000),
        "Fecha ejecución": new Date().toISOString(),
      });
    } catch (_) {}
  }
}

const SYS_LEAD = `Eres el LEAD_AGENT de The Lab Solutions, empresa de fabricación digital premium en Santiago, Chile.
Servicios: Activaciones, Premiaciones, Merchandising, Impresión 3D, Volumétricos, Cartelería, Papelería, Chip The Lab.
Reglas de canal:
- source=google_ads: intención alta, prioriza velocidad de respuesta.
- source=linkedin: tono B2B consultivo (evalúa cargo, empresa, industria).
- source=web: orienta y educa sin extenderte.
- source=whatsapp: directo y orientado a cotización.
Detecta el servicio más probable. Detecta datos faltantes clave (cantidad, fecha, comuna, medidas, material, archivo, presupuesto). No inventes precios finales.
Responde SOLO un objeto JSON con EXACTAMENTE estas claves:
{
 "lead_score": <número 1-10>,
 "servicio_detectado": "<uno de los servicios o 'Otro'>",
 "urgencia": "Alta|Media|Baja",
 "faltan_datos": ["..."],
 "proxima_accion": "<acción concreta>",
 "mensaje_wa": "<máx 4 líneas, listo para WhatsApp>",
 "email": {"asunto": "...", "cuerpo": "..."},
 "resumen_crm": "<resumen interno breve>"
}`;

const SYS_LINKEDIN = `Eres el LINKEDIN_AGENT de The Lab Solutions (fabricación digital B2B, Santiago, Chile).
Analizas leads B2B de LinkedIn (Ads, Lead Gen Forms o prospección). Tono profesional, chileno, directo, sin sonar robótico.
Servicios: Activaciones, Premiaciones, Merchandising, Impresión 3D, Volumétricos, Cartelería, Papelería, Chip The Lab.
Responde SOLO un objeto JSON con EXACTAMENTE estas claves:
{
 "score_b2b": <número 1-10>,
 "servicio_recomendado": "<uno de los servicios>",
 "decisor": "Alto|Medio|Bajo",
 "mensaje_linkedin": "<mensaje corto de apertura>",
 "email": {"asunto": "...", "cuerpo": "..."},
 "objeciones_probables": ["..."],
 "proxima_accion": "<acción recomendada>",
 "resumen": "<resumen interno breve>"
}`;

async function callClaude(env, system, user, opts = {}) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model || env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: opts.maxTokens || 1200,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) {
    const e = await r.text().catch(() => "");
    throw new Error(`Anthropic ${r.status}: ${e.slice(0, 300)}`);
  }
  const data = await r.json();
  return data.content?.find((b) => b.type === "text")?.text || "";
}

// Firma HTML de Andrea Garrido (Atención al Cliente) — la misma marca que usan los
// correos de estado de cotización/pedido, para que todo lo que ve el cliente sea consistente.
const FIRMA_ANDREA =
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0;"><tr><td bgcolor="#0a0a0a" style="background-color:#0a0a0a;border:1px solid #262626;border-radius:14px;padding:20px 24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td valign="middle" style="padding-right:22px;"><img src="https://dashboard.thelab.solutions/logo-footer-thelab.png" width="88" height="83" alt="The Lab Solutions" style="display:block;border:0;outline:none;text-decoration:none;width:88px;height:83px;" /></td><td valign="middle" style="padding-left:22px;border-left:2px solid #00d4cc;"><div style="font-family:'Montserrat','Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.2;font-weight:700;color:#ffffff;letter-spacing:0.3px;">Andrea Garrido</div><div style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;font-size:10.5px;line-height:1.3;font-weight:600;color:#00d4cc;letter-spacing:1px;text-transform:uppercase;padding-top:5px;">Atención al Cliente</div><div style="height:11px;line-height:11px;font-size:0;">&nbsp;</div><div style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;font-size:12px;line-height:1.9;color:#c7ccd1;"><span style="color:#00d4cc;">&#9642;</span>&nbsp;<a href="https://wa.me/56928785039" style="color:#c7ccd1;text-decoration:none;">+56 9 2878 5039</a><br /><span style="color:#00d4cc;">&#9642;</span>&nbsp;<a href="https://thelab.solutions" style="color:#00d4cc;text-decoration:none;font-weight:500;">www.thelab.solutions</a><br /><span style="color:#00d4cc;">&#9642;</span>&nbsp;<a href="mailto:hola@thelab.solutions" style="color:#c7ccd1;text-decoration:none;">hola@thelab.solutions</a></div></td></tr></table></td></tr></table>`;

// Auto-respuesta al lead (speed-to-lead). Best-effort vía Resend. Requiere RESEND_API_KEY.
async function sendLeadAutoReply(env, norm) {
  if (!env.RESEND_API_KEY || !norm.email) return;
  // Remitente de cara al cliente: Andrea Garrido (Atención al Cliente).
  const from =
    env.RESEND_FROM_CLIENTE || "Andrea Garrido - The Lab Solutions <hola@thelab.solutions>";
  const wa = env.WHATSAPP_NUMBER ? `https://wa.me/${env.WHATSAPP_NUMBER}` : null;
  // El nombre y el servicio llegan del formulario PÚBLICO: van escapados, igual
  // que en el resto de los correos. Sin esto, un lead con HTML en el nombre se
  // inyectaba en el cuerpo de la respuesta automática.
  const name = norm.name ? escapeHtmlW(norm.name.split(" ")[0]) : "";
  const svc = norm.service ? ` sobre <strong>${escapeHtmlW(norm.service)}</strong>` : "";
  const waBlock = wa
    ? `<p style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.7;color:#3f454b;margin:0 0 16px;">¿Prefieres adelantar? Escríbenos por WhatsApp: <a href="${wa}" style="color:#009c94;text-decoration:none;font-weight:600;">${wa.replace("https://", "")}</a></p>`
    : "";
  // Mismo template de marca que los correos de estado (cotización/pedido): tarjeta
  // blanca con cabecera, franja turquesa, chip, cuerpo y firma de Andrea.
  const html =
    `<div style="margin:0;padding:0;background:#eef1f4;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;"><tr><td align="center" style="padding:26px 12px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e9ee;box-shadow:0 2px 12px rgba(20,30,40,.06);">` +
    `<tr><td style="background:#ffffff;padding:26px 36px 18px;"><img src="https://dashboard.thelab.solutions/logo-thelab-black.png" width="272" height="25" alt="The Lab Solutions" style="display:block;border:0;outline:none;text-decoration:none;width:272px;height:25px;max-width:74%;" /></td></tr>` +
    `<tr><td style="height:3px;background:#00d4cc;line-height:3px;font-size:0;">&nbsp;</td></tr>` +
    `<tr><td style="padding:26px 36px 30px;">` +
    `<div style="display:inline-block;background:#e7f7f6;color:#00807a;font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:5px 12px;border-radius:20px;">Solicitud recibida</div>` +
    `<div style="font-family:'Montserrat','Helvetica Neue',Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;color:#141719;margin:14px 0 8px;">¡Recibimos tu solicitud!</div>` +
    `<div style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;font-size:16.5px;font-weight:700;color:#2a2f34;margin:0 0 18px;">Hola ${name} 👋</div>` +
    `<p style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.7;color:#3f454b;margin:0 0 16px;">Gracias por escribirnos y por considerar a <strong>The Lab Solutions</strong> para tu proyecto. Recibimos tu solicitud${svc} y ya la estamos revisando.</p>` +
    `<p style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.7;color:#3f454b;margin:0 0 16px;">Te contactaremos en <strong>menos de 24 horas hábiles</strong> con una cotización (material, plazo y precio). Cualquier duda, puedes responder directamente este correo.</p>` +
    waBlock +
    `<div style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.6;color:#3f454b;margin:22px 0 20px;">Un saludo,</div>` +
    FIRMA_ANDREA +
    `<div style="border-top:1px solid #eef1f4;margin:24px 0 0;padding-top:16px;font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;font-size:11px;line-height:1.6;color:#9aa0a6;">Este correo fue enviado por <span style="color:#6b7178;">The Lab Solutions</span> · Fabricación digital · Santiago, Chile<br>¿No esperabas este mensaje? Respóndenos y lo revisamos.</div>` +
    `</td></tr></table></td></tr></table></div>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [norm.email],
        reply_to: "hola@thelab.solutions",
        subject: "Recibimos tu solicitud — The Lab Solutions",
        html,
      }),
    });
  } catch (e) {
    console.error("[leads-worker] auto-reply:", e.message);
  }
}

// Aviso interno cuando un lead NO se pudo guardar en Airtable (cayó al buffer de
// reintentos). Antes esto fallaba en silencio: el lead recibía el "te contactaremos"
// pero no entraba al CRM y nadie se enteraba. Ahora llega el dato completo + el
// motivo exacto del rechazo, para rescatarlo a mano. Best-effort vía Resend.
async function sendLeadSaveFailedAlert(env, norm, reason, opts = {}) {
  if (!env.RESEND_API_KEY) return;
  const from = env.RESEND_FROM || "The Lab Solutions <hola@thelab.solutions>";
  const to = env.LEADS_NOTIFY_TO || "thelabsolutionscl@gmail.com";
  const title = opts.title || "⚠️ Lead NO se guardó en el CRM";
  const intro =
    opts.intro ||
    "Se envió la auto-respuesta al lead, pero <strong>Airtable rechazó el registro</strong>. " +
      "Quedó en el buffer de reintentos (cada hora). <strong>Si no aparece en el CRM en ~1 hora, " +
      "regístralo a mano</strong> con estos datos para no perderlo.";
  const subject =
    opts.subject || `⚠️ Lead NO guardado (rescatar): ${norm.name || norm.email || "sin nombre"}`;
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
    );
  const rows = [
    ["Nombre", norm.name],
    ["Empresa", norm.company],
    ["Email", norm.email],
    ["Teléfono", norm.phone],
    ["Servicio", norm.service],
    ["Mensaje", norm.message],
  ].filter(([, v]) => v);
  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.55;max-width:560px">` +
    `<h2 style="margin:0 0 12px;color:#b00020">${title}</h2>` +
    `<p>${intro}</p>` +
    `<p style="background:#fff3f3;border:1px solid #f3caca;border-radius:8px;padding:8px 12px;color:#a00"><strong>Motivo (Airtable):</strong> ${esc(reason)}</p>` +
    rows.map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(v)}</p>`).join("") +
    `<p style="color:#666;font-size:13px;margin-top:18px">— Worker de leads · The Lab Solutions</p>` +
    `</div>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: norm.email || undefined,
        subject,
        html,
      }),
    });
  } catch (e) {
    console.error("[leads-worker] alerta lead no guardado:", e.message);
  }
}

// Aviso interno de nueva postulación de proveedor. Best-effort vía Resend.
async function sendProveedorNotification(env, p) {
  if (!env.RESEND_API_KEY) return;
  const from = env.RESEND_FROM || "The Lab Solutions <hola@thelab.solutions>";
  const to = env.LEADS_NOTIFY_TO || "thelabsolutionscl@gmail.com";
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
    );
  const rows = [
    ["Proveedor", p.nombre],
    ["Contacto", p.contacto],
    ["Email", p.email],
    ["Teléfono", p.phone],
    ["Categoría / rubro", p.categoria],
    ["Sitio web", p.website],
    ["Productos / servicios", p.productos],
    ["Mensaje", p.message],
  ].filter(([, v]) => v);
  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.55;max-width:560px">` +
    `<h2 style="margin:0 0 12px">Nueva postulación de proveedor — thelab.solutions</h2>` +
    (p.failed
      ? `<p style="color:#b00"><strong>⚠️ No se pudo guardar en Airtable.</strong> Registrar manualmente con estos datos.</p>`
      : `<p>Estado: <strong>ENTREVISTAR</strong> · revísala en la tabla <em>Proveedores</em> del dashboard.</p>`) +
    rows.map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(v)}</p>`).join("") +
    `<p style="color:#666;font-size:13px;margin-top:18px">— Pipeline web · The Lab Solutions</p>` +
    `</div>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: p.email || undefined,
        subject: `Nueva postulación de proveedor: ${p.nombre}`,
        html,
      }),
    });
  } catch (e) {
    console.error("[proveedor] notificación:", e.message);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * Normalizadores de payload por canal → forma interna única
 * ══════════════════════════════════════════════════════════════════════ */
// Sube un adjunto (base64) al campo de attachments del Cliente usando el
// endpoint de contenido de Airtable (acepta el archivo directo, sin URL pública).
// Campo destino: env.ATTACH_FIELD o "Adjuntos". Best-effort: nunca tumba el lead.
async function uploadAttachmentToCliente(env, recordId, att) {
  if (!recordId || !att || !att.data) return;
  try {
    const field = env.ATTACH_FIELD || "Adjuntos";
    const r = await fetch(
      `https://content.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${recordId}/${encodeURIComponent(field)}/uploadAttachment`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentType: att.type || "application/octet-stream",
          file: att.data,
          filename: att.name || "referencia",
        }),
      }
    );
    if (!r.ok) console.error("[leads-worker] uploadAttachment:", r.status, (await r.text()).slice(0, 200));
  } catch (e) {
    console.error("[leads-worker] uploadAttachment:", e.message);
  }
}

function normalizeWeb(b) {
  return {
    name: str(b.name),
    company: str(b.company),
    email: str(b.email),
    phone: str(b.phone),
    jobTitle: str(b.jobTitle),
    service: str(b.service),
    product: str(b.product),
    quantity: str(b.quantity),
    deliveryDate: str(b.deliveryDate),
    budget: str(b.budget),
    urgency: str(b.urgency),
    // Ficha de cliente (web) → columnas reales de Clientes
    rut: str(b.rut),
    industry: str(b.industry),
    tipoCliente: str(b.tipoCliente),
    website: str(b.website),
    region: str(b.region),
    comuna: str(b.comuna),
    address: str(b.address),
    message: str(b.message),
    source: str(b.source) || "web",
    landingUrl: str(b.landingUrl),
    utmSource: str(b.utmSource),
    utmMedium: str(b.utmMedium),
    utmCampaign: str(b.utmCampaign),
    utmTerm: str(b.utmTerm),
    utmContent: str(b.utmContent),
    gclid: str(b.gclid),
    linkedinClickId: str(b.linkedinClickId),
  };
}

function normalizeGoogleAds(b) {
  // Google Lead Form: { lead_id, campaign_id, ..., user_column_data: [{column_id, string_value}] }
  const map = {};
  const cols = Array.isArray(b.user_column_data) ? b.user_column_data : [];
  for (const c of cols) {
    const id = String(c.column_id || c.column_name || "").toLowerCase();
    map[id] = c.string_value ?? c.value ?? "";
  }
  const pick = (...keys) => {
    for (const k of keys) if (map[k]) return map[k];
    return "";
  };
  return {
    name: pick("full_name", "first_name", "name") || str(b.name),
    company: pick("company_name", "company") || str(b.company),
    email: pick("email", "user_email") || str(b.email),
    phone: pick("phone_number", "phone") || str(b.phone),
    jobTitle: pick("job_title"),
    service: pick("service", "what_service") || str(b.service),
    message: pick("message", "comments") || str(b.message),
    source: "google_ads",
    utmCampaign: str(b.campaign_name) || str(b.campaign_id),
    gclid: str(b.gcl_id) || str(b.gclid),
    landingUrl: str(b.landingUrl),
  };
}

function normalizeLinkedin(b) {
  const name = str(b.name) || [str(b.firstName), str(b.lastName)].filter(Boolean).join(" ");
  return {
    name,
    company: str(b.company),
    email: str(b.email),
    phone: str(b.phone),
    jobTitle: str(b.jobTitle),
    service: str(b.service),
    message: str(b.message),
    source: "linkedin",
    campaign: str(b.campaign),
    linkedinCampaignId: str(b.linkedinCampaignId),
    linkedinLeadGenFormId: str(b.linkedinLeadGenFormId),
    linkedinClickId: str(b.linkedinClickId),
    landingUrl: str(b.landingUrl),
    utmCampaign: str(b.campaign),
  };
}

function buildNotes(n) {
  const lines = [];
  if (n.message) lines.push(n.message);
  const meta = [];
  if (n.product) meta.push(`Proyecto: ${n.product}`);
  if (n.quantity) meta.push(`Cantidad: ${n.quantity}`);
  if (n.deliveryDate) meta.push(`Fecha: ${n.deliveryDate}`);
  if (n.budget) meta.push(`Presupuesto: ${n.budget}`);
  if (n.urgency) meta.push(`Urgencia: ${n.urgency}`);
  if (meta.length) lines.push(meta.join(" · "));
  const tracking = [];
  if (n.utmSource) tracking.push(`utm_source=${n.utmSource}`);
  if (n.utmMedium) tracking.push(`utm_medium=${n.utmMedium}`);
  if (n.utmCampaign) tracking.push(`utm_campaign=${n.utmCampaign}`);
  if (n.utmTerm) tracking.push(`utm_term=${n.utmTerm}`);
  if (n.utmContent) tracking.push(`utm_content=${n.utmContent}`);
  if (n.gclid) tracking.push(`gclid=${n.gclid}`);
  if (n.linkedinClickId) tracking.push(`li_fat_id=${n.linkedinClickId}`);
  if (tracking.length) lines.push("Tracking: " + tracking.join(" "));
  if (n.landingUrl) lines.push(`Landing: ${n.landingUrl}`);
  return lines.join("\n");
}

/* ════════════════════════════════════════════════════════════════════════
 * Airtable helpers (tolerantes a campos inexistentes)
 * ══════════════════════════════════════════════════════════════════════ */
async function airtableCreate(env, table, fields) {
  const r = await fetch(
    `${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.AIRTABLE_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields, typecast: true }),
    }
  );
  return r;
}

async function airtableUpdate(env, table, recordId, fields) {
  const r = await fetch(
    `${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}/${recordId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + env.AIRTABLE_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields, typecast: true }),
    }
  );
  if (!r.ok) throw new Error(await airtableErr(r));
  return await r.json();
}

// Busca un Cliente existente por email o teléfono (dedupe). Best-effort.
async function airtableFindCliente(env, { email, phone }) {
  const esc = (s) => String(s).replace(/'/g, "\\'");
  const clauses = [];
  if (email) clauses.push(`LOWER({Email})=LOWER('${esc(email)}')`);
  const phoneDigits = phone ? String(phone).replace(/[^0-9]/g, "") : "";
  if (phoneDigits)
    clauses.push(`REGEX_REPLACE({Teléfono} & "", "[^0-9]", "") = '${phoneDigits}'`);
  if (!clauses.length) return null;
  const formula = clauses.length > 1 ? `OR(${clauses.join(",")})` : clauses[0];
  const url =
    `${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent("Clientes")}` +
    `?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
  // Reintenta ante rate-limit / transitorio: un blip acá haría que se cree un
  // Cliente DUPLICADO en vez de actualizar el existente. Best-effort (null si no se pudo).
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, {
        headers: { Authorization: "Bearer " + env.AIRTABLE_TOKEN },
      });
      if (r.ok) {
        const data = await r.json();
        return data?.records?.[0]?.id || null;
      }
      if (r.status === 429 || r.status >= 500) {
        await sleep(300 * (i + 1));
        continue;
      }
      return null; // 4xx no transitorio (formula/permiso): no insistir
    } catch (_) {
      await sleep(300 * (i + 1));
    }
  }
  console.error("[leads-worker] dedup Clientes: sin respuesta tras reintentos");
  return null;
}

// Espera breve para el backoff de reintentos ante errores transitorios de Airtable.
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Crea reintentando: descarta campos que Airtable rechaza (desconocidos o inválidos)
// y reintenta con backoff ante rate-limit / errores transitorios (429 / 5xx).
async function airtableCreateTolerant(env, table, fields, maxTries = 8) {
  let f = { ...fields };
  for (let i = 0; i < maxTries; i++) {
    const r = await airtableCreate(env, table, f);
    if (r.ok) return await r.json();
    if (r.status === 429 || r.status >= 500) {
      await sleep(300 * (i + 1)); // rate-limit / transitorio → esperar y reintentar
      continue;
    }
    const bad = await unknownFieldFrom(r);
    if (bad && bad in f) {
      delete f[bad];
      continue;
    }
    throw new Error(await airtableErr(r));
  }
  throw new Error(`Airtable: reintentos agotados creando en ${table}`);
}

async function airtableUpdateTolerant(env, table, recordId, fields, maxTries = 8) {
  let f = { ...fields };
  if (Object.keys(f).length === 0) return null;
  for (let i = 0; i < maxTries; i++) {
    const r = await fetch(
      `${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}/${recordId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + env.AIRTABLE_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields: f, typecast: true }),
      }
    );
    if (r.ok) return await r.json();
    if (r.status === 429 || r.status >= 500) {
      await sleep(300 * (i + 1)); // rate-limit / transitorio → esperar y reintentar
      continue;
    }
    const bad = await unknownFieldFrom(r);
    if (bad && bad in f) {
      delete f[bad];
      if (Object.keys(f).length === 0) return null;
      continue;
    }
    throw new Error(await airtableErr(r));
  }
  return null;
}

async function unknownFieldFrom(r) {
  const data = await r.clone().json().catch(() => null);
  const msg = data?.error?.message || "";
  // Devuelve el nombre de un campo que conviene descartar y reintentar sin él, para
  // no perder el registro completo por un solo campo problemático. Cubre:
  //  - "Unknown field name: \"X\""          → el campo no existe en la base
  //  - "Field \"X\" cannot accept ..."       → valor/tipo inválido o campo computado
  //  - "... for field \"X\""                 → no se pudo parsear el valor de X
  // Los errores sin nombre de campo (p. ej. rate-limit 429) devuelven null → se
  // relanzan y el lead va al buffer de reintentos (no se descarta ningún dato).
  const m =
    msg.match(/Unknown field name:?\s*"?([^"]+)"?/i) ||
    msg.match(/Field\s+"([^"]+)"\s+cannot/i) ||
    msg.match(/for field\s+"([^"]+)"/i);
  return m ? m[1] : null;
}

async function airtableErr(r) {
  const data = await r.json().catch(() => ({}));
  return `Airtable ${r.status}: ${data?.error?.message || data?.error?.type || "error"}`;
}

/* ════════════════════════════════════════════════════════════════════════
 * Anti-bot / utilidades
 * ══════════════════════════════════════════════════════════════════════ */
async function verifyTurnstile(secret, token, request) {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);
  const r = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form }
  );
  const data = await r.json().catch(() => ({}));
  return !!data.success;
}

// Rate-limit por IP usando KV opcional (binding env.RL). Sin KV → no limita.
async function rateLimited(env, request, scope, max, windowSec) {
  if (!env.RL) return false;
  const ip = request.headers.get("CF-Connecting-IP") || "anon";
  const key = `${scope}:${ip}`;
  const cur = parseInt((await env.RL.get(key)) || "0", 10);
  if (cur >= max) return true;
  await env.RL.put(key, String(cur + 1), { expirationTtl: windowSec });
  return false;
}

// Tope diario de auto-procesamiento (guardrail de costo de Claude). Requiere KV (RL).
async function autoProcessAllowed(env) {
  if (!env.RL) return true;
  const cap = parseInt(env.AUTO_PROCESS_DAILY_CAP || "200", 10);
  // El día del tope es el día de Chile: con UTC el contador se reiniciaba a las
  // 20:00 hora local, en plena tarde de trabajo, y no al empezar la jornada.
  const key = `autoproc:${today()}`;
  const cur = parseInt((await env.RL.get(key)) || "0", 10);
  if (cur >= cap) return false;
  await env.RL.put(key, String(cur + 1), { expirationTtl: 172800 });
  return true;
}

// ── Dead-letter: nunca perder un lead si Airtable falla ──────────────────
async function bufferDeadLetter(env, item) {
  if (!env.RL) return;
  try {
    const key = `dl:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await env.RL.put(key, JSON.stringify(item), { expirationTtl: 604800 }); // 7 días
  } catch (_) {}
}

async function retryDeadLetters(env) {
  if (!env.RL || !env.AIRTABLE_TOKEN) return;
  const { keys } = await env.RL.list({ prefix: "dl:" });
  for (const k of keys) {
    const raw = await env.RL.get(k.name);
    if (!raw) continue;
    let item;
    try {
      item = JSON.parse(raw);
    } catch {
      await env.RL.delete(k.name);
      continue;
    }
    const { norm, agente, evento, source, campaign } = item;
    try {
      let clienteId = await airtableFindCliente(env, {
        email: norm.email,
        phone: norm.phone,
      });
      if (!clienteId) {
        const cliente = await airtableCreateTolerant(
          env,
          "Clientes",
          buildClienteFields(norm, source)
        );
        clienteId = cliente?.id || null;
      }
      await airtableCreateTolerant(
        env,
        "Agent_Queue",
        stripEmpty({
          Evento: evento,
          Entidad: "Cliente",
          "ID entidad": clienteId,
          Agente: agente,
          Estado: "Pendiente",
          Prioridad: source === "google_ads" ? "Alta" : "Media",
          "Input JSON": JSON.stringify(norm).slice(0, 95000),
          Source: source,
          Campaign: campaign,
          "Fecha creación": new Date().toISOString(),
        })
      );
      await env.RL.delete(k.name); // recuperado → fuera del buffer
    } catch (_) {
      /* sigue en buffer para el próximo intento */
    }
  }
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = allowed.includes(origin) ? origin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Public-Lead-Key, X-Portal-Admin-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function timingSafeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (_) {
    return null;
  }
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function safeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch (_) {}
  }
  return null;
}

const str = (v) => (v == null ? "" : String(v).trim());
const isRecId = (v) => /^rec[A-Za-z0-9]{14}$/.test(String(v || ""));
// Fecha calendario en horario de Chile (America/Santiago). new Date().toISOString()
// devuelve UTC y estampa el día siguiente en acciones de tarde-noche (UTC-4/-3),
// descuadrando reportes mensuales cuando el cambio de día UTC cruza fin de mes.
const today = () => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date()); }
  catch (_) { return new Date().toISOString().slice(0, 10); }
};
const numOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
function stripEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

// ── Latido a la tabla Automations (Oficina Virtual) ──────────────────────
// Marca la fila ID=<id> como "Activo" con la hora actual, máx. 1 vez cada
// 5 min (throttle por isolate). Best-effort: si la tabla/fila no existen,
// no hace nada. Se invoca con ctx.waitUntil para no añadir latencia.
let _ofLastBeat = 0;
async function ofHeartbeat(env, id) {
  const now = Date.now();
  if (now - _ofLastBeat < 5 * 60 * 1000) return;
  _ofLastBeat = now;
  const tbl = `${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent("Automations")}`;
  const auth = { Authorization: "Bearer " + env.AIRTABLE_TOKEN };
  const q = `${tbl}?maxRecords=1&filterByFormula=${encodeURIComponent(`{ID}='${id}'`)}`;
  const found = await fetch(q, { headers: auth });
  if (!found.ok) return;
  const data = await found.json();
  const rec = data.records && data.records[0];
  if (!rec) return;
  const f = rec.fields || {};
  const sameDay = f.UltimaEjecucion && new Date(f.UltimaEjecucion).toDateString() === new Date().toDateString();
  const ej = (sameDay ? (Number(f.EjecucionesHoy) || 0) : 0) + 1;
  await fetch(`${tbl}/${rec.id}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: { Estado: "Activo", UltimaEjecucion: new Date().toISOString(), EjecucionesHoy: ej },
      typecast: true,
    }),
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * PILOTO AUTOMÁTICO GOOGLE ADS (semanal, con aprobación por email)
 *
 * Cron (lunes) → lee señales (ventas por línea, capacidad de producción,
 * campañas desde el endpoint del Script 1) → Claude propone ajustes →
 * guardrails duros filtran → guarda la propuesta en Agent_Queue (Pendiente)
 * → email con botones Aprobar / Rechazar → al aprobar, las mutaciones se
 * encolan en el Script 1 y el Script 2 las aplica en Google Ads.
 *
 * Config (wrangler.toml / secrets):
 *   ADS_AUTOPILOT=true            interruptor maestro
 *   ADS_ENDPOINT=<URL Script 1>   lectura de campañas + cola de mutaciones
 *   ADS_SCRIPT_SECRET             secret del Script 1 (default thelab2025)
 *   ADS_APPROVAL_SECRET           firma los links de aprobación (fallback PUBLIC_LEAD_KEY)
 *   ADS_AUTOPILOT_EMAIL           destinatario (fallback LEADS_NOTIFY_TO)
 *   WORKER_PUBLIC_URL             URL pública del worker (para los links del email)
 * Kill-switch sin deploy: registro "ADS_AUTOPILOT" en Monitor Sistema con
 * Notes = {"enabled":false}. Ahí también se pueden ajustar los límites.
 * ══════════════════════════════════════════════════════════════════════ */

// Las 9 líneas: nombre visible (= "Servicio interés" en Clientes), términos para
// matchear campañas por nombre, y plantilla para crear campaña si falta cobertura.
const AP_LINEAS = [
  { slug: "chip-the-lab", nombre: "Chip The Lab", match: ["nfc", "chip"], presupuesto: 3000,
    kws: ["tarjetas nfc", "tarjeta de presentacion nfc", "tarjetas nfc empresa", "tarjeta digital nfc"],
    titulos: ["Tarjetas NFC", "Tarjeta Digital NFC", "NFC para Empresas", "The Lab Solutions"],
    descs: ["Tarjetas de presentación NFC personalizadas: comparte tu contacto al tocar.", "Tarjetas inteligentes NFC para tu equipo. Cotiza las tuyas online."] },
  { slug: "impresion-3d", nombre: "Impresión 3D", match: ["3d"], presupuesto: 8000,
    kws: ["impresión 3d santiago", "servicio de impresion 3d", "piezas 3d a medida", "prototipo 3d"],
    titulos: ["Impresión 3D en Santiago", "Piezas y Prototipos 3D", "Impresión 3D a Medida", "The Lab Solutions"],
    descs: ["Impresión 3D profesional: piezas, prototipos y repuestos a medida.", "Llevamos tu idea a una pieza real. Cotiza tu proyecto 3D en Santiago."] },
  { slug: "premiaciones", nombre: "Premiaciones", match: ["premiacion", "trofeo", "galvano", "medalla"], presupuesto: 6000,
    kws: ["galvanos personalizados", "trofeos corporativos", "medallas personalizadas", "premios para empresa"],
    titulos: ["Galvanos y Trofeos", "Premiaciones Corporativas", "Trofeos Personalizados", "The Lab Solutions"],
    descs: ["Galvanos, trofeos y medallas personalizados para premiar a tu equipo.", "Fabricación a medida para tu premiación. Cotiza online."] },
  { slug: "volumetricos", nombre: "Volumétricos", match: ["volumetric", "corpore", "neon", "neón"], presupuesto: 5000,
    kws: ["letras corporeas", "letrero neon led", "logo corporeo", "letreros luminosos led"],
    titulos: ["Letras Corpóreas y Neón", "Volumétricos a Medida", "Letreros Neón LED", "The Lab Solutions"],
    descs: ["Letras corpóreas, logos 3D y neón LED personalizados para tu marca.", "Volumétricos y estructuras para oficina o evento. Cotiza a medida."] },
  { slug: "carteleria", nombre: "Cartelería", match: ["carteler", "señalet", "senalet", "letrero", "acril"], presupuesto: 6000,
    kws: ["señaletica corporativa", "letrero acrilico", "señalizacion empresa", "placas acrilico"],
    titulos: ["Cartelería y Señalética", "Señalética en Acrílico", "Letreros para Empresas", "The Lab Solutions"],
    descs: ["Cartelería y señalética corporativa en acrílico con corte láser.", "Letreros, rótulos y placas a medida para tu empresa. Cotiza online."] },
  { slug: "activaciones", nombre: "Activaciones", match: ["activacion", "activación", "btl"], presupuesto: 6000,
    kws: ["activaciones de marca", "activaciones btl", "stands para activacion", "activacion marca santiago"],
    titulos: ["Activaciones de Marca", "Activaciones BTL a Medida", "Producción de Activaciones", "The Lab Solutions"],
    descs: ["Activaciones de marca y BTL producidas end-to-end para tu campaña o evento.", "Diseño, fabricación y montaje. Cotiza tu activación en Santiago."] },
  { slug: "merchandising", nombre: "Merchandising", match: ["merch", "regalo", "promocional"], presupuesto: 6000,
    kws: ["merchandising corporativo", "regalos corporativos", "articulos promocionales", "regalos corporativos por mayor"],
    titulos: ["Merchandising Corporativo", "Regalos Corporativos", "Artículos Promocionales", "The Lab Solutions"],
    descs: ["Merchandising y regalos corporativos personalizados para tu marca.", "Kits, artículos promocionales y packs por mayor. Cotiza para tu empresa."] },
  { slug: "cajas-personalizadas", nombre: "Cajas Personalizadas", match: ["caja", "packaging"], presupuesto: 4000,
    kws: ["cajas personalizadas", "packaging personalizado", "packaging corporativo", "cajas con logo empresa"],
    titulos: ["Cajas Personalizadas", "Packaging a Medida", "Cajas con tu Logo", "The Lab Solutions"],
    descs: ["Cajas y packaging personalizados para regalo o producto corporativo.", "Diseño y fabricación de cajas a medida con tu marca. Cotiza online."] },
  { slug: "papeleria", nombre: "Papelería", match: ["papeler", "imprenta", "tarjeta", "membrete"], presupuesto: 3000,
    kws: ["papeleria corporativa", "tarjetas de presentacion", "imprenta corporativa", "membrete personalizado"],
    titulos: ["Papelería Corporativa", "Tarjetas y Membretes", "Imprenta para Empresas", "The Lab Solutions"],
    descs: ["Papelería corporativa: tarjetas, membretes, sellos y carpetas.", "Imagen profesional para tu empresa. Cotiza tu papelería online."] },
];

const AP_DEFAULTS = {
  maxChangePct: 0.3,     // cambio máx de presupuesto por semana
  capTotalDiario: 60000, // tope de presupuesto diario total (CLP) tras los cambios
  minConv: 8,            // bajo esto no se toman decisiones agresivas
  cpaSano: 8000,         // CLP — no pausar campañas con CPA bajo esto
  maxAcciones: 6,
  maxCrear: 1,
  presupuestoNuevoMax: 10000, // CLP/día máx para una campaña creada por el piloto
};

function apNorm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Asigna cada campaña a lo más una línea (prioridad = orden de AP_LINEAS)
function apMatchCampaigns(campanas) {
  const porLinea = {}; const usadas = new Set();
  for (const l of AP_LINEAS) {
    for (const c of campanas || []) {
      if (usadas.has(c.id)) continue;
      const n = apNorm(c.nombre);
      if (l.match.some((t) => n.includes(apNorm(t)))) { porLinea[l.slug] = c; usadas.add(c.id); break; }
    }
  }
  return porLinea;
}

async function apAirtableList(env, table, params = {}) {
  const q = new URLSearchParams();
  if (params.filterByFormula) q.set("filterByFormula", params.filterByFormula);
  (params.fields || []).forEach((f) => q.append("fields[]", f));
  q.set("pageSize", "100");
  let all = [], offset = null;
  do {
    const url = `${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?${q.toString()}${offset ? "&offset=" + encodeURIComponent(offset) : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
    if (!r.ok) throw new Error(`Airtable ${table} ${r.status}`);
    const d = await r.json();
    all = all.concat(d.records || []);
    offset = d.offset || null;
  } while (offset && all.length < (params.maxRecords || 2000));
  return all;
}

async function apHmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Huella corta de las mutaciones: va dentro de la firma del link de aprobación,
// así un token no puede aplicar un payload distinto al que se propuso (TOCTOU).
async function apMutHash(mutaciones) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(mutaciones || [])));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Config editable sin deploy: Monitor Sistema → registro Name="ADS_AUTOPILOT",
// Notes = JSON {enabled, maxChangePct, capTotalDiario, minConv, cpaSano, email}
async function apLoadConfig(env) {
  const cfg = { ...AP_DEFAULTS, enabled: true, email: env.ADS_AUTOPILOT_EMAIL || env.LEADS_NOTIFY_TO || "thelabsolutionscl@gmail.com" };
  try {
    const recs = await apAirtableList(env, "Monitor Sistema", {
      filterByFormula: `{Name}='ADS_AUTOPILOT'`, maxRecords: 1,
    });
    if (recs[0]?.fields?.Notes) Object.assign(cfg, JSON.parse(recs[0].fields.Notes));
  } catch (e) { /* sin config remota → defaults */ }
  return cfg;
}

// ── Señales por línea: leads, ingresos, ocupación, campaña asociada ──────
async function apGatherSignals(env) {
  const DAYS = 28;
  const cutoff = new Date(Date.now() - DAYS * 86400000);

  // Campañas (cache del Script 1)
  const adsRes = await fetch(`${env.ADS_ENDPOINT}?days=30`);
  const ads = await adsRes.json().catch(() => null);
  if (!ads || ads.ok === false || !Array.isArray(ads.campanas)) {
    throw new Error("Sin datos de campañas en el endpoint (ejecuta el Script 2 primero)");
  }

  const [clientes, pedidos, maquinas, eventos] = await Promise.all([
    apAirtableList(env, "Clientes", { fields: ["Servicio interés"] }),
    apAirtableList(env, "Pedidos", { fields: ["Estado pedido", "Monto total (CLP)", "Cliente"] }),
    apAirtableList(env, "Maquinas", { fields: ["id", "modelo", "estado"] }).catch(() => []),
    apAirtableList(env, "Maquinas_Eventos", {
      fields: ["maquina_id", "fecha", "tipo"],
      filterByFormula: `IS_AFTER({fecha}, DATEADD(TODAY(), -8, 'days'))`,
    }).catch(() => []),
  ]);

  const servicioDeCliente = {};
  clientes.forEach((c) => { servicioDeCliente[c.id] = apNorm(c.fields?.["Servicio interés"]); });

  // Ocupación 3D: slots de máquinas FDM esta semana (mismo cálculo del dashboard)
  const ids3d = maquinas.filter((m) => ["K1", "K2", "K2 Plus", "Ender-5 Max", "Giga"].includes(m.fields?.modelo)).map((m) => m.fields?.id).filter(Boolean);
  const enMantGlobal = maquinas.filter((m) => ["K1", "K2", "K2 Plus", "Ender-5 Max", "Giga"].includes(m.fields?.modelo) && m.fields?.estado === "mantencion").length;
  const slots = Math.max(ids3d.length * 5 - enMantGlobal * 5, 1);
  let enUso3d = 0;
  eventos.forEach((e) => { if (e.fields?.tipo === "uso" && ids3d.includes(e.fields?.maquina_id)) enUso3d++; });
  const occ3d = ids3d.length ? Math.min(Math.round((enUso3d / slots) * 100), 100) : null;

  // Ocupación general: pedidos activos (proxy, igual que el dashboard)
  const activos = pedidos.filter((p) => !["Despachado", "Cancelado"].includes(p.fields?.["Estado pedido"] || "")).length;
  const occGeneral = Math.min(Math.round((activos / 20) * 100), 100);

  const porLinea = apMatchCampaigns(ads.campanas);
  const lineas = AP_LINEAS.map((l) => {
    const nombreNorm = apNorm(l.nombre);
    const leads28 = clientes.filter((c) => {
      const d = c.createdTime ? new Date(c.createdTime) : null;
      return d && d >= cutoff && apNorm(c.fields?.["Servicio interés"]) === nombreNorm;
    }).length;
    let revenue28 = 0, pedidos28 = 0;
    pedidos.forEach((p) => {
      const f = p.fields || {};
      if ((f["Estado pedido"] || "") === "Cancelado") return;
      const d = p.createdTime ? new Date(p.createdTime) : null;
      if (!d || d < cutoff) return;
      const cid = Array.isArray(f.Cliente) ? f.Cliente[0] : null;
      if (cid && servicioDeCliente[cid] === nombreNorm) {
        revenue28 += Math.round((f["Monto total (CLP)"] || 0) / 1.19);
        pedidos28++;
      }
    });
    const camp = porLinea[l.slug] || null;
    return {
      slug: l.slug, nombre: l.nombre,
      ocupacion: l.slug === "impresion-3d" && occ3d != null ? occ3d : occGeneral,
      leads28, revenue28, pedidos28,
      camp: camp ? {
        id: String(camp.id), nombre: camp.nombre, estado: camp.estado,
        presupuesto: camp.presupuesto || 0, gasto: camp.gasto || 0,
        clics: camp.clics || 0, conversiones: camp.conversiones || 0,
      } : null,
    };
  });

  return { lineas, totals: { gasto: ads.gasto || 0, conversiones: ads.conversiones || 0, activos, occGeneral, occ3d }, guardado: ads.guardado };
}

// ── Guardrails duros (puros, testeables) ─────────────────────────────────
export function applyAutopilotGuardrails(acciones, lineas, cfg) {
  const c = { ...AP_DEFAULTS, ...cfg };
  const porSlug = {}; lineas.forEach((l) => { porSlug[l.slug] = l; });
  const aprobadas = [], descartadas = [];
  let creadas = 0;
  const lineasTocadas = new Set(); // una sola acción por línea por semana (evita contradicciones)
  const desc = (a, motivo) => descartadas.push({ ...a, descarte: motivo });

  for (const a0 of Array.isArray(acciones) ? acciones : []) {
    if (aprobadas.length >= c.maxAcciones) { desc(a0, "tope de acciones por semana"); continue; }
    const a = { ...a0, tipo: apNorm(a0.tipo) };
    const linea = porSlug[a.linea];
    if (!linea) { desc(a, "línea desconocida"); continue; }
    if (lineasTocadas.has(a.linea)) { desc(a, "ya hay una acción sobre esta línea"); continue; }
    const camp = linea.camp;

    if (a.tipo === "presupuesto") {
      if (!camp || !camp.id) { desc(a, "sin campaña asociada"); continue; }
      const old = camp.presupuesto || 0;
      let nuevo = Math.round(Number(a.nuevo) || 0);
      if (nuevo < 1000) { desc(a, "presupuesto bajo el mínimo"); continue; }
      if (old > 0) {
        const lo = Math.round(old * (1 - c.maxChangePct)), hi = Math.round(old * (1 + c.maxChangePct));
        nuevo = Math.min(Math.max(nuevo, lo), hi);
      } else if (nuevo > c.presupuestoNuevoMax) nuevo = c.presupuestoNuevoMax;
      if (nuevo === old) { desc(a, "sin cambio tras aplicar límites"); continue; }
      if (nuevo > old && linea.ocupacion >= 85) { desc(a, "línea saturada — no escalar"); continue; }
      if (nuevo > old && (camp.conversiones || 0) < 1 && linea.leads28 < 3) { desc(a, "sin señal de conversión para escalar"); continue; }
      aprobadas.push({ ...a, nuevo, anterior: old, id: camp.id, campana: camp.nombre }); lineasTocadas.add(a.linea);

    } else if (a.tipo === "pausar") {
      if (!camp || !camp.id) { desc(a, "sin campaña asociada"); continue; }
      if (camp.estado !== "ENABLED") { desc(a, "ya está pausada"); continue; }
      const cpa = camp.conversiones > 0 ? camp.gasto / camp.conversiones : Infinity;
      const rentableGoogle = camp.conversiones >= c.minConv && cpa < c.cpaSano;
      // ROAS-real (proxy): ingresos CRM de la línea vs gasto de la campaña — manda sobre el CPA de Google
      const rentableCRM = camp.gasto > 0 && (linea.revenue28 || 0) / camp.gasto >= 1.5;
      if ((rentableGoogle || rentableCRM) && linea.ocupacion < 85) {
        desc(a, "campaña rentable — no pausar"); continue;
      }
      aprobadas.push({ ...a, id: camp.id, campana: camp.nombre }); lineasTocadas.add(a.linea);

    } else if (a.tipo === "activar") {
      if (!camp || !camp.id) { desc(a, "sin campaña asociada"); continue; }
      if (camp.estado === "ENABLED") { desc(a, "ya está activa"); continue; }
      if (linea.ocupacion >= 65) { desc(a, "carga alta — no reactivar"); continue; }
      aprobadas.push({ ...a, id: camp.id, campana: camp.nombre }); lineasTocadas.add(a.linea);

    } else if (a.tipo === "crear") {
      if (camp) { desc(a, "la línea ya tiene campaña"); continue; }
      if (creadas >= c.maxCrear) { desc(a, "tope de campañas nuevas por semana"); continue; }
      if (linea.ocupacion >= 65) { desc(a, "carga alta — no abrir demanda"); continue; }
      creadas++;
      aprobadas.push({ ...a, campana: a.campana || `Búsqueda - ${linea.nombre}` }); lineasTocadas.add(a.linea);

    } else desc(a, "tipo de acción no permitido");
  }

  // Tope de presupuesto diario total tras los cambios
  const budgets = {};
  lineas.forEach((l) => { if (l.camp && l.camp.estado === "ENABLED") budgets[l.camp.id] = l.camp.presupuesto || 0; });
  const proyectar = () => {
    const b = { ...budgets };
    let extra = 0;
    for (const a of aprobadas) {
      if (a.tipo === "presupuesto") b[a.id] = a.nuevo;
      else if (a.tipo === "pausar") delete b[a.id];
      else if (a.tipo === "activar") b[a.id] = porSlug[a.linea]?.camp?.presupuesto || 0;
      else if (a.tipo === "crear") extra += porSlug[a.linea] ? (AP_LINEAS.find((x) => x.slug === a.linea)?.presupuesto || 0) : 0;
    }
    return Object.values(b).reduce((s, v) => s + v, 0) + extra;
  };
  while (proyectar() > c.capTotalDiario) {
    const i = aprobadas.map((a, idx) => ({ a, idx }))
      .filter(({ a }) => a.tipo === "crear" || a.tipo === "activar" || (a.tipo === "presupuesto" && a.nuevo > (a.anterior || 0)))
      .pop();
    if (!i) break;
    desc(aprobadas[i.idx], "tope de gasto diario total");
    aprobadas.splice(i.idx, 1);
  }

  return { aprobadas, descartadas };
}

// Acciones aprobadas → mutaciones del Script 1/2 (se guardan junto a la propuesta)
function apBuildMutations(aprobadas) {
  const ts = () => new Date().toISOString();
  return aprobadas.map((a) => {
    if (a.tipo === "presupuesto") return { op: "edit", id: a.id, data: { presupuesto: a.nuevo }, timestamp: ts(), status: "pending" };
    if (a.tipo === "pausar") return { op: "edit", id: a.id, data: { estado: "PAUSED" }, timestamp: ts(), status: "pending" };
    if (a.tipo === "activar") return { op: "edit", id: a.id, data: { estado: "ENABLED" }, timestamp: ts(), status: "pending" };
    if (a.tipo === "crear") {
      const l = AP_LINEAS.find((x) => x.slug === a.linea);
      return { op: "create", id: "", timestamp: ts(), status: "pending", data: {
        nombre: a.campana, presupuesto: l.presupuesto, estado: "ENABLED", tipo: "SEARCH",
        concordancia: "FRASE", maxCpc: 800, pujaEstrategia: "MAXIMIZE_CLICKS",
        palabrasClave: l.kws,
        negativas: ["empleo", "trabajo", "gratis", "curso", "como hacer", "plantilla", "pdf", "usado"],
        anuncio: { finalUrl: `https://thelab.solutions/servicios/${l.slug}`, titulos: l.titulos, descripciones: l.descs },
      } };
    }
    return null;
  }).filter(Boolean);
}

// ── Corrida semanal ──────────────────────────────────────────────────────
async function adsAutopilotRun(env, { force = false } = {}) {
  if (!force && env.ADS_AUTOPILOT !== "true") return { skipped: "ADS_AUTOPILOT desactivado" };
  if (!env.ADS_ENDPOINT) return { skipped: "falta ADS_ENDPOINT" };
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return { skipped: "falta Airtable" };
  if (!env.ANTHROPIC_API_KEY) return { skipped: "falta ANTHROPIC_API_KEY" };

  const cfg = await apLoadConfig(env);
  if (cfg.enabled === false && !force) return { skipped: "kill-switch en Monitor Sistema" };

  const { lineas, totals, guardado } = await apGatherSignals(env);
  if (guardado && Date.now() - new Date(guardado).getTime() > 3 * 86400000) {
    await apSendEmail(env, cfg.email, "⚠ Piloto Ads: datos desactualizados",
      `<p>Los datos de Google Ads tienen más de 3 días (última sync: ${guardado}). Ejecuta el Script 2 en Google Ads y vuelve a correr el piloto.</p>`);
    return { skipped: "datos de campañas desactualizados" };
  }

  const sys = `Eres el piloto automático de Google Ads de The Lab Solutions (fabricación digital B2B, Santiago de Chile).
Cada semana ajustas los presupuestos de campañas de búsqueda según DEMANDA real (leads e ingresos del CRM por línea) y CAPACIDAD de producción.
REGLAS:
- Sube presupuesto (máx +30%) solo si la línea tiene demanda (leads/ventas), la campaña convierte y la ocupación es <65%.
- Baja presupuesto o pausa si la línea está saturada (ocupación >=85%) o la campaña gasta sin convertir.
- Con <8 conversiones no tomes decisiones agresivas, salvo gasto alto con 0 conversiones.
- Propón "crear" SOLO si una línea con demanda clara (leads28 >= 3) no tiene campaña y su ocupación es <65%.
- Máximo 6 acciones. Si no hay nada claro que hacer, devuelve acciones: [].
Responde SOLO un objeto JSON: {"resumen":"<2-3 líneas del razonamiento>","acciones":[{"tipo":"presupuesto|pausar|activar|crear","linea":"<slug>","nuevo":<CLP entero o null>,"motivo":"<corto, con números>"}]}`;

  const user = `SEÑALES (últimos 28 días, ocupación = semana actual):\n` +
    lineas.map((l) => `- ${l.slug} (${l.nombre}): leads=${l.leads28} · pedidos=${l.pedidos28} · ingresos_neto=$${l.revenue28.toLocaleString("es-CL")} · ocupación=${l.ocupacion}%` +
      (l.camp ? ` · campaña="${l.camp.nombre}" [${l.camp.estado}] ppto=$${l.camp.presupuesto}/día gasto=$${Math.round(l.camp.gasto)} conv=${l.camp.conversiones}` : " · SIN CAMPAÑA")).join("\n") +
    `\nTOTALES: gasto=$${Math.round(totals.gasto)} · conversiones=${totals.conversiones} · pedidos activos=${totals.activos} · tope diario total=$${cfg.capTotalDiario}`;

  const raw = await callClaude(env, sys, user, { maxTokens: 2000, model: env.ADS_AUTOPILOT_MODEL || undefined });
  let prop = null;
  try { prop = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch (e) { /* abajo */ }
  if (!prop || !Array.isArray(prop.acciones)) return { skipped: "respuesta IA inválida" };

  const { aprobadas, descartadas } = applyAutopilotGuardrails(prop.acciones, lineas, cfg);

  if (!aprobadas.length) {
    await apSendEmail(env, cfg.email, "Piloto Ads semanal — sin cambios",
      `<p>${prop.resumen ? escHtml(prop.resumen) : "Sin acciones recomendadas esta semana."}</p>` +
      (descartadas.length ? `<p style="color:#888;font-size:13px">Descartadas por guardrails: ${descartadas.map((d) => `${escHtml(d.tipo)} ${escHtml(d.linea)} (${escHtml(d.descarte)})`).join(" · ")}</p>` : ""));
    return { ok: true, acciones: 0, descartadas: descartadas.length };
  }

  const mutaciones = apBuildMutations(aprobadas);

  // Propuesta → Agent_Queue (Pendiente) para aprobar desde email o dashboard
  const rec = await airtableCreateTolerant(env, "Agent_Queue", stripEmpty({
    Evento: "ads.autopilot_proposal",
    Entidad: "GoogleAds",
    Agente: "ADS_AUTOPILOT",
    Estado: "Pendiente",
    Prioridad: "Alta",
    "Input JSON": JSON.stringify({ lineas, totals }).slice(0, 95000),
    Output: JSON.stringify({ resumen: prop.resumen || "", acciones: aprobadas, mutaciones, descartadas }).slice(0, 95000),
    Source: "autopilot",
    "Fecha creación": new Date().toISOString(),
  }));
  const recId = rec?.id;

  // Email con botones Aprobar / Rechazar. Los links van firmados con
  // ADS_APPROVAL_SECRET (sin fallback a claves públicas) e incluyen la huella
  // del payload: si las mutaciones cambian después, el link deja de servir.
  const base = (env.WORKER_PUBLIC_URL || "").replace(/\/$/, "");
  const secret = env.ADS_APPROVAL_SECRET || "";
  let botones = `<p style="color:#888">Aprueba o rechaza desde el dashboard → Web → Google Ads → Piloto automático.</p>`;
  if (base && secret && recId) {
    const mh = await apMutHash(mutaciones);
    const tA = await apHmacHex(secret, `${recId}:approve:${mh}`);
    const tR = await apHmacHex(secret, `${recId}:reject:${mh}`);
    botones =
      `<p style="margin:20px 0">` +
      `<a href="${base}/ads/decision?id=${recId}&a=approve&t=${tA}" style="background:#0a7d5c;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600">✓ Aprobar y aplicar</a>` +
      `&nbsp;&nbsp;<a href="${base}/ads/decision?id=${recId}&a=reject&t=${tR}" style="background:#555;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none">✗ Rechazar</a></p>` +
      `<p style="color:#888;font-size:12px">También puedes revisarla en el dashboard → Web → Google Ads → Piloto automático.</p>`;
  }
  const filas = aprobadas.map((a) => {
    const det = a.tipo === "presupuesto" ? `$${(a.anterior || 0).toLocaleString("es-CL")} → <strong>$${a.nuevo.toLocaleString("es-CL")}</strong>/día` : a.tipo;
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${escHtml(a.linea)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${escHtml(a.campana || "")}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${det}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">${escHtml(a.motivo || "")}</td></tr>`;
  }).join("");
  await apSendEmail(env, cfg.email, `Piloto Ads semanal — ${aprobadas.length} cambio(s) propuesto(s)`,
    `<p>${escHtml(prop.resumen || "")}</p>` +
    `<table style="border-collapse:collapse;font-size:13px;width:100%"><tr><th style="text-align:left;padding:6px 10px">Línea</th><th style="text-align:left;padding:6px 10px">Campaña</th><th style="text-align:left;padding:6px 10px">Cambio</th><th style="text-align:left;padding:6px 10px">Motivo</th></tr>${filas}</table>` +
    (descartadas.length ? `<p style="color:#888;font-size:12px;margin-top:10px">Descartadas por guardrails: ${descartadas.map((d) => `${escHtml(d.tipo)} ${escHtml(d.linea)} (${escHtml(d.descarte)})`).join(" · ")}</p>` : "") +
    botones +
    `<p style="color:#aaa;font-size:11px">Nada se aplica sin tu aprobación. Los cambios aprobados se ejecutan en Google Ads en la próxima corrida del Script 2 (cada hora).</p>`);

  return { ok: true, acciones: aprobadas.length, descartadas: descartadas.length, queueId: recId };
}

function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;");
}

async function apSendEmail(env, to, subject, htmlBody) {
  if (!env.RESEND_API_KEY || !to) return;
  const from = env.RESEND_FROM || "The Lab Solutions <hola@thelab.solutions>";
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject,
        html: `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.55;max-width:640px">` +
          `<h2 style="margin:0 0 12px">🤖 Piloto automático — Google Ads</h2>${htmlBody}` +
          `<p style="color:#666;font-size:12px;margin-top:18px">— The Lab Solutions · piloto semanal de campañas</p></div>` }),
    });
  } catch (e) { console.error("[ads-autopilot] email:", e.message); }
}

// ── Aprobación desde el email (GET = página de confirmación, POST = aplica) ──
function apHtmlPage(title, body) {
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title></head>` +
    `<body style="font-family:system-ui,Arial,sans-serif;background:#0d1117;color:#e6edf3;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">` +
    `<div style="max-width:520px;padding:32px;background:#161b22;border:1px solid #30363d;border-radius:12px;margin:16px">` +
    `<h2 style="margin:0 0 14px">${escHtml(title)}</h2>${body}</div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function handleAdsDecision(request, env) {
  const url = new URL(request.url);
  const isPost = request.method === "POST";
  let id, a, t;
  if (isPost) {
    const form = await request.formData().catch(() => null);
    id = form?.get("id"); a = form?.get("a"); t = form?.get("t");
  } else {
    id = url.searchParams.get("id"); a = url.searchParams.get("a"); t = url.searchParams.get("t");
  }
  const secret = env.ADS_APPROVAL_SECRET || "";
  if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id) || !["approve", "reject"].includes(a) || !secret) {
    return apHtmlPage("Solicitud inválida", `<p>El enlace no es válido.</p>`);
  }

  // Estado actual del registro (se necesita antes de validar: la firma incluye
  // la huella de las mutaciones guardadas — si alguien las cambió, no calza)
  const recRes = await fetch(`${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/Agent_Queue/${id}`, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
  });
  if (!recRes.ok) return apHtmlPage("No encontrada", `<p>La propuesta ya no existe.</p>`);
  const rec = await recRes.json();

  let recMuts = [];
  try { recMuts = JSON.parse(rec.fields?.Output || "{}").mutaciones || []; } catch (e) { /* vacío */ }
  const mh = await apMutHash(recMuts);
  const expected = await apHmacHex(secret, `${id}:${a}:${mh}`);
  if (!timingSafeEqual(String(t || ""), expected)) {
    return apHtmlPage("Enlace no autorizado", `<p>La firma del enlace no es válida (o la propuesta cambió después de enviarse el email).</p>`);
  }

  // Expiración: una propuesta de hace semanas ya no refleja la realidad
  const creada = rec.fields?.["Fecha creación"] || rec.createdTime;
  if (creada && Date.now() - new Date(creada).getTime() > 15 * 86400000) {
    return apHtmlPage("Propuesta expirada", `<p>Esta propuesta tiene más de 15 días. El piloto generará una nueva el próximo lunes.</p>`);
  }

  const estado = rec.fields?.Estado || "";
  if (estado !== "Pendiente") {
    return apHtmlPage("Propuesta ya procesada", `<p>Esta propuesta está en estado <strong>${escHtml(estado)}</strong>. No hay nada más que hacer.</p>`);
  }

  // GET → página de confirmación (evita que un prefetch de email apruebe solo)
  if (!isPost) {
    let detalle = "";
    try {
      const out = JSON.parse(rec.fields?.Output || "{}");
      detalle = `<ul style="color:#9da7b3;font-size:14px;line-height:1.7">` +
        (out.acciones || []).map((x) => `<li><strong>${escHtml(x.tipo)}</strong> · ${escHtml(x.linea)}${x.campana ? " · " + escHtml(x.campana) : ""}${x.nuevo ? ` · $${Number(x.nuevo).toLocaleString("es-CL")}/día` : ""}</li>`).join("") + `</ul>`;
    } catch (e) { /* sin detalle */ }
    const label = a === "approve" ? "✓ Confirmar y aplicar en Google Ads" : "✗ Confirmar rechazo";
    const color = a === "approve" ? "#0a7d5c" : "#8b3a3a";
    return apHtmlPage(a === "approve" ? "Aprobar cambios del piloto" : "Rechazar propuesta",
      detalle +
      `<form method="POST" action="/ads/decision">` +
      `<input type="hidden" name="id" value="${escHtml(id)}"><input type="hidden" name="a" value="${escHtml(a)}"><input type="hidden" name="t" value="${escHtml(t)}">` +
      `<button type="submit" style="background:${color};color:#fff;border:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer">${label}</button></form>`);
  }

  // POST → ejecutar la decisión
  if (a === "reject") {
    await airtableUpdateTolerant(env, "Agent_Queue", id, {
      Estado: "Error", Error: `Rechazado por el usuario (${new Date().toISOString().slice(0, 16)})`,
    });
    return apHtmlPage("Propuesta rechazada", `<p>No se aplicará ningún cambio. El piloto volverá a proponer la próxima semana.</p>`);
  }

  const mutaciones = recMuts; // ya verificadas: su huella va dentro de la firma del link
  if (!mutaciones.length) return apHtmlPage("Sin mutaciones", `<p>La propuesta no contiene cambios aplicables.</p>`);

  let ok = 0, err = 0;
  for (const m of mutaciones) {
    try {
      const r = await fetch(env.ADS_ENDPOINT, {
        method: "POST", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ secret: env.ADS_SCRIPT_SECRET || "thelab2025", type: "mutation", ...m }),
      });
      const d = await r.json().catch(() => ({}));
      d && d.ok ? ok++ : err++;
    } catch (e) { err++; }
  }
  await airtableUpdateTolerant(env, "Agent_Queue", id, {
    Estado: err ? "Error" : "Completado",
    Error: err ? `${err} mutación(es) no se pudieron encolar` : "",
    "Fecha ejecución": new Date().toISOString(),
    "Accion sugerida": `Aprobado por email: ${ok}/${mutaciones.length} mutaciones encoladas`,
  });
  return apHtmlPage(err ? "Aplicado con errores" : "✓ Cambios aprobados",
    `<p>${ok} de ${mutaciones.length} cambio(s) encolado(s). Google Ads los aplicará en la próxima corrida del Script 2 (cada hora).</p>` +
    (err ? `<p style="color:#e5534b">${err} cambio(s) fallaron al encolarse — reintenta desde el dashboard.</p>` : ""));
}
