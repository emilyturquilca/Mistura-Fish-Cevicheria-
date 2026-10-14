import test from 'node:test';
import assert from 'node:assert/strict';
import '../sales-core.js';
import '../operations-core.js';
import { GET, POST } from '../api/operations.js';

const O = globalThis.MisturaOperations;
const now = '2026-10-14T18:00:00Z';
const command = (id, type, payload) => ({ id, type, payload });
function setup() {
  let state = O.initial();
  const apply = (id, type, payload) => { state = O.apply(state, command(id, type, payload), now).state; return state; };
  apply('supplier-1', 'supplier', { name: 'Proveedor de prueba', taxId: '', phone: '', contact: '' });
  apply('fish', 'ingredient', { name: 'Pescado de prueba', unit: 'kg', minimum: 2 });
  return { apply, get state() { return state; } };
}
function received(qty = 10, cost = 20) {
  const s = setup();
  s.apply('order-1', 'order', { supplierId: 'supplier-1', date: '2026-10-14', reference: '', lines: [{ ingredientId: 'fish', quantity: qty, unit: 'kg', unitCost: cost }] });
  s.apply('receive-1', 'receive', { orderId: 'order-1', date: '2026-10-14', reference: '', lines: [{ lineId: 'order-1/0', quantity: qty, unitCost: cost }] });
  return s;
}
test('A purchase does not change stock; partial receipt only adds what arrived', () => {
  const s = setup();
  s.apply('order', 'order', { supplierId: 'supplier-1', date: '2026-10-14', lines: [{ ingredientId: 'fish', quantity: 10000, unit: 'g', unitCost: 20 }] });
  assert.equal(O.stock(s.state, 'fish'), 0);
  s.apply('delivery', 'receive', { orderId: 'order', date: '2026-10-14', lines: [{ lineId: 'order/0', quantity: 4, unitCost: 21 }] });
  assert.equal(O.stock(s.state, 'fish'), 4);
  assert.equal(s.state.orders[0].status, 'Parcial');
  assert.equal(s.state.ingredients[0].cost, 21);
});
test('A retried receipt ID cannot double stock, even after its purchase closes', () => {
  const s = received();
  const result = O.apply(s.state, command('receive-1', 'receive', { orderId: 'order-1' }), now);
  assert.equal(result.duplicate, true);
  assert.equal(O.stock(result.state, 'fish'), 10);
  assert.equal(result.state.receptions.length, 1);
});
test('Weighted cost uses stock remaining after waste, not lifetime purchases', () => {
  const s = received(10, 20);
  s.apply('waste', 'waste', { ingredientId: 'fish', quantity: 2000, unit: 'g', date: '2026-10-14', note: 'Deterioro de prueba' });
  s.apply('order-2', 'order', { supplierId: 'supplier-1', date: '2026-10-14', lines: [{ ingredientId: 'fish', quantity: 2, unit: 'kg', unitCost: 30 }] });
  s.apply('receive-2', 'receive', { orderId: 'order-2', date: '2026-10-14', lines: [{ lineId: 'order-2/0', quantity: 2, unitCost: 30 }] });
  assert.equal(O.stock(s.state, 'fish'), 10);
  assert.equal(s.state.ingredients[0].cost, 22);
  assert.equal(s.state.movements.find(m => m.kind === 'Merma').unitCost, 20);
});
test('Excess receipt is rejected atomically without changing the old state', () => {
  const s = setup();
  s.apply('order', 'order', { supplierId: 'supplier-1', date: '2026-10-14', lines: [{ ingredientId: 'fish', quantity: 4, unit: 'kg', unitCost: 20 }] });
  const snapshot = structuredClone(s.state);
  assert.throws(() => s.apply('receive', 'receive', { orderId: 'order', date: '2026-10-14', lines: [{ lineId: 'order/0', quantity: 5, unitCost: 20 }] }), /supera/);
  assert.deepEqual(s.state, snapshot);
});
test('A multi-line reception rejects duplicate lines and rolls back every line', () => {
  const s = setup();
  s.apply('order', 'order', { supplierId: 'supplier-1', date: '2026-10-14', lines: [{ ingredientId: 'fish', quantity: 4, unit: 'kg', unitCost: 20 }] });
  assert.throws(() => s.apply('receive', 'receive', { orderId: 'order', date: '2026-10-14', lines: Array(2).fill({ lineId: 'order/0', quantity: 1, unitCost: 20 }) }), /duplicada/);
  assert.equal(O.stock(s.state, 'fish'), 0);
});
test('Waste and consumption cannot make stock negative or omit the reason', () => {
  const s = received();
  assert.throws(() => s.apply('waste', 'waste', { ingredientId: 'fish', quantity: 11, unit: 'kg', date: '2026-10-14', note: 'Prueba' }), /stock suficiente/);
  assert.throws(() => s.apply('usage', 'usage', { ingredientId: 'fish', quantity: 1, unit: 'kg', date: '2026-10-14', note: '' }), /Motivo/);
  assert.equal(O.stock(s.state, 'fish'), 10);
});
test('Physical count sets the total and values only the added difference', () => {
  const s = received(10, 20);
  s.apply('count', 'count', { ingredientId: 'fish', quantity: 12, unitCost: 32, date: '2026-10-14', note: 'Conteo de prueba' });
  assert.equal(O.stock(s.state, 'fish'), 12);
  assert.equal(s.state.ingredients[0].cost, 22);
  assert.equal(s.state.movements.at(-1).quantity, 2);
});
test('Recipe costs convert grams, account for yield and divide by portions', () => {
  const s = received(10, 20);
  s.state.sales.prods.test = { n: 'Plato de prueba', p: 40 };
  s.apply('recipe', 'recipe', { productKey: 'test', portions: 2, lines: [{ ingredientId: 'fish', quantity: 400, unit: 'g', yield: 80 }] });
  assert.equal(O.recipeCost(s.state, s.state.recipes[0]), 5);
  s.apply('revision', 'recipe', { productKey: 'test', portions: 1, lines: [{ ingredientId: 'fish', quantity: 200, unit: 'g', yield: 100 }] });
  assert.equal(s.state.recipes.length, 1);
  assert.equal(s.state.recipes[0].revision, 2);
  assert.equal(O.recipeCost(s.state, s.state.recipes[0]), 4);
});
test('Unknown recipe cost stays unknown; explicit zero cost stays zero', () => {
  const s = setup(); s.state.sales.prods.test = { n: 'Prueba' };
  s.apply('recipe', 'recipe', { productKey: 'test', portions: 1, lines: [{ ingredientId: 'fish', quantity: 200, unit: 'g', yield: 100 }] });
  assert.equal(O.recipeCost(s.state, s.state.recipes[0]), null);
  s.apply('opening', 'count', { ingredientId: 'fish', quantity: 1, unitCost: 0, date: '2026-10-14', note: 'Ingreso gratuito de prueba' });
  assert.equal(O.recipeCost(s.state, s.state.recipes[0]), 0);
});
test('Unit dimensions, invalid numbers and invalid yields are rejected', () => {
  const s = received(); s.state.sales.prods.test = { n: 'Prueba' };
  assert.throws(() => O.unitQuantity(s.state.ingredients[0], 200, 'ml'), /unidad/);
  assert.throws(() => s.apply('waste', 'waste', { ingredientId: 'fish', quantity: 'abc', unit: 'kg', date: '2026-10-14', note: 'Prueba' }), /número/);
  assert.throws(() => s.apply('recipe', 'recipe', { productKey: 'test', portions: 1, lines: [{ ingredientId: 'fish', quantity: 200, unit: 'g', yield: 101 }] }), /100%/);
});
test('Received orders cannot be cancelled and past expiry is rejected', () => {
  const s = received();
  assert.throws(() => s.apply('cancel', 'cancelOrder', { orderId: 'order-1' }), /sin recepciones/);
  const t = setup(); t.apply('order', 'order', { supplierId: 'supplier-1', date: '2026-10-14', lines: [{ ingredientId: 'fish', quantity: 1, unit: 'kg', unitCost: 1 }] });
  assert.throws(() => t.apply('r', 'receive', { orderId: 'order', date: '2026-10-14', lines: [{ lineId: 'order/0', quantity: 1, unitCost: 1, expiry: '2026-10-13' }] }), /Vencimiento/);
});
test('Shared API checks authentication before touching the database and reports missing configuration', async () => {
  const originalPassword = process.env.APP_PASSWORD, originalURL = process.env.DATABASE_URL;
  process.env.APP_PASSWORD = 'test-password'; delete process.env.DATABASE_URL;
  try {
    assert.equal((await GET(new Request('https://example.test/api/operations'))).status, 401);
    assert.equal((await POST(new Request('https://example.test/api/operations', { method: 'POST' }))).status, 401);
    const r = await GET(new Request('https://example.test/api/operations', { headers: { 'x-clave': 'test-password' } }));
    assert.equal(r.status, 503); assert.equal((await r.json()).configured, false);
  } finally {
    if (originalPassword == null) delete process.env.APP_PASSWORD; else process.env.APP_PASSWORD = originalPassword;
    if (originalURL == null) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalURL;
  }
});
test('Shared refresh preserves manual imports and old local archives, but never resurrects cancelled receipts', () => {
  const local = { prods: { old: { n: 'Producto anterior' } }, v: {
    file: { source: 'file', f: now, total: 20 }, archive: { source: 'api', f: '2025-01-01T12:00:00Z', total: 30 },
    staleRecent: { source: 'api', f: now, total: 40 }, cancelled: { source: 'api', f: '2025-01-01T12:00:00Z', total: 50 },
    updated: { source: 'api', f: now, total: 60 }
  } };
  const shared = { prods: { fresh: { n: 'Producto nuevo' } }, v: { updated: { source: 'api', f: now, total: 70 } }, cancelledIds: { cancelled: now }, sync: now };
  const combined = O.combineSales(shared, local, now);
  assert.equal(combined.v.file.total, 20); assert.equal(combined.v.archive.total, 30); assert.equal(combined.v.updated.total, 70);
  assert.equal(combined.v.cancelled, undefined); assert.equal(combined.v.staleRecent, undefined);
  assert.equal(combined.prods.old.n, 'Producto anterior'); assert.equal(combined.prods.fresh.n, 'Producto nuevo');
  assert.equal(local.v.updated.total, 60);
});
