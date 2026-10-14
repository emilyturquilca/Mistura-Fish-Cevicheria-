# Mistura Fish · Operations and reports

The first release covers purchasing, suppliers, receiving, inventory, waste, recipe costing, profitability and Loyverse synchronization. Production, kitchen orders, staff, customer loyalty and forecasting are reserved for the second phase.

See [the Spanish user guide and setup instructions](README.es.md).

The buildless frontend calls authenticated Vercel Functions. PostgreSQL (Neon) stores a versioned JSONB operations document. Server validation and an atomic version comparison prevent lost updates; command IDs prevent duplicate writes on retries. Receipts and catalog data synchronized through the server are shared across devices. APP_PASSWORD, LOYVERSE_TOKEN and DATABASE_URL must be configured server-side. No secrets are committed.

Receive purchases to add inventory, record waste and consumption to reduce it, and use physical counts to correct differences. Recipe costs convert compatible units, apply technical yield and divide by portions. Stock consumption is currently manual: importing sales does not automatically deduct ingredients. Historical Loyverse profit and theoretical recipe margins are presented separately. Manual spreadsheet imports remain device-local.

Use Node.js 22+, npm ci, and npm test. node tests/preview.mjs runs an explicitly marked local fixture with synthetic data and in-memory storage; it does not test the live database. Connect a separate database/branch for preview testing. The API creates its initial table on authorized access without inserting business fixtures. See the Spanish guide for first-release storage design and limitations.
