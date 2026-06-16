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
 *   POST /webhooks/google-ads   (Google Lead Form — clave GOOGLE_ADS_WEBHOOK_KEY)
 *   POST /webhooks/linkedin     (LinkedIn vía Make/Zapier — clave LINKEDIN_WEBHOOK_KEY)
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
      // ── GET /health ────────────────────────────────────────────────
      if (request.method === "GET" && url.pathname === "/health") {
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

      if (request.method === "POST" && url.pathname === "/webhooks/google-ads") {
        return await handleGoogleAds(request, env, ctx, cors);
      }

      if (request.method === "POST" && url.pathname === "/webhooks/linkedin") {
        return await handleLinkedin(request, env, ctx, cors);
      }

      return json({ ok: false, error: "Ruta no encontrada" }, 404, cors);
    } catch (e) {
      console.error("[leads-worker]", e?.stack || e?.message || String(e));
      return json({ ok: false, error: "Error interno" }, 500, cors);
    }
  },
};

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
  return await createLeadAndQueue(env, ctx, cors, {
    norm,
    agente: "LEAD_AGENT",
    evento: "lead.created",
    source: norm.source || "web",
    campaign: norm.utmCampaign,
  });
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
 * NÚCLEO: crear Cliente + tarea en Agent_Queue
 * ══════════════════════════════════════════════════════════════════════ */
async function createLeadAndQueue(env, ctx, cors, { norm, agente, evento, source, campaign }) {
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) {
    return json({ ok: false, error: "Airtable no configurado" }, 500, cors);
  }

  // 1) Cliente — campos tolerantes (si no existen en la base, se descartan)
  const clienteFields = stripEmpty({
    Empresa: norm.company || norm.name,
    Contacto: norm.name,
    Email: norm.email,
    Teléfono: norm.phone,
    "Cargo contacto": norm.jobTitle,
    "Origen lead": source,
    Comuna: norm.comuna,
    "Servicio interés": norm.service,
    "Notas internas": buildNotes(norm),
    "Fecha primer contacto": today(),
  });

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
        })
      );
    } else {
      const cliente = await airtableCreateTolerant(env, "Clientes", clienteFields);
      clienteId = cliente?.id || null;
    }
  } catch (e) {
    console.error("[leads-worker] Clientes:", e.message);
    return json({ ok: false, error: "No se pudo crear el cliente" }, 502, cors);
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
    // El lead ya se guardó; la cola es best-effort.
    console.error("[leads-worker] Agent_Queue:", e.message);
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

async function callClaude(env, system, user) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 1200,
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

// Auto-respuesta al lead (speed-to-lead). Best-effort vía Resend. Requiere RESEND_API_KEY.
async function sendLeadAutoReply(env, norm) {
  if (!env.RESEND_API_KEY || !norm.email) return;
  const from = env.RESEND_FROM || "The Lab Solutions <contacto@thelab.solutions>";
  const wa = env.WHATSAPP_NUMBER ? `https://wa.me/${env.WHATSAPP_NUMBER}` : null;
  const name = norm.name ? norm.name.split(" ")[0] : "";
  const svc = norm.service ? ` sobre <strong>${norm.service}</strong>` : "";
  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;color:#111;line-height:1.55;max-width:520px">` +
    `<h2 style="margin:0 0 12px">¡Recibimos tu solicitud! 👋</h2>` +
    `<p>Hola ${name},</p>` +
    `<p>Gracias por escribirnos. Recibimos tu solicitud${svc} y te contactaremos en ` +
    `<strong>menos de 24 horas hábiles</strong> con una cotización (material, plazo y precio).</p>` +
    (wa
      ? `<p>Si quieres adelantar, escríbenos por WhatsApp: <a href="${wa}">${wa.replace("https://", "")}</a></p>`
      : "") +
    `<p style="color:#666;font-size:13px;margin-top:18px">— Equipo The Lab Solutions · fabricación digital, Santiago</p>` +
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
        to: [norm.email],
        subject: "Recibimos tu solicitud — The Lab Solutions",
        html,
      }),
    });
  } catch (e) {
    console.error("[leads-worker] auto-reply:", e.message);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * Normalizadores de payload por canal → forma interna única
 * ══════════════════════════════════════════════════════════════════════ */
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
    comuna: str(b.comuna),
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
  try {
    const r = await fetch(url, {
      headers: { Authorization: "Bearer " + env.AIRTABLE_TOKEN },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.records?.[0]?.id || null;
  } catch (_) {
    return null;
  }
}

// Crea reintentando: si Airtable rechaza un campo desconocido, lo quita y reintenta.
async function airtableCreateTolerant(env, table, fields, maxTries = 8) {
  let f = { ...fields };
  for (let i = 0; i < maxTries; i++) {
    const r = await airtableCreate(env, table, f);
    if (r.ok) return await r.json();
    const bad = await unknownFieldFrom(r);
    if (bad && bad in f) {
      delete f[bad];
      continue;
    }
    throw new Error(await airtableErr(r));
  }
  throw new Error(`Airtable: demasiados campos desconocidos en ${table}`);
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
  // "Unknown field name: \"Servicio interés\""
  const m = msg.match(/Unknown field name:?\s*"?([^"]+)"?/i);
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
  const key = `autoproc:${new Date().toISOString().slice(0, 10)}`;
  const cur = parseInt((await env.RL.get(key)) || "0", 10);
  if (cur >= cap) return false;
  await env.RL.put(key, String(cur + 1), { expirationTtl: 172800 });
  return true;
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Permite los orígenes configurados + los deploys de Vercel de este proyecto
  // (web-thelab-solutions*.vercel.app) para previsualización. No es wildcard general.
  const isVercel = /^https:\/\/web-thelab-solutions[a-z0-9-]*\.vercel\.app$/.test(origin);
  const allow = allowed.includes(origin) || isVercel ? origin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Public-Lead-Key",
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
const today = () => new Date().toISOString().slice(0, 10);
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
