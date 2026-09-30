# Signed customer-feedback links — staged migration

The public NPS, proof-of-delivery (POD) and order-tracking routes formerly accepted base64(Airtable record ID). IP-based rate limiting is not access authorization.

The lead Worker now supports administrator-authenticated `POST /feedback/link`, accepting one canonical order record ID, a purpose (`nps`, `pod` or `pedido`) and 1–90 days of validity. It returns a purpose-bound, expiring HMAC-SHA256 link. Issuance requires the private `PORTAL_ADMIN_KEY` and a server-only `FEEDBACK_LINK_SECRET` (at least 32 characters) or an existing equally long private `PORTAL_SECRET`; it never uses the public lead key or Airtable PAT as a signing fallback. No signing secret is placed in Pages.

The Airtable proxy has a `POST /feedback/link` bridge restricted to a verified Cloudflare Access `operator`, `finance` or `admin`. It validates all inputs, sends the server-held portal credential only to the approved lead Worker, rejects redirects and verifies the issued link before returning it.

Both signed and legacy customer links are accepted while `FEEDBACK_SIGNED_ONLY` is unset. Enabling `FEEDBACK_SIGNED_ONLY=true` on the lead Worker rejects unsigned legacy links for all three routes, including NPS comments and POD confirmation; links signed for one purpose cannot be used for another. This switch remains **OFF** until the dashboard's outgoing NPS, POD and tracking messages request the new signed links and that path passes real-user tests.

Final coordinated rollout (no user setup required during this code-audit stage): configure a private feedback signing secret and matching private portal-admin credentials on the relevant Workers, restore the same-site proxy DNS, verify Cloudflare Access and the proxy's role enforcement from real browsers, migrate dashboard link generation, then enable signed-only enforcement. Any previously sent legacy links will stop working at that final switch; plan customer support for reissuing them.

Automated tests cover signing, purpose isolation, expiry, missing secrets, legacy compatibility, denial when signed-only is enabled, role protection and safe proxy forwarding. Do not mistake a successful Worker deployment for verified production enforcement while Access and DNS are pending.

## Issuer and browser cutover safeguards

Feedback issuance is **separately disabled** until `FEEDBACK_ISSUER_ENABLED=true` is configured on the lead Worker. This matters because the existing legacy portal administration credential may have appeared in earlier static dashboard bundles: deploy the code first, move all portal issuance to verified Access, rotate `PORTAL_ADMIN_KEY` across the proxy and lead Worker, and only then enable this issuer. A known old browser key alone must never mint signed order-feedback URLs.

The dashboard's `js/agentes.js` now has its own `FEEDBACK_ACCESS_MODE` build gate. In secure mode its WhatsApp and email workflows request NPS, POD and tracking URLs through `POST /feedback/link` on the same-site proxy with Access cookies. Issuance, role, network and malformed-response failures **abort sharing** rather than fall back to base64 record IDs; a WhatsApp popup is pre-opened on click so the async issuer does not trigger popup blocking. Existing legacy links are unchanged with the gate off. The GitHub Pages deployment refuses `FEEDBACK_ACCESS_MODE=true` without both `FEEDBACK_CUTOVER_VERIFIED=true` and `PORTAL_ACCESS_MODE=true`, a configured lead Worker and a same-site proxy URL.

At the final joint cutover, confirm `FEEDBACK_ISSUER_ENABLED=true` and a freshly rotated `PORTAL_ADMIN_KEY` on the Workers only after the existing Pages portal admin secret has been removed and Access sessions verified. Configure a dedicated 32+ character `FEEDBACK_LINK_SECRET` on the lead Worker, verify new NPS/POD/tracking links and expiry with actual browsers, then enable `FEEDBACK_ACCESS_MODE`/`FEEDBACK_CUTOVER_VERIFIED` for Pages. Enable `FEEDBACK_SIGNED_ONLY=true` only after already-sent legacy links have been handled or reissued. If the signed-only flag is malformed but nonempty, verification now fails closed rather than silently accepting base64 again.
