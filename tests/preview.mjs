// Local UI fixture. No production credentials or real business data are used.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import '../sales-core.js';
import '../operations-core.js';

const root = new URL('../', import.meta.url);
const today = globalThis.MisturaCore.dateKey();
const sale = (id, date, total, cost) => ({
  receipt_number: id, receipt_type: 'SALE', receipt_date: date, total_money: total,
  total_discount: 0, payments: [{ name: 'Efectivo' }],
  line_items: [{ item_id: 'ceviche', item_name: 'Ceviche', quantity: 1, total_money: total, cost_total: cost }]
});
const receipts = [sale('DEMO-1', '2026-10-12T01:00:00Z', 70, 30), sale('DEMO-2', '2026-10-12T17:00:00Z', 600, 200), sale('DEMO-HOY', today + 'T12:00:00-05:00', 40, 15)];
let operationState = globalThis.MisturaOperations.initial(), operationVersion = 0;
operationState.sales.prods.ceviche = { n: 'Ceviche de prueba', c: 'Prueba', p: 40, k: 15 };
globalThis.MisturaCore.mergeReceipts(operationState.sales, receipts);
operationState.sales.sync = new Date().toISOString();
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/operations' || url.pathname === '/api/sync-sales') {
    let status = 200, data;
    try {
      if (request.method === 'POST' && url.pathname === '/api/operations') {
        let body = ''; for await (const chunk of request) body += chunk;
        const command = JSON.parse(body);
        if (command.version !== operationVersion) { status = 409; throw new Error('Otro dispositivo actualizó los datos. Actualiza y revisa el formulario.'); }
        operationState = globalThis.MisturaOperations.apply(operationState, command).state; operationVersion++;
      }
      data = { configured: true, state: operationState, version: operationVersion, counts: { added: 0, updated: 0, cancelled: 0 } };
    } catch (e) { if (status === 200) status = 400; data = { error: e.message, state: operationState, version: operationVersion }; }
    response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); return;
  }
  if (url.pathname === '/api/loyverse') {
    const path = url.searchParams.get('path');
    const data = { '/ping': { ok: true, loyverseConfigured: true }, '/categories': { categories: [] }, '/customers': { customers: [] }, '/items': { items: [{ id: 'ceviche', item_name: 'Ceviche', variants: [{ default_price: 40, cost: 15 }] }] }, '/receipts': { receipts } }[path];
    response.writeHead(data ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(data || { error: 'Not found' }));
    return;
  }
  const files = { '/': 'index.html', '/dark': 'index.html', '/index.html': 'index.html', '/sales-core.js': 'sales-core.js', '/operations-core.js': 'operations-core.js', '/operations-ui.js': 'operations-ui.js', '/assets/xlsx.full.min.js': 'assets/xlsx.full.min.js' };
  const file = files[url.pathname];
  if (!file) { response.writeHead(404); response.end(); return; }
  try {
    let content = await readFile(new URL(file, root));
    if (file === 'index.html') content = content.toString().replace('<title>', '<title>PRUEBA CON DATOS FICTICIOS · ').replace('iniciar();', "sessionStorage.setItem('mf_clave','local-preview-only');iniciar();").replace('<body>', '<body style="padding-top:28px"><div style="position:fixed;top:0;left:0;right:0;height:28px;z-index:100;background:#ffe1a8;color:#352300;text-align:center;padding:4px">PRUEBA LOCAL · Datos ficticios</div>');
    if (url.pathname === '/dark') content = content.replace('<html lang="es">', '<html lang="es" data-theme="dark">');
    response.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
    response.end(content);
  } catch { response.writeHead(500); response.end('Preview unavailable'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Local preview: http://127.0.0.1:4173'));
