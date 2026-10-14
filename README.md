# Mistura Fish · Analytics Panel

🇪🇸 [Leer en español](README.es.md)

A web dashboard that turns the sales data already recorded in **Loyverse** into clear indicators, charts and reports for the business owner. It does **not** replace the POS: it does not register sales, take payments or print receipts.

## Features
- Dashboard: sales today / this month, number of sales, average ticket, top product, top category, most used payment method.
- Charts: sales per day, sales by category, payment methods, best-selling products.
- Period selector: today, this week, this month, previous month, custom range.
- Sales history with search, filters, sale detail and **sum of totals** (useful for accounting).
- Products, customers and profitability (margin only when cost data exists; otherwise "Información no disponible").
- Reports with CSV export and PDF (browser print).
- Sync with Loyverse on open and with a button. No duplicated sales.

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
- Cancelled receipts and refunds are ignored. Sales are identified by receipt number, so re-syncing never duplicates them.
- A cost of 0 or empty is shown as "Información no disponible" (Loyverse does not distinguish "no cost" from "cost 0"). Nothing is estimated.
- Browser storage is about 5 MB: enough for several months of sales, not years. The panel warns when it is full.
- The password is kept only for the current browser session. After signing out or starting a new session, it must be entered again.
- A token entered in the panel is stored in that device's browser: use the panel only on trusted devices.
- Use one data source (API or file), not both: file and API identify products differently and could list them twice.
- One shared password; use a long one and keep the repository private.
- Vercel's free Hobby plan is for non-commercial use only; a business using this needs a paid plan or another host.
- The Loyverse field names used in `index.html` were written from memory: verify them against a real receipt and the official API docs.

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
