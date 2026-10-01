# Inventory: CRM writers outside the shared guard

A read-only schema check confirmed owner and related-record fields across Clientes, Cotizaciones and Pedidos. The connected Airtable account showed zero automations for this base; this does not establish the state of external Make scenarios or other API clients.

The lead Worker directly creates unassigned customers, refreshes existing customer contact and lead attributes, records customer-portal quote decisions and rejection notes, and writes NPS and delivery confirmations on orders. None of the inspected routes intentionally changes the seller or commercial record links. Generic lead Worker Airtable create/PATCH helpers now reject all seller and commercial-link field names and IDs, preventing an accidental future expansion of those public routes into owner-changing writers.

To avoid clobbering data written by the independent lead Worker, staged sales PATCH no longer offers the customer's Cargo contacto or the quote's Notas cotización. This does not activate sales writes: ACCESS_SALES_WRITES_ENABLED remains off. External writers, direct Airtable editor permissions and Make scenarios still require verification before the final controlled rollout. No historical seller attribution is inferred or changed.

A separate follow-up should harden legacy post-delivery NPS/POD and order-tracking links that currently encode record IDs rather than purpose-bound signed tokens, while preserving customer workflows during migration.
