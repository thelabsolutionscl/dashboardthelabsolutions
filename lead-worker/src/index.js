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

      if (request.method === "POST" && url.pathname === "/proveedor") {
        return await handleProveedor(request, env, ctx, cors);
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
  const msg = new TextEncoder().encode(`${purpose}:${String(email).trim().toLowerCase()}`);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(nlSecret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msg);
  let s = "";
  const b = new Uint8Array(sig);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function nlVerify(env, purpose, email, token) {
  if (!token) return false;
  return timingSafeEqual(token, await nlSign(env, purpose, email));
}
function escapeHtmlW(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function htmlPage(title, msg, ok) {
  const color = ok ? "#00b3a4" : "#e5484d";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtmlW(title)} — The Lab Solutions</title></head>
<body style="margin:0;background:#0b0b0c;color:#e8e8ea;font-family:system-ui,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:460px;padding:40px 28px;text-align:center">
<div style="font-size:13px;letter-spacing:.18em;color:#7a7a82;text-transform:uppercase;margin-bottom:18px">The Lab Solutions</div>
<h1 style="font-size:22px;margin:0 0 12px;color:${color}">${escapeHtmlW(title)}</h1>
<p style="font-size:15px;line-height:1.6;color:#b6b6bd;margin:0 0 24px">${escapeHtmlW(msg)}</p>
<a href="https://thelab.solutions" style="display:inline-block;background:#00b3a4;color:#06231f;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:14px">Ir a thelab.solutions</a>
</div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
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
    "Etapa venta": "Lead nuevo",
    "Notas internas": buildNotes(norm),
    "Fecha primer contacto": today(),
  });
}

async function createLeadAndQueue(env, ctx, cors, { norm, agente, evento, source, campaign }) {
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
  const name = norm.name ? norm.name.split(" ")[0] : "";
  const svc = norm.service ? ` sobre <strong>${norm.service}</strong>` : "";
  const html =
    `<div style="font-family:'DM Sans',system-ui,Arial,sans-serif;color:#111;line-height:1.6;max-width:560px">` +
    `<h2 style="margin:0 0 12px">¡Recibimos tu solicitud! 👋</h2>` +
    `<p>Hola ${name},</p>` +
    `<p>Gracias por escribirnos. Recibimos tu solicitud${svc} y te contactaremos en ` +
    `<strong>menos de 24 horas hábiles</strong> con una cotización (material, plazo y precio).</p>` +
    (wa
      ? `<p>Si quieres adelantar, escríbenos por WhatsApp: <a href="${wa}">${wa.replace("https://", "")}</a></p>`
      : "") +
    `<div style="margin:22px 0 16px;color:#3f454b">Un saludo,</div>` +
    FIRMA_ANDREA +
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
async function sendLeadSaveFailedAlert(env, norm, reason) {
  if (!env.RESEND_API_KEY) return;
  const from = env.RESEND_FROM || "The Lab Solutions <hola@thelab.solutions>";
  const to = env.LEADS_NOTIFY_TO || "thelabsolutionscl@gmail.com";
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
    `<h2 style="margin:0 0 12px;color:#b00020">⚠️ Lead NO se guardó en el CRM</h2>` +
    `<p>Se envió la auto-respuesta al lead, pero <strong>Airtable rechazó el registro</strong>. ` +
    `Quedó en el buffer de reintentos (cada hora). <strong>Si no aparece en el CRM en ~1 hora, ` +
    `regístralo a mano</strong> con estos datos para no perderlo.</p>` +
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
        subject: `⚠️ Lead NO guardado (rescatar): ${norm.name || norm.email || "sin nombre"}`,
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
  const key = `autoproc:${new Date().toISOString().slice(0, 10)}`;
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
