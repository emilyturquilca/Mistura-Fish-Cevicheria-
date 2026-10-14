import { authorized, load, save, error } from './operations.js';
import '../sales-core.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function pages(path, key, params = {}) {
  const all = []; let cursor;
  for (let page = 0; page < 80; page++) {
    const url = new URL('https://api.loyverse.com/v1.0' + path);
    Object.entries({ ...params, limit: 250, cursor }).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.LOYVERSE_TOKEN }, signal: AbortSignal.timeout(25000) });
    if (r.status === 402) throw new Error('Loyverse limita el historial disponible a los últimos 31 días. Elige una fecha más reciente.');
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Loyverse rechazó el token.' : 'Loyverse no respondió correctamente (' + r.status + ').');
    const data = await r.json();
    if (!Array.isArray(data[key])) throw new Error('Respuesta inesperada de Loyverse.');
    all.push(...data[key]); cursor = data.cursor;
    if (!cursor) return all;
  }
  throw new Error('Demasiados recibos para una sola sincronización. Elige una fecha más reciente.');
}
export async function POST(request) {
  if (!authorized(request)) return json({ error: 'No autorizado' }, 401);
  if (!process.env.LOYVERSE_TOKEN) return json({ error: 'Falta LOYVERSE_TOKEN en el servidor.' }, 400);
  let from;
  try {
    const body = await request.json();
    from = body.from;
    if (from && (!globalThis.MisturaCore.parseDate(from) || new Date(from) > new Date())) throw new Error();
  } catch { return json({ error: 'Fecha inválida.' }, 400); }
  // Check storage first so a missing database cannot masquerade as a successful sync.
  let current; try { current = await load(); } catch (e) { return error(e); }
  const started = new Date().toISOString();
  let cats, items, customers, receipts;
  try {
    [cats, items, customers, receipts] = await Promise.all([
      pages('/categories', 'categories'), pages('/items', 'items'), pages('/customers', 'customers'),
      pages('/receipts', 'receipts', { created_at_min: from || new Date(Date.now() - 30 * 864e5).toISOString() })
    ]);
  } catch (e) { return json({ error: e.name === 'TimeoutError' ? 'Loyverse tardó demasiado. Intenta nuevamente.' : e.message }, 502); }
  const cn = Object.fromEntries(cats.map(c => [c.id, c.name])), cm = Object.fromEntries(customers.map(c => [c.id, c.name]));
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (attempt) current = await load();
      const state = structuredClone(current.state), sales = state.sales;
      for (const item of items) {
        const variant = (item.variants || [])[0] || {};
        sales.prods[item.id] = { n: item.item_name, c: cn[item.category_id] || 'Sin categoría', p: variant.default_price ?? 0, k: variant.cost > 0 ? variant.cost : null };
      }
      const counts = globalThis.MisturaCore.mergeReceipts(sales, receipts, cm);
      sales.sync = started; sales.apiSync = started; sales.apiVersion = 3;
      const version = await save(state, current.version);
      if (version != null) return json({ configured: true, state, version, counts });
    } catch (e) { return error(e); }
  }
  return json({ error: 'Hay cambios simultáneos. Actualiza y vuelve a sincronizar.' }, 409);
}
