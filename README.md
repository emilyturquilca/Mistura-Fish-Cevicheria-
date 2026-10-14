# Mistura Fish · Analytics Panel

🇪🇸 [Leer en español](README.es.md)

A web dashboard that turns the sales data already recorded in **Loyverse** into clear indicators, charts and reports for the business owner. It does **not** replace the POS: it does not register sales, take payments or print receipts.

## Features
- Dashboard: sales today / this month, number of sales, average ticket, top product, top category, most used payment method.
- Charts: sales per day, sales by category, payment methods, best-selling products.
- Period selector: dated Today button, previous/next day arrows, calendar, this week, this month, previous month and custom range. Dates and daily groups use `America/Lima`.
- Sales history with search, filters, sale detail and **sum of totals** (useful for accounting).
- Products, customers and profitability (margin only when cost data exists; otherwise "Información no disponible").
- Reports with real `.xlsx` Excel export (summary, daily totals and all matching receipts), CSV and PDF (browser print). Sales exports also respect search and payment filters.
- Separate gross sales, refunds, net discounts, net sales, net collected payments and gross profit. Profit uses historical receipt costs when available.
- Sync updates existing receipts, removes cancellations and subtracts refunds without duplicates.

## How it works
```
Browser (index.html)  ──►  /api/loyverse (Vercel function)  ──►  Loyverse API
   stores data locally        adds the secret token
```
The panel is protected by a password (`APP_PASSWORD`). The password is validated before the dashboard is shown and is not stored permanently in the browser. Once inside, the owner either pastes the Loyverse token in the panel (kept only on that device and sent to your Vercel function) or uploads a CSV/Excel file exported from Loyverse. Data is stored in each device's browser (localStorage) and can be re-downloaded from Loyverse at any time.

## Project structure
| Path | Purpose |
|---|---|
| `index.html` | Whole front end (HTML, CSS, JavaScript, Chart.js from CDN) |
| `sales-core.js` | Lima business dates, receipt updates, sales amounts and export rows |
| `assets/` | SheetJS CE 0.20.3 and Apache 2.0 license; Excel import/export needs no CDN |
| `tests/sales.test.js` | Run `npm test` for date, sync, reconciliation and Excel round-trip tests |
| `api/loyverse.js` | Secure proxy to the Loyverse API (see `api/README.md`) |
| `.env.example` | Names of the required environment variables |

## Deploy (GitHub + Vercel)
1. Create a **private** GitHub repository and upload these files.
2. In Vercel: *Add New > Project*, import the repository, framework preset **Other**, then *Deploy*. If the project lives inside a subfolder, set **Root Directory** to the folder that contains `index.html`, `package.json` and `api/loyverse.js`.
3. In *Project > Settings > Environment Variables* add `APP_PASSWORD` (below), then redeploy.
4. Open the Vercel URL and sign in with the password. In **Sincronizar Loyverse**, either paste your Loyverse token (API) and press **Guardar y sincronizar**, or upload an exported CSV/Excel file.

### Environment variables
| Name | Description |
|---|---|
| `LOYVERSE_TOKEN` | Optional. Server-side token. If omitted, enter the token inside the panel instead. |
| `APP_PASSWORD` | Long password the owner types to enter the panel. |

## Notes and limitations
- Receipts are upserted by receipt number, cancelled receipts are removed and refunds use negative amounts on their own dates.
- Net sales = gross sales − refunds before discounts − net discounts. Included taxes remain in sales; added taxes, tips and surcharges belong to collected payments, not net sales.
- Gross profit = net sales − historical receipt line costs (`cost_total`). Missing costs produce "Información no disponible"; operating expenses are not included.
- The first sync after upgrading reloads from the earliest stored receipt (at least 30 days). File imports never advance the API sync cursor. Old/file receipts without a full breakdown remain provisional until reconciled with the API.
- A cost of 0 or empty is shown as "Información no disponible" (Loyverse does not distinguish "no cost" from "cost 0"). Nothing is estimated.
- Browser storage is about 5 MB: enough for several months of sales, not years. The panel warns when it is full.
- The password is kept only for the current browser session. After signing out or starting a new session, it must be entered again.
- A token entered in the panel is stored in that device's browser: use the panel only on trusted devices.
- Use one data source (API or file), not both: file and API identify products differently and could list them twice.
- One shared password; use a long one and keep the repository private.
- Vercel's free Hobby plan is for non-commercial use only; a business using this needs a paid plan or another host.
- Amount definitions follow the [Loyverse API](https://developer.loyverse.com/docs/) and [Back Office sales definitions](https://help.loyverse.com/help/sales-summary-report-back-office). Compare the same dates and store/employee filters; this panel currently includes all stores and employees.

Regression tests contain synthetic receipts. They demonstrate the UTC date bug without claiming to reconcile the business's actual receipts. Verify real discrepancies after syncing real data and comparing the exported receipt list.

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| "Contraseña incorrecta" | `APP_PASSWORD` not set, or Vercel was not redeployed after adding it |
| "No se pudo conectar: Error 404" | Vercel did not publish `/api/loyverse`; check the **Root Directory**, confirm `api/loyverse.js` is in the deployed root, then redeploy |
| "Falta el token de Loyverse" | No token saved in the panel and no `LOYVERSE_TOKEN` variable set |
| "Loyverse rechazó el token" | Token invalid or expired, or the plan does not allow API access |
| "No reconocí las columnas" | The file needs receipt number, date and total columns; send the real headers to adjust |
| No sales appear | Wrong period selected, or history not loaded yet (use *Cargar historial*) |
| Storage warning | Load a shorter history or clear this device's data |
