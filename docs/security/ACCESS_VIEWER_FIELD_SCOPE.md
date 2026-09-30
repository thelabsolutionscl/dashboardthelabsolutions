# Signed viewer: reviewed, non-financial Airtable field scope

The current Cloudflare Access RBAC implementation permits the signed `viewer` role to read CRM tables. Before this patch, those reads went through the general Airtable proxy and exposed entire records, including bank/payment data in Clientes, margins in Cotizaciones and real material/labor/production costs in Pedidos. A read-only HTTP method does not imply non-financial data access.

## Staged correction

This change adds an **independent signed-viewer read route** with a schema-verified allowlist of tables and visible fields. It requests only approved `fields[]` in Airtable list queries, then builds a fresh safe response for **both lists and direct record-ID GETs**. Unknown or newly added columns, private upstream metadata, financial details, private notes and machine IP/camera fields cannot pass through merely because Airtable returned them. The supported viewer tables are `Clientes`, `Cotizaciones`, `Pedidos`, `Proveedores`, `Maquinas`, `Maquinas_Eventos` and `Maquinas_Mant`. These were checked against the live Airtable schema without changing records.

The viewer cannot request arbitrary `filterByFormula`, `view`, `sort`, metadata, field-ID formatting or unknown column names. Such controls would disclose protected values indirectly through result counts and ordering, even when response field projection is correct. Only bounded `pageSize`, `maxRecords`, `offset` and whitelisted `fields[]` are accepted. Responses use private, no-store cache headers; malformed Airtable responses fail closed. Unlike `sales`, `viewer` is company-wide within these approved fields, with no vendor ownership restriction; it may receive canonical CRM relationship IDs where both related tables are within the approved catalog.

Until schemas and data classification are reviewed, `viewer` is denied `Inventario`, `Monitor Sistema`, `Equipo_Eventos` and all other non-whitelisted tables. Machine inventory IP/camera columns, supplier payment terms, personal event details, CRM financial columns and unrestricted free-text notes are **not** part of the viewer response. `operator`, `finance`, `admin` and the owner-scoped `sales` route are not changed by this patch.

## Security boundaries and remaining work

These protections operate **only when signed Cloudflare Access is enforced**, not in the existing legacy public-`APP_KEY` fallback. Access activation and DNS repair must be completed together during the final manual rollout. Do not present this code deployment as evidence that the publicly accessible legacy dashboard has become private.

An additional review is needed for `operator`: this role can currently read and edit broad CRM fields and may be able to access private financial data despite being outside the `finance` role. Treat operator field-scoping as the next security stage; no untested field mutation restriction was included here. Also verify actual viewer screens with a signed session before mapping anyone to this role, because existing UI features may expect columns deliberately withheld by this policy.

Regression tests: `tests/access-viewer-field-scope.test.js` covers each approved table, forbidden columns, lists and direct records, paging, malicious filters, unknown future columns, malformed upstream, redirects and unreviewed tables.
