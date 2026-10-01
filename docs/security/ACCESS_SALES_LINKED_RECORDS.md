# Verified commercial links and sales PATCH projection

## Read-only baseline, 2026-09-29

The actual `The Lab Solutions - Operaciones` Airtable base was queried without modifying any record: 314 Clientes, 70 Cotizaciones and 32 Pedidos. Across 254 **directional** links among these tables (including reciprocal references), 60 joined two records assigned to the same seller, 194 had at least one end without a seller, 0 joined two records assigned to different sellers, and 0 pointed to missing records in the inspected snapshot. The largest number of links in one source record was 14. **These are not 254 distinct business relationships**. No automatic assignment or historical backfill was performed.

The Airtable account returned 0 visible Airtable automations for this base. This observation **does not audit** Make scenarios, direct Airtable editors, other API tokens, historic actions or external integrations. Keep `ACCESS_SALES_WRITES_ENABLED` disabled until those owner-changing paths are independently inventoried and coordinated.

## Signed `sales` access

Normal signed sales GET responses still omit unverified relationships. An **explicit single-record** query `GET /v0/app1YtD74AqiPWQhy/{Clientes|Cotizaciones|Pedidos}/rec...?...includeVerifiedLinks=1` returns the ordinary approved field projection and adds only verified same-owner CRM link IDs: Clientes → Pedidos/Cotizaciones, Cotizaciones → Cliente/Pedido, Pedidos → Cliente/Cotizaciones. The Worker first verifies that the requested source row belongs to the seller determined by their signed Cloudflare email mapping. The server derives target tables/IDs exclusively from that Airtable row, not from query parameters.

The Worker uses at most two bounded target-table list requests, one per referenced table. Each applies a server-generated filter requiring the same verified `Vendedor` AND the exact canonical Airtable record IDs found in the owned source row. Returned target IDs are checked against the requested set; an unexpected row, wrong owner, duplicate, unexpected pagination, malformed structure, oversized relation set or upstream failure aborts the **entire** joined response with 502. Foreign/unassigned/nonexistent related records are **omitted** from verified link arrays. Maximum 25 source links per single-record request; list-wide joins and arbitrary filters/targets remain forbidden. No lookup of hidden financial fields, attachments or unrestricted JSON is provided.

The optional relationship query is deliberately not the default because it adds upstream requests and the existing legacy dashboard cannot yet be treated as a signed-sales client. The frontend must explicitly adopt and test these verified links during the eventual Cloudflare Access UI cutover. As with any multi-request Airtable read, verification proves the owner **at lookup time**, not an atomic historical snapshot if external writers can reassign owners between requests.

A signed sales PATCH, if independently activated after the external writer review, now applies the **same approved field projection** to its successful postflight record as a signed sales GET. The full Airtable response is never returned to that seller: bank/financial fields, costs, future columns and unverified relationship IDs stay hidden. PATCH requests cannot edit links or owner fields, and this optional GET join does not relax those restrictions.

## Source freshness check

For explicit verified-link reads, the proxy rereads the source after verifying linked rows. If its assigned seller or link IDs change, the whole response fails closed. Regression tests cover the second read. Changes made by independent Airtable clients after this final read remain an outstanding rollout limitation.
