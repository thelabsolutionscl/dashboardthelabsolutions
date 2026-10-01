# Operator mutation policy — staged signed Access

The legacy public APP_KEY still operates until the final, coordinated Cloudflare Access cutover. This policy applies only to an independently verified signed `operator` identity. Do **not** claim production is protected before the proxy DNS, Cloudflare Access mapping and two-browser end-to-end checks have completed.

## Scope

The previous signed operator role could DELETE CRM data and send unrestricted POST/PATCH fields even while read responses hid financial columns. The operator role now has **no Airtable DELETE permission**. The unreviewed `Inventario`, `Monitor Sistema` and `Equipo_Eventos` tables have no signed operator writes pending separate data-classification review. Its existing machine/maintenance/event operational write permissions are unchanged in this patch; audit their payloads separately.

Signed operator POST/PATCH on **Clientes, Cotizaciones, Pedidos and Proveedores** must pass a table-specific allowlist of field names and field types, checked against the September 29 Airtable schema. New, differently cased, field-ID and unknown fields are denied by default. In particular `Vendedor`, banking and payment terms, direct finance links, actual margins, production costs, paid balance/advance flags, tax-document numbers and invoice URLs are forbidden to this role. Operator may still enter legitimate quote and order *sale* totals and approved operational status/production details; this is not a finance-only role.

The four catalogues distinguish free text, notes, selections, numbers/currency, booleans, dates, URLs, email/phone, multiple-select and canonical record-link arrays. Record links are bounded and have canonical Airtable IDs; `Cliente` and `Pedido` are at most one link. Only a single-record POST is allowed. PATCH accepts either a single record or a bounded 10-row batch on the matching collection endpoint, with no additional top-level keys or `typecast=true`. The existing global CRM Durable Object serializes signed operator creates of Cotizaciones/Pedidos and single/batch PATCH on all three commercial tables; it independently revalidates the operator payload before accessing Airtable. Clientes/Proveedores creates and supplier PATCH remain direct but field-validated.

**Mutation response redaction:** a successful operator POST/PATCH is also a read operation. The Worker constructs a new response containing only the operator's approved GET field catalogue, for both single and batch mutations; no raw Airtable success body can echo hidden bank/margin/cost data. A malformed or uncertain response fails closed with an uncertainty code; it must not trigger automatic repeat of a potentially committed write. Non-2xx Airtable error bodies are not exposed.

## Explicit remaining limitations

1. Owner/link integrity is not yet transactional across external direct Airtable/Make writers. Only admin/finance can reassign `Vendedor` through the signed proxy; operator may link approved client/quote/order IDs to company-wide records but target existence and owner consistency still require follow-up validation. The signed `sales` role continues to verify links independently and `ACCESS_SALES_WRITES_ENABLED` remains OFF.
2. Production and machine/event tables retain their previous operator write permissions until their field/record classification is completed; add separate tests before Access rollout.
3. No signed role migration or production key rotation occurs with this code. The operator UI must adapt away from raw Airtable formulas and any deliberately forbidden fields, and real user sessions must be tested during the final DNS/Cloudflare setup. Finance/admin rights and the legacy mode remain unchanged.

Automated regression tests: `tests/access-operator-mutations.test.js` verifies forbidden deletes, schema-typed allowlists, absent/duplicate/malformed links, CRM guard validation, bounded batch updates, sensitive response redaction for all four tables, and no automatic retry of an uncertain PATCH.
