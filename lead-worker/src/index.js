/**
 * thelab-leads-worker
 * ---------------------------------------------------------------------------
 * Endpoint pÃºblico de captaciÃ³n de leads para The Lab Solutions.
 *
 *   Web / Google Ads / LinkedIn
 *        â”‚  POST  (+ anti-bot)
 *        â–¼
 *   este Worker
 *        â”œâ”€â†’ Airtable: crea Cliente   (tolerante a campos inexistentes)
 *        â”œâ”€â†’ Airtable: crea tarea en  Agent_Queue (estado Pendiente)
 *        â””â”€â†’ (opcional) procesa LEAD_AGENT con Claude y deja el lead pre-scoreado
 *
 * Rutas:
 *   GET  /health
 *   POST /lead                  (web pÃºblica â€” clave X-Public-Lead-Key + Turnstile opcional)
 *   POST /newsletter            (alta de suscriptor desde la web â€” misma clave + anti-bot)
 *   GET  /newsletter/confirm    (doble opt-in: confirma la suscripciÃ³n vÃ­a token HMAC)
 *   GET  /newsletter/unsubscribe(baja de la lista â€” token HMAC opcional)
 *   POST /portal/link           (dashboard â€” emite el link del portal, clave PORTAL_ADMIN_KEY)
 *   POST /portal/revocar        (dashboard â€” invalida los links de un cliente)
 *   GET  /portal                (cliente â€” pedidos y cotizaciones, token firmado)
 *   GET  /portal/cotizacion     (cliente â€” su cotizaciÃ³n como documento imprimible)
 *   POST /portal/cotizacion/decision (cliente â€” aprueba/rechaza su cotizaciÃ³n)
 *   POST /webhooks/google-ads   (Google Lead Form â€” clave GOOGLE_ADS_WEBHOOK_KEY)
 *   POST /webhooks/linkedin     (LinkedIn vÃ­a Make/Zapier â€” clave LINKEDIN_WEBHOOK_KEY)
 *   POST /webhooks/social       (Instagram/Facebook/TikTok comentarios+DMs vÃ­a Make â€” clave SOCIAL_WEBHOOK_KEY)
 *
 * NINGÃšN secreto vive en este archivo. Todo viene de `env` (wrangler secret put).
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

      // â”€â”€ GET/HEAD /health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // HEAD lo usan los monitores de uptime (p. ej. UptimeRobot free) que
      // solo hacen HEAD; sin esto devolvÃ­a 404 y marcaba "caÃ­do" en falso.
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
      // dashboard contra /portal/link; la pÃ¡gina y la decisiÃ³n se sirven acÃ¡.
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

      // Encuesta de satisfacciÃ³n post-entrega (NPS/CSAT). El cliente llega desde
      // el mensaje post-entrega: GET muestra/registra la calificaciÃ³n (pÃ¡gina
      // HTML), POST guarda el comentario opcional.
      if (url.pathname === "/nps") {
        return await handleNps(request, env, ctx, cors);
      }

      // Comprobante de entrega (POD): el cliente confirma la recepciÃ³n con un clic.
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

      // Piloto automÃ¡tico de Google Ads: aprobaciÃ³n/rechazo desde el email
      if (url.pathname === "/ads/decision") {
        return await handleAdsDecision(request, env);
      }

      // Disparo manual del piloto (para probar sin esperar el cron semanal).
      // Requiere ADS_APPROVAL_SECRET (sin fallback: PUBLIC_LEAD_KEY viaja en el
      // bundle de la web y no sirve para autorizar cambios de campaÃ±as).
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
    // Una vez al dÃ­a (07:17 UTC â‰ˆ madrugada en Chile): poda de la cola de agentes
    // y canario del formulario web (ver checkLeadFormHealth).
    if (new Date(event.scheduledTime || Date.now()).getUTCHours() === 7) {
      ctx.waitUntil(cleanupAgentQueue(env));
      ctx.waitUntil(checkLeadFormHealth(env));
    }
  },
};

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * Limpieza de Agent_Queue: las tareas "Completado" con mÃ¡s de
 * CLEANUP_QUEUE_DAYS dÃ­as (30 por defecto; "0" desactiva) se borran solas.
 * La cola queda como semÃ¡foro: casi vacÃ­a = todo bien. Pendiente, Procesando
 * y Error se conservan SIEMPRE â€” son las que piden atenciÃ³n humana.
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * Canario diario del formulario web
 *
 * El 2026-08-18 se descubriÃ³ que los formularios de la web llevaban casi un mes
 * entregando los leads SOLO por email: entraban al correo y nunca al CRM. Nada
 * fallaba a la vista â€”el sitio compilaba, el formulario decÃ­a "Â¡Registro
 * recibido!"â€” y por eso durÃ³ tanto.
 *
 * El deploy de la web ya verifica esto al publicar, pero eso no cubre la deriva
 * posterior: si alguien borra una variable del Worker de la web, el formulario
 * vuelve a perder leads sin que ningÃºn deploy lo note. Este canario lo mira una
 * vez al dÃ­a desde fuera y avisa. Cuando todo estÃ¡ bien no manda nada: un
 * canario que canta todos los dÃ­as deja de escucharse.
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const LEAD_FORM_HEALTH_URL = "https://thelab.solutions/api/lead/health";
async function checkLeadFormHealth(env) {
  let motivo, detalle = "";
  try {
    const r = await fetch(env.LEAD_FORM_HEALTH_URL || LEAD_FORM_HEALTH_URL, {
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => null);
    if (d && d.ok === true) return; // sano: silencio
    if (d) {
      motivo = "el sitio responde que los formularios NO entregan al CRM";
      detalle = JSON.stringify(d);
    } else {
      motivo = `la respuesta del sitio no se pudo leer (HTTP ${r.status})`;
      detalle = "Â¿quedÃ³ desplegada una versiÃ³n sin /api/lead/health?";
    }
  } catch (e) {
    motivo = "no se pudo consultar el sitio";
    detalle = e.message;
  }
  console.error("[canario-leads]", motivo, detalle);
  await sendLeadFormBrokenAlert(env, motivo, detalle);
}
async function sendLeadFormBrokenAlert(env, motivo, detalle) {
  if (!env.RESEND_API_KEY) return;
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
    );
  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.55;max-width:560px">` +
    `<h2 style="margin:0 0 12px;color:#b00020">âš ï¸ El formulario de la web puede estar perdiendo leads</h2>` +
    `<p>El chequeo diario encontrÃ³ que <strong>${esc(motivo)}</strong>.</p>` +
    `<p>Mientras esto siga asÃ­, una ficha enviada desde thelab.solutions llega por correo pero <strong>no entra a Clientes ni a la cola de agentes</strong>.</p>` +
    `<p style="background:#fff3f3;border:1px solid #f3caca;border-radius:8px;padding:8px 12px;color:#a00"><strong>Detalle:</strong> ${esc(detalle)}</p>` +
    `<p>Comprobar a mano:<br><code>curl -s https://thelab.solutions/api/lead/health</code></p>` +
    `<p style="color:#666;font-size:13px">Revisa que <code>LEAD_ENDPOINT</code> y <code>LEAD_KEY</code> sigan definidas en el Worker de la web (Cloudflare â†’ Workers &amp; Pages â†’ web-thelab-solutions â†’ Settings â†’ Variables).</p>` +
    `</div>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.RESEND_FROM || "The Lab Solutions <hola@thelab.solutions>",
        to: env.LEADS_NOTIFY_TO || "thelabsolutionscl@gmail.com",
        subject: "âš ï¸ El formulario de la web puede estar perdiendo leads",
        html,
      }),
    });
  } catch (e) {
    console.error("[canario-leads] no se pudo avisar:", e.message);
  }
}

async function cleanupAgentQueue(env) {
  try {
    if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return;
    const days = parseInt(env.CLEANUP_QUEUE_DAYS ?? "30", 10);
    if (!days || days < 1) return;
    const formula = `AND({Estado}='Completado', IS_BEFORE({Fecha creaciÃ³n}, DATEADD(NOW(), -${days}, 'days')))`;
    const H = { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` };
    let borradas = 0;
    // Borra-y-repite: al eliminar la pÃ¡gina, la consulta siguiente trae lo que
    // queda (sin cursores que invalidar). Tope de 10 rondas = 1000 filas/dÃ­a.
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
    if (borradas) console.log(`[cleanup-queue] ${borradas} tareas Completado de +${days} dÃ­as eliminadas`);
  } catch (e) {
    console.error("[cleanup-queue]", e.message);
  }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * PORTAL DEL CLIENTE  (pÃ¡ginas servidas por el Worker, no por el dashboard)
 *
 *   POST /portal/link                 el dashboard pide el link de un cliente
 *   GET  /portal?t=<token>            pÃ¡gina del cliente: pedidos + cotizaciones
 *   POST /portal/cotizacion/decision  el cliente aprueba/rechaza una cotizaciÃ³n
 *
 * Token:  recIdCliente . vencimiento(base36) . HMAC-SHA256
 * Sin el secreto no se puede forjar, y deja de servir en la fecha de vencimiento.
 * Los datos se leen ACÃ con el token de Airtable del servidor: el navegador del
 * cliente no recibe credenciales ni mÃ¡s registros que los suyos.
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const PORTAL_DIAS_DEFAULT = 30;
const PORTAL_STAGES = ["Confirmado", "En producciÃ³n", "Listo para despacho", "Despachado", "Completado"];
const PORTAL_COT_ABIERTAS = ["Enviada", "Solicitada"];

// Secreto de firma. NUNCA PUBLIC_LEAD_KEY: esa viaja en el bundle de la web y
// permitirÃ­a a cualquiera firmarse un token para el cliente que quisiera.
function portalSecret(env) {
  return env.PORTAL_SECRET || env.NEWSLETTER_SECRET || env.AIRTABLE_TOKEN || "";
}
// RevocaciÃ³n por cliente: en el KV vive un contador por cliente que entra en la
// firma. Al revocar sube en 1 y todos los links que ya circulaban dejan de
// validar, sin tocar los de los demÃ¡s clientes. La versiÃ³n 0 firma el mensaje
// sin sufijo, asÃ­ los links emitidos antes de existir esto siguen sirviendo
// hasta su primera revocaciÃ³n (o hasta que venzan).
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
// Devuelve null si la firma no cuadra (invÃ¡lido o revocado); { vencido: true }
// distingue el enlace caducado para poder decirle al cliente quÃ© le pasÃ³.
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

/* â”€â”€ POST /portal/revocar â”€â”€ corta los links de UN cliente â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function handlePortalRevocar(request, env, cors) {
  const expected = env.PORTAL_ADMIN_KEY || "";
  const key = request.headers.get("X-Portal-Admin-Key") || "";
  if (!expected || !timingSafeEqual(key, expected)) {
    return json({ ok: false, error: "No autorizado" }, 401, cors);
  }
  // Sin KV no hay dÃ³nde guardar el contador: mejor decirlo que fingir que se revocÃ³.
  if (!env.RL) return json({ ok: false, error: "RevocaciÃ³n no disponible: al Worker le falta el KV (binding RL)" }, 501, cors);
  const body = await readJson(request);
  const clienteId = str(body && body.clienteId);
  if (!isRecId(clienteId)) return json({ ok: false, error: "Cliente invÃ¡lido" }, 400, cors);
  const v = (await portalVersion(env, clienteId)) + 1;
  try {
    await env.RL.put(PORTAL_REV_KEY(clienteId), String(v));
  } catch (e) {
    return json({ ok: false, error: "No se pudo revocar" }, 502, cors);
  }
  return json({ ok: true, version: v }, 200, cors);
}

/* â”€â”€ POST /portal/link â”€â”€ solo el dashboard (clave PORTAL_ADMIN_KEY) â”€â”€â”€â”€â”€â”€ */
async function handlePortalLink(request, env, cors) {
  const expected = env.PORTAL_ADMIN_KEY || "";
  const key = request.headers.get("X-Portal-Admin-Key") || "";
  if (!expected || !timingSafeEqual(key, expected)) {
    return json({ ok: false, error: "No autorizado" }, 401, cors);
  }
  if (!portalSecret(env)) return json({ ok: false, error: "Portal sin configurar (falta PORTAL_SECRET)" }, 500, cors);
  const body = await readJson(request);
  const clienteId = str(body && body.clienteId);
  if (!isRecId(clienteId)) return json({ ok: false, error: "Cliente invÃ¡lido" }, 400, cors);
  let dias = parseInt((body && body.dias) ?? PORTAL_DIAS_DEFAULT, 10);
  if (!Number.isFinite(dias) || dias < 1) dias = PORTAL_DIAS_DEFAULT;
  if (dias > 365) dias = 365;
  const { token, exp } = await portalMakeToken(env, clienteId, dias);
  const base = (env.WORKER_PUBLIC_URL || new URL(request.url).origin).replace(/\/+$/, "");
  return json({ ok: true, url: `${base}/portal?t=${token}`, dias, expira: portalFecha(new Date(exp * 1000).toISOString().slice(0, 10)) }, 200, cors);
}

/* â”€â”€ GET /portal?t=â€¦ â”€â”€ la pÃ¡gina que ve el cliente â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function handlePortal(request, env) {
  const url = new URL(request.url);
  const tok = await portalVerifyToken(env, url.searchParams.get("t"));
  if (!tok) return htmlPage("Enlace invÃ¡lido", "Este enlace no es vÃ¡lido. EscrÃ­benos a hola@thelab.solutions y te enviamos uno nuevo.", false);
  if (tok.vencido) return htmlPage("Enlace vencido", "Este enlace de seguimiento ya venciÃ³. EscrÃ­benos a hola@thelab.solutions y te enviamos uno nuevo al tiro.", false);
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return htmlPage("No disponible", "El portal no estÃ¡ disponible en este momento. Intenta mÃ¡s tarde.", false);

  const cliente = await portalGetRecord(env, "Clientes", tok.clienteId);
  if (!cliente) return htmlPage("No disponible", "No pudimos cargar tus datos ahora. Intenta mÃ¡s tarde o escrÃ­benos a hola@thelab.solutions.", false);
  const f = cliente.fields || {};
  const [pedidos, cots] = await Promise.all([
    portalGetLinked(env, "Pedidos", f["Pedidos"]),
    portalGetLinked(env, "Cotizaciones", f["Cotizaciones"]),
  ]);
  return portalPage({
    token: url.searchParams.get("t") || "",
    nombre: f["Empresa"] || f["Contacto"] || "Cliente",
    pedidos,
    cots: cots.filter((c) => PORTAL_COT_ABIERTAS.includes((c.fields || {})["Estado cotizaciÃ³n"] || "")),
  });
}

/* â”€â”€ POST /portal/cotizacion/decision â”€â”€ aprobar / rechazar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function handlePortalCotDecision(request, env, ctx, cors) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON invÃ¡lido" }, 400, cors);
  const tok = await portalVerifyToken(env, body.t);
  if (!tok) return json({ ok: false, error: "Enlace invÃ¡lido" }, 401, cors);
  if (tok.vencido) return json({ ok: false, error: "Este enlace venciÃ³. EscrÃ­benos a hola@thelab.solutions." }, 401, cors);
  const cotId = str(body.cot);
  if (!isRecId(cotId)) return json({ ok: false, error: "CotizaciÃ³n invÃ¡lida" }, 400, cors);
  const decision = String(body.decision || "");
  if (decision !== "Aprobada" && decision !== "Rechazada") return json({ ok: false, error: "DecisiÃ³n invÃ¡lida" }, 400, cors);
  if (await rateLimited(env, request, "portal-dec", 40, 3600)) return json({ ok: false, error: "Demasiados intentos, intenta mÃ¡s tarde" }, 429, cors);
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return json({ ok: false, error: "No configurado" }, 500, cors);

  const rec = await portalGetRecord(env, "Cotizaciones", cotId);
  if (!rec) return json({ ok: false, error: "CotizaciÃ³n no encontrada" }, 404, cors);
  // La cotizaciÃ³n tiene que ser de ESTE cliente: con el token de uno no se
  // decide sobre la cotizaciÃ³n de otro.
  const dueÃ±o = (rec.fields || {})["Cliente"];
  const esSuya = Array.isArray(dueÃ±o) ? dueÃ±o.includes(tok.clienteId) : dueÃ±o === tok.clienteId;
  if (!esSuya) return json({ ok: false, error: "No autorizado" }, 403, cors);

  const estado = (rec.fields || {})["Estado cotizaciÃ³n"] || "";
  if (!PORTAL_COT_ABIERTAS.includes(estado)) {
    // Ya fue decidida (doble clic, pestaÃ±a vieja): idempotente, no es error.
    return json({ ok: true, alreadyDecided: true, estado }, 200, cors);
  }

  const comentario = String(body.comentario || "").slice(0, 2000);
  const fields = { "Estado cotizaciÃ³n": decision };
  if (decision === "Aprobada") fields["Fecha aprobaciÃ³n"] = today();
  // El comentario va a "Notas cotizaciÃ³n" (texto largo) y NO a "Motivo rechazo":
  // ese campo es un single select y con typecast cada texto libre del cliente le
  // creaba una opciÃ³n nueva. La clasificaciÃ³n la hace el equipo desde el dashboard.
  if (decision === "Rechazada" && comentario) {
    const previas = str((rec.fields || {})["Notas cotizaciÃ³n"]);
    fields["Notas cotizaciÃ³n"] = (previas ? previas + "\n\n" : "") + `[${today()}] Rechazo del cliente (portal): ${comentario}`;
  }
  try {
    await airtableUpdateTolerant(env, "Cotizaciones", cotId, fields);
  } catch (e) {
    return json({ ok: false, error: "No se pudo registrar" }, 502, cors);
  }

  // Aviso al equipo (best-effort, no bloquea la respuesta)
  const numCot = (rec.fields || {})["NÂ° CotizaciÃ³n"] || cotId;
  ctx.waitUntil(sendCotDecisionAlert(env, { numCot, decision, comentario }));

  return json({ ok: true, decision }, 200, cors);
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * GET /portal/cotizacion?t=<token>&cot=<recId>
 * La cotizaciÃ³n como documento imprimible (el cliente la ve y la guarda en PDF
 * con el botÃ³n, que dispara el diÃ¡logo de impresiÃ³n del navegador).
 *
 * CUIDADO al tocar los campos que se muestran acÃ¡:
 *   Â· "Detalle JSON" trae costoUnit y el desglose de costos por Ã­tem.
 *   Â· "Detalle productos" trae "Costo: $â€¦" escrito en el texto.
 *   Â· "Subtotal (CLP)" NO es un subtotal de venta: guarda la suma de COSTOS.
 * De ahÃ­ solo puede salir desc, und y ventaUnit. Nada mÃ¡s. El total que manda
 * es "Total final (CLP)" (IVA incluido); si no cuadra con los Ã­tems, la
 * diferencia se muestra como ajuste para que las cuentas cierren siempre.
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function handlePortalCotizacion(request, env) {
  const url = new URL(request.url);
  const tok = await portalVerifyToken(env, url.searchParams.get("t"));
  if (!tok) return htmlPage("Enlace invÃ¡lido", "Este enlace no es vÃ¡lido. EscrÃ­benos a hola@thelab.solutions y te enviamos uno nuevo.", false);
  if (tok.vencido) return htmlPage("Enlace vencido", "Este enlace ya venciÃ³. EscrÃ­benos a hola@thelab.solutions y te enviamos uno nuevo al tiro.", false);
  const cotId = str(url.searchParams.get("cot"));
  if (!isRecId(cotId)) return htmlPage("CotizaciÃ³n no encontrada", "No pudimos encontrar esta cotizaciÃ³n.", false);
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return htmlPage("No disponible", "No estÃ¡ disponible en este momento. Intenta mÃ¡s tarde.", false);

  const rec = await portalGetRecord(env, "Cotizaciones", cotId);
  if (!rec) return htmlPage("CotizaciÃ³n no encontrada", "No pudimos encontrar esta cotizaciÃ³n.", false);
  const dueÃ±o = (rec.fields || {})["Cliente"];
  const esSuya = Array.isArray(dueÃ±o) ? dueÃ±o.includes(tok.clienteId) : dueÃ±o === tok.clienteId;
  if (!esSuya) return htmlPage("No disponible", "Esta cotizaciÃ³n no corresponde a tu cuenta.", false);

  const cliente = await portalGetRecord(env, "Clientes", tok.clienteId);
  return portalCotizacionPage(rec, (cliente && cliente.fields) || {}, url.searchParams.get("t") || "");
}

// Solo descripciÃ³n, cantidad y precio de venta: ver la advertencia de arriba.
// â”€â”€ La cotizaciÃ³n, calcada de buildCotizacionDoc() (js/pdf-fichas.js) â”€â”€â”€â”€â”€â”€
// Es EL MISMO documento que sale de la secciÃ³n Cotizaciones del dashboard. Si
// cambias uno, cambia el otro: el cliente no puede recibir dos versiones
// distintas del mismo papel.
const COT_FORMA_PAGO_DESC = {
  "AL CONTADO": "Pago total al momento de confirmar el pedido, vÃ­a transferencia bancaria, vale vista o cheque al dÃ­a.",
  "30 DÃAS DESDE OC": "Pago total a 30 dÃ­as desde la emisiÃ³n de la Orden de Compra, vÃ­a transferencia bancaria.",
  "45 DÃAS DESDE OC": "Pago total a 45 dÃ­as desde la emisiÃ³n de la Orden de Compra, vÃ­a transferencia bancaria.",
  "70% ABONO Y 30% CONTRA ENTREGA": "70% de abono al confirmar el pedido (Facturable inmediatamente), 30% restante contra entrega y conformidad de recepciÃ³n, vÃ­a transferencia bancaria, vale vista o cheque al dÃ­a.",
  "50% ABONO Y 50% 30 DÃAS": "50% de abono al confirmar el pedido (Facturable inmediatamente), 50% restante a 30 dÃ­as desde la Orden de Compra, vÃ­a transferencia bancaria.",
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
  if (f["Fecha de entrega"]) return `Entrega estimada para el ${cotFechaLarga(f["Fecha de entrega"])}. Fecha sujeta a la confirmaciÃ³n del pedido y a la disponibilidad de stock.`;
  const min = f["Tiempo de producciÃ³n"];
  if (!min) return "";
  const max = f["Tiempo de producciÃ³n mÃ¡x"];
  const tipo = String(f["Tipo dÃ­as producciÃ³n"] || "DÃAS HÃBILES").toLowerCase();
  const rango = max && max > min ? `${min}-${max}` : `${min}`;
  return `${rango} ${tipo} desde la confirmaciÃ³n del pedido. Plazo podrÃ­a variar dependiendo de stock de productos, contingencias sanitarias o sociales.`;
}
// Mismo parseo de "Detalle productos" que el dashboard: de cada lÃ­nea saca la
// VENTA. La diferencia: acÃ¡, si la columna elegida trae "Costo:" (lÃ­nea con
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
  // desc/und/ventaUnit (ese JSON tambiÃ©n trae costoUnit y el desglose de costos).
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
  const abierta = PORTAL_COT_ABIERTAS.includes(f["Estado cotizaciÃ³n"] || "");
  const num = f["NÂ° CotizaciÃ³n"] || "â€”";
  // Mismo fallback que el dashboard: sin fecha emitida, va la de hoy.
  // today() y no toISOString():m«ëŒ+Š×®º+º$zzb¥âVÂv÷&¶W"6÷'&RVâUD2Â<:ÒVRVæ6÷F—¦6œ;6à¢òò6–âfV6†&÷–&–W'FFRæö6†R6Ì:ÖfV6†FVâL:ÖÜ:2FVÆçFRVRVÀ¢òòÖ—6ÖòFö7VÖVçFòFW66&vFòFW6FRVÂF6†&ö&Bà¢6öç7BfV6†Òe²$fV6†6÷F—¦6œ;6â%ÒÇÂFöF’‚“°¢6öç7BgFòÒe²$fV6†fVæ6–Ö–VçFò%ÒÇÂ.(	B#°¢6öç7BW&vVçFRÒe²%W&vVæ6–‚³#RR’%Ó°¢6öç7B6öÆ–6—GVBÒ7G"†e²%6öÆ–6—GVB6Æ–VçFR‡FW‡FòÆ–'&R’%Ò“°¢6öç7BF÷FÂÒçVÖ&W"†e²%F÷FÂf–æÂ„4Å’%Ò’ÇÂ°¢6öç7BæWFòÒÖF‚ç&÷VæB‡F÷FÂòã’“°¢6öç7B—fÒF÷FÂÒæWFó°¢6öç7BÆ¦÷G‡BÒ6÷EÆ¦õFW‡Fò†b’ÇÂ$6ö÷&F–æ"6öâVÂ6Æ–VçFRâ#°¢6öç7Bf÷&ÖvòÒ7G"†e²$f÷&ÖFRvò%Ò“°¢6öç7Bf÷&Ö‡FÖÂÒf÷&ÖvòòÇ7G&öæsâG¶W62†f÷&Övò—Ó£Â÷7G&öæsâG¶W62„4õEôdõ$ÔõtõôDU45¶f÷&ÖvõÒÇÂ""—Ö¢"#° ¢6öç7BÆ–æV2Ò6÷DÆ–æV2†b“°¢6öç7B—FV×4…DÔÂÒÆ–æV2æÆVæwF€¢òÆ–æV2æÖ‚†ÂÂ’’ÓâÇG"7G–ÆSÒ&&6¶w&÷VæC¢G¶’R"ÓÓÒò"6c–c–c’"¢"6ffb'Ò#ãÇFB7G–ÆSÒ'FF–æs£g‚ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6S†S†Sƒ¶föçB×6—¦S£‚#âG¶W62†ÂæFW62—ÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£g‚ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6S†S†Sƒ¶föçB×6—¦S£ƒ·FW‡BÖÆ–vã¦6VçFW#¶6öÆ÷#¢3SSR#âG¶ÂçVæGÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£g‚ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6S†S†Sƒ¶föçB×6—¦S£ƒ·FW‡BÖÆ–vã§&–v‡B#âG¶W62‡÷'FÄ4Å†ÂçfVçFVæ—B’—ÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£g‚ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6S†S†Sƒ¶föçB×6—¦S£ƒ·FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c#âG¶W62‡÷'FÄ4Å†ÂçfVçFF÷FÂ’—ÓÂ÷FCãÂ÷G#æ’æ¦ö–â‚""¢¢ÇG#ãÇFB6öÇ7ãÒ#B"7G–ÆSÒ'FF–æs£'ƒ·FW‡BÖÆ–vã¦6VçFW#¶6öÆ÷#¢3“““¶föçB×6—¦S£‚#å6–âFWFÆÆSÂ÷FCãÂ÷G#æ°¢6öç7B–æfõ&÷rÒ†Æ&VÂÂfÂ’Óâ‡fÂbbfÂÓÒ.(	B"òÇG#ãÇFB7G–ÆSÒ'FF–æs£7‚¶föçB×6—¦S£ƒ¶6öÆ÷#¢3ƒƒƒ·v–GFƒ£ƒƒ·fW'F–6ÂÖÆ–vã§F÷#âG¶W62†Æ&VÂ—ÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£7‚¶föçB×6—¦S£ƒ¶6öÆ÷#¢3¶föçB×vV–v‡C£S#âG¶W62‡fÂ—ÓÂ÷FCãÂ÷G#æ¢""“° ¢6öç7B7VÖæWFòÒÆ–æV2ç&VGV6R‚†ÂÂ’Óâ²†ÂçfVçFF÷FÂÇÂ’Â“°¢6öç7BFW657BÒÖF‚æÖ‚ƒÂ'6TfÆöB†e²$FW67VVçFò‚R’%Ò’ÇÂ“°¢6öç7BFW64ÖöçFòÒ7VÖæWFòÒæWFó°¢6öç7B†”FW62ÒFW657BâbbFW64ÖöçFòâbb7VÖæWFòâ°¢6öç7BFW657EG‡BÒçVÖ&W"æ—4–çFVvW"†FW657B’ò7G&–ær†FW657B’¢FW657BçFôf—†VBƒ’ç&WÆ6R‚õÂãBòÂ""“°¢6öç7BF÷FÇ5&÷w2Ğ¢††”FW60¢òÆF—b6Æ73Ò'F÷FÇ2×&÷r#ãÇ7ãå7V'F÷FÂæWFóÂ÷7ããÇ7ãâG¶W62‡÷'FÄ4Å‡7VÖæWFò’—ÓÂ÷7ããÂöF—cæ°¢ÆF—b6Æ73Ò'F÷FÇ2×&÷r"7G–ÆSÒ&6öÆ÷#¢633“&"#ãÇ7ãäFW67VVçFò‚G¶W62†FW657EG‡B—ÒR“Â÷7ããÇ7ãî(‰"G¶W62‡÷'FÄ4Å†FW64ÖöçFò’—ÓÂ÷7ããÂöF—cæ°¢ÆF—b6Æ73Ò'F÷FÇ2×&÷r#ãÇ7ãäæWFóÂ÷7ããÇ7ãâG¶W62‡÷'FÄ4Å†æWFò’—ÓÂ÷7ããÂöF—cæ ¢¢ÆF—b6Æ73Ò'F÷FÇ2×&÷r#ãÇ7ãäæWFóÂ÷7ããÇ7ãâG¶W62‡÷'FÄ4Å†æWFò’—ÓÂ÷7ããÂöF—cæ’°¢ÆF—b6Æ73Ò'F÷FÇ2×&÷r—f#ãÇ7ãä•dƒ’R“Â÷7ããÇ7ãâG¶W62‡÷'FÄ4Å†—f’—ÓÂ÷7ããÂöF—cæ°¢ÆF—b6Æ73Ò'F÷FÇ2×&÷rF÷FÂÖf–æÂ#ãÇ7ãåDõDÃÂ÷7ããÇ7ãâG¶W62‡÷'FÄ4Å‡F÷FÂ’—ÓÂ÷7ããÂöF—cæ° ¢6öç7B‡FÖÂÒÂDô5E•R‡FÖÃãÆ‡FÖÂÆæsÒ&W2#ãÆ†VCãÆÖWF6†'6WCÒ%UDbÓ‚#ãÆÖWFæÖSÒ'f–Ww÷'B"6öçFVçCÒ'v–GFƒÖFWf–6R×v–GF‚Æ–æ—F–Â×66ÆSÓ#ãÆÖWFæÖSÒ'&ö&÷G2"6öçFVçCÒ&æö–æFW‚ÆæöföÆÆ÷r#ãÇF—FÆSä6÷F—¦6œ;6âG¶W62†çVÒ—ÓÂ÷F—FÆSà£ÆÆ–æ²&VÃÒ&–6öâ"‡&VcÒ&‡GG3¢òöF6†&ö&BçF†VÆ"ç6öÇWF–öç2ö—6÷F—ò×F†VÆ"çær#à£Ç7G–ÆSâ§¶&÷‚×6—¦–æs¦&÷&FW"Ö&÷ƒ¶Ö&v–ã£·FF–æs£·Ö&öG—¶föçBÖfÖ–Ç“¢t†VÇfWF–6æWVRrÄ&–ÂÇ6ç2×6W&–c¶6öÆ÷#¢3¶&6¶w&÷VæC¢6ffc·FF–æs£‡‚#Gƒ¶föçB×6—¦S£ƒ·Ğ¢æ†VFW'¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Æ–vâÖ—FV×3¦fÆW‚×7F'C¶Ö&v–âÖ&÷GFöÓ£Gƒ·FF–ærÖ&÷GFöÓ£'ƒ¶&÷&FW"Ö&÷GFöÓ£7‚6öÆ–B3CF63·Ğ¢æÆövòÖ&V–Öw¶†V–v‡C£#‡ƒ·ÒæÆövòÖ&VçFvÆ–æW¶föçB×6—¦S£‡ƒ¶6öÆ÷#¢6¶Ö&v–â×F÷£Gƒ¶ÆWGFW"×76–æs£ã'ƒ·FW‡B×G&ç6f÷&Ó§WW&66S·Ğ¢æ6÷BÖÖWF·FW‡BÖÆ–vã§&–v‡C·Òæ6÷BÖÖWFƒ¶föçB×6—¦S£#ƒ¶föçB×vV–v‡C£ƒ¶ÆWGFW"×76–æs£'ƒ·FW‡B×G&ç6f÷&Ó§WW&66S¶6öÆ÷#¢3·Ğ¢æ6÷BÖÖWFæçV×¶föçB×6—¦S£gƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢3CF63¶föçBÖfÖ–Ç“¦Ööæ÷76S¶Ö&v–â×F÷£'ƒ·Òæ6÷BÖÖWFæfV6†7¶föçB×6—¦S£—ƒ¶6öÆ÷#¢3“““¶Ö&v–â×F÷£Gƒ¶Æ–æRÖ†V–v‡C£ãc·Ğ¢G·W&vVçFRò"çW&vVçFR×7G&—¶&6¶w&÷VæC¢6fcf#3S¶6öÆ÷#¢6ffc·FW‡BÖÆ–vã¦6VçFW#¶föçB×6—¦S£—ƒ¶föçB×vV–v‡C£s¶ÆWGFW"×76–æs£ãWƒ·FW‡B×G&ç6f÷&Ó§WW&66S·FF–æs£Wƒ¶&÷&FW"×&F—W3£Wƒ¶Ö&v–âÖ&÷GFöÓ£ƒ·Ò"¢"'Ğ¢æ–æfòÖw&–G¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3£g"g#¶v£ƒ¶Ö&v–âÖ&÷GFöÓ£'ƒ·Ğ¢æ–æfòÖ&÷‡¶&6¶w&÷VæC¢6c†c†cƒ¶&÷&FW"×&F—W3£gƒ·FF–æs£‚'ƒ¶&÷&FW"×F÷£7‚6öÆ–B3CF63·Ğ¢æ–æfòÖ&÷‚ƒ7¶föçB×6—¦S£‡ƒ¶föçB×vV–v‡C£s¶ÆWGFW"×76–æs£ãWƒ·FW‡B×G&ç6f÷&Ó§WW&66S¶6öÆ÷#¢6¶Ö&v–âÖ&÷GFöÓ£‡ƒ·Ğ¢æ–æfòÖ&÷‚F&ÆW·v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S·Ğ¢ç6V7F–öâÖÆ&VÇ¶föçB×6—¦S£‡ƒ¶föçB×vV–v‡C£s¶ÆWGFW"×76–æs£ãWƒ·FW‡B×G&ç6f÷&Ó§WW&66S¶6öÆ÷#¢6¶Ö&v–ã£‚Wƒ·Ğ¢ç6öÆ–6—GVBÖ&÷‡¶&6¶w&÷VæC¢6cfffS¶&÷&FW#£‚6öÆ–B&v&ƒÃ#"Ã#BÃã2“¶&÷&FW"×&F—W3£gƒ·FF–æs£‡‚ƒ¶föçB×6—¦S£ƒ¶6öÆ÷#¢3333¶Æ–æRÖ†V–v‡C£ãs·v†—FR×76S§&RÖÆ–æS·Ğ¢æ6öæF–6–öæW2Ö&÷‡¶&6¶w&÷VæC¢6c†c†cƒ¶&÷&FW"×&F—W3£gƒ·FF–æs£‚'ƒ¶Ö&v–â×F÷£ƒ¶&÷&FW"ÖÆVgC£G‚6öÆ–B3CF63¶föçB×6—¦S£—ƒ¶6öÆ÷#¢3333¶Æ–æRÖ†V–v‡C£ãs·Ğ§F&ÆRæ—FV×7·v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶&÷&FW#£‚6öÆ–B6S†S†Sƒ¶Ö&v–â×F÷£Wƒ·Ğ§F&ÆRæ—FV×2F†VBG'¶&6¶w&÷VæC¢3¶6öÆ÷#¢6ffc·Ğ§F&ÆRæ—FV×2F†VBF‡·FF–æs£w‚ƒ¶föçB×6—¦S£‡ƒ¶föçB×vV–v‡C£s¶ÆWGFW"×76–æs£ƒ·FW‡B×G&ç6f÷&Ó§WW&66S·FW‡BÖÆ–vã¦ÆVgC·Ğ§F&ÆRæ—FV×2F†VBFƒ¦çF‚Ö6†–ÆBƒ"—·FW‡BÖÆ–vã¦6VçFW#·×F&ÆRæ—FV×2F†VBFƒ¦çF‚Ö6†–ÆBƒ2’ÇF&ÆRæ—FV×2F†VBFƒ¦çF‚Ö6†–ÆBƒB—·FW‡BÖÆ–vã§&–v‡C·Ğ¢çF÷FÇ7¶Ö&v–â×F÷£‡ƒ¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC¦fÆW‚ÖVæC·Ğ¢çF÷FÇ2Ö&÷‡¶Ö–â×v–GFƒ£##ƒ¶&÷&FW#£‚6öÆ–B6S†S†Sƒ¶&÷&FW"×&F—W3£gƒ¶÷fW&fÆ÷s¦†–FFVã·Ğ¢çF÷FÇ2×&÷w¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã·FF–æs£g‚'ƒ¶föçB×6—¦S£ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6ccc¶&6¶w&÷VæC¢6ffc·Ğ¢çF÷FÇ2×&÷ræ—f¶6öÆ÷#¢3ƒƒƒ·ÒçF÷FÇ2×&÷rçF÷FÂÖf–æÇ¶&6¶w&÷VæC¢3¶6öÆ÷#¢3CF63¶föçB×vV–v‡C£s¶föçB×6—¦S£'ƒ¶&÷&FW"Ö&÷GFöÓ¦æöæS·Ğ¢çG&ç6fW"Ö&÷‡¶Ö&v–â×F÷£'ƒ¶&÷&FW#£‚6öÆ–B3CF63¶&÷&FW"×&F—W3£gƒ¶÷fW&fÆ÷s¦†–FFVã·Ğ¢çG&ç6fW"×F—FÆW¶&6¶w&÷VæC¢3CF63¶6öÆ÷#¢3¶föçB×vV–v‡C£s·FW‡BÖÆ–vã¦6VçFW#·FF–æs£Wƒ¶ÆWGFW"×76–æs£ãWƒ·FW‡B×G&ç6f÷&Ó§WW&66S¶föçB×6—¦S£—ƒ·Ğ¢çG&ç6fW"Ö&÷‚F&ÆW·v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S·ÒçG&ç6fW"Ö&÷‚F&ÆRFG·FF–æs£G‚ƒ¶föçB×6—¦S£—ƒ·Ğ¢æfö÷FW'¶Ö&v–â×F÷£'ƒ·FF–ær×F÷£ƒ¶&÷&FW"×F÷£'‚6öÆ–B6ccc¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Æ–vâÖ—FV×3¦6VçFW#·Ğ¢æfö÷FW"æÆVgG¶föçB×6—¦S£‡ƒ¶6öÆ÷#¢6&&#¶Æ–æRÖ†V–v‡C£ãs·Òæfö÷FW"çfÆ–F—G—¶&6¶w&÷VæC¢6c†c†cƒ¶&÷&FW"×&F—W3£Wƒ·FF–æs£W‚ƒ¶föçB×6—¦S£—ƒ¶6öÆ÷#¢3SSS·Ğ¢æfö÷FW"çfÆ–F—G’7G&öæw¶6öÆ÷#¢3·Ğ¢æ66–öæW7¶F—7Æ“¦fÆWƒ¶v£‡ƒ¶fÆW‚×w&§w&¶Ö&v–âÖ&÷GFöÓ£g‡Ğ¢æ66–öæW2æ'Fç¶&÷&FW#£¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‚gƒ¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s¶7W'6÷#§ö–çFW#¶föçBÖfÖ–Ç“¦–æ†W&—C·FW‡BÖFV6÷&F–öã¦æöæS¶F—7Æ“¦–æÆ–æRÖ&Æö6·Ğ¤ÖVF–&–çG¶&öG—·FF–æs£‚Gƒ·Òæ66–öæW7¶F—7Æ“¦æöæR–×÷'FçGÔvW¶Ö&v–ã£†ÖÓ·6—¦S¤C·×ÓÂ÷7G–ÆSãÂö†VCãÆ&öG“à£ÆF—b6Æ73Ò&66–öæW2#à¢Æ'WGFöâ6Æ73Ò&'Fâ"öæ6Æ–6³Ò'v–æF÷rç&–çB‚’"7G–ÆSÒ&&6¶w&÷VæC¢3¶6öÆ÷#¢6ffb#î*ÈrFW66&v"DcÂö'WGFöãà¢G¶&–W'FòÆ'WGFöâ6Æ73Ò&'Fâ"öæ6Æ–6³Ò'÷'FÄFV6–F—"‚rG¶W62‡&V2æ–B—ÒrÂt&ö&Fr’"7G–ÆSÒ&&6¶w&÷VæC¢3CF63¶6öÆ÷#¢3#î)É2&ö&"6÷F—¦6œ;6ãÂö'WGFöãà¢Æ'WGFöâ6Æ73Ò&'Fâ"öæ6Æ–6³Ò'÷'FÄFV6–F—"‚rG¶W62‡&V2æ–B—ÒrÂu&V6†¦Fr’"7G–ÆSÒ&&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sss¶&÷&FW#£‚6öÆ–B6FFB#å&V6†¦#Âö'WGFöãæ¢"'Ğ¢Æ6Æ73Ò&'Fâ"‡&VcÒ"÷÷'FÃ÷CÒG¶Væ6öFUU$”6ö×öæVçB‡Fö¶Vâ—Ò"7G–ÆSÒ&&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sss¶&÷&FW#£‚6öÆ–B6FFB#î(iföÇfW#Âöà£ÂöF—cà£ÆF—b6Æ73Ò&†VFW"#ãÆF—b6Æ73Ò&ÆövòÖ&V#ãÆ–ÖrÆöF–æsÒ&Æ§’"FV6öF–æsÒ&7–æ2"7&3Ò"G´Äôtõô$Ä4µõU$ÇÒ"öæW'&÷#Ò'F†—2ç7G–ÆRæF—7Æ“ÒvæöæRr#ãÆF—b6Æ73Ò'FvÆ–æR#ä–×&W6œ;6â4B+ræVöæW2+rG&öfV÷3ÂöF—cãÂöF—cà£ÆF—b6Æ73Ò&6÷BÖÖWF#ãÆƒä6÷F—¦6œ;6ãÂöƒãÆF—b6Æ73Ò&çVÒ#âG¶W62†çVÒ—ÓÂöF—cãÆF—b6Æ73Ò&fV6†2#äVÖ—F–F¢Ç7G&öæsâG¶W62†fV6†—ÓÂ÷7G&öæsãÆ'#ål:Æ–F†7F¢Ç7G&öæsâG¶W62‡gFò—ÓÂ÷7G&öæsãÂöF—cãÂöF—cãÂöF—cà¢G·W&vVçFRòsÆF—b6Æ73Ò'W&vVçFR×7G&—#î)ª6÷F—¦6œ;6â6öâW&vVæ6–(	B6RÆ–6&V6&vòFVÂ#RSÂöF—câr¢"'Ğ£ÆF—b6Æ73Ò&–æfòÖw&–B#à£ÆF—b6Æ73Ò&–æfòÖ&÷‚#ãÆƒ3ä6Æ–VçFSÂöƒ3ãÇF&ÆSâG¶–æfõ&÷r‚$V×&W6"Â6Æ•²$V×&W6%Ò—ÒG¶–æfõ&÷r‚%%UB"Â6Æ•²%%UB%Ò—ÒG¶–æfõ&÷r‚$6öçF7Fò"Â6Æ•²$6öçF7Fò%Ò—ÒG¶–æfõ&÷r‚%FVÌ:–föæò"Â6Æ•²%FVÌ:–föæò%Ò—ÒG¶–æfõ&÷r‚$VÖ–Â"Â6Æ•²$VÖ–Â%Ò—ÒG¶–æfõ&÷r‚$F—&V66œ;6â"Â6Æ•²$F—&V66œ;6â%Ò—ÒG¶–æfõ&÷r‚$6ö×Væ"Â6Æ•²$6ö×Væ%Ò—ÒG¶–æfõ&÷r‚%&Vvœ;6â"Â6Æ•²%&Vvœ;6â%Ò—ÓÂ÷F&ÆSãÂöF—cà£ÆF—b6Æ73Ò&–æfòÖ&÷‚#ãÆƒ3åF†RÆ"6öÇWF–öç3Âöƒ3ãÇF&ÆSâG¶–æfõ&÷r‚%vV""Â'F†VÆ"ç6öÇWF–öç2"—ÒG¶–æfõ&÷r‚%FVÌ:–föæò"Â"³Sb’sƒcC""—ÒG¶–æfõ&÷r‚$VÖ–Â"Â&†öÆF†VÆ"ç6öÇWF–öç2"—ÒG¶–æfõ&÷r‚$F—&V66œ;6â"Â%¦&v÷¦ƒƒƒ"ÂÆ26öæFW2"—ÒG¶–æfõ&÷r‚$6—VFB"Â%6çF–vòÂ6†–ÆR"—ÓÂ÷F&ÆSãÂöF—cà£ÂöF—cà¢G·6öÆ–6—GVBòÆF—b6Æ73Ò'6V7F–öâÖÆ&VÂ#å6öÆ–6—GVBFVÂ6Æ–VçFSÂöF—cãÆF—b6Æ73Ò'6öÆ–6—GVBÖ&÷‚#âG¶W62‡6öÆ–6—GVB—ÓÂöF—cæ¢"'Ğ£ÆF—b6Æ73Ò&6öæF–6–öæW2Ö&÷‚#ãÇ7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£W‚#ãÇ7G&öæsåÄ¤òDRTåE$Tt£Â÷7G&öæsâG¶W62‡Æ¦÷G‡B—ÓÂ÷âG¶f÷&Ö‡FÖÂòÇ7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£'ƒ¶Ö&v–â×F÷£W‚#ãÇ7G&öæsädõ$ÔDRtó£Â÷7G&öæsãÂ÷ãÇ7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£W‚#âG¶f÷&Ö‡FÖÇÓÂ÷æ¢"'ÓÇ7G–ÆSÒ&6öÆ÷#¢3ƒƒƒ¶föçB×7G–ÆS¦—FÆ–2#â¢6÷F—¦6œ;6âl:Æ–F÷"L:Ö2Œ:&–ÆW2ãÂ÷ãÂöF—cà£ÆF—b6Æ73Ò'6V7F–öâÖÆ&VÂ"7G–ÆSÒ&Ö&v–â×F÷£‚#äFWFÆÆRFR&öGV7F÷2ò6W'f–6–÷3ÂöF—cà£ÇF&ÆR6Æ73Ò&—FV×2#ãÇF†VCãÇG#ãÇF‚7G–ÆSÒ&&6¶w&÷VæC¢3¶6öÆ÷#¢6ffb#äFW67&—6œ;6ãÂ÷FƒãÇF‚7G–ÆSÒ&&6¶w&÷VæC¢3¶6öÆ÷#¢6ffc·FW‡BÖÆ–vã¦6VçFW"#ä6çBãÂ÷FƒãÇF‚7G–ÆSÒ&&6¶w&÷VæC¢3¶6öÆ÷#¢6ffc·FW‡BÖÆ–vã§&–v‡B#å&V6–òVæ—BâæWFóÂ÷FƒãÇF‚7G–ÆSÒ&&6¶w&÷VæC¢3¶6öÆ÷#¢6ffc·FW‡BÖÆ–vã§&–v‡B#åF÷FÂæWFóÂ÷FƒãÂ÷G#ãÂ÷F†VCãÇF&öG“âG¶—FV×4…DÔÇÓÂ÷F&öG“ãÂ÷F&ÆSà£ÆF—b6Æ73Ò'F÷FÇ2#ãÆF—b6Æ73Ò'F÷FÇ2Ö&÷‚#âG·F÷FÇ5&÷w7ÓÂöF—cãÂöF—cà£ÆF—b6Æ73Ò'G&ç6fW"Ö&÷‚#ãÆF—b6Æ73Ò'G&ç6fW"×F—FÆR#äFF÷2FRG&ç6fW&Væ6–ÂöF—cãÇF&ÆSà£ÇG"7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6S†S†S‚#ãÇFB7G–ÆSÒ&6öÆ÷#¢3ƒƒƒ·v–GFƒ£#ƒ¶föçB×vV–v‡C£c·FW‡B×G&ç6f÷&Ó§WW&66S¶föçB×6—¦S£‡‚#å&¬;6â6ö6–ÃÂ÷FCãÇFB7G–ÆSÒ&föçB×vV–v‡C£S#åt5C4B5Â÷FCãÂ÷G#à£ÇG"7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6S†S†Sƒ¶&6¶w&÷VæC¢6c–c–c’#ãÇFB7G–ÆSÒ&6öÆ÷#¢3ƒƒƒ¶föçB×vV–v‡C£c·FW‡B×G&ç6f÷&Ó§WW&66S¶föçB×6—¦S£‡‚#ä&æ6óÂ÷FCãÇFB7G–ÆSÒ&föçB×vV–v‡C£S#ä$ä4òU5DDóÂ÷FCãÂ÷G#à£ÇG"7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6S†S†S‚#ãÇFB7G–ÆSÒ&6öÆ÷#¢3ƒƒƒ¶föçB×vV–v‡C£c·FW‡B×G&ç6f÷&Ó§WW&66S¶föçB×6—¦S£‡‚#åF—òFR7VVçFÂ÷FCãÇFB7G–ÆSÒ&föçB×vV–v‡C£S#ä5TTåDd•5D„4„UTU$TÄT5E,94ä”4“Â÷FCãÂ÷G#à£ÇG"7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6S†S†Sƒ¶&6¶w&÷VæC¢6c–c–c’#ãÇFB7G–ÆSÒ&6öÆ÷#¢3ƒƒƒ¶föçB×vV–v‡C£c·FW‡B×G&ç6f÷&Ó§WW&66S¶föçB×6—¦S£‡‚#å%UCÂ÷FCãÇFB7G–ÆSÒ&föçB×vV–v‡C£S#ãsrãC“’ãSSBÓCÂ÷FCãÂ÷G#à£ÇG"7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6S†S†S‚#ãÇFB7G–ÆSÒ&6öÆ÷#¢3ƒƒƒ¶föçB×vV–v‡C£c·FW‡B×G&ç6f÷&Ó§WW&66S¶föçB×6—¦S£‡‚#äì+FR7VVçFÂ÷FCãÇFB7G–ÆSÒ&föçB×vV–v‡C£S#ã“#sC#sƒÂ÷FCãÂ÷G#à£ÇG"7G–ÆSÒ&&6¶w&÷VæC¢6c–c–c’#ãÇFB7G–ÆSÒ&6öÆ÷#¢3ƒƒƒ¶föçB×vV–v‡C£c·FW‡B×G&ç6f÷&Ó§WW&66S¶föçB×6—¦S£‡‚#äVÖ–ÃÂ÷FCãÇFB7G–ÆSÒ&föçB×vV–v‡C£S#åtõ4D„TÄ"å4ôÅUD”ôå3Â÷FCãÂ÷G#à£Â÷F&ÆSãÂöF—cà£ÆF—b6Æ73Ò&fö÷FW"#ãÆF—b6Æ73Ò&ÆVgB#åF†RÆ"6öÇWF–öç27+r6çF–vòÂ6†–ÆSÆ'#æ†öÆF†VÆ"ç6öÇWF–öç2+r³Sb’sƒcC#ÂöF—cãÆF—b6Æ73Ò'fÆ–F—G’#ål:Æ–F†7F¢Ç7G&öæsâG¶W62‡gFò—ÓÂ÷7G&öæsãÂöF—cãÂöF—cà£Ç67&—Cà§f"õ%DÅõDô´TãÒG´¥4ôâç7G&–æv–g’‡Fö¶Vâ—Ó°¢Gµõ%DÅôDT4”D•%ô¥7Ğ£Â÷67&—Cà£Âö&öG“ãÂö‡FÖÃæ°¢&WGW&âæWr&W7öç6R†‡FÖÂÂ°¢7FGW3¢#À¢†VFW'3¢²$6öçFVçBÕG—R#¢'FW‡Bö‡FÖÃ²6†'6WC×WFbÓ‚"Â$66†RÔ6öçG&öÂ#¢&æò×7F÷&R"Â%‚Õ&ö&÷G2ÕFr#¢&æö–æFW‚ÂæöföÆÆ÷r"ÒÀ¢Ò“°§Ğ ¢ò¢)H)HÆV7GW&Vâ—'F&ÆR‡6–V×&R6W'fW"×6–FR’)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H¢ğ¦7–æ2gVæ7F–öâ÷'FÄvWE&V6÷&B†VçbÂF&ÆRÂ&V4–B’°¢G'’°¢6öç7B"Òv—BfWF6‚†G´•%D$ÄUô—ÒòG¶Vçbä•%D$ÄUô$4Uô”GÒòG¶Væ6öFUU$”6ö×öæVçB‡F&ÆR—ÒòG·&V4–GÖÂ°¢†VFW'3¢²WF†÷&—¦F–öã¢$&V&W""²Vçbä•%D$ÄUõDô´TâÒÀ¢Ò“°¢–b‚"æö²’&WGW&âçVÆÃ°¢&WGW&âv—B"æ§6öâ‚“°¢Ò6F6‚†R’°¢&WGW&âçVÆÃ°¢Ğ§Ğ¢òòÆ÷2&V4–G2f–VæVâFVÂ&÷–ò&Vv—7G&òFVÂ6Æ–VçFR†6×÷2Æ–æ²’Â<:ÒVRÆ¢òòl;7&×VÆæòVVFRÆÆWf"æF–ç–V7FFó²–wVÂ6RfÆ–FâVæòVæòà¦7–æ2gVæ7F–öâ÷'FÄvWDÆ–æ¶VB†VçbÂF&ÆRÂ–G2ÂÖ‚Ò3’°¢6öç7BÆ—7BÒ„'&’æ—4'&’†–G2’ò–G2¢µÒ’æf–ÇFW"†—5&V4–B’ç6Æ–6R‚ÖÖ‚“°¢–b‚Æ—7BæÆVæwF‚’&WGW&âµÓ°¢6öç7B÷WBÒµÓ°¢f÷"†ÆWB’Ò²’ÂÆ—7BæÆVæwFƒ²’³ÒR’°¢6öç7B6‡Væ²ÒÆ—7Bç6Æ–6R†’Â’²R“°¢6öç7BÒæWrU$Å6V&6…&×2‡°¢f–ÇFW$'”f÷&×VÆ¢õ"‚G¶6‡Væ²æÖ‚†–B’Óâ$T4õ$Eô”B‚“ÒrG¶–GÒv’æ¦ö–â‚"Â"—Ò–À¢vU6—¦S¢7G&–ær†6‡Væ²æÆVæwF‚’À¢Ò“°¢G'’°¢6öç7B"Òv—BfWF6‚†G´•%D$ÄUô—ÒòG¶Vçbä•%D$ÄUô$4Uô”GÒòG¶Væ6öFUU$”6ö×öæVçB‡F&ÆR—ÓòG·ÖÂ°¢†VFW'3¢²WF†÷&—¦F–öã¢$&V&W""²Vçbä•%D$ÄUõDô´TâÒÀ¢Ò“°¢–b‚"æö²’²6öç6öÆRæW'&÷"†·÷'FÅÒG·F&ÆWÓ¦Â"ç7FGW2“²6öçF–çVS²Ğ¢÷WBçW6‚‚âââ‚†v—B"æ§6öâ‚’’ç&V6÷&G2ÇÂµÒ’“°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"†·÷'FÅÒG·F&ÆWÓ¦ÂRæÖW76vR“°¢Ğ¢Ğ¢&WGW&â÷WC°§Ğ ¢ò¢)H)Hf÷&ÖFò6†–ÆVæó¢Cã#3BãScr’DBÔÔÒÔ)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H¢ğ¦gVæ7F–öâ÷'FÄ4Å†â’°¢6öç7BbÒçVÖ&W"†â“°¢–b‚çVÖ&W"æ—4f–æ—FR‡b’’&WGW&â"#°¢&WGW&â"B"²ÖF‚ç&÷VæB‡b’çFôÆö6ÆU7G&–ær‚&W2Ô4Â"’ç&WÆ6R‚òÂörÂ"â"“°§Ğ¦gVæ7F–öâ÷'FÄfV6††—6ò’°¢6öç7BÒÒõâ…ÆG³GÒ’Ò…ÆG³'Ò’Ò…ÆG³'Ò’òæW†V2…7G&–ær†—6òÇÂ""’“°¢&WGW&âÒòG¶Õ³5×ÒÒG¶Õ³%×ÒÒG¶Õ³×Ö¢"#°§Ğ ¢ò¢)H)H&ö&"ò&V6†¦#¢ÆòW6âÆÆ—7FFVÂ÷'FÂ’Æ†ö¦FRÆ¢6÷F—¦6œ;6ââVâÆÆ—7F&VV×Æ¦ÆF&¦WF²VâÆ†ö¦f—6’gVVÇfRâ)H)H¢ğ¦6öç7Bõ%DÅôDT4”D•%ô¥2Ò ¦7–æ2gVæ7F–öâ÷'FÄFV6–F—"†6÷BÆFV6—6–öâ—°¢f"6öÖVçF&–óÒrs°¢–b†FV6—6–öãÓÓÒu&V6†¦Fr—·f"Ó×&ö×B‚|+ôæ÷27VVçF2÷"\:“ò†÷6–öæÂ(	Bæ÷2—VFÖV¦÷&"Æ&÷VW7F’r“¶–b†ÓÓÓÖçVÆÂ—&WGW&ã¶6öÖVçF&–óÖ×ÇÂrs·Ğ¢VÇ6R–b‚6öæf—&Ò‚|+ô6öæf—&Ö2VR%TT$2W7F6÷F—¦6œ;6ãòæ÷2öæVÖ÷2VâÖ&6†FR–æÖVF–Fòâr’—&WGW&ã°¢f"6&CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÒr¶6÷B“¶–b†6&B–6&Bç7G–ÆRæ÷6—G“ÒsãSRs°¢f"ö´&ö#Ò~)É2*6÷F—¦6œ;6â&ö&Fw&6–2(	B'F–Ö÷2FR–æÖVF–Fò’FR6öçF7FÖ÷26öâÆ÷2,;7†–Ö÷26÷2âs°¢f"öµ&V6ƒÒt6÷F—¦6œ;6â&V6†¦Fâw&6–2÷"f—6&æ÷3²6’öFVÖ÷2§W7F"ÆvòÂW67,:Ö&Væ÷2†öÆF†VÆ"ç6öÇWF–öç2âs°¢G'—°¢f"#Öv—BfWF6‚‚r÷÷'FÂö6÷F—¦6–öâöFV6—6–öârÇ¶ÖWF†öC¢uõ5BrÆ†VFW'3§²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öâwÒÆ&öG“¤¥4ôâç7G&–æv–g’‡·C¥õ%DÅõDô´TâÆ6÷C¦6÷BÆFV6—6–öã¦FV6—6–öâÆ6öÖVçF&–ó¦6öÖVçF&–÷Ò—Ò“°¢f"&W3Öv—B"æ§6öâ‚’æ6F6‚†gVæ7F–öâ‚—·&WGW&âçVÆÃ·Ò“°¢–b‡"æö²bg&W2bg&W2æö²—°¢f"G‡CÖFV6—6–öãÓÓÒt&ö&Fsöö´&ö#¦öµ&V6ƒ°¢–b†6&B—¶6&Bç7G–ÆRæ÷6—G“Òss°¢6&Bæ–ææW$…DÔÃÖFV6—6–öãÓÓÒt&ö&Fp¢òsÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢3#6B#âr¶ö´&ö"²sÂöF—câp¢¢sÆF—b7G–ÆSÒ&föçB×6—¦S£7ƒ¶6öÆ÷#¢6#f#f&B#âr¶öµ&V6‚²sÂöF—câs°¢ÖVÇ6W¶ÆW'B‡G‡B“¶Æö6F–öâæ‡&VcÒr÷÷'FÃ÷CÒr¶Væ6öFUU$”6ö×öæVçB…õ%DÅõDô´Tâ“·Ğ¢ÖVÇ6W¶–b†6&B–6&Bç7G–ÆRæ÷6—G“Òss¶ÆW'B‚‡&W2bg&W2æW'&÷"—ÇÂtæò6RVFò&Vv—7G&"âW67,:Ö&Væ÷2†öÆF†VÆ"ç6öÇWF–öç2’Æò&W6öÇfVÖ÷2âr“·Ğ¢Ö6F6‚†R—¶–b†6&B–6&Bç7G–ÆRæ÷6—G“Òss¶ÆW'B‚u&ö&ÆVÖFR6öæW†œ;6ââW67,:Ö&Væ÷2†öÆF†VÆ"ç6öÇWF–öç2âr“·Ğ§Ö° ¢ò¢)H)HÆ:v–æ)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H¢ğ¦gVæ7F–öâ÷'FÅvR‡²Fö¶VâÂæöÖ'&RÂVF–F÷2Â6÷G2Ò’°¢6öç7BW62ÒW66T‡FÖÅs°¢6öç7B÷&FVâÒ†Â"’Óâ7G&–ær‚†"æf–VÆG2ÇÂ·Ò•²$fV6†–æw&W6ò%ÒÇÂ"æ7&VFVEF–ÖRÇÂ""’æÆö6ÆT6ö×&R…7G&–ær‚†æf–VÆG2ÇÂ·Ò•²$fV6†–æw&W6ò%ÒÇÂæ7&VFVEF–ÖRÇÂ""’“°¢6öç7BfW$6÷BÒ†6÷D–B’Óâ÷÷'FÂö6÷F—¦6–öã÷CÒG¶Væ6öFUU$”6ö×öæVçB‡Fö¶Vâ—Òf6÷CÒG¶Væ6öFUU$”6ö×öæVçB†6÷D–B—Ö° ¢6öç7B7FWW"Ò†W7FFò’Óâ°¢6öç7B–G‚Òõ%DÅõ5DtU2æ–æFW„öb†W7FFò“°¢6öç7B6÷2Òõ%DÅõ5DtU2æÖ‚‡2Â’’Óâ°¢6öç7B†V6†òÒ’ÃÒ–Gƒ°¢&WGW&âÆF—b7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£·FW‡BÖÆ–vã¦6VçFW"#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW"#ãÆF—b7G–ÆSÒ&†V–v‡C£7ƒ¶fÆWƒ£¶&6¶w&÷VæC¢G¶’ÓÓÒò'G&ç7&VçB"¢’ÃÒ–G‚ò"3#6B"¢"3#c#c&"'Ò#ãÂöF—cà¢ÆF—b7G–ÆSÒ'v–GFƒ£gƒ¶†V–v‡C£gƒ¶&÷&FW"×&F—W3£SS¶fÆW‚×6‡&–æ³£¶&6¶w&÷VæC¢G¶†V6†òò"3#6B"¢"3SS‚'Ó¶&÷&FW#£'‚6öÆ–BG¶†V6†òò"3#6B"¢"3333C6'Ò#ãÂöF—cà¢ÆF—b7G–ÆSÒ&†V–v‡C£7ƒ¶fÆWƒ£¶&6¶w&÷VæC¢G¶’ÓÓÒõ%DÅõ5DtU2æÆVæwF‚Òò'G&ç7&VçB"¢’Â–G‚ò"3#6B"¢"3#c#c&"'Ò#ãÂöF—cãÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£—ƒ¶Ö&v–â×F÷£Wƒ¶6öÆ÷#¢G¶’ÓÓÒ–G‚ò"6S†S†V"¢†V6†òò"3††“""¢"3V3V3c2'Ó¶föçB×vV–v‡C¢G¶’ÓÓÒ–G‚ò#s"¢#C'Ò#âG¶W62‡2ÓÓÒ$Æ—7Fò&FW76†ò"ò$Æ—7Fò"¢2ÓÓÒ$Vâ&öGV66œ;6â"ò%&öGV66œ;6â"¢2—ÓÂöF—cà¢ÂöF—cæ°¢Ò’æ¦ö–â‚""“°¢&WGW&âÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Ö&v–ã£G‚G‚#âG·6÷7ÓÂöF—cæ°¢Ó° ¢6öç7BVD…DÔÂÒVF–F÷2æÆVæwF€¢òVF–F÷2ç6Æ–6R‚’ç6÷'B†÷&FVâ’æÖ‚‡’Óâ°¢6öç7BbÒæf–VÆG2ÇÂ·Ó°¢6öç7BW7FFòÒe²$W7FFòVF–Fò%ÒÇÂ$6öæf—&ÖFò#°¢6öç7B6W'&FòÒ²$FW76†Fò"Â$6ö×ÆWFFò%Òæ–æ6ÇVFW2†W7FFò“°¢6öç7BVçG&VvÒ÷'FÄfV6††6W'&Fòbbe²$fV6†FW76†ò%Òòe²$fV6†FW76†ò%Ò¢e²$fV6†VçG&Vv%Ò“°¢6öç7B6VwV–Ö–VçFòÒ7G"‡e²$ì+6VwV–Ö–VçFò6÷W&–W"%Ò“°¢òò6÷F—¦6œ;6âFR÷&–vVâFVÂVF–Fó¢VÂ6Æ–VçFRVVFRföÇfW"fW&Æà¢6öç7B6÷DFVÅVF–FòÒ„'&’æ—4'&’‡e²$6÷F—¦6–öæW2%Ò’òe²$6÷F—¦6–öæW2%Ò¢µÒ’æf–ÇFW"†—5&V4–B•³Ó°¢&WGW&âÆF—b7G–ÆSÒ&&6¶w&÷VæC¢333S¶&÷&FW#£‚6öÆ–B3#c#c&#¶&÷&FW"×&F—W3£'ƒ·FF–æs£G‚gƒ¶Ö&v–âÖ&÷GFöÓ£‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Æ–vâÖ—FV×3¦6VçFW#¶v£ƒ¶fÆW‚×w&§w&#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£s¶ÆWGFW"×76–æs¢ã&VÒ#âG¶W62‡e²$ì+VF–Fò%ÒÇÂ.(	B"—ÓÂ÷7ãà¢Ç7â7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£s·FF–æs£7‚—ƒ¶&÷&FW"×&F—W3£gƒ¶&6¶w&÷VæC¢G¶W7FFòÓÓÒ$6æ6VÆFò"ò"36S#"¢6W'&Fòò"3c&##B"¢"3#&#32'Ó¶6öÆ÷#¢G¶W7FFòÓÓÒ$6æ6VÆFò"ò"6SSCƒFB"¢6W'&Fòò"3VfF63B"¢"3vf3FS'Ò#âG¶6W'&Fòò.)É2"¢"'ÒG¶W62†W7FFò—ÓÂ÷7ãà¢ÂöF—cà¢G¶W7FFòÓÓÒ$6æ6VÆFò"ò""¢7FWW"†W7FFò—Ğ¢G¶VçG&VvòÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#¢3††“#¶Ö&v–â×F÷£‡‚#ï	ù8RG¶6W'&Fòò$VçG&VvFò"¢$VçG&VvW7F–ÖF'Ó¢G¶W62†VçG&Vv—ÓÂöF—cæ¢"'Ğ¢G·6VwV–Ö–VçFòòÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#¢3††“#¶Ö&v–â×F÷£G‚#ï	ù©¢6VwV–Ö–VçFó¢G¶W62‡6VwV–Ö–VçFò—ÓÂöF—cæ¢"'Ğ¢G¶6÷DFVÅVF–FòòÆ‡&VcÒ"G·fW$6÷B†6÷DFVÅVF–Fò—Ò"7G–ÆSÒ&F—7Æ“¦–æÆ–æRÖ&Æö6³¶Ö&v–â×F÷£ƒ¶6öÆ÷#¢6S†S†V¶&÷&FW#£‚6öÆ–B3333C6¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‡‚Gƒ¶föçB×6—¦S£'ƒ·FW‡BÖFV6÷&F–öã¦æöæR#ï	ù8BfW"6÷F—¦6œ;6ãÂöæ¢"'Ğ¢ÂöF—cæ°¢Ò’æ¦ö–â‚""¢¢sÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#·FF–æs£‡ƒ¶6öÆ÷#¢3f#f#s3¶föçB×6—¦S£7‚#åFöFl:ÖæòF–VæW2VF–F÷2&Vv—7G&F÷2ãÂöF—câs° ¢6öç7B6÷D…DÔÂÒ6÷G2æÖ‚†2’Óâ°¢6öç7B6bÒ2æf–VÆG2ÇÂ·Ó°¢6öç7BF÷FÂÒ÷'FÄ4Å†6e²%F÷FÂf–æÂ„4Å’%Ò“°¢6öç7BgFòÒ÷'FÄfV6††6e²$fV6†fVæ6–Ö–VçFò%Ò“°¢6öç7BF—GVÆòÒ7G"†6e²$Æ–2òL:×GVÆò%Ò“°¢&WGW&âÆF—b–CÒ&6÷BÒG¶W62†2æ–B—Ò"7G–ÆSÒ&&6¶w&÷VæC¢333S¶&÷&FW#£‚6öÆ–B3#c#c&#¶&÷&FW"×&F—W3£'ƒ·FF–æs£G‚gƒ¶Ö&v–âÖ&÷GFöÓ£‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Æ–vâÖ—FV×3¦6VçFW#¶v£ƒ¶fÆW‚×w&§w&#à¢ÆF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£s#âG¶W62†6e²$ì+6÷F—¦6œ;6â%ÒÇÂ.(	B"—ÓÂöF—cà¢G·F—GVÆòòÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#¢3††“#¶Ö&v–â×F÷£'‚#âG¶W62‡F—GVÆò—ÓÂöF—cæ¢"'ÓÂöF—cà¢G·F÷FÂòÆF—b7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÆF—b7G–ÆSÒ&föçB×6—¦S£gƒ¶föçB×vV–v‡C£s#âG¶W62‡F÷FÂ—ÓÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#¢3f#f#s2#ä•d–æ6ÇV–FóÂöF—cãÂöF—cæ¢"'Ğ¢ÂöF—cà¢G·gFòòÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#¢3††“#¶Ö&v–â×F÷£‡‚#ål:Æ–F†7FG¶W62‡gFò—ÓÂöF—cæ¢"'Ğ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£‡ƒ¶Ö&v–â×F÷£'ƒ¶fÆW‚×w&§w&#à¢Æ'WGFöâöæ6Æ–6³Ò'÷'FÄFV6–F—"‚rG¶W62†2æ–B—ÒrÂt&ö&Fr’"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£3ƒ¶&6¶w&÷VæC¢3#6C¶6öÆ÷#¢3c#3c¶&÷&FW#£¶&÷&FW"×&F—W3£—ƒ·FF–æs£ƒ¶föçB×vV–v‡C£s¶föçB×6—¦S£Gƒ¶7W'6÷#§ö–çFW"#î)É2&ö&#Âö'WGFöãà¢Æ‡&VcÒ"G·fW$6÷B†2æ–B—Ò"7G–ÆSÒ&&6¶w&÷VæC§G&ç7&VçC¶6öÆ÷#¢6S†S†V¶&÷&FW#£‚6öÆ–B3333C6¶&÷&FW"×&F—W3£—ƒ·FF–æs£‚gƒ¶föçB×6—¦S£7ƒ·FW‡BÖFV6÷&F–öã¦æöæS·v†—FR×76S¦æ÷w&#ï	ù8BfW"6÷F—¦6œ;6ãÂöà¢Æ'WGFöâöæ6Æ–6³Ò'÷'FÄFV6–F—"‚rG¶W62†2æ–B—ÒrÂu&V6†¦Fr’"7G–ÆSÒ&&6¶w&÷VæC§G&ç7&VçC¶6öÆ÷#¢3††“#¶&÷&FW#£‚6öÆ–B3333C6¶&÷&FW"×&F—W3£—ƒ·FF–æs£‚gƒ¶föçB×6—¦S£7ƒ¶7W'6÷#§ö–çFW"#å&V6†¦#Âö'WGFöãà¢ÂöF—cà¢ÂöF—cæ°¢Ò’æ¦ö–â‚""“° ¢6öç7B‡FÖÂÒÂFö7G—R‡FÖÃãÆ‡FÖÂÆæsÒ&W2#ãÆ†VCãÆÖWF6†'6WCÒ'WFbÓ‚#ãÆÖWFæÖSÒ'f–Ww÷'B"6öçFVçCÒ'v–GFƒÖFWf–6R×v–GF‚Æ–æ—F–Â×66ÆSÓ#ãÆÖWFæÖSÒ'&ö&÷G2"6öçFVçCÒ&æö–æFW‚ÆæöföÆÆ÷r#ãÇF—FÆSåGW2VF–F÷2(	BF†RÆ"6öÇWF–öç3Â÷F—FÆSãÂö†VCà£Æ&öG’7G–ÆSÒ&Ö&v–ã£¶&6¶w&÷VæC¢3##3¶6öÆ÷#¢6S†S†V¶föçBÖfÖ–Ç“§7—7FVÒ×V’Ä&–ÂÇ6ç2×6W&–b#à£ÆF—b7G–ÆSÒ&Ö‚×v–GFƒ£c#ƒ¶Ö&v–ã£WFó·FF–æs£3G‚#‚C‡‚#à¢G¶Æövô†VFW"†fÇ6R—Ğ¢Æƒ7G–ÆSÒ&föçB×6—¦S£#'ƒ¶Ö&v–ã£G‚#âG¶W62†æöÖ'&R—ÓÂöƒà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£7ƒ¶6öÆ÷#¢3††“#¶Ö&v–âÖ&÷GFöÓ£#G‚#âG·VF–F÷2æÆVæwF‡ÒVF–FòG·VF–F÷2æÆVæwF‚ÓÒò'2"¢"'ÒG¶6÷G2æÆVæwF‚ò+rG¶6÷G2æÆVæwF‡Ò6÷F—¦6œ;6âG¶6÷G2æÆVæwF‚ÓÒò&W2"¢"'Ò÷"&W7öæFW&¢"'ÓÂöF—cà¢G¶6÷D…DÔÂòÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£s·FW‡B×G&ç6f÷&Ó§WW&66S¶ÆWGFW"×76–æs¢ãVÓ¶6öÆ÷#¢3vvƒ#¶Ö&v–âÖ&÷GFöÓ£‚#ä6÷F—¦6–öæW2VæF–VçFW3ÂöF—câG¶6÷D…DÔÇÓÆF—b7G–ÆSÒ&†V–v‡C£G‚#ãÂöF—cæ¢"'Ğ¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£s·FW‡B×G&ç6f÷&Ó§WW&66S¶ÆWGFW"×76–æs¢ãVÓ¶6öÆ÷#¢3vvƒ#¶Ö&v–âÖ&÷GFöÓ£‚#åGW2VF–F÷3ÂöF—cà¢G·VD…DÔÇĞ¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£#gƒ·FW‡BÖÆ–vã¦6VçFW#¶föçB×6—¦S£ƒ¶6öÆ÷#¢3f#f#s3¶Æ–æRÖ†V–v‡C£ãr#ì+ôGVF3òW67,:Ö&Væ÷2Æ‡&VcÒ&Ö–ÇFó¦†öÆF†VÆ"ç6öÇWF–öç2"7G–ÆSÒ&6öÆ÷#¢3#6B#æ†öÆF†VÆ"ç6öÇWF–öç3ÂöãÆ'#ãÆ‡&VcÒ&‡GG3¢ò÷F†VÆ"ç6öÇWF–öç2"7G–ÆSÒ&6öÆ÷#¢3f#f#s2#çF†VÆ"ç6öÇWF–öç3ÂöãÂöF—cà£ÂöF—cà£Ç67&—Cà§f"õ%DÅõDô´TãÒG´¥4ôâç7G&–æv–g’‡Fö¶Vâ—Ó°¢Gµõ%DÅôDT4”D•%ô¥7Ğ£Â÷67&—Cà£Âö&öG“ãÂö‡FÖÃæ°¢&WGW&âæWr&W7öç6R†‡FÖÂÂ°¢7FGW3¢#À¢†VFW'3¢²$6öçFVçBÕG—R#¢'FW‡Bö‡FÖÃ²6†'6WC×WFbÓ‚"Â$66†RÔ6öçG&öÂ#¢&æò×7F÷&R"Â%‚Õ&ö&÷G2ÕFr#¢&æö–æFW‚ÂæöföÆÆ÷r"ÒÀ¢Ò“°§Ğ ¦7–æ2gVæ7F–öâ6VæD6÷DFV6—6–öäÆW'B†VçbÂ²çVÔ6÷BÂFV6—6–öâÂ6öÖVçF&–òÒ’°¢–b‚Vçbå$U4TäEô•ô´U’’&WGW&ã°¢6öç7Bg&öÒÒVçbå$U4TäEôe$ôÒÇÂ%F†RÆ"6öÇWF–öç2Æ†öÆF†VÆ"ç6öÇWF–öç3â#°¢6öç7BFòÒVçbäÄTE5ôäõD”e•õDòÇÂ'F†VÆ'6öÇWF–öç66ÄvÖ–Âæ6öÒ#°¢6öç7BW62Ò‡2’Óâ7G&–ær‡2ÓÒçVÆÂò""¢2’ç&WÆ6R‚õ²cÃâ"uÒörÂ†2’Óâ†2ÓÓÒ"b"ò"f×²"¢2ÓÓÒ#Â"ò"fÇC²"¢2ÓÓÒ#â"ò"fwC²"¢2ÓÓÒr"rò"gV÷C²"¢"b33“²"’“°¢6öç7B&ö"ÒFV6—6–öâÓÓÒ$&ö&F#°¢6öç7B‡FÖÂĞ¢ÆF—b7G–ÆSÒ&föçBÖfÖ–Ç“§7—7FVÒ×V’Ä&–ÂÇ6ç2×6W&–c¶6öÆ÷#¢3¶Æ–æRÖ†V–v‡C£ãSS¶Ö‚×v–GFƒ£Sc‚#æ°¢Æƒ"7G–ÆSÒ&Ö&v–ã£'ƒ¶6öÆ÷#¢G¶&ö"ò"3†cf"¢"6##'Ò#âG¶&ö"ò.)ÈR"¢/	ùª²'Ò6÷F—¦6œ;6âG¶W62†çVÔ6÷B—ÒG¶&ö"ò$$ô$D"¢%$T4„¤D'Ò÷"VÂ6Æ–VçFSÂöƒ#æ°¢ÇäVÂ6Æ–VçFRG¶&ö"ò&&ö,;2"¢'&V6†¬;2'ÒÆ6÷F—¦6œ;6âÇ7G&öæsâG¶W62†çVÔ6÷B—ÓÂ÷7G&öæsâFW6FRVÂ÷'FÂãÂ÷æ°¢†6öÖVçF&–òòÇ7G–ÆSÒ&&6¶w&÷VæC¢6cfcfcc¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‡‚'‚#ãÇ7G&öæsä6öÖVçF&–ó£Â÷7G&öæsâG¶W62†6öÖVçF&–ò—ÓÂ÷æ¢""’°¢ÇâG¶&ö"ò%öçFRVâÖ&6†¢6öæf—&ÖVÂçF–6—ò’7&VVÂVF–Fòâ"¢$6öç6–FW&Vâv–âÖ&6²ò§W7F"Æ&÷VW7Fâ'ÓÂ÷æ°¢Ç7G–ÆSÒ&6öÆ÷#¢3ccc¶föçB×6—¦S£7ƒ¶Ö&v–â×F÷£‡‚#î(	B÷'FÂFR6Æ–VçFW2+rF†RÆ"6öÇWF–öç3Â÷ãÂöF—cæ°¢G'’°¢v—BfWF6‚‚&‡GG3¢òö’ç&W6VæBæ6öÒöVÖ–Ç2"Â°¢ÖWF†öC¢%õ5B"À¢†VFW'3¢²WF†÷&—¦F–öã¢$&V&W""²Vçbå$U4TäEô•ô´U’Â$6öçFVçBÕG—R#¢&Æ–6F–öâö§6öâ"ÒÀ¢&öG“¢¥4ôâç7G&–æv–g’‡²g&öÒÂFó¢·FõÒÂ7V&¦V7C¢G¶&ö"ò.)ÈR"¢/	ùª²'Ò6÷F—¦6œ;6âG¶çVÔ6÷GÒG¶&ö"ò&&ö&F"¢'&V6†¦F'Ò÷"VÂ6Æ–VçFVÂ‡FÖÂÒ’À¢Ò“°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚%¶ÆVG2×v÷&¶W%ÒÆW'FFV6—6œ;6â6÷F—¦6œ;6ã¢"ÂRæÖW76vR“°¢Ğ§Ğ ¢ò¢)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢¢%UD¢öç2†Væ7VW7FFR6F—6f66œ;6â÷7BÖVçG&VvÂ6Æ–2FW6FRVÂÖVç6¦R¢¢tUBöç3÷Ö&6ScB‡VF–Fõ&V4–B’(i":v–æ6öâR6&—F0¢¢tUBöç3÷Òâââg3ÓâãU²fs×W&Å&W6\;Ò(i"&Vv—7G&Ææ÷F’w&FV6P¢¢õ5Böç2·Fö¶VâÂ6öÖVçF&–÷Ò(i"wV&FVÂ6öÖVçF&–ò÷6–öæÀ¢¢6VwW&–FC¢VÂ&V4–BæòW2F—f–æ&ÆS²Ææ÷FW2FVÂ&÷–ò6Æ–VçFR‡VVFP¢¢6÷'&Vv—&Æ&VVçf–æFò’âW67&–&RVâVF–F÷3¢$å266÷&R"Â$å2fV6†"À¢¢$å26öÖVçF&–ò"†Æ÷27&VVÂF6†&ö&B&¦òFVÖæF’à¢¢)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y¢ğ¦gVæ7F–öâöç4FV6öFUFö¶Vâ‡B’°¢ÆWB–C°¢G'’²–BÒFö"…7G&–ær‡BÇÂ""’“²Ò6F6‚†R’²&WGW&âçVÆÃ²Ğ¢&WGW&â—5&V4–B†–B’ò–B¢çVÆÃ°§Ğ¦7–æ2gVæ7F–öâ†æFÆTç2‡&WVW7BÂVçbÂ7G‚Â6÷'2’°¢6öç7BW&ÂÒæWrU$Â‡&WVW7BçW&Â“° ¢òòVÂFö¶VâW2&6ScBFVÂ&V4–BÂ6–âf—&Ö¢VÂÌ:ÖÖ—FR÷"•Wf—FVRÆwV–Và¢òò'VV&RFö¶Vç2VâÖ6ò–çVæFRFRW67&—GW&2—'F&ÆRâ3ö‚FFR6ö'&¢òò&VÂfÇV¦ò&VÂ†'&—"Æ:v–æÂ6Æ–f–6"’6öÖVçF"’à¢–b†v—B&FTÆ–Ö—FVB†VçbÂ&WVW7BÂ&ç2"Â3Â3c’’°¢–b‡&WVW7BæÖWF†öBÓÓÒ%õ5B"’&WGW&â§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$FVÖ6–F÷2–çFVçF÷2Â–çFVçFÜ:2F&FR"ÒÂC#’Â6÷'2“°¢&WGW&â‡FÖÅvR‚$FVÖ6–F÷2–çFVçF÷2"Â$W7W&Væ÷2Ö–çWF÷2’gVVÇfR'&—"VÂVæÆ6Râ"ÂfÇ6RÂC#’“°¢Ğ ¢òòõ5B(i"6öÖVçF&–ò÷6–öæÀ¢–b‡&WVW7BæÖWF†öBÓÓÒ%õ5B"’°¢6öç7B&öG’Òv—B&VD§6öâ‡&WVW7B“°¢–b‚&öG’’&WGW&â§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$¥4ôâ–çl:Æ–Fò"ÒÂCÂ6÷'2“°¢6öç7BVD–BÒöç4FV6öFUFö¶Vâ†&öG’çFö¶Vâ“°¢–b‚VD–B’&WGW&â§6öâ‡²ö³¢fÇ6RÂW'&÷#¢%Fö¶Vâ–çl:Æ–Fò"ÒÂCÂ6÷'2“°¢–b‚Vçbä•%D$ÄUõDô´TâÇÂVçbä•%D$ÄUô$4Uô”B’&WGW&â§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$æò6öæf–wW&Fò"ÒÂSÂ6÷'2“°¢6öç7B6öÖVçF&–òÒ7G&–ær†&öG’æ6öÖVçF&–òÇÂ""’ç6Æ–6RƒÂ#“°¢–b†6öÖVçF&–ò’°¢G'’²v—B—'F&ÆUWFFUFöÆW&çB†VçbÂ%VF–F÷2"ÂVD–BÂ²$å26öÖVçF&–ò#¢6öÖVçF&–òÒ“²Ò6F6‚†R’·Ğ¢7G‚çv—EVçF–Â‡6VæDç4ÆW'B†VçbÂ²VD–BÂ6öÖVçF&–òÂ6öÖVçF&–ôöæÇ“¢G'VRÒ’“°¢Ğ¢&WGW&â§6öâ‡²ö³¢G'VRÒÂ#Â6÷'2“°¢Ğ ¢òòtU@¢6öç7BVD–BÒöç4FV6öFUFö¶Vâ‡W&Âç6V&6…&×2ævWB‚'"’“°¢–b‚VD–B’&WGW&â‡FÖÅvR‚$VæÆ6R–çl:Æ–Fò"Â$W7FRVæÆ6RFRVæ7VW7FæòW2l:Æ–Fòò–W‡—,;2â"ÂfÇ6R“°¢6öç7Bu&rÒW&Âç6V&6…&×2ævWB‚&r"’ÇÂ"#°¢6öç7BuW&ÂÒõæ‡GG3ó¥ÂõÂòö’çFW7B†u&r’òu&r¢"#°¢6öç7B5&rÒW&Âç6V&6…&×2ævWB‚'2"“° ¢òò6–â66÷&R(i"Ö÷7G&"Æ:v–æFR6Æ–f–66œ;6à¢–b‡5&rÓÒçVÆÂ’&WGW&âç5&F–æuvR‡VD–BÂuW&Â“° ¢6öç7B66÷&RÒ'6T–çB‡5&rÂ“°¢–b‚‡66÷&RãÒbb66÷&RÃÒR’’&WGW&â‡FÖÅvR‚$6Æ–f–66œ;6â–çl:Æ–F"Â$VÆ–vRVææ÷FFVÂÂRâ"ÂfÇ6R“°¢–b‚Vçbä•%D$ÄUõDô´TâÇÂVçbä•%D$ÄUô$4Uô”B’&WGW&âç5F†æ·5vR‡66÷&RÂVD–BÂuW&Â“° ¢G'’°¢v—B—'F&ÆUWFFUFöÆW&çB†VçbÂ%VF–F÷2"ÂVD–BÂ°¢$å266÷&R#¢66÷&RÀ¢$å2fV6†#¢FöF’‚’À¢Ò“°¢Ò6F6‚†R’°¢òò&W7BÖVff÷'C¢–wVÂw&FV6VÖ÷2&æòg'W7G&"Â6Æ–VçFP¢Ğ¢7G‚çv—EVçF–Â‡6VæDç4ÆW'B†VçbÂ²VD–BÂ66÷&RÒ’“°¢&WGW&âç5F†æ·5vR‡66÷&RÂVD–BÂuW&Â“°§Ğ¦gVæ7F–öâç5&F–æuvR‡VD–BÂuW&Â’°¢6öç7BFö²Ò'Fö‡VD–B“°¢6öç7BrÒuW&Âò"fsÒ"²Væ6öFUU$”6ö×öæVçB†uW&Â’¢"#°¢6öç7Bf6W2Ò°¢²ã¢ÂS¢/	ù‰â"ÂC¢$×W’ÖÆò"ÒÀ¢²ã¢"ÂS¢/	ù˜"ÂC¢$ÖÆò"ÒÀ¢²ã¢2ÂS¢/	ù‰"ÂC¢%&VwVÆ""ÒÀ¢²ã¢BÂS¢/	ù˜""ÂC¢$'VVæò"ÒÀ¢²ã¢RÂS¢/	ùˆÒ"ÂC¢$W†6VÆVçFR"ÒÀ¢Ó°¢6öç7B'Fç2Òf6W2æÖ‚†b’Óà¢Æ‡&VcÒ"öç3÷ÒG·Fö·Òg3ÒG¶bæçÒG¶wÒ"7G–ÆSÒ&F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶Æ–vâÖ—FV×3¦6VçFW#¶v£gƒ·FW‡BÖFV6÷&F–öã¦æöæS·FF–æs£'‚‡ƒ¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢3SSƒ¶&÷&FW#£‚6öÆ–B3#c#c&#¶Ö–â×v–GFƒ£S‡ƒ·G&ç6—F–öã§G&ç6f÷&Òã2#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£3G‚#âG¶bæWÓÂ÷7ãà¢Ç7â7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#¢3††“"#âG¶bçGÓÂ÷7ããÂöæ ¢’æ¦ö–â‚""“°¢6öç7B‡FÖÂÒÂFö7G—R‡FÖÃãÆ‡FÖÂÆæsÒ&W2#ãÆ†VCãÆÖWF6†'6WCÒ'WFbÓ‚#ãÆÖWFæÖSÒ'f–Ww÷'B"6öçFVçCÒ'v–GFƒÖFWf–6R×v–GF‚Æ–æ—F–Â×66ÆSÓ#ãÇF—FÆSì+ô<;6ÖòÆò†–6–Ö÷3ò(	BF†RÆ"6öÇWF–öç3Â÷F—FÆSãÂö†VCà£Æ&öG’7G–ÆSÒ&Ö&v–ã£¶&6¶w&÷VæC¢3##3¶6öÆ÷#¢6S†S†V¶föçBÖfÖ–Ç“§7—7FVÒ×V’Ä&–ÂÇ6ç2×6W&–c¶F—7Æ“¦fÆWƒ¶Ö–âÖ†V–v‡C£fƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC¦6VçFW"#à£ÆF—b7G–ÆSÒ&Ö‚×v–GFƒ£Cƒƒ·FF–æs£C‚#Gƒ·FW‡BÖÆ–vã¦6VçFW"#à¢G¶Æövô†VFW"‡G'VR—Ğ£Æƒ7G–ÆSÒ&föçB×6—¦S£#'ƒ¶Ö&v–ã£‡‚#ì+ô<;6ÖògVRGRW‡W&–Væ6–óÂöƒà£Ç7G–ÆSÒ&föçB×6—¦S£Wƒ¶Æ–æRÖ†V–v‡C£ãc¶6öÆ÷#¢6#f#f&C¶Ö&v–ã£#G‚#åGR÷–æœ;6âæ÷2FöÖR6VwVæF÷2’æ÷2—VFVâÖöçL;6â	ù)“Â÷à£ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£‡ƒ¶§W7F–g’Ö6öçFVçC¦6VçFW#¶fÆW‚×w&§w&#âG¶'Fç7ÓÂöF—cà£ÂöF—cãÂö&öG“ãÂö‡FÖÃæ°¢&WGW&âæWr&W7öç6R†‡FÖÂÂ²7FGW3¢#Â†VFW'3¢²$6öçFVçBÕG—R#¢'FW‡Bö‡FÖÃ²6†'6WC×WFbÓ‚"ÒÒ“°§Ğ¦gVæ7F–öâç5F†æ·5vR‡66÷&RÂVD–BÂuW&Â’°¢6öç7BFö²Ò'Fö‡VD–B“°¢6öç7BfVÆ—¢Ò66÷&RãÒC°¢6öç7B6öÆ÷"ÒfVÆ—¢ò"3#6B"¢66÷&RÓÓÒ2ò"6cVc#2"¢"6SSCƒFB#°¢6öç7BF—GVÆòÒfVÆ—¢ò,*w&6–2÷"GRæ÷F	ù˜Â"¢$w&6–2ÂÆòFöÖÖ÷2×W’Vâ6W&–ò#°¢6öç7B×6rÒfVÆ— ¢ò$æ÷2ÆVw&×V6†òVRÆ†–26Fò&–Vââ*6VwV–Ö÷2G&&¦æFò&F’ ¢¢$ÆÖVçFÖ÷2æò†&W"W7FFòÆÇGW&â7\:–çFæ÷2\:’<;2’Æò&W6öÇfVÖ÷3¢#°¢òò&æ÷F2ÇF2’6öâVæÆ6RFR&W6\;¢–çf—F"vöövÆRâ&&¦3¢6¦FR6öÖVçF&–òà¢6öç7BW‡G&ÒfVÆ—¢bbuW&À¢òÆ‡&VcÒ"G¶W66T‡FÖÅr†uW&Â—Ò"7G–ÆSÒ&F—7Æ“¦–æÆ–æRÖ&Æö6³¶&6¶w&÷VæC¢3#6C¶6öÆ÷#¢3c#3c¶föçB×vV–v‡C£s·FW‡BÖFV6÷&F–öã¦æöæS·FF–æs£‚#ƒ¶&÷&FW"×&F—W3£—ƒ¶föçB×6—¦S£Gƒ¶Ö&v–â×F÷£‡‚#î*ÙL:–¦æ÷2Væ&W6\;VâvöövÆSÂöæ ¢¢‚fVÆ— ¢òÆf÷&Ò–CÒ&6b"7G–ÆSÒ&Ö&v–â×F÷£‡ƒ·FW‡BÖÆ–vã¦ÆVgB#à¢ÇFW‡F&V–CÒ&6Ò"&÷w3Ò#B"Æ6V†öÆFW#Ò,+õ\:’öG,:ÖÖ÷2ÖV¦÷&#ò"7G–ÆSÒ'v–GFƒ£S¶&÷‚×6—¦–æs¦&÷&FW"Ö&÷ƒ¶&6¶w&÷VæC¢3SSƒ¶&÷&FW#£‚6öÆ–B3#c#c&#¶&÷&FW"×&F—W3£ƒ¶6öÆ÷#¢6S†S†V·FF–æs£'ƒ¶föçB×6—¦S£Gƒ¶föçBÖfÖ–Ç“¦–æ†W&—B#ãÂ÷FW‡F&Và¢Æ'WGFöâG—SÒ'7V&Ö—B"7G–ÆSÒ'v–GFƒ£S¶Ö&v–â×F÷£ƒ¶&6¶w&÷VæC¢3#6C¶6öÆ÷#¢3c#3c¶föçB×vV–v‡C£s¶&÷&FW#£·FF–æs£'ƒ¶&÷&FW"×&F—W3£—ƒ¶föçB×6—¦S£Gƒ¶7W'6÷#§ö–çFW"#äVçf–"6öÖVçF&–óÂö'WGFöãà¢Âöf÷&Óà¢ÆF—b–CÒ&ö¶×6r"7G–ÆSÒ&F—7Æ“¦æöæS¶6öÆ÷#¢3#6C¶Ö&v–â×F÷£'ƒ¶föçB×vV–v‡C£c#ì*w&6–2Æò&Wf—6&VÖ÷2Vç6VwV–FãÂöF—cà¢Ç67&—Cà¢Fö7VÖVçBævWDVÆVÖVçFÚ±î¸Â¸­yêë¢°k¢G§¦*^ById('cf').addEventListener('submit',async function(ev){ev.preventDefault();
             var t=document.getElementById('cm').value.trim();if(!t)return;
             try{await fetch('/nps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(tok)},comentario:t})});}catch(e){}
             document.getElementById('cf').style.display='none';document.getElementById('okmsg').style.display='block';});
         </script>`
      : "");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gracias â€” The Lab Solutions</title></head>
<body style="margin:0;background:#0b0b0c;color:#e8e8ea;font-family:system-ui,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:460px;padding:40px 24px;text-align:center">
${logoHeader(true)}
<div style="font-size:44px;margin-bottom:8px">${feliz ? "ğŸ‰" : "ğŸ™"}</div>
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
  // NÂº de pedido para el aviso (best-effort)
  let numPed = pedId;
  try {
    const r = await fetch(`${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/Pedidos/${pedId}`, {
      headers: { Authorization: "Bearer " + env.AIRTABLE_TOKEN },
    });
    if (r.ok) { const rec = await r.json(); numPed = (rec.fields && rec.fields["NÂ° Pedido"]) || pedId; }
  } catch (e) {}
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));
  const faces = { 1: "ğŸ˜", 2: "ğŸ™", 3: "ğŸ˜", 4: "ğŸ™‚", 5: "ğŸ˜" };
  let subject, html;
  if (comentarioOnly) {
    subject = `ğŸ’¬ Comentario de satisfacciÃ³n â€” Pedido ${numPed}`;
    html = `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.55;max-width:560px"><h2 style="margin:0 0 12px">ğŸ’¬ Nuevo comentario post-entrega</h2><p>Pedido <strong>${esc(numPed)}</strong>:</p><p style="background:#f6f6f6;border-radius:8px;padding:8px 12px">${esc(comentario)}</p></div>`;
  } else {
    const bajo = score <= 3;
    subject = `${faces[score] || "â­"} SatisfacciÃ³n ${score}/5 â€” Pedido ${numPed}${bajo ? " (requiere atenciÃ³n)" : ""}`;
    html = `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.55;max-width:560px"><h2 style="margin:0 0 12px;color:${bajo ? "#b00020" : "#0a8f6a"}">${faces[score] || "â­"} El cliente calificÃ³ ${score}/5</h2><p>Pedido <strong>${esc(numPed)}</strong>.</p>${bajo ? '<p style="color:#b00020"><strong>Nota baja:</strong> contacta al cliente para recuperar la relaciÃ³n.</p>' : "<p>Â¡Buen trabajo! Buen momento para pedir una reseÃ±a o referidos.</p>"}</div>`;
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

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * RUTA: GET /pod  (comprobante de entrega â€” el cliente confirma la recepciÃ³n)
 *   GET /pod?p=base64(pedidoRecId)        â†’ pÃ¡gina con botÃ³n de confirmaciÃ³n
 *   GET /pod?p=...&c=1                     â†’ registra la recepciÃ³n y agradece
 * Escribe en Pedidos: "RecepciÃ³n confirmada" (checkbox) y "RecepciÃ³n fecha".
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function handlePod(request, env, ctx, cors) {
  const url = new URL(request.url);
  // Mismo motivo que en /nps: este enlace marca "RecepciÃ³n confirmada", asÃ­ que
  // no puede quedar expuesto a que se prueben tokens sin lÃ­mite.
  if (await rateLimited(env, request, "pod", 30, 3600)) {
    return htmlPage("Demasiados intentos", "Espera unos minutos y vuelve a abrir el enlace.", false, 429);
  }
  const pedId = _npsDecodeToken(url.searchParams.get("p"));
  if (!pedId) return htmlPage("Enlace invÃ¡lido", "Este enlace de confirmaciÃ³n no es vÃ¡lido o ya expirÃ³.", false);
  const confirm = url.searchParams.get("c") === "1";
  if (!confirm) return podConfirmPage(pedId);
  if (env.AIRTABLE_TOKEN && env.AIRTABLE_BASE_ID) {
    try {
      await airtableUpdateTolerant(env, "Pedidos", pedId, {
        "RecepciÃ³n confirmada": true,
        "RecepciÃ³n fecha": today(),
      });
    } catch (e) {}
    ctx.waitUntil(sendPodAlert(env, pedId));
  }
  return htmlPage("Â¡RecepciÃ³n confirmada! âœ…", "Gracias por confirmar que recibiste tu pedido conforme. Â¡Fue un gusto trabajar contigo!", true);
}
function podConfirmPage(pedId) {
  const tok = btoa(pedId);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirmar recepciÃ³n â€” The Lab Solutions</title></head>
<body style="margin:0;background:#0b0b0c;color:#e8e8ea;font-family:system-ui,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:460px;padding:40px 24px;text-align:center">
${logoHeader(true)}
<div style="font-size:44px;margin-bottom:8px">ğŸ“¦</div>
<h1 style="font-size:22px;margin:0 0 12px">Â¿Recibiste tu pedido?</h1>
<p style="font-size:15px;line-height:1.6;color:#b6b6bd;margin:0 0 24px">ConfÃ­rmanos que llegÃ³ todo en orden. Nos tomas 1 segundo y nos ayuda a cerrar el pedido.</p>
<a href="/pod?p=${tok}&c=1" style="display:inline-block;background:#00b3a4;color:#06231f;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:10px;font-size:15px">âœ… SÃ­, lo recibÃ­ conforme</a>
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
    if (r.ok) { const rec = await r.json(); numPed = (rec.fields && rec.fields["NÂ° Pedido"]) || pedId; }
  } catch (e) {}
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: `âœ… Entrega confirmada â€” Pedido ${numPed}`, html: `<div style="font-family:system-ui,Arial,sans-serif;color:#111"><h2 style="color:#0a8f6a">âœ… El cliente confirmÃ³ la recepciÃ³n</h2><p>Pedido <strong>${esc(numPed)}</strong> recibido conforme. Puedes cerrarlo.</p></div>` }),
    });
  } catch (e) {
    console.error("[leads-worker] alerta POD:", e.message);
  }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * RUTA: GET /pedido?p=base64(pedidoRecId)  (portal de seguimiento, solo lectura)
 * Muestra al cliente el estado de su pedido en una lÃ­nea de progreso.
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function handlePedidoEstado(request, env) {
  const url = new URL(request.url);
  // Seguimiento: el cliente recarga la pÃ¡gina varias veces mientras espera, por
  // eso el lÃ­mite es mÃ¡s holgado que en /nps y /pod (que son de un solo uso).
  if (await rateLimited(env, request, "pedido", 60, 3600)) {
    return htmlPage("Demasiados intentos", "Espera unos minutos y vuelve a abrir el enlace.", false, 429);
  }
  const pedId = _npsDecodeToken(url.searchParams.get("p"));
  if (!pedId) return htmlPage("Enlace invÃ¡lido", "Este enlace de seguimiento no es vÃ¡lido o ya expirÃ³.", false);
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return htmlPage("No disponible", "El seguimiento no estÃ¡ disponible en este momento.", false);
  let rec;
  try {
    const r = await fetch(`${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/Pedidos/${pedId}`, { headers: { Authorization: "Bearer " + env.AIRTABLE_TOKEN } });
    if (r.status === 404) return htmlPage("Pedido no encontrado", "No pudimos encontrar este pedido.", false);
    if (!r.ok) return htmlPage("No disponible", "No pudimos leer el estado ahora. Intenta mÃ¡s tarde.", false);
    rec = await r.json();
  } catch (e) {
    return htmlPage("No disponible", "Error de conexiÃ³n. Intenta mÃ¡s tarde.", false);
  }
  const f = rec.fields || {};
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));
  const estado = f["Estado pedido"] || "Confirmado";
  if (estado === "Cancelado") return htmlPage("Pedido cancelado", "Este pedido figura como cancelado. Si crees que es un error, escrÃ­benos.", false);
  const stages = ["Confirmado", "En producciÃ³n", "Listo para despacho", "Despachado"];
  let idx = stages.indexOf(estado);
  if (idx < 0) idx = f["RecepciÃ³n confirmada"] ? 3 : 0;
  const entrega = f["Fecha entrega"] || "";
  const numPed = f["NÂ° Pedido"] || "";
  const recibido = !!f["RecepciÃ³n confirmada"];
  const steps = stages.map((s, i) => {
    const done = i < idx || (i === idx);
    const active = i === idx;
    const color = done ? "#00b3a4" : "#2b323b";
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0">
      <div style="width:26px;height:26px;border-radius:50%;flex-shrink:0;background:${done ? "#00b3a4" : "#151518"};border:2px solid ${done ? "#00b3a4" : "#33343a"};display:flex;align-items:center;justify-content:center;color:${done ? "#06231f" : "#7a7a82"};font-weight:800;font-size:13px">${i < idx ? "âœ“" : (i + 1)}</div>
      <span style="font-size:15px;color:${active ? "#e8e8ea" : done ? "#b6b6bd" : "#6b6b73"};font-weight:${active ? "700" : "400"}">${esc(s)}${active ? " Â·  ahora" : ""}</span>
    </div>`;
  }).join("");
  const pct = Math.round(((idx + 1) / stages.length) * 100);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seguimiento ${esc(numPed)} â€” The Lab Solutions</title></head>
<body style="margin:0;background:#0b0b0c;color:#e8e8ea;font-family:system-ui,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:440px;width:100%;padding:36px 26px">
${logoHeader(false)}
<h1 style="font-size:22px;margin:0 0 4px">Seguimiento de tu pedido</h1>
<div style="font-size:13px;color:#8a8a92;margin-bottom:20px">${numPed ? "NÂ° " + esc(numPed) : ""}${entrega ? " Â· entrega estimada " + esc(entrega) : ""}</div>
<div style="height:8px;background:#151518;border-radius:5px;overflow:hidden;margin-bottom:8px"><div style="height:100%;width:${pct}%;background:#00b3a4;border-radius:5px"></div></div>
<div style="font-size:12px;color:#8a8a92;margin-bottom:18px">${pct}% del proceso</div>
<div style="border:1px solid #26262b;border-radius:14px;padding:8px 18px">${steps}</div>
${recibido ? '<div style="margin-top:16px;padding:11px 14px;background:#0f2b24;border:1px solid #1c4a3f;border-radius:10px;font-size:13px;color:#5fdcc4">âœ… RecepciÃ³n confirmada. Â¡Gracias!</div>' : ""}
<div style="margin-top:22px;text-align:center;font-size:11px;color:#6b6b73">Â¿Dudas? EscrÃ­benos por WhatsApp o a hola@thelab.solutions</div>
</div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * RUTA: POST /lead   (formulario de la web pÃºblica)
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function handleLead(request, env, ctx, cors) {
  // 1) Clave compartida (anti-bot bÃ¡sico â€” NO es seguridad fuerte)
  if (env.PUBLIC_LEAD_KEY) {
    const key = request.headers.get("X-Public-Lead-Key") || "";
    if (!timingSafeEqual(key, env.PUBLIC_LEAD_KEY)) {
      return json({ ok: false, error: "No autorizado" }, 401, cors);
    }
  }

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON invÃ¡lido" }, 400, cors);

  // 2) Honeypot: si viene relleno, es un bot. Respondemos 200 para no enseÃ±arle.
  if (body.company_website || body._hp) {
    return json({ ok: true, clienteId: null, queueId: null }, 200, cors);
  }

  // 3) Turnstile (opcional)
  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, request);
    if (!ok) return json({ ok: false, error: "VerificaciÃ³n anti-bot fallÃ³" }, 403, cors);
  }

  // 4) Rate-limit por IP (opcional, requiere binding KV "RL")
  const limited = await rateLimited(env, request, "lead", 8, 60);
  if (limited) return json({ ok: false, error: "Demasiadas solicitudes" }, 429, cors);

  // 5) ValidaciÃ³n mÃ­nima
  const name = str(body.name);
  const company = str(body.company);
  const email = str(body.email);
  const phone = str(body.phone);
  if (!name && !company) {
    return json({ ok: false, error: "Falta nombre o empresa" }, 400, cors);
  }
  if (!email && !phone) {
    return json({ ok: false, error: "Falta email o telÃ©fono" }, 400, cors);
  }

  const norm = normalizeWeb(body);

  // 6) Adjunto opcional (imagen o PDF de referencia del cotizador pÃºblico).
  //    ValidaciÃ³n estricta: tipo permitido y â‰¤ ~4 MB decodificado (el lÃ­mite
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

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * RUTA: POST /proveedor   (formulario "SÃ© nuestro proveedor" de la web)
 * Crea un registro en la tabla Proveedores con "Estado postulaciÃ³n" = ENTREVISTAR.
 * El equipo lo cambia luego a APROBADO / RECHAZADO y aÃ±ade "Motivo evaluaciÃ³n".
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function handleProveedor(request, env, ctx, cors) {
  // 1) Clave compartida (anti-bot bÃ¡sico)
  if (env.PUBLIC_LEAD_KEY) {
    const key = request.headers.get("X-Public-Lead-Key") || "";
    if (!timingSafeEqual(key, env.PUBLIC_LEAD_KEY)) {
      return json({ ok: false, error: "No autorizado" }, 401, cors);
    }
  }

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON invÃ¡lido" }, 400, cors);

  // 2) Honeypot
  if (body.company_website || body._hp) {
    return json({ ok: true, proveedorId: null }, 200, cors);
  }

  // 3) Turnstile (opcional)
  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, request);
    if (!ok) return json({ ok: false, error: "VerificaciÃ³n anti-bot fallÃ³" }, 403, cors);
  }

  // 4) Rate-limit por IP
  const limited = await rateLimited(env, request, "proveedor", 5, 60);
  if (limited) return json({ ok: false, error: "Demasiadas solicitudes" }, 429, cors);

  // 5) ValidaciÃ³n mÃ­nima
  const nombre = str(body.name) || str(body.company);
  const email = str(body.email);
  const phone = str(body.phone);
  if (!nombre) return json({ ok: false, error: "Falta el nombre del proveedor" }, 400, cors);
  if (!email && !phone) {
    return json({ ok: false, error: "Falta email o telÃ©fono" }, 400, cors);
  }

  const contacto = str(body.contact) || nombre;
  const categoria = str(body.categoria || body.category);
  const productos = str(body.productos || body.products);
  const website = str(body.website);
  const message = str(body.message);

  const notas = ["ğŸ“¥ PostulaciÃ³n vÃ­a formulario web (thelab.solutions/proveedores)."];
  if (message) notas.push(message);

  const fields = stripEmpty({
    Nombre: nombre,
    Contacto: contacto,
    Cargo: str(body.cargo || body.role),
    Email: email,
    TelÃ©fono: phone,
    WhatsApp: str(body.whatsapp) || phone,
    "Sitio Web": website,
    RUT: str(body.rut),
    Comuna: str(body.comuna),
    RegiÃ³n: str(body.region),
    // multipleSelects â†’ array; typecast crea la opciÃ³n si no existe
    CategorÃ­a: categoria ? [categoria] : undefined,
    Productos: productos,
    Notas: notas.join("\n\n"),
    "Estado postulaciÃ³n": "ENTREVISTAR",
  });

  const summary = { nombre, contacto, email, phone, categoria, productos, website, message };

  try {
    const rec = await airtableCreateTolerant(env, "Proveedores", fields);
    ctx.waitUntil(sendProveedorNotification(env, summary));
    return json({ ok: true, proveedorId: rec?.id || null }, 200, cors);
  } catch (e) {
    console.error("[proveedor]", e?.stack || e?.message || String(e));
    // No perder la postulaciÃ³n: avisar por email aunque Airtable falle.
    ctx.waitUntil(sendProveedorNotification(env, { ...summary, failed: true }));
    return json({ ok: false, error: "No se pudo registrar la postulaciÃ³n" }, 502, cors);
  }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * RUTAS: GET /blog  y  GET /blog/:slug   (lectura pÃºblica del blog desde Airtable)
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
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
  if (cat) formula = `AND({Estado}='Publicado',{CategorÃ­a}='${cat.replace(/'/g, "\\'")}')`;
  try {
    const recs = await airtableSelectBlog(env, {
      formula,
      fields: ["TÃ­tulo", "Slug", "Fecha", "Extracto", "Imagen", "CategorÃ­a"],
      sort: { field: "Fecha", dir: "desc" },
      maxRecords: limit,
    });
    const posts = recs
      .map((r) => ({
        title: r.fields["TÃ­tulo"] || "",
        slug: r.fields["Slug"] || "",
        date: r.fields["Fecha"] || "",
        excerpt: r.fields["Extracto"] || "",
        image: r.fields["Imagen"] || "",
        categoria: r.fields["CategorÃ­a"] || "",
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
          title: f["TÃ­tulo"] || "",
          slug: f["Slug"] || "",
          date: f["Fecha"] || "",
          excerpt: f["Extracto"] || "",
          content: f["Contenido"] || "",
          image: f["Imagen"] || "",
          categoria: f["CategorÃ­a"] || "",
        },
      },
      200,
      cors
    );
  } catch (e) {
    return json({ ok: false, error: e.message }, 502, cors);
  }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * RUTA: POST /newsletter   (alta de suscriptor desde la web)
 * Doble opt-in: si hay Resend configurado, NO marca "Suscrito" hasta que el
 * suscriptor confirme por email (link con token HMAC). Si no hay Resend, hace
 * alta directa (single opt-in). No encola agentes: es solo opt-in.
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function handleNewsletter(request, env, ctx, cors) {
  // 1) Clave compartida (mismo anti-bot bÃ¡sico que /lead)
  if (env.PUBLIC_LEAD_KEY) {
    const key = request.headers.get("X-Public-Lead-Key") || "";
    if (!timingSafeEqual(key, env.PUBLIC_LEAD_KEY)) {
      return json({ ok: false, error: "No autorizado" }, 401, cors);
    }
  }

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON invÃ¡lido" }, 400, cors);

  // 2) Honeypot: si viene relleno, es un bot. Respondemos 200 sin enseÃ±arle.
  if (body.company_website || body._hp) {
    return json({ ok: true, subscribed: true }, 200, cors);
  }

  // 3) Turnstile (opcional)
  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, request);
    if (!ok) return json({ ok: false, error: "VerificaciÃ³n anti-bot fallÃ³" }, 403, cors);
  }

  // 4) Rate-limit por IP (opcional, requiere binding KV "RL")
  const limited = await rateLimited(env, request, "newsletter", 8, 60);
  if (limited) return json({ ok: false, error: "Demasiadas solicitudes" }, 429, cors);

  // 5) ValidaciÃ³n: email obligatorio y con forma vÃ¡lida
  const email = str(body.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Email invÃ¡lido" }, 400, cors);
  }
  const name = str(body.name);
  const company = str(body.company);
  const source = str(body.source) || "Newsletter web";

  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) {
    return json({ ok: false, error: "Airtable no configurado" }, 500, cors);
  }

  // Doble opt-in si podemos enviar el correo de confirmaciÃ³n (Resend) y no estÃ¡ deshabilitado.
  const doubleOptIn = !!env.RESEND_API_KEY && env.NEWSLETTER_DOUBLE_OPTIN !== "false";

  try {
    const existing = await airtableFindCliente(env, { email });

    if (doubleOptIn) {
      // Aseguramos que el contacto exista (sin marcar "Suscrito" todavÃ­a).
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
            "Email vÃ¡lido": true,
            "Fecha primer contacto": today(),
            "Notas internas":
              "SolicitÃ³ newsletter (pendiente de confirmar)" +
              (body.landingUrl ? ` â€” ${str(body.landingUrl)}` : ""),
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

    // Sin Resend â†’ alta directa (single opt-in).
    if (existing) {
      await airtableUpdateTolerant(
        env,
        "Clientes",
        existing,
        stripEmpty({ "Suscrito newsletter": true, "Baja newsletter": false, "Email vÃ¡lido": true })
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
        "Email vÃ¡lido": true,
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

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * RUTA: GET /newsletter/confirm   (doble opt-in)
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function handleNewsletterConfirm(request, env) {
  const url = new URL(request.url);
  const email = str(url.searchParams.get("e"));
  const token = str(url.searchParams.get("t"));
  if (!email || !(await nlVerify(env, "confirm", email, token))) {
    return htmlPage("Enlace invÃ¡lido", "Este enlace de confirmaciÃ³n no es vÃ¡lido o ya expirÃ³. Vuelve a suscribirte en thelab.solutions.", false);
  }
  if (env.AIRTABLE_TOKEN && env.AIRTABLE_BASE_ID) {
    try {
      const id = await airtableFindCliente(env, { email });
      if (id) {
        await airtableUpdateTolerant(env, "Clientes", id, stripEmpty({ "Suscrito newsletter": true, "Baja newsletter": false, "Email vÃ¡lido": true }));
      } else {
        await airtableCreateTolerant(env, "Clientes", stripEmpty({ Empresa: email, Email: email, "Origen lead": "Newsletter web", "Suscrito newsletter": true, "Email vÃ¡lido": true, "Fecha primer contacto": today() }));
      }
    } catch (e) {
      console.error("[leads-worker] confirm:", e.message);
    }
  }
  return htmlPage("Â¡SuscripciÃ³n confirmada! ğŸ‰", "Gracias por confirmar. Te escribiremos con novedades, casos reales y ofertas â€” sin spam.", true);
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * RUTA: GET /newsletter/unsubscribe   (baja)
 * Token HMAC opcional: si viene, se valida; si no, igual se procesa la baja
 * (un opt-out nunca se bloquea).
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function handleNewsletterUnsubscribe(request, env) {
  const url = new URL(request.url);
  const email = str(url.searchParams.get("e"));
  if (!email) return htmlPage("Enlace invÃ¡lido", "Falta el correo en el enlace de baja.", false);
  if (env.AIRTABLE_TOKEN && env.AIRTABLE_BASE_ID) {
    try {
      const id = await airtableFindCliente(env, { email });
      if (id) await airtableUpdateTolerant(env, "Clientes", id, stripEmpty({ "Baja newsletter": true, "Suscrito newsletter": false }));
    } catch (e) {
      console.error("[leads-worker] unsubscribe:", e.message);
    }
  }
  return htmlPage("Te diste de baja", "Ya no recibirÃ¡s mÃ¡s correos del newsletter. Si fue un error, puedes volver a suscribirte en thelab.solutions.", true);
}

/* â”€â”€ Newsletter: helpers de token HMAC (sin estado),m«ëŒ+Š×®º+º$zzb¥â:v–æ…DÔÂ’VÖ–Â)H)H¢ğ¦gVæ7F–öâæÅ6V7&WB†Vçb’°¢&WGW&âVçbääUu4ÄUEDU%õ4T5$UBÇÂVçbåT$Ä”5ôÄTEô´U’ÇÂVçbä•%D$ÄUõDô´TâÇÂ'F†VÆ"ÖæWw6ÆWGFW"#°§Ğ¦7–æ2gVæ7F–öâæÅ6–vâ†VçbÂW'÷6RÂVÖ–Â’°¢&WGW&âv—B†Ö4#cGR†æÅ6V7&WB†Vçb’ÂG·W'÷6WÓ¢Gµ7G&–ær†VÖ–Â’çG&–Ò‚’çFôÆ÷vW$66R‚—Ö“°§Ğ¢òò„Ô2Õ4„#SbVâ&6ScGW&Â(	Bf—&ÖÆ÷2Fö¶Vç26–âW7FFò†æWw6ÆWGFW"’÷'FÂ’à¦7–æ2gVæ7F–öâ†Ö4#cGR‡6V7&WBÂ×6r’°¢6öç7B¶W’Òv—B7'—Fòç7V'FÆRæ–×÷'D¶W’‚'&r"ÂæWrFW‡DVæ6öFW"‚’æVæ6öFR‡6V7&WB’Â²æÖS¢$„Ô2"Â†6ƒ¢%4„Ó#Sb"ÒÂfÇ6RÂ²'6–vâ%Ò“°¢6öç7B6–rÒæWrV–çC„'&’†v—B7'—Fòç7V'FÆRç6–vâ‚$„Ô2"Â¶W’ÂæWrFW‡DVæ6öFW"‚’æVæ6öFR†×6r’’“°¢ÆWB2Ò"#°¢f÷"†ÆWB’Ò²’Â6–ræÆVæwFƒ²’²²’2³Ò7G&–æræg&öÔ6†$6öFR‡6–u¶•Ò“°¢&WGW&â'Fö‡2’ç&WÆ6R‚õÂ²örÂ"Ò"’ç&WÆ6R‚õÂòörÂ%ò"’ç&WÆ6R‚óÒ²BòÂ""“°§Ğ¦7–æ2gVæ7F–öâæÅfW&–g’†VçbÂW'÷6RÂVÖ–ÂÂFö¶Vâ’°¢–b‚Fö¶Vâ’&WGW&âfÇ6S°¢&WGW&âF–Ö–æu6fTWVÂ‡Fö¶VâÂv—BæÅ6–vâ†VçbÂW'÷6RÂVÖ–Â’“°§Ğ¢òò6&V6W&FRÖ&6FRÆ2:v–æ2;¦&Æ–62‡÷'FÂÂ6VwV–Ö–VçFòÂå2ÂôBÀ¢òòæWw6ÆWGFW"’âVÂärÆò6—'fRVÂF6†&ö&C²6’æò6&v&Â6RÂFW‡FòFP¢òò6–V×&RVâfW¢FRFV¦"Vâ‡VV6òà¦6öç7BÄôtõõU$ÂÒ&‡GG3¢òöF6†&ö&BçF†VÆ"ç6öÇWF–öç2öÆövò×F†VÆ"çær#°¢òòfW'6œ;6â&föæFò6Æ&ò†Æ†ö¦FRÆ6÷F—¦6œ;6â’à¦6öç7BÄôtõô$Ä4µõU$ÂÒ&‡GG3¢òöF6†&ö&BçF†VÆ"ç6öÇWF–öç2öÆövò×F†VÆ"Ö&Æ6²çær#°¦gVæ7F–öâÆövô†VFW"†6VçG&Fò’°¢&WGW&âÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£‡‚#à¢Æ–Ör7&3Ò"G´ÄôtõõU$ÇÒ"ÇCÒ%F†RÆ"6öÇWF–öç2"7G–ÆSÒ'v–GFƒ£#ƒ¶Ö‚×v–GFƒ£cS¶†V–v‡C¦WFó¶F—7Æ“¦&Æö6²G¶6VçG&Fòò#¶Ö&v–ã£WFò"¢"'Ò"öæW'&÷#Ò'F†—2ç7G–ÆRæF—7Æ“ÒvæöæRs·F†—2ææW‡DVÆVÖVçE6–&Æ–ærç7G–ÆRæF—7Æ“Òv&Æö6²r#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦æöæS¶föçB×6—¦S£7ƒ¶ÆWGFW"×76–æs¢ã†VÓ¶6öÆ÷#¢3vvƒ#·FW‡B×G&ç6f÷&Ó§WW&66R#åF†RÆ"6öÇWF–öç3ÂöF—cà¢ÂöF—cæ°§Ğ¦gVæ7F–öâW66T‡FÖÅr‡2’°¢&WGW&â7G&–ær‡2ÓÒçVÆÂò""¢2’ç&WÆ6R‚òbörÂ"f×²"’ç&WÆ6R‚óÂörÂ"fÇC²"’ç&WÆ6R‚óâörÂ"fwC²"’ç&WÆ6R‚ò"örÂ"gV÷C²"’ç&WÆ6R‚òrörÂ"b33“²"“°§Ğ¦gVæ7F–öâ‡FÖÅvR‡F—FÆRÂ×6rÂö²Â7FGW2Ò#’°¢6öç7B6öÆ÷"Òö²ò"3#6B"¢"6SSCƒFB#°¢6öç7B‡FÖÂÒÂFö7G—R‡FÖÃãÆ‡FÖÂÆæsÒ&W2#ãÆ†VCãÆÖWF6†'6WCÒ'WFbÓ‚#ãÆÖWFæÖSÒ'f–Ww÷'B"6öçFVçCÒ'v–GFƒÖFWf–6R×v–GF‚Æ–æ—F–Â×66ÆSÓ#ãÇF—FÆSâG¶W66T‡FÖÅr‡F—FÆR—Ò(	BF†RÆ"6öÇWF–öç3Â÷F—FÆSãÂö†VCà£Æ&öG’7G–ÆSÒ&Ö&v–ã£¶&6¶w&÷VæC¢3##3¶6öÆ÷#¢6S†S†V¶föçBÖfÖ–Ç“§7—7FVÒ×V’Ä&–ÂÇ6ç2×6W&–c¶F—7Æ“¦fÆWƒ¶Ö–âÖ†V–v‡C£fƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC¦6VçFW"#à£ÆF—b7G–ÆSÒ&Ö‚×v–GFƒ£Ccƒ·FF–æs£C‚#‡ƒ·FW‡BÖÆ–vã¦6VçFW"#à¢G¶Æövô†VFW"‡G'VR—Ğ£Æƒ7G–ÆSÒ&föçB×6—¦S£#'ƒ¶Ö&v–ã£'ƒ¶6öÆ÷#¢G¶6öÆ÷'Ò#âG¶W66T‡FÖÅr‡F—FÆR—ÓÂöƒà£Ç7G–ÆSÒ&föçB×6—¦S£Wƒ¶Æ–æRÖ†V–v‡C£ãc¶6öÆ÷#¢6#f#f&C¶Ö&v–ã£#G‚#âG¶W66T‡FÖÅr†×6r—ÓÂ÷à£Æ‡&VcÒ&‡GG3¢ò÷F†VÆ"ç6öÇWF–öç2"7G–ÆSÒ&F—7Æ“¦–æÆ–æRÖ&Æö6³¶&6¶w&÷VæC¢3#6C¶6öÆ÷#¢3c#3c¶föçB×vV–v‡C£s·FW‡BÖFV6÷&F–öã¦æöæS·FF–æs£‚#ƒ¶&÷&FW"×&F—W3£—ƒ¶föçB×6—¦S£G‚#ä—"F†VÆ"ç6öÇWF–öç3Âöà£ÂöF—cãÂö&öG“ãÂö‡FÖÃæ°¢&WGW&âæWr&W7öç6R†‡FÖÂÂ²7FGW2Â†VFW'3¢²$6öçFVçBÕG—R#¢'FW‡Bö‡FÖÃ²6†'6WC×WFbÓ‚"ÒÒ“°§Ğ¦7–æ2gVæ7F–öâ6VæDæWw6ÆWGFW$6öæf—&Ò†VçbÂVÖ–ÂÂæÖRÂ6öæf—&ÕW&Â’°¢–b‚Vçbå$U4TäEô•ô´U’’&WGW&ã°¢6öç7Bg&öÒÒVçbå$U4TäEôe$ôÒÇÂ%F†RÆ"6öÇWF–öç2Æ†öÆF†VÆ"ç6öÇWF–öç3â#°¢6öç7Bf—'7BÒæÖRò7G&–ær†æÖR’ç7Æ—B‚""•³Ò¢"#°¢6öç7B‡FÖÂĞ¢ÆF—b7G–ÆSÒ&föçBÖfÖ–Ç“§7—7FVÒ×V’Ä&–ÂÇ6ç2×6W&–c¶6öÆ÷#¢3¶Æ–æRÖ†V–v‡C£ãc¶Ö‚×v–GFƒ£S#‚#æ°¢Æƒ"7G–ÆSÒ&Ö&v–ã£'‚#ä6öæf—&ÖGR7W67&—6œ;6â)ÈSÂöƒ#æ°¢Çä†öÆG¶W66T‡FÖÅr†f—'7B—ÒÃÂ÷æ°¢Çå&V6–&–Ö÷2GR6öÆ–6—GVB&&V6–&—"VÂæWw6ÆWGFW"FRÇ7G&öæsåF†RÆ"6öÇWF–öç3Â÷7G&öæsââ&7F—f&ÆÂ6öæf—&ÖGR6÷'&Vó£Â÷æ°¢Ç7G–ÆSÒ&Ö&v–ã£#'‚#ãÆ‡&VcÒ"G¶6öæf—&ÕW&ÇÒ"7G–ÆSÒ&&6¶w&÷VæC¢3#6C¶6öÆ÷#¢3c#3c¶föçB×vV–v‡C£s·FW‡BÖFV6÷&F–öã¦æöæS·FF–æs£'‚#'ƒ¶&÷&FW"×&F—W3£—‚#ä6öæf—&Ö"7W67&—6œ;6ãÂöãÂ÷æ°¢Ç7G–ÆSÒ&6öÆ÷#¢3ccc¶föçB×6—¦S£7‚#å6’æògV—7FRL;¢Â–væ÷&W7FR6÷'&Vò’æòFR7W67&–&—&VÖ÷2ãÂ÷æ°¢Ç7G–ÆSÒ&6öÆ÷#¢3ccc¶föçB×6—¦S£'ƒ¶Ö&v–â×F÷£‡‚#î(	BWV—òF†RÆ"6öÇWF–öç2+rf'&–66œ;6âF–v—FÂÂ6çF–vóÂ÷æ°¢ÂöF—cæ°¢G'’°¢v—BfWF6‚‚&‡GG3¢òö’ç&W6VæBæ6öÒöVÖ–Ç2"Â°¢ÖWF†öC¢%õ5B"À¢†VFW'3¢²WF†÷&—¦F–öã¢$&V&W""²Vçbå$U4TäEô•ô´U’Â$6öçFVçBÕG—R#¢&Æ–6F–öâö§6öâ"ÒÀ¢&öG“¢¥4ôâç7G&–æv–g’‡²g&öÒÂFó¢¶VÖ–ÅÒÂ7V&¦V7C¢$6öæf—&ÖGR7W67&—6œ;6â(	BF†RÆ"6öÇWF–öç2"Â‡FÖÂÒ’À¢Ò“°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚%¶ÆVG2×v÷&¶W%Ò6öæf—&ÒVÖ–Ã¢"ÂRæÖW76vR“°¢Ğ§Ğ ¢ò¢)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢¢%UD¢õ5B÷vV&†öö·2övöövÆRÖG0¢¢)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y¢ğ¦7–æ2gVæ7F–öâ†æFÆTvöövÆTG2‡&WVW7BÂVçbÂ7G‚Â6÷'2’°¢6öç7B&öG’Òv—B&VD§6öâ‡&WVW7B“°¢–b‚&öG’’&WGW&â§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$¥4ôâ–çl:Æ–Fò"ÒÂCÂ6÷'2“° ¢òòvöövÆRW&Ö—FRVçf–"Æ6ÆfRVâ†VFW"òVâVÂ&öG¢6öç7B&÷f–FVBĞ¢&WVW7Bæ†VFW'2ævWB‚%‚ÔvöövÆRÔG2ÕvV&†öö²Ô¶W’"’ÇÀ¢&öG’ævöövÆUö¶W’ÇÀ¢&öG’çfW&–f–6F–öåö¶W’ÇÀ¢"#°¢–b‚VçbätôôtÄUôE5õtT$„ôôµô´U’ÇÂF–Ö–æu6fTWVÂ‡&÷f–FVBÂVçbätôôtÄUôE5õtT$„ôôµô´U’’’°¢&WGW&â§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$æòWF÷&—¦Fò"ÒÂCÂ6÷'2“°¢Ğ ¢6öç7Bæ÷&ÒÒæ÷&ÖÆ—¦TvöövÆTG2†&öG’“°¢&WGW&âv—B7&VFTÆVDæEVWVR†VçbÂ7G‚Â6÷'2Â°¢æ÷&ÒÀ¢vVçFS¢$ÄTEôtTåB"À¢WfVçFó¢&vöövÆUöG2æÆVE÷&V6V—fVB"À¢6÷W&6S¢&vöövÆUöG2"À¢6×–vã¢æ÷&ÒçWFÔ6×–vâÀ¢Ò“°§Ğ ¢ò¢)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢¢%UD¢õ5B÷vV&†öö·2öÆ–æ¶VF–â‡l:ÖÖ¶Rò¦–W"ò‡V%7÷B¢¢)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y¢ğ¦7–æ2gVæ7F–öâ†æFÆTÆ–æ¶VF–â‡&WVW7BÂVçbÂ7G‚Â6÷'2’°¢6öç7B&÷f–FVBĞ¢&WVW7Bæ†VFW'2ævWB‚%‚ÔÆ–æ¶VF–âÕvV&†öö²Ô¶W’"’ÇÀ¢&WVW7Bæ†VFW'2ævWB‚%‚ÕV&Æ–2ÔÆVBÔ¶W’"’ÇÀ¢"#°¢6öç7BW‡V7FVBÒVçbäÄ”ä´TD”åõtT$„ôôµô´U’ÇÂVçbåT$Ä”5ôÄTEô´U“°¢–b‚W‡V7FVBÇÂF–Ö–æu6fTWVÂ‡&÷f–FVBÂW‡V7FVB’’°¢&WGW&â§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$æòWF÷&—¦Fò"ÒÂCÂ6÷'2“°¢Ğ ¢6öç7B&öG’Òv—B&VD§6öâ‡&WVW7B“°¢–b‚&öG’’&WGW&â§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$¥4ôâ–çl:Æ–Fò"ÒÂCÂ6÷'2“° ¢6öç7Bæ÷&ÒÒæ÷&ÖÆ—¦TÆ–æ¶VF–â†&öG’“°¢&WGW&âv—B7&VFTÆVDæEVWVR†VçbÂ7G‚Â6÷'2Â°¢æ÷&ÒÀ¢vVçFS¢$Ä”ä´TD”åôtTåB"À¢WfVçFó¢&Æ–æ¶VF–âæÆVE÷&V6V—fVB"À¢6÷W&6S¢&Æ–æ¶VF–â"À¢6×–vã¢æ÷&Òæ6×–vâÇÂæ÷&ÒçWFÔ6×–vâÀ¢Ò“°§Ğ ¢ò¢)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢¢%UD¢õ5B÷vV&†öö·2÷6ö6–Â†6öÖVçF&–÷2’D×2FR–ç7Fw&Òôf6V&öö²õF–µFö°¢¢l:ÖÖ¶R’â6–V×&R&Vv—7G&Æ–çFW&66œ;6âVâ6ö6–Åô–çFW&7F–öç3²6’f–VæP¢¢Ö&6F6öÖòÆVBÂFVÜ:27&V6Æ–VçFR²vVçEõVWVR†Ö—6Öò—VÆ–æR’à¢¢)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y¢ğ¦7–æ2gVæ7F–öâ†æFÆU6ö6–Â‡&WVW7BÂVçbÂ7G‚Â6÷'2’°¢6öç7B&÷f–FVBĞ¢&WVW7Bæ†VFW'2ævWB‚%‚Õ6ö6–ÂÕvV&†öö²Ô¶W’"’ÇÀ¢&WVW7Bæ†VFW'2ævWB‚%‚ÕV&Æ–2ÔÆVBÔ¶W’"’ÇÀ¢"#°¢6öç7BW‡V7FVBÒVçbå4ô4”ÅõtT$„ôôµô´U’ÇÂVçbåT$Ä”5ôÄTEô´U“°¢–b‚W‡V7FVBÇÂF–Ö–æu6fTWVÂ‡&÷f–FVBÂW‡V7FVB’’°¢&WGW&â§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$æòWF÷&—¦Fò"ÒÂCÂ6÷'2“°¢Ğ ¢6öç7B&öG’Òv—B&VD§6öâ‡&WVW7B“°¢–b‚&öG’’&WGW&â§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$¥4ôâ–çl:Æ–Fò"ÒÂCÂ6÷'2“° ¢6öç7B2Òæ÷&ÖÆ—¦U6ö6–Â†&öG’“°¢–b‚2çW7V&–òbb2æÖVç6¦R’°¢&WGW&â§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$fÇFâFF÷2‡W7V&–òöÖVç6¦R’"ÒÂCÂ6÷'2“°¢Ğ ¢òò’6–V×&S¢&Vv—7G&Æ–çFW&66œ;6âVâ6ö6–Åô–çFW&7F–öç2†&W7BÖVff÷'B’à¢ÆWB–çFW&7F–öä–BÒçVÆÃ°¢G'’°¢6öç7B–çFW"Òv—B—'F&ÆT7&VFUFöÆW&çB€¢VçbÀ¢%6ö6–Åô–çFW&7F–öç2"À¢7G&—V×G’‡°¢&VC¢2ç&VBÀ¢F—ó¢2çF—òÀ¢W7V&–ó¢2çW7V&–òÀ¢ÖVç6¦S¢2æÖVç6¦RÀ¢–çFVæ6œ;6ã¢2æ–çFVæ6–öâÀ¢$W2ÆVB#¢2æW4ÆVBÇÂVæFVf–æVBÀ¢VV¦¢2çVV¦ÇÂVæFVf–æVBÀ¢W7FFó¢%VæF–VçFR"À¢fV6†¢2æfV6†À¢Ò¢“°¢–çFW&7F–öä–BÒ–çFW#òæ–BÇÂçVÆÃ°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚%¶ÆVG2×v÷&¶W%Ò6ö6–Åô–çFW&7F–öç3¢"ÂRæÖW76vR“°¢Ğ ¢òò"’6’f–VæRÖ&6F6öÖòÆVBÂ7&V6Æ–VçFR²vVçEõVWVR‡6–âVÖ–Âæò†¢òòWFò×&WÇ“²VÂÄTEôtTåBÆò&R×66÷&V6’UDõõ$ô4U55ôÄTE2W7L:7F—fò’à¢–b‡2æW4ÆVB’°¢6öç7Bæ÷&ÒÒ°¢æÖS¢2çW7V&–òÀ¢6ö×ç“¢2çW7V&–òò$"²2çW7V&–ò¢$ÆVB&VFW26ö6–ÆW2"À¢ÖW76vS¢2æÖVç6¦RÀ¢6W'f–6S¢2ç6W'f–6RÀ¢&VC¢2ç&VBÀ¢F—ó¢2çF—òÀ¢–çFVæ6–öã¢2æ–çFVæ6–öâÀ¢6×–vã¢2æ6×–vâÀ¢–çFW&7F–öä–BÀ¢Ó°¢&WGW&âv—B7&VFTÆVDæEVWVR†VçbÂ7G‚Â6÷'2Â°¢æ÷&ÒÀ¢vVçFS¢$ÄTEôtTåB"À¢WfVçFó¢'6ö6–ÂæÆVE÷&V6V—fVB"À¢6÷W&6S¢2ç6÷W&6RÀ¢6×–vã¢2æ6×–vâÀ¢Ò“°¢Ğ ¢&WGW&â§6öâ‡²ö³¢G'VRÂ–çFW&7F–öä–BÂÆVC¢fÇ6RÒÂ#Â6÷'2“°§Ğ ¦gVæ7F–öâæ÷&ÖÆ—¦U6ö6–Â†"’°¢6öç7B&VE&rÒ‡7G"†"ç&VB’ÇÂ7G"†"ææWGv÷&²’ÇÂ""’çFôÆ÷vW$66R‚“°¢6öç7B&VDÖÒ°¢–ç7Fw&Ó¢$–ç7Fw&Ò"Â–s¢$–ç7Fw&Ò"À¢f6V&öö³¢$f6V&öö²"Âf#¢$f6V&öö²"À¢Æ–æ¶VF–ã¢$Æ–æ¶VD–â"À¢F–·Fö³¢%F–µFö²"ÂGC¢%F–µFö²"À¢Ó°¢6öç7B&VBÒ&VDÖ·&VE&uÒÇÂ7G"†"ç&VB’ÇÂ7G"†"ææWGv÷&²’ÇÂ"#°¢6öç7BF—õ&rÒ‡7G"†"çF—ò’ÇÂ7G"†"çG—R’ÇÂ&6öÖVçF&–ò"’çFôÆ÷vW$66R‚“°¢6öç7BF—òĞ¢F—õ&rç7F'G5v—F‚‚&FÒ"’ÇÂF—õ&ræ–æ6ÇVFW2‚&ÖW76vR"’ÇÂF—õ&ræ–æ6ÇVFW2‚&ÖVç6¦R"¢ò$DÒ ¢¢F—õ&ræ–æ6ÇVFW2‚&ÖVæ2"’ÇÂF—õ&ræ–æ6ÇVFW2‚&ÖVçF–öâ"¢ò$ÖVæ6œ;6â ¢¢$6öÖVçF&–ò#°¢6öç7BW4ÆVBÒõâ‡5¶œ:Õ×ÇG'VWÃ’Bö’çFW7B…7G&–ær†"æW4ÆVBóò"æW5öÆVBóò""’çG&–Ò‚’“°¢6öç7BÖVç6¦RÒ7G"†"æÖVç6¦R’ÇÂ7G"†"æÖW76vR’ÇÂ7G"†"çFW‡B’ÇÂ7G"†"æ6öÖÖVçB“°¢6öç7B–çFVæ6–öâÒ7G"†"æ–çFVæ6–öâ’ÇÂ7G"†"æ–çFVçB“°¢&WGW&â°¢&VBÀ¢F—òÀ¢W7V&–ó¢7G"†"çW7V&–ò’ÇÂ7G"†"çW6W&æÖR’ÇÂ7G"†"æg&öÒ’ÇÂ7G"†"çW6W"’À¢ÖVç6¦RÀ¢–çFVæ6–öâÀ¢W4ÆVBÀ¢VV¦¢6ö6–Ä—46ö×Æ–çB†ÖVç6¦RÂ–çFVæ6–öâ’À¢6W'f–6S¢7G"†"ç6W'f–6R’À¢6÷W&6S¢&VE&rÇÂ'&VFW2"À¢6×–vã¢7G"†"æ6×–vâ’À¢fV6†¢7G"†"æfV6†’ÇÂ7G"†"æFFR’ÇÂæWrFFR‚’çFô•4õ7G&–ær‚’À¢Ó°§Ğ ¢òòFWFV66œ;6â6–×ÆRFRVV¦‡6VçF–Ö–VçFòæVvF—fò’&F—7&"VÂf—6ò÷"v†G4à¢òòW7V¦Æ†WW,:×7F–6FVÂF6†&ö&B…÷&VFW56VçF–ÖVçB’à¦gVæ7F–öâ6ö6–Ä—46ö×Æ–çB†ÖVç6¦RÂ–çFVæ6–öâ’°¢–b‚÷6÷÷'FWÇVV¦Ç&V6ÆÖòö’çFW7B†–çFVæ6–öâÇÂ""’’&WGW&âG'VS°¢&WGW&â÷&ö&ÆVÖÇ&V6ÆÖ÷Ç¶\:•×6–Ö÷ÇW6–Ö÷ÇFW'&–&ÆWÆÖÆ÷ÆÖÆÆ†÷'&–&ÆWÆW7FfÆg&VFWÆæòÆÆVwÆæòÖRÆÆVwÇ&÷F÷Ç&÷FÆF¼;åÖGÆG&7ÇF&FWÆçVæ6ÆÆVwÆVæö¦GÆÖöÆW7GÆFVf–6–VçFWÆFVçVæ6—ÆFWföÇV6—ÆæògVæ6–öæÆæò6—'fRö’çFW7B€¢ÖVç6¦RÇÂ" ¢“°§Ğ ¢ò¢)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢¢ì9¤4ÄTó¢7&V"6Æ–VçFR²F&VVâvVçEõVWVP¢¢)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y¢ğ ¢òòWF—VWF&öf–6–Â"FR÷&–vVâÆVBVâVÂ5$Ó¢Æ÷2ÆVG2FVÂ6—F–òVVFâ6öÖğ¢òò%vV""†Æ÷6œ;6â7W&F’Âæò6öÖòÆ'vV""VâÖ–ì;§67VÆVRvVæW&&çFW2à¦6öç7Bõ$”tTåôÄ$TÂÒ²vV#¢%vV""Ó°¦gVæ7F–öâ÷&–vVäÆ&VÂ‡6÷W&6R’°¢&WGW&âõ$”tTåôÄ$TÅ·6÷W&6UÒÇÂ6÷W&6S°§Ğ ¢òòÖVVÂÆVBæ÷&ÖÆ—¦Fò6öÇVÖæ2&VÆW2FRÆF&Æ6Æ–VçFW2âFöÆW&çFS ¢òòÆ÷26×÷2VRæòW†—7FâVâÆ&6R6RFW66'FâVâ—'F&ÆT7&VFUFöÆW&çBà¢òòÆ÷2FF÷2FR–FVçF–FB…%UBÂ–æGW7G&–ÂF—&V66œ;6âÂWF2â’fâ7W26öÇVÖæ3°¢òòVÂ'&–VbFVÂ&÷–V7Fò‡&öGV7FòÂ6çF–FBÂfV6†Â&W7WVW7Fò’f$æ÷F2–çFW&æ2"à¦gVæ7F–öâ'V–ÆD6Æ–VçFTf–VÆG2†æ÷&ÒÂ6÷W&6R’°¢&WGW&â7G&—V×G’‡°¢V×&W6¢æ÷&Òæ6ö×ç’ÇÂæ÷&ÒææÖRÀ¢6öçF7Fó¢æ÷&ÒææÖRÀ¢VÖ–Ã¢æ÷&ÒæVÖ–ÂÀ¢FVÌ:–föæó¢æ÷&Òç†öæRÀ¢$6&vò6öçF7Fò#¢æ÷&Òæ¦ö%F—FÆRÀ¢$÷&–vVâÆVB#¢÷&–vVäÆ&VÂ‡6÷W&6R’À¢$–æGW7G&–ò'V'&ò#¢æ÷&Òæ–æGW7G'’À¢%F—òFR6Æ–VçFR#¢æ÷&ÒçF—ô6Æ–VçFRÀ¢%UC¢æ÷&Òç'WBÀ¢%6—F–òvV"#¢æ÷&ÒçvV'6—FRÀ¢F—&V66œ;6ã¢æ÷&ÒæFG&W72À¢&Vvœ;6ã¢æ÷&Òç&Vv–öâÀ¢6ö×Væ¢æ÷&Òæ6ö×VæÀ¢%6W'f–6–ò–çFW,:—2#¢æ÷&Òç6W'f–6RÀ¢òòG&6¶–ærW7G'V7GW&Fò&–×÷'F"6öçfW'6–öæW2öffÆ–æRvöövÆRG2à¢òò6öÇVÖæ2FöÆW&çFW3¢6’æòW†—7FVâVâÆ&6RÂ6RFW66'Fâ6–â&ö×W"à¢t4Ä”C¢æ÷&Òæv6Æ–BÀ¢$6×;G2#¢æ÷&ÒçWFÔ6×–vâÀ¢òòÆ÷2&Vv—7G&÷2çVWf÷2VçG&â6öÖòÄTB†6FVv÷,:Ö’âVÂWV—òÆ÷2fÆ–F¢òòÇVVvòÖ&6æFòVÂ6×ò%fÆ–FFò"VâVÂF6†&ö&BÂVRÆ÷264Ä”TåDRà¢fÆ–FFó¢fÇ6RÀ¢$æ÷F2–çFW&æ2#¢'V–ÆDæ÷FW2†æ÷&Ò’À¢$fV6†&–ÖW"6öçF7Fò#¢FöF’‚’À¢Ò“°§Ğ ¦7–æ2gVæ7F–öâ7&VFTÆVDæEVWVR†VçbÂ7G‚Â6÷'2Â²æ÷&ÒÂvVçFRÂWfVçFòÂ6÷W&6RÂ6×–vâÂGF6†ÖVçBÒ’°¢–b‚Vçbä•%D$ÄUõDô´TâÇÂVçbä•%D$ÄUô$4Uô”B’°¢&WGW&â§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$—'F&ÆRæò6öæf–wW&Fò"ÒÂSÂ6÷'2“°¢Ğ ¢òò’6Æ–VçFR(	B6×÷2FöÆW&çFW2‡6’æòW†—7FVâVâÆ&6RÂ6RFW66'Fâ¢6öç7B6Æ–VçFTf–VÆG2Ò'V–ÆD6Æ–VçFTf–VÆG2†æ÷&ÒÂ6÷W&6R“° ¢ÆWB6Æ–VçFT–BÒçVÆÃ°¢G'’°¢6öç7BW†—7F–ærÒv—B—'F&ÆTf–æD6Æ–VçFR†VçbÂ°¢VÖ–Ã¢æ÷&ÒæVÖ–ÂÀ¢†öæS¢æ÷&Òç†öæRÀ¢Ò“°¢–b†W†—7F–ær’°¢òò6Æ–VçFR&V7W'&VçFS¢&WWF–Æ—¦VÂ&Vv—7G&ò’&Vg&W66–çFW,:—2ö6&vğ¢òò6–â—6"æ÷F2æ’ÆfV6†FR&–ÖW"6öçF7Fòà¢6Æ–VçFT–BÒW†—7F–æs°¢v—B—'F&ÆUWFFUFöÆW&çB€¢VçbÀ¢$6Æ–VçFW2"À¢W†—7F–ærÀ¢7G&—V×G’‡°¢%6W'f–6–ò–çFW,:—2#¢æ÷&Òç6W'f–6RÀ¢$6&vò6öçF7Fò#¢æ÷&Òæ¦ö%F—FÆRÀ¢òò&Vg&W66VÂv6Æ–Bö6×;6’VÂÆVB&V7W'&VçFRÆÆVv÷"Vâ6Æ–2FRG0¢òò‡7G&—V×G’FW66'FÆ÷2f<:Ö÷2(i"æò&÷'&Vâv6Æ–B&Wf–ò’à¢t4Ä”C¢æ÷&Òæv6Æ–BÀ¢$6×;G2#¢æ÷&ÒçWFÔ6×–vâÀ¢Ò¢“°¢ÒVÇ6R°¢6öç7B6Æ–VçFRÒv—B—'F&ÆT7&VFUFöÆW&çB†VçbÂ$6Æ–VçFW2"Â6Æ–VçFTf–VÆG2“°¢6Æ–VçFT–BÒ6Æ–VçFSòæ–BÇÂçVÆÃ°¢Ğ¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚%¶ÆVG2×v÷&¶W%Ò6Æ–VçFW3¢"ÂRæÖW76vR“°¢òòæòW&FW"VÂÆVC¢'VffW"„µb’&&V–çFVçFò÷"7&öâ²WFò×&WÇ’–wVÂ°¢òòf—6ò–çFW&æò&&W66F&ÆòÖæò†çFW2fÆÆ&Vâ6–ÆVæ6–ò’à¢v—B'VffW$FVDÆWGFW"†VçbÂ²æ÷&ÒÂvVçFRÂWfVçFòÂ6÷W&6RÂ6×–vâÂ&V6öã¢RæÖW76vRÒ“°¢–b†æ÷&ÒæVÖ–Â’7G‚çv—EVçF–Â‡6VæDÆVDWFõ&WÇ’†VçbÂæ÷&Ò’“°¢7G‚çv—EVçF–Â‡6VæDÆVE6fTf–ÆVDÆW'B†VçbÂæ÷&ÒÂRæÖW76vR’“°¢&WGW&â§6öâ‡²ö³¢G'VRÂ6Æ–VçFT–C¢çVÆÂÂVWVT–C¢çVÆÂÂ'VffW&VC¢G'VRÒÂ#Â6÷'2“°¢Ğ ¢òò"’F§VçFò(i"6×òFRGF6†ÖVçG2FVÂ6Æ–VçFR†&W7BÖVff÷'C¢6’VÂ6×ğ¢òòæòW†—7FRVâÆ&6RÂ6RÆöwVV’VÂÆVB6–wVR7R7W'6òæ÷&ÖÂ’à¢–b†GF6†ÖVçBbb6Æ–VçFT–Bbb7G‚’°¢7G‚çv—EVçF–Â‡WÆöDGF6†ÖVçEFô6Æ–VçFR†VçbÂ6Æ–VçFT–BÂGF6†ÖVçB’“°¢Ğ ¢òò"’vVçEõVWVR(	BF&Æ&¦òçVW7G&ò6öçG&öÂ†6×÷2f–¦÷2¢ÆWBVWVT–BÒçVÆÃ°¢6öç7BVWVTf–VÆG2Ò7G&—V×G’‡°¢WfVçFó¢WfVçFòÀ¢VçF–FC¢$6Æ–VçFR"À¢$”BVçF–FB#¢6Æ–VçFT–BÀ¢vVçFS¢vVçFRÀ¢W7FFó¢%VæF–VçFR"À¢&–÷&–FC¢6÷W&6RÓÓÒ&vöövÆUöG2"ò$ÇF"¢$ÖVF–"À¢$–çWB¥4ôâ#¢¥4ôâç7G&–æv–g’†æ÷&Ò’ç6Æ–6RƒÂ“S’À¢6÷W&6S¢6÷W&6RÀ¢6×–vã¢6×–vâÀ¢$fV6†7&V6œ;6â#¢æWrFFR‚’çFô•4õ7G&–ær‚’À¢Ò“°¢G'’°¢6öç7BÒv—B—'F&ÆT7&VFUFöÆW&çB†VçbÂ$vVçEõVWVR"ÂVWVTf–VÆG2“°¢VWVT–BÒòæ–BÇÂçVÆÃ°¢Ò6F6‚†R’°¢òòVÂ6Æ–VçFR–6RwV&L;2ÂW&òÆF&VFVÂ—VÆ–æRæó¢äòfÆÆ"Vâ6–ÆVæ6–òà¢òòÂ'VffW"†VÂ7&öâ&V–çFVçF7&V"ÆF&V(	BVÂ6Æ–VçFR–W†—7FRÂæò6RGWÆ–6¢òò²f—6òÂWV—òÂ&VRVÂÆVBæò6RVVFR6–â&ö6W6"6–âVRæF–RÆò6Wà¢6öç6öÆRæW'&÷"‚%¶ÆVG2×v÷&¶W%ÒvVçEõVWVS¢"ÂRæÖW76vR“°¢v—B'VffW$FVDÆWGFW"†VçbÂ°¢æ÷&ÒÀ¢vVçFRÀ¢WfVçFòÀ¢6÷W&6RÀ¢6×–vâÀ¢&V6öã¢$vVçEõVWVS¢"²RæÖW76vRÀ¢Ò“°¢7G‚çv—EVçF–Â€¢6VæDÆVE6fTf–ÆVDÆW'B†VçbÂæ÷&ÒÂRæÖW76vRÂ°¢F—FÆS¢.)ªûˆòÆVBwV&FFòÂW&ò4”âF&VFR6VwV–Ö–VçFò"À¢–çG&ó ¢$VÂ6Æ–VçFRÇ7G&öæsç<:ÓÂ÷7G&öæsâVVL;2VâVÂ5$ÒÂW&òæò6RVFò7&V"7RF&VVâVÂ"°¢'—VÆ–æR„vVçEõVWVR’Â<:ÒVRæò6RWFò×&ö6W6æ’6RÆR6–væ6VwV–Ö–VçFòÂfVæFVF÷"â"°¢%VVL;2VâVÂ'VffW"FR&V–çFVçF÷2†6F†÷&“²6’Vâã†÷&6–wVR6–âF&VÂ7,:–ÆÖæòâ"À¢7V&¦V7C¢)ªûˆòÆVB6–âF&VFR6VwV–Ö–VçFó¢G¶æ÷&ÒææÖRÇÂæ÷&ÒæVÖ–ÂÇÂ'6–âæöÖ'&R'ÖÀ¢Ò¢“°¢Ğ ¢òòWFò×&W7VW7FÂÆVB‡7VVB×FòÖÆVB’Â&W7BÖVff÷'BÂæò&Æ÷VVÆ&W7VW7F¢–b†æ÷&ÒæVÖ–Â’7G‚çv—EVçF–Â‡6VæDÆVDWFõ&WÇ’†VçbÂæ÷&Ò’“° ¢òò2’&ö6W6Ö–VçFò÷6–öæÂ6öâ6ÆVFR†æò&Æ÷VVÆ&W7VW7F¢–b€¢VçbäUDõõ$ô4U55ôÄTE2ÓÓÒ'G'VR"b`¢VçbäåD…$õ”5ô•ô´U’b`¢VWVT–Bb`¢†v—BWFõ&ö6W74ÆÆ÷vVB†Vçb’¢’°¢7G‚çv—EVçF–Â‡&ö6W74ÆVDvVçB†VçbÂ²6Æ–VçFT–BÂVWVT–BÂæ÷&ÒÂvVçFRÒ’“°¢Ğ ¢&WGW&â§6öâ‡²ö³¢G'VRÂ6Æ–VçFT–BÂVWVT–BÒÂ#Â6÷'2“°§Ğ ¢ò¢)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢¢&ö6W6Ö–VçFò6W'fW"×6–FRFRÄTEôtTåBòÄ”ä´TD”åôtTåB6öâ6ÆVFP¢¢)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y¢ğ¦7–æ2gVæ7F–öâ&ö6W74ÆVDvVçB†VçbÂ²6Æ–VçFT–BÂVWVT–BÂæ÷&ÒÂvVçFRÒ’°¢G'’°¢v—B—'F&ÆUWFFR†VçbÂ$vVçEõVWVR"ÂVWVT–BÂ²W7FFó¢%&ö6W6æFò"Ò“° ¢6öç7B7—2Ğ¢vVçFRÓÓÒ$Ä”ä´TD”åôtTåB ¢ò5•5ôÄ”ä´TD”à¢¢5•5ôÄTC°¢6öç7BW6W$×6rĞ¢$FF÷2FVÂÆVB„¥4ôâ“¥Æâ"°¢¥4ôâç7G&–æv–g’†æ÷&ÒÂçVÆÂÂ"’°¢%ÆåÆå&W7öæFR4ôÄò6öâVÂö&¦WFò¥4ôâVF–FòÂ6–âFW‡FòF–6–öæÂâ#° ¢6öç7B÷WBÒv—B6ÆÄ6ÆVFR†VçbÂ7—2ÂW6W$×6r“°¢6öç7B'6VBÒ6fT§6öâ†÷WB’ÇÂ·Ó° ¢òò7GVÆ—¦VÂ6Æ–VçFR‡FöÆW&çFR6×÷2–æW†—7FVçFW2¢v—B—'F&ÆUWFFUFöÆW&çB€¢VçbÀ¢$6Æ–VçFW2"À¢6Æ–VçFT–BÀ¢7G&—V×G’‡°¢$ÆVB66÷&R”#¢çVÔ÷$çVÆÂ‡'6VBæÆVE÷66÷&Róò'6VBç66÷&Uö#&"’À¢%6W'f–6–ò–çFW,:—2#¢'6VBç6W'f–6–õöFWFV7FFòÇÂ'6VBç6W'f–6–õ÷&V6öÖVæFFòÀ¢%,;7†–Ö66œ;6â”#¢'6VBç&÷†–Öö66–öâÀ¢,9¦ÇF–ÖòvVçFRV¦V7WFFò#¢vVçFRÀ¢%&W7VÖVâ”#¢'6VBç&W7VÖVåö7&ÒÇÂ'6VBç&W7VÖVâÀ¢Ò¢“° ¢v—B—'F&ÆUWFFR†VçbÂ$vVçEõVWVR"ÂVWVT–BÂ°¢W7FFó¢$6ö×ÆWFFò"À¢÷WGWC¢÷WBç6Æ–6RƒÂ“S’À¢$66–öâ7VvW&–F#¢'6VBç&÷†–Öö66–öâÇÂ""À¢$ÆVB66÷&R#¢çVÔ÷$çVÆÂ‡'6VBæÆVE÷66÷&Róò'6VBç66÷&Uö#&"’À¢$fV6†V¦V7V6œ;6â#¢æWrFFR‚’çFô•4õ7G&–ær‚’À¢Ò“°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚%¶ÆVG2×v÷&¶W%Ò&ö6W74ÆVDvVçC¢"ÂRæÖW76vR“°¢G'’°¢v—B—'F&ÆUWFFR†VçbÂ$vVçEõVWVR"ÂVWVT–BÂ°¢W7FFó¢$W'&÷""À¢W'&÷#¢7G&–ær†RæÖW76vR’ç6Æ–6RƒÂ’À¢$fV6†V¦V7V6œ;6â#¢æWrFFR‚’çFô•4õ7G&–ær‚’À¢Ò“°¢Ò6F6‚…ò’·Ğ¢Ğ§Ğ ¦6öç7B5•5ôÄTBÒW&W2VÂÄTEôtTåBFRF†RÆ"6öÇWF–öç2ÂV×&W6FRf'&–66œ;6âF–v—FÂ&VÖ—VÒVâ6çF–vòÂ6†–ÆRà¥6W'f–6–÷3¢7F—f6–öæW2Â&VÖ–6–öæW2ÂÖW&6†æF—6–ærÂ–×&W6œ;6â4BÂföÇVÜ:—G&–6÷2Â6'FVÆW,:ÖÂVÆW,:ÖÂ6†—F†RÆ"à¥&VvÆ2FR6æÃ ¢Ò6÷W&6SÖvöövÆUöG3¢–çFVæ6œ;6âÇFÂ&–÷&—¦fVÆö6–FBFR&W7VW7Fà¢Ò6÷W&6SÖÆ–æ¶VF–ã¢Föæò#$"6öç7VÇF—fò†WfÌ;¦6&vòÂV×&W6Â–æGW7G&–’à¢Ò6÷W&6S×vV#¢÷&–VçF’VGV66–âW‡FVæFW'FRà¢Ò6÷W&6S×v†G6¢F—&V7Fò’÷&–VçFFò6÷F—¦6œ;6âà¤FWFV7FVÂ6W'f–6–òÜ:2&ö&&ÆRâFWFV7FFF÷2fÇFçFW26ÆfR†6çF–FBÂfV6†Â6ö×VæÂÖVF–F2ÂÖFW&–ÂÂ&6†—fòÂ&W7WVW7Fò’âæò–çfVçFW2&V6–÷2f–æÆW2à¥&W7öæFR4ôÄòVâö&¦WFò¥4ôâ6öâU„5DÔTåDRW7F26ÆfW3 §°¢&ÆVE÷66÷&R#¢Æì;¦ÖW&òÓâÀ¢'6W'f–6–õöFWFV7FFò#¢#ÇVæòFRÆ÷26W'f–6–÷2òt÷G&òsâ"À¢'W&vVæ6–#¢$ÇFÄÖVF–Ä&¦"À¢&fÇFåöFF÷2#¢²"âââ%ÒÀ¢'&÷†–Öö66–öâ#¢#Æ66œ;6â6öæ7&WFâ"À¢&ÖVç6¦U÷v#¢#ÆÜ:‚BÌ:ÖæV2ÂÆ—7Fò&v†G4â"À¢&VÖ–Â#¢²&7VçFò#¢"âââ"Â&7VW'ò#¢"âââ'ÒÀ¢'&W7VÖVåö7&Ò#¢#Ç&W7VÖVâ–çFW&æò'&WfSâ §Ö° ¦6öç7B5•5ôÄ”ä´TD”âÒW&W2VÂÄ”ä´TD”åôtTåBFRF†RÆ"6öÇWF–öç2†f'&–66œ;6âF–v—FÂ#$"Â6çF–vòÂ6†–ÆR’à¤æÆ—¦2ÆVG2#$"FRÆ–æ¶VD–â„G2ÂÆVBvVâf÷&×2ò&÷7V66œ;6â’âFöæò&öfW6–öæÂÂ6†–ÆVæòÂF—&V7FòÂ6–â6öæ"&ö,;7F–6òà¥6W'f–6–÷3¢7F—f6–öæW2Â&VÖ–6–öæW2ÂÖW&6†æF—6–ærÂ–×&W6œ;6â4BÂföÇVÜ:—G&–6÷2Â6'FVÆW,:ÖÂVÆW,:ÖÂ6†—F†RÆ"à¥&W7öæFR4ôÄòVâö&¦WFò¥4ôâ6öâU„5DÔTåDRW7F26ÆfW3 §°¢'66÷&Uö#&"#¢Æì;¦ÖW&òÓâÀ¢'6W'f–6–õ÷&V6öÖVæFFò#¢#ÇVæòFRÆ÷26W'f–6–÷3â"À¢&FV6—6÷"#¢$ÇF÷ÄÖVF–÷Ä&¦ò"À¢&ÖVç6¦UöÆ–æ¶VF–â#¢#ÆÖVç6¦R6÷'FòFRW'GW&â"À¢&VÖ–Â#¢²&7VçFò#¢"âââ"Â&7VW'ò#¢"âââ'ÒÀ¢&ö&¦V6–öæW5÷&ö&&ÆW2#¢²"âââ%ÒÀ¢'&÷†–Öö66–öâ#¢#Æ66œ;6â&V6öÖVæFFâ"À¢'&W7VÖVâ#¢#Ç&W7VÖVâ–çFW&æò'&WfSâ §Ö° ¦6öç7B4ÄTDUôÄÄõtTEôÔôDTÅ2ÒæWr6WB…°¢&6ÆVFRÖ†–·RÓBÓR"À¢&6ÆVFRÖ†–·RÓBÓRÓ##S"À¢&6ÆVFR×6öææWBÓBÓb"À¥Ò“° ¦7–æ2gVæ7F–öâ6ÆÄ6ÆVFR†VçbÂ7—7FVÒÂW6W"Â÷G2Ò·Ò’°¢6öç7B&WVW7FVDÖöFVÂÒ÷G2æÖöFVÂÇÂVçbäåD…$õ”5ôÔôDTÂÇÂ&6ÆVFRÖ†–·RÓBÓRÓ##S#°¢6öç7BÖöFVÂÒ4ÄTDUôÄÄõtTEôÔôDTÅ2æ†2‡&WVW7FVDÖöFVÂ’ò&WVW7FVDÖöFVÂ¢&6ÆVFRÖ†–·RÓBÓRÓ##S#°¢6öç7B"Òv—BfWF6‚‚&‡GG3¢òö’æçF‡&÷–2æ6öÒ÷cöÖW76vW2"Â°¢ÖWF†öC¢%õ5B"À¢†VFW'3¢°¢$6öçFVçBÕG—R#¢&Æ–6F–öâö§6öâ"À¢'‚Ö’Ö¶W’#¢VçbäåD…$õ”5ô•ô´U’À¢&çF‡&÷–2×fW'6–öâ#¢###2ÓbÓ"À¢ÒÀ¢&öG“¢¥4ôâç7G&–æv–g’‡°¢ÖöFVÂÀ¢Ö…÷Fö¶Vç3¢ÖF‚æÖ‚ƒ#‚ÂÖF‚æÖ–âƒ#ÂçVÖ&W"†÷G2æÖ…Fö¶Vç2’ÇÂƒ’’À¢7—7FVÒÀ¢ÖW76vW3¢·²&öÆS¢'W6W""Â6öçFVçC¢W6W"ÕÒÀ¢Ò’À¢Ò“°¢–b‚"æö²’°¢6öç7BRÒv—B"çFW‡B‚’æ6F6‚‚‚’Óâ""“°¢F‡&÷ræWrW'&÷"†çF‡&÷–2G·"ç7FGW7Ó¢G¶Rç6Æ–6RƒÂ3—Ö“°¢Ğ¢6öç7BFFÒv—B"æ§6öâ‚“°¢òòÖWFFF÷2FR6öç7VÖòVâÆ÷2Æöw2FVÂv÷&¶W"Â6–â”’æ’6öçFVæ–FòFVÂÆVBà¢6öç6öÆRæ–æfò‚u¶çF‡&÷–2×W6vUÒrÂ¥4ôâç7G&–æv–g’‡¶–C¦FFæ–BÆÖöFVÃ¦FFæÖöFVÂÇW6vS¦FFçW6vRÇ6÷W&6S¢vÆVB×v÷&¶W"wÒ’“°¢&WGW&âFFæ6öçFVçCòæf–æB‚†"’Óâ"çG—RÓÓÒ'FW‡B"“òçFW‡BÇÂ"#°§Ğ ¢òòf—&Ö…DÔÂFRæG&Vv'&–Fò„FVæ6œ;6âÂ6Æ–VçFR’(	BÆÖ—6ÖÖ&6VRW6âÆ÷0¢òò6÷'&V÷2FRW7FFòFR6÷F—¦6œ;6â÷VF–FòÂ&VRFöFòÆòVRfRVÂ6Æ–VçFR6V6öç6—7FVçFRà¦6öç7Bd•$ÔôäE$TĞ¢ÇF&ÆR&öÆSÒ'&W6VçFF–öâ"6VÆÇFF–æsÒ#"6VÆÇ76–æsÒ#"&÷&FW#Ò#"7G–ÆSÒ&&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶Ö&v–ã£²#ãÇG#ãÇFB&v6öÆ÷#Ò"3"7G–ÆSÒ&&6¶w&÷VæBÖ6öÆ÷#¢3¶&÷&FW#£‚6öÆ–B3#c#c#c¶&÷&FW"×&F—W3£Gƒ·FF–æs£#‚#Gƒ²#ãÇF&ÆR&öÆSÒ'&W6VçFF–öâ"6VÆÇFF–æsÒ#"6VÆÇ76–æsÒ#"&÷&FW#Ò#"7G–ÆSÒ&&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S²#ãÇG#ãÇFBfÆ–vãÒ&Ö–FFÆR"7G–ÆSÒ'FF–ær×&–v‡C£#'ƒ²#ãÆ–Ör7&3Ò&‡GG3¢òöF6†&ö&BçF†VÆ"ç6öÇWF–öç2öÆövòÖfö÷FW"×F†VÆ"çær"v–GFƒÒ#ƒ‚"†V–v‡CÒ#ƒ2"ÇCÒ%F†RÆ"6öÇWF–öç2"7G–ÆSÒ&F—7Æ“¦&Æö6³¶&÷&FW#£¶÷WFÆ–æS¦æöæS·FW‡BÖFV6÷&F–öã¦æöæS·v–GFƒ£ƒ‡ƒ¶†V–v‡C£ƒ7ƒ²"óãÂ÷FCãÇFBfÆ–vãÒ&Ö–FFÆR"7G–ÆSÒ'FF–ærÖÆVgC£#'ƒ¶&÷&FW"ÖÆVgC£'‚6öÆ–B3CF63²#ãÆF—b7G–ÆSÒ&föçBÖfÖ–Ç“¢tÖöçG6W'&BrÂt†VÇfWF–6æWVRrÄ&–ÂÇ6ç2×6W&–c¶föçB×6—¦S£gƒ¶Æ–æRÖ†V–v‡C£ã#¶föçB×vV–v‡C£s¶6öÆ÷#¢6fffffc¶ÆWGFW"×76–æs£ã7ƒ²#äæG&Vv'&–FóÂöF—cãÆF—b7G–ÆSÒ&föçBÖfÖ–Ç“¢tDÒ6ç2rÂt†VÇfWF–6æWVRrÄ&–ÂÇ6ç2×6W&–c¶föçB×6—¦S£ãWƒ¶Æ–æRÖ†V–v‡C£ã3¶föçB×vV–v‡C£c¶6öÆ÷#¢3CF63¶ÆWGFW"×76–æs£ƒ·FW‡B×G&ç6f÷&Ó§WW&66S·FF–ær×F÷£Wƒ²#äFVæ6œ;6âÂ6Æ–VçFSÂöF—cãÆF—b7G–ÆSÒ&†V–v‡C£ƒ¶Æ–æRÖ†V–v‡C£ƒ¶föçB×6—¦S£²#âfæ'7³ÂöF—cãÆF—b7G–ÆSÒ&föçBÖfÖ–Ç“¢tDÒ6ç2rÂt†VÇfWF–6æWVRrÄ&–ÂÇ6ç2×6W&–c¶föçB×6—¦S£'ƒ¶Æ–æRÖ†V–v‡C£ã“¶6öÆ÷#¢63v66C²#ãÇ7â7G–ÆSÒ&6öÆ÷#¢3CF63²#âb3“cC#³Â÷7ãâfæ'7³Æ‡&VcÒ&‡GG3¢ò÷væÖRóSc“#ƒsƒS3’"7G–ÆSÒ&6öÆ÷#¢63v66C·FW‡BÖFV6÷&F–öã¦æöæS²#â³Sb’#ƒs‚S3“ÂöãÆ'"óãÇ7â7G–ÆSÒ&6öÆ÷#¢3CF63²#âb3“cC#³Â÷7ãâfæ'7³Æ‡&VcÒ&‡GG3¢ò÷F†VÆ"ç6öÇWF–öç2"7G–ÆSÒ&6öÆ÷#¢3CF63·FW‡BÖFV6÷&F–öã¦æöæS¶föçB×vV–v‡C£S²#çwwrçF†VÆ"ç6öÇWF–öç3ÂöãÆ'"óãÇ7â7G–ÆSÒ&6öÆ÷#¢3CF63²#âb3“cC#³Â÷7ãâfæ'7³Æ‡&VcÒ&Ö–ÇFó¦†öÆF†VÆ"ç6öÇWF–öç2"7G–ÆSÒ&6öÆ÷#¢63v66C·FW‡BÖFV6÷&F–öã¦æöæS²#æ†öÆF†VÆ"ç6öÇWF–öç3ÂöãÂöF—cãÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂ÷FCãÂ÷G#ãÂ÷F&ÆSæ° ¢òòWFò×&W7VW7FÂÆVB‡7VVB×FòÖÆVB’â&W7BÖVff÷'Bl:Ö&W6VæBâ&WV–W&R$U4TäEô•ô´U’à¦7–æ2gVæ7F–öâ6VæDÆVDWFõ&WÇ’†VçbÂæ÷&Ò’°¢–b‚Vçbå$U4TäEô•ô´U’ÇÂæ÷&ÒæVÖ–Â’&WGW&ã°¢òò&VÖ—FVçFRFR6&Â6Æ–VçFS¢æG&Vv'&–Fò„FVæ6œ;6âÂ6Æ–VçFR’à¢6öç7Bg&öÒĞ¢Vçbå$U4TäEôe$ôÕô4Ä”TåDRÇÂ$æG&Vv'&–FòÒF†RÆ"6öÇWF–öç2Æ†öÆF†VÆ"ç6öÇWF–öç3â#°¢6öç7BvÒVçbåt„E4ôåTÔ$U"ò‡GG3¢ò÷væÖRòG¶Vçbåt„E4ôåTÔ$U'Ö¢çVÆÃ°¢òòVÂæöÖ'&R’VÂ6W'f–6–òÆÆVvâFVÂf÷&×VÆ&–ò9¤$Ä”4ó¢fâW66F÷2Â–wVÀ¢òòVRVâVÂ&W7FòFRÆ÷26÷'&V÷2â6–âW7FòÂVâÆVB6öâ…DÔÂVâVÂæöÖ'&R6P¢òò–ç–V7F&VâVÂ7VW'òFRÆ&W7VW7FWFöÜ:F–6à¢6öç7BæÖRÒæ÷&ÒææÖRòW66T‡FÖÅr†æ÷&ÒææÖRç7Æ—B‚""•³Ò’¢"#°¢6öç7B7f2Òæ÷&Òç6W'f–6Rò6ö'&RÇ7G&öæsâG¶W66T‡FÖÅr†æ÷&Òç6W'f–6R—ÓÂ÷7G&öæsæ¢"#°¢6öç7Bv&Æö6²Òv¢òÇ7G–ÆSÒ&föçBÖfÖ–Ç“¢tDÒ6ç2rÂt†VÇfWF–6æWVRrÄ&–ÂÇ6ç2×6W&–c¶föçB×6—¦S£Wƒ¶Æ–æRÖ†V–v‡C£ãs¶6öÆ÷#¢36cCSF#¶Ö&v–ã£gƒ²#ì+õ&Vf–W&W2FVÆçF#òW67,:Ö&Væ÷2÷"v†G4¢Æ‡&VcÒ"G·vÒ"7G–ÆSÒ&6öÆ÷#¢3–3“C·FW‡BÖFV6÷&F–öã¦æöæS¶föçB×vV–v‡C£c²#âG·vç&WÆ6R‚&‡GG3¢òò"Â""—ÓÂöãÂ÷æ ¢¢"#°¢òòÖ—6ÖòFV×ÆFRFRÖ&6VRÆ÷26÷'&V÷2FRW7FFò†6÷F—¦6œ;6â÷VF–Fò“¢F&¦WF¢òò&Ææ66öâ6&V6W&Âg&æ¦GW'VW6Â6†—Â7VW'ò’f—&ÖFRæG&Và¢6öç7B‡FÖÂĞ¢ÆF—b7G–ÆSÒ&Ö&v–ã£·FF–æs£¶&6¶w&÷VæC¢6VVccC²#ãÇF&ÆR&öÆSÒ'&W6VçFF–öâ"v–GFƒÒ#R"6VÆÇFF–æsÒ#"6VÆÇ76–æsÒ#"7G–ÆSÒ&&6¶w&÷VæC¢6VVccC²#ãÇG#ãÇFBÆ–vãÒ&6VçFW""7G–ÆSÒ'FF–æs£#g‚'ƒ²#æ°¢ÇF&ÆR&öÆSÒ'&W6VçFF–öâ"v–GFƒÒ#c"6VÆÇFF–æsÒ#"6VÆÇ76–æsÒ#"7G–ÆSÒ'v–GFƒ£cƒ¶Ö‚×v–GFƒ£S¶&6¶w&÷VæC¢6fffffc¶&÷&FW"×&F—W3£gƒ¶÷fW&fÆ÷s¦†–FFVã¶&÷&FW#£‚6öÆ–B6SfS–VS¶&÷‚×6†F÷s£'‚'‚&v&ƒ#Ã3ÃCÂãb“²#æ°¢ÇG#ãÇFB7G–ÆSÒ&&6¶w&÷VæC¢6fffffc·FF–æs£#g‚3g‚‡ƒ²#ãÆ–Ör7&3Ò&‡GG3¢òöF6†&ö&BçF†VÆ"ç6öÇWF–öç2öÆövò×F†VÆ"Ö&Æ6²çær"v–GFƒÒ##s""†V–v‡CÒ##R"ÇCÒ%F†RÆ"6öÇWF–öç2"7G–ÆSÒ&F—7Æ“¦&Æö6³¶&÷&FW#£¶÷WFÆ–æS¦æöæS·FW‡BÖFV6÷&F–öã¦æöæS·v–GFƒ£#s'ƒ¶†V–v‡C£#Wƒ¶Ö‚×v–GFƒ£sBS²"óãÂ÷FCãÂ÷G#æ°¢ÇG#ãÇFB7G–ÆSÒ&†V–v‡C£7ƒ¶&6¶w&÷VæC¢3CF63¶Æ–æRÖ†V–v‡C£7ƒ¶föçB×6—¦S£²#âfæ'7³Â÷FCãÂ÷G#æ°¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£#g‚3g‚3ƒ²#æ°¢ÆF—b7G–ÆSÒ&F—7Æ“¦–æÆ–æRÖ&Æö6³¶&6¶w&÷VæC¢6Svcvcc¶6öÆ÷#¢3ƒv¶föçBÖfÖ–Ç“¢tDÒ6ç2rÂt†VÇfWF–6æWVRrÄ&–ÂÇ6ç2×6W&–c¶föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶ÆWGFW"×76–æs£ã'ƒ·FW‡B×G&ç6f÷&Ó§WW&66S·FF–æs£W‚'ƒ¶&÷&FW"×&F—W3£#ƒ²#å6öÆ–6—GVB&V6–&–FÂöF—cæ°¢ÆF—b7G–ÆSÒ&föçBÖfÖ–Ç“¢tÖöçG6W'&BrÂt†VÇfWF–6æWVRrÄ&–ÂÇ6ç2×6W&–c¶föçB×6—¦S£#'ƒ¶Æ–æRÖ†V–v‡C£ã3¶föçB×vV–v‡C£s¶6öÆ÷#¢3Cs“¶Ö&v–ã£G‚‡ƒ²#ì*&V6–&–Ö÷2GR6öÆ–6—GVBÂöF—cæ°¢ÆF—b7G–ÆSÒ&föçBÖfÖ–Ç“¢tDÒ6ç2rÂt†VÇfWF–6æWVRrÄ&–ÂÇ6ç2×6W&–c¶föçB×6—¦S£bãWƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢3&&c3C¶Ö&v–ã£‡ƒ²#ä†öÆG¶æÖWÒ	ù³ÂöF—cæ°¢Ç7G–ÆSÒ&föçBÖfÖ–Ç“¢tDÒ6ç2rÂt†VÇfWF–6æWVRrÄ&–ÂÇ6ç2×6W&–c¶föçB×6—¦S£Wƒ¶Æ–æRÖ†V–v‡C£ãs¶6öÆ÷#¢36cCSF#¶Ö&v–ã£gƒ²#äw&6–2÷"W67&–&—&æ÷2’÷"6öç6–FW&"Ç7G&öæsåF†RÆ"6öÇWF–öç3Â÷7G&öæsâ&GR&÷–V7Fòâ&V6–&–Ö÷2GR6öÆ–6—GVBG·7f7Ò’–ÆW7FÖ÷2&Wf—6æFòãÂ÷æ°¢Ç7G–ÆSÒ&föçBÖfÖ–Ç“¢tDÒ6ç2rÂt†VÇfWF–6æWVRrÄ&–ÂÇ6ç2×6W&–c¶föçB×6—¦S£Wƒ¶Æ–æRÖ†V–v‡C£ãs¶6öÆ÷#¢36cCSF#¶Ö&v–ã£gƒ²#åFR6öçF7F&VÖ÷2VâÇ7G&öæsæÖVæ÷2FR#B†÷&2Œ:&–ÆW3Â÷7G&öæsâ6öâVæ6÷F—¦6œ;6â†ÖFW&–ÂÂÆ¦ò’&V6–ò’â7VÇV–W"GVFÂVVFW2&W7öæFW"F—&V7FÖVçFRW7FR6÷'&VòãÂ÷æ°¢v&Æö6²°¢ÆF—b7G–ÆSÒ&föçBÖfÖ–Ç“¢tDÒ6ç2rÂt†VÇfWF–6æWVRrÄ&–ÂÇ6ç2×6W&–c¶föçB×6—¦S£Wƒ¶Æ–æRÖ†V–v‡C£ãc¶6öÆ÷#¢36cCSF#¶Ö&v–ã£#'‚#ƒ²#åVâ6ÇVFòÃÂöF—cæ°¢d•$ÔôäE$T°¢ÆF—b7G–ÆSÒ&&÷&FW"×F÷£‚6öÆ–B6VVccC¶Ö&v–ã£#G‚·FF–ær×F÷£gƒ¶föçBÖfÖ–Ç“¢tDÒ6ç2rÂt†VÇfWF–6æWVRrÄ&–ÂÇ6ç2×6W&–c¶föçB×6—¦S£ƒ¶Æ–æRÖ†V–v‡C£ãc¶6öÆ÷#¢3–c²#äW7FR6÷'&VògVRVçf–Fò÷"Ç7â7G–ÆSÒ&6öÆ÷#¢3f#ssƒ²#åF†RÆ"6öÇWF–öç3Â÷7ãâ+rf'&–66œ;6âF–v—FÂ+r6çF–vòÂ6†–ÆSÆ'#ì+ôæòW7W&&2W7FRÖVç6¦Sò&W7;6æFVæ÷2’Æò&Wf—6Ö÷2ãÂöF—cæ°¢Â÷FCãÂ÷G#ãÂ÷F&ÆSãÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—cæ°¢G'’°¢v—BfWF6‚‚&‡GG3¢òö’ç&W6VæBæ6öÒöVÖ–Ç2"Â°¢ÖWF†öC¢%õ5B"À¢†VFW'3¢°¢WF†÷&—¦F–öã¢$&V&W""²Vçbå$U4TäEô•ô´U’À¢$6öçFVçBÕG—R#¢&Æ–6F–öâö§6öâ"À¢ÒÀ¢&öG“¢¥4ôâç7G&–æv–g’‡°¢g&öÒÀ¢Fó¢¶æ÷&ÒæVÖ–ÅÒÀ¢&WÇ•÷Fó¢&†öÆF†VÆ"ç6öÇWF–öç2"À¢7V&¦V7C¢%&V6–&–Ö÷2GR6öÆ–6—GVB(	BF†RÆ"6öÇWF–öç2"À¢‡FÖÂÀ¢Ò’À¢Ò“°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚%¶ÆVG2×v÷&¶W%ÒWFò×&WÇ“¢"ÂRæÖW76vR“°¢Ğ§Ğ ¢òòf—6ò–çFW&æò7VæFòVâÆVBäò6RVFòwV&F"Vâ—'F&ÆR†6œ;2Â'VffW"FP¢òò&V–çFVçF÷2’âçFW2W7FòfÆÆ&Vâ6–ÆVæ6–ó¢VÂÆVB&V6–,:ÖVÂ'FR6öçF7F&VÖ÷2 ¢òòW&òæòVçG&&Â5$Ò’æF–R6RVçFW&&â†÷&ÆÆVvVÂFFò6ö×ÆWFò²VÀ¢òòÖ÷F—fòW†7FòFVÂ&V6†¦òÂ&&W66F&ÆòÖæòâ&W7BÖVff÷'Bl:Ö&W6VæBà¦7–æ2gVæ7F–öâ6VæDÆVE6fTf–ÆVDÆW'B†VçbÂæ÷&ÒÂ&V6öâÂ÷G2Ò·Ò’°¢–b‚Vçbå$U4TäEô•ô´U’’&WGW&ã°¢6öç7Bg&öÒÒVçbå$U4TäEôe$ôÒÇÂ%F†RÆ"6öÇWF–öç2Æ†öÆF†VÆ"ç6öÇWF–öç3â#°¢6öç7BFòÒVçbäÄTE5ôäõD”e•õDòÇÂ'F†VÆ'6öÇWF–öç66ÄvÖ–Âæ6öÒ#°¢6öç7BF—FÆRÒ÷G2çF—FÆRÇÂ.)ªûˆòÆVBäò6RwV&L;2VâVÂ5$Ò#°¢6öç7B–çG&òĞ¢÷G2æ–çG&òÇÀ¢%6RVçfœ;2ÆWFò×&W7VW7FÂÆVBÂW&òÇ7G&öæsä—'F&ÆR&V6†¬;2VÂ&Vv—7G&óÂ÷7G&öæsââ"°¢%VVL;2VâVÂ'VffW"FR&V–çFVçF÷2†6F†÷&’âÇ7G&öæså6’æò&V6RVâVÂ5$ÒVâã†÷&Â"°¢'&V|:×7G&ÆòÖæóÂ÷7G&öæsâ6öâW7F÷2FF÷2&æòW&FW&Æòâ#°¢6öç7B7V&¦V7BĞ¢÷G2ç7V&¦V7BÇÂ)ªûˆòÆVBäòwV&FFò‡&W66F"“¢G¶æ÷&ÒææÖRÇÂæ÷&ÒæVÖ–ÂÇÂ'6–âæöÖ'&R'ÖÚ±î¸Â¸­yêë¢°k¢G§¦*^;
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
    );
  const rows = [
    ["Nombre", norm.name],
    ["Empresa", norm.company],
    ["Email", norm.email],
    ["TelÃ©fono", norm.phone],
    ["Servicio", norm.service],
    ["Mensaje", norm.message],
  ].filter(([, v]) => v);
  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.55;max-width:560px">` +
    `<h2 style="margin:0 0 12px;color:#b00020">${title}</h2>` +
    `<p>${intro}</p>` +
    `<p style="background:#fff3f3;border:1px solid #f3caca;border-radius:8px;padding:8px 12px;color:#a00"><strong>Motivo (Airtable):</strong> ${esc(reason)}</p>` +
    rows.map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(v)}</p>`).join("") +
    `<p style="color:#666;font-size:13px;margin-top:18px">â€” Worker de leads Â· The Lab Solutions</p>` +
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

// Aviso interno de nueva postulaciÃ³n de proveedor. Best-effort vÃ­a Resend.
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
    ["TelÃ©fono", p.phone],
    ["CategorÃ­a / rubro", p.categoria],
    ["Sitio web", p.website],
    ["Productos / servicios", p.productos],
    ["Mensaje", p.message],
  ].filter(([, v]) => v);
  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.55;max-width:560px">` +
    `<h2 style="margin:0 0 12px">Nueva postulaciÃ³n de proveedor â€” thelab.solutions</h2>` +
    (p.failed
      ? `<p style="color:#b00"><strong>âš ï¸ No se pudo guardar en Airtable.</strong> Registrar manualmente con estos datos.</p>`
      : `<p>Estado: <strong>ENTREVISTAR</strong> Â· revÃ­sala en la tabla <em>Proveedores</em> del dashboard.</p>`) +
    rows.map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(v)}</p>`).join("") +
    `<p style="color:#666;font-size:13px;margin-top:18px">â€” Pipeline web Â· The Lab Solutions</p>` +
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
        subject: `Nueva postulaciÃ³n de proveedor: ${p.nombre}`,
        html,
      }),
    });
  } catch (e) {
    console.error("[proveedor] notificaciÃ³n:", e.message);
  }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * Normalizadores de payload por canal â†’ forma interna Ãºnica
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
// Sube un adjunto (base64) al campo de attachments del Cliente usando el
// endpoint de contenido de Airtable (acepta el archivo directo, sin URL pÃºblica).
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
    // Ficha de cliente (web) â†’ columnas reales de Clientes
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
  if (meta.length) lines.push(meta.join(" Â· "));
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

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * Airtable helpers (tolerantes a campos inexistentes)
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
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

// Busca un Cliente existente por email o telÃ©fono (dedupe). Best-effort.
async function airtableFindCliente(env, { email, phone }) {
  const esc = (s) => String(s).replace(/'/g, "\\'");
  const clauses = [];
  if (email) clauses.push(`LOWER({Email})=LOWER('${esc(email)}')`);
  const phoneDigits = phone ? String(phone).replace(/[^0-9]/g, "") : "";
  if (phoneDigits)
    clauses.push(`REGEX_REPLACE({TelÃ©fono} & "", "[^0-9]", "") = '${phoneDigits}'`);
  if (!clauses.length) return null;
  const formula = clauses.length > 1 ? `OR(${clauses.join(",")})` : clauses[0];
  const url =
    `${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent("Clientes")}` +
    `?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
  // Reintenta ante rate-limit / transitorio: un blip acÃ¡ harÃ­a que se cree un
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

// Crea reintentando: descarta campos que Airtable rechaza (desconocidos o invÃ¡lidos)
// y reintenta con backoff ante rate-limit / errores transitorios (429 / 5xx).
async function airtableCreateTolerant(env, table, fields, maxTries = 8) {
  let f = { ...fields };
  for (let i = 0; i < maxTries; i++) {
    const r = await airtableCreate(env, table, f);
    if (r.ok) return await r.json();
    if (r.status === 429 || r.status >= 500) {
      await sleep(300 * (i + 1)); // rate-limit / transitorio â†’ esperar y reintentar
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
      await sleep(300 * (i + 1)); // rate-limit / transitorio â†’ esperar y reintentar
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
  // Devuelve el nombre de un campo que conviene descartar y reintentar sin Ã©l, para
  // no perder el registro completo por un solo campo problemÃ¡tico. Cubre:
  //  - "Unknown field name: \"X\""          â†’ el campo no existe en la base
  //  - "Field \"X\" cannot accept ..."       â†’ valor/tipo invÃ¡lido o campo computado
  //  - "... for field \"X\""                 â†’ no se pudo parsear el valor de X
  // Los errores sin nombre de campo (p. ej. rate-limit 429) devuelven null â†’ se
  // relanzan y el lead va al buffer de reintentos (no se descarta ningÃºn dato).
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

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * Anti-bot / utilidades
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
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

// Rate-limit por IP usando KV opcional (binding env.RL). Sin KV â†’ no limita.
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
  // El dÃ­a del tope es el dÃ­a de Chile: con UTC el contador se reiniciaba a las
  // 20:00 hora local, en plena tarde de trabajo, y no al empezar la jornada.
  const key = `autoproc:${today()}`;
  const cur = parseInt((await env.RL.get(key)) || "0", 10);
  if (cur >= cap) return false;
  await env.RL.put(key, String(cur + 1), { expirationTtl: 172800 });
  return true;
}

// â”€â”€ Dead-letter: nunca perder un lead si Airtable falla â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function bufferDeadLetter(env, item) {
  if (!env.RL) return;
  try {
    const key = `dl:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await env.RL.put(key, JSON.stringify(item), { expirationTtl: 604800 }); // 7 dÃ­as
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
          "Fecha creaciÃ³n": new Date().toISOString(),
        })
      );
      await env.RL.delete(k.name); // recuperado â†’ fuera del buffer
    } catch (_) {
      /* sigue en buffer para el prÃ³ximo intento */
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
// devuelve UTC y estampa el dÃ­a siguiente en acciones de tarde-noche (UTC-4/-3),
// descuadrando reportes mensuales cuando el cambio de dÃ­a UTC cruza fin de mes.
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

// â”€â”€ Latido a la tabla Automations (Oficina Virtual) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Marca la fila ID=<id> como "Activo" con la hora actual, mÃ¡x. 1 vez cada
// 5 min (throttle por isolate). Best-effort: si la tabla/fila no existen,
// no hace nada. Se invoca con ctx.waitUntil para no aÃ±adir latencia.
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

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * PILOTO AUTOMÃTICO GOOGLE ADS (semanal, con aprobaciÃ³n por email)
 *
 * Cron (lunes) â†’ lee seÃ±ales (ventas por lÃ­nea, capacidad de producciÃ³n,
 * campaÃ±as desde el endpoint del Script 1) â†’ Claude propone ajustes â†’
 * guardrails duros filtran â†’ guarda la propuesta en Agent_Queue (Pendiente)
 * â†’ email con botones Aprobar / Rechazar â†’ al aprobar, las mutaciones se
 * encolan en el Script 1 y el Script 2 las aplica en Google Ads.
 *
 * Config (wrangler.toml / secrets):
 *   ADS_AUTOPILOT=true            interruptor maestro
 *   ADS_ENDPOINT=<URL Script 1>   lectura de campaÃ±as + cola de mutaciones
 *   ADS_SCRIPT_SECRET             secret del Script 1 (default thelab2025)
 *   ADS_APPROVAL_SECRET           firma los links de aprobaciÃ³n (fallback PUBLIC_LEAD_KEY)
 *   ADS_AUTOPILOT_EMAIL           destinatario (fallback LEADS_NOTIFY_TO)
 *   WORKER_PUBLIC_URL             URL pÃºblica del worker (para los links del email)
 * Kill-switch sin deploy: registro "ADS_AUTOPILOT" en Monitor Sistema con
 * Notes = {"enabled":false}. AhÃ­ tambiÃ©n se pueden ajustar los lÃ­mites.
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

// Las 9 lÃ­neas: nombre visible (= "Servicio interÃ©s" en Clientes), tÃ©rminos para
// matchear campaÃ±as por nombre, y plantilla para crear campaÃ±a si falta cobertura.
const AP_LINEAS = [
  { slug: "chip-the-lab", nombre: "Chip The Lab", match: ["nfc", "chip"], presupuesto: 3000,
    kws: ["tarjetas nfc", "tarjeta de presentacion nfc", "tarjetas nfc empresa", "tarjeta digital nfc"],
    titulos: ["Tarjetas NFC", "Tarjeta Digital NFC", "NFC para Empresas", "The Lab Solutions"],
    descs: ["Tarjetas de presentaciÃ³n NFC personalizadas: comparte tu contacto al tocar.", "Tarjetas inteligentes NFC para tu equipo. Cotiza las tuyas online."] },
  { slug: "impresion-3d", nombre: "ImpresiÃ³n 3D", match: ["3d"], presupuesto: 8000,
    kws: ["impresiÃ³n 3d santiago", "servicio de impresion 3d", "piezas 3d a medida", "prototipo 3d"],
    titulos: ["ImpresiÃ³n 3D en Santiago", "Piezas y Prototipos 3D", "ImpresiÃ³n 3D a Medida", "The Lab Solutions"],
    descs: ["ImpresiÃ³n 3D profesional: piezas, prototipos y repuestos a medida.", "Llevamos tu idea a una pieza real. Cotiza tu proyecto 3D en Santiago."] },
  { slug: "premiaciones", nombre: "Premiaciones", match: ["premiacion", "trofeo", "galvano", "medalla"], presupuesto: 6000,
    kws: ["galvanos personalizados", "trofeos corporativos", "medallas personalizadas", "premios para empresa"],
    titulos: ["Galvanos y Trofeos", "Premiaciones Corporativas", "Trofeos Personalizados", "The Lab Solutions"],
    descs: ["Galvanos, trofeos y medallas personalizados para premiar a tu equipo.", "FabricaciÃ³n a medida para tu premiaciÃ³n. Cotiza online."] },
  { slug: "volumetricos", nombre: "VolumÃ©tricos", match: ["volumetric", "corpore", "neon", "neÃ³n"], presupuesto: 5000,
    kws: ["letras corporeas", "letrero neon led", "logo corporeo", "letreros luminosos led"],
    titulos: ["Letras CorpÃ³reas y NeÃ³n", "VolumÃ©tricos a Medida", "Letreros NeÃ³n LED", "The Lab Solutions"],
    descs: ["Letras corpÃ³reas, logos 3D y neÃ³n LED personalizados para tu marca.", "VolumÃ©tricos y estructuras para oficina o evento. Cotiza a medida."] },
  { slug: "carteleria", nombre: "CartelerÃ­a", match: ["carteler", "seÃ±alet", "senalet", "letrero", "acril"], presupuesto: 6000,
    kws: ["seÃ±aletica corporativa", "letrero acrilico", "seÃ±alizacion empresa", "placas acrilico"],
    titulos: ["CartelerÃ­a y SeÃ±alÃ©tica", "SeÃ±alÃ©tica en AcrÃ­lico", "Letreros para Empresas", "The Lab Solutions"],
    descs: ["CartelerÃ­a y seÃ±alÃ©tica corporativa en acrÃ­lico con corte lÃ¡ser.", "Letreros, rÃ³tulos y placas a medida para tu empresa. Cotiza online."] },
  { slug: "activaciones", nombre: "Activaciones", match: ["activacion", "activaciÃ³n", "btl"], presupuesto: 6000,
    kws: ["activaciones de marca", "activaciones btl", "stands para activacion", "activacion marca santiago"],
    titulos: ["Activaciones de Marca", "Activaciones BTL a Medida", "ProducciÃ³n de Activaciones", "The Lab Solutions"],
    descs: ["Activaciones de marca y BTL producidas end-to-end para tu campaÃ±a o evento.", "DiseÃ±o, fabricaciÃ³n y montaje. Cotiza tu activaciÃ³n en Santiago."] },
  { slug: "merchandising", nombre: "Merchandising", match: ["merch", "regalo", "promocional"], presupuesto: 6000,
    kws: ["merchandising corporativo", "regalos corporativos", "articulos promocionales", "regalos corporativos por mayor"],
    titulos: ["Merchandising Corporativo", "Regalos Corporativos", "ArtÃ­culos Promocionales", "The Lab Solutions"],
    descs: ["Merchandising y regalos corporativos personalizados para tu marca.", "Kits, artÃ­culos promocionales y packs por mayor. Cotiza para tu empresa."] },
  { slug: "cajas-personalizadas", nombre: "Cajas Personalizadas", match: ["caja", "packaging"], presupuesto: 4000,
    kws: ["cajas personalizadas", "packaging personalizado", "packaging corporativo", "cajas con logo empresa"],
    titulos: ["Cajas Personalizadas", "Packaging a Medida", "Cajas con tu Logo", "The Lab Solutions"],
    descs: ["Cajas y packaging personalizados para regalo o producto corporativo.", "DiseÃ±o y fabricaciÃ³n de cajas a medida con tu marca. Cotiza online."] },
  { slug: "papeleria", nombre: "PapelerÃ­a", match: ["papeler", "imprenta", "tarjeta", "membrete"], presupuesto: 3000,
    kws: ["papeleria corporativa", "tarjetas de presentacion", "imprenta corporativa", "membrete personalizado"],
    titulos: ["PapelerÃ­a Corporativa", "Tarjetas y Membretes", "Imprenta para Empresas", "The Lab Solutions"],
    descs: ["PapelerÃ­a corporativa: tarjetas, membretes, sellos y carpetas.", "Imagen profesional para tu empresa. Cotiza tu papelerÃ­a online."] },
];

const AP_DEFAULTS = {
  maxChangePct: 0.3,     // cambio mÃ¡x de presupuesto por semana
  capTotalDiario: 60000, // tope de presupuesto diario total (CLP) tras los cambios
  minConv: 8,            // bajo esto no se toman decisiones agresivas
  cpaSano: 8000,         // CLP â€” no pausar campaÃ±as con CPA bajo esto
  maxAcciones: 6,
  maxCrear: 1,
  presupuestoNuevoMax: 10000, // CLP/dÃ­a mÃ¡x para una campaÃ±a creada por el piloto
};

function apNorm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[Ì€-Í¯]/g, "");
}

// Asigna cada campaÃ±a a lo mÃ¡s una lÃ­nea (prioridad = orden de AP_LINEAS)
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

// Huella corta de las mutaciones: va dentro de la firma del link de aprobaciÃ³n,
// asÃ­ un token no puede aplicar un payload distinto al que se propuso (TOCTOU).
async function apMutHash(mutaciones) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(mutaciones || [])));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Config editable sin deploy: Monitor Sistema â†’ registro Name="ADS_AUTOPILOT",
// Notes = JSON {enabled, maxCham«ëŒ+Š×®º+º$zzb¥