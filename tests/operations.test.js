import test from 'node:test';
import assert from 'node:assert/strict';
import '../sales-core.js';
import '../operations-core.js';
import '../operations-edit-core.js';
import '../restaurant-core.js';
import '../payables-core.js';
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
test('Editing a reception recalculates subsequent waste costs and recipe profitability', () => {
  const s=received(10,20);s.state.sales.prods.test={n:'Prueba',p:40};
  s.apply('recipe','recipe',{productKey:'test',portions:1,lines:[{ingredientId:'fish',quantity:200,unit:'g',yield:100}]});
  s.apply('waste','waste',{ingredientId:'fish',quantity:2,unit:'kg',date:'2026-10-14',note:'Prueba'});
  s.apply('edit','editReception',{id:'receive-1',orderId:'order-1',date:'2026-10-14',reference:'Corregido',lines:[{lineId:'order-1/0',quantity:10,unitCost:30,lot:'Lote nuevo',expiry:'2026-10-15'}]});
  assert.equal(O.stock(s.state,'fish'),8);assert.equal(s.state.ingredients[0].cost,30);
  assert.equal(s.state.movements.find(m=>m.kind==='Merma').unitCost,30);
  assert.equal(s.state.movements[0].note,'Corregido');assert.equal(s.state.movements[0].lot,'Lote nuevo');
  assert.equal(O.recipeCost(s.state,s.state.recipes[0]),6);
});
test('Editing a receipt cannot make a later movement negative; every record stays unchanged', () => {
  const s=received();s.apply('usage','usage',{ingredientId:'fish',quantity:8,unit:'kg',date:'2026-10-14',note:'Prueba'});
  const before=structuredClone(s.state);
  assert.throws(()=>s.apply('edit','editReception',{id:'receive-1',date:'2026-10-14',lines:[{lineId:'order-1/0',quantity:5,unitCost:20}]}),/stock negativo/);
  assert.deepEqual(s.state,before);
});
test('Editing and deleting a waste movement update stock; restoring reverses the deletion once', () => {
  const s=received();s.apply('waste','waste',{ingredientId:'fish',quantity:2,unit:'kg',date:'2026-10-14',note:'Prueba'});
  const waste=s.state.movements.at(-1).id;
  s.apply('edit','editMovement',{id:waste,ingredientId:'fish',kind:'Consumo',quantity:500,unit:'g',date:'2026-10-14',note:'Tipo corregido'});
  assert.equal(O.stock(s.state,'fish'),9.5);assert.equal(s.state.movements.at(-1).kind,'Consumo');
  s.apply('delete','delete',{entity:'movements',targetId:waste});assert.equal(O.stock(s.state,'fish'),10);
  s.apply('restore','restore',{trashId:'delete'});assert.equal(O.stock(s.state,'fish'),9.5);assert.equal(s.state.trash.length,0);
  assert.equal(O.apply(s.state,command('restore','restore',{trashId:'delete'}),now).duplicate,true);
});
test('Deleting a purchase includes its receipts and ledger entries; restoring returns their original IDs', () => {
  const s=received();const previous=structuredClone(s.state);
  s.apply('delete','delete',{entity:'orders',targetId:'order-1'});
  assert.equal(s.state.orders.length,0);assert.equal(s.state.receptions.length,0);assert.equal(O.stock(s.state,'fish'),0);
  assert.equal(s.state.trash[0].bundle.receptions.length,1);assert.equal(s.state.trash[0].bundle.movements.length,1);
  s.apply('new-order','order',{supplierId:'supplier-1',date:'2026-10-14',lines:[{ingredientId:'fish',quantity:1,unit:'kg',unitCost:1}]});
  assert.equal(s.state.orders[0].number,2);
  s.apply('restore','restore',{trashId:'delete'});
  assert.equal(s.state.orders.find(o=>o.id==='order-1').number,1);assert.equal(O.stock(s.state,'fish'),10);
  assert.equal(s.state.movements[0].id,previous.movements[0].id);assert.equal(s.state.receptions[0].id,'receive-1');
});
test('Deleting an input that would invalidate stock is blocked, not cascaded silently', () => {
  const s=received();s.apply('usage','usage',{ingredientId:'fish',quantity:1,unit:'kg',date:'2026-10-14',note:'Prueba'});
  const before=structuredClone(s.state);
  assert.throws(()=>s.apply('delete','delete',{entity:'receptions',targetId:'receive-1'}),/stock negativo/);
  assert.throws(()=>s.apply('delete','delete',{entity:'orders',targetId:'order-1'}),/stock negativo/);
  assert.deepEqual(s.state,before);
});
test('Counts remain absolute physical totals after changing an earlier input, including legacy counts', () => {
  const s=received();s.apply('count','count',{ingredientId:'fish',quantity:8,unitCost:20,date:'2026-10-14',note:'Conteo'});
  const count=s.state.movements.at(-1);delete count.countedQuantity;delete count.inputCost;
  s.apply('edit','editReception',{id:'receive-1',date:'2026-10-14',lines:[{lineId:'order-1/0',quantity:9,unitCost:30}]});
  assert.equal(O.stock(s.state,'fish'),8);assert.equal(s.state.movements.at(-1).quantity,-1);assert.equal(s.state.movements.at(-1).unitCost,30);
  s.apply('edit-count','editMovement',{id:count.id,ingredientId:'fish',quantity:7,unitCost:30,date:'2026-10-14',note:'Conteo corregido'});
  assert.equal(O.stock(s.state,'fish'),7);
});
test('Editing purchases retains received line identities and rejects an understated order', () => {
  const s=received();
  s.apply('edit','editOrder',{id:'order-1',supplierId:'supplier-1',date:'2026-10-14',reference:'Referencia corregida',lines:[{ingredientId:'fish',quantity:12,unit:'kg',unitCost:25}]});
  assert.equal(s.state.orders[0].lines[0].id,'order-1/0');assert.equal(s.state.orders[0].status,'Parcial');assert.equal(O.stock(s.state,'fish'),10);
  assert.throws(()=>s.apply('bad-edit','editOrder',{id:'order-1',supplierId:'supplier-1',date:'2026-10-14',lines:[{ingredientId:'fish',quantity:9,unit:'kg',unitCost:25}]}),/menos cantidad/);
});
test('Suppliers and ingredients can be edited; deleting referenced records explains the dependency', () => {
  const s=received();
  s.apply('edit-supplier','supplier',{id:'supplier-1',name:'Nombre corregido',taxId:'',phone:'123',contact:''});
  s.apply('edit-ingredient','ingredient',{id:'fish',name:'Pescado corregido',unit:'kg',minimum:4});
  assert.equal(s.state.suppliers[0].name,'Nombre corregido');assert.equal(s.state.ingredients[0].minimum,4);assert.equal(s.state.ingredients[0].cost,20);
  assert.throws(()=>s.apply('delete-supplier','delete',{entity:'suppliers',targetId:'supplier-1'}),/tiene compras/);
  assert.throws(()=>s.apply('delete-ingredient','delete',{entity:'ingredients',targetId:'fish'}),/registros relacionados/);
  assert.throws(()=>s.apply('unit-edit','ingredient',{id:'fish',name:'Pescado corregido',unit:'l',minimum:4}),/unidad base/);
});
test('Deleting and restoring unused suppliers and ingredients preserves their records', () => {
  const s=setup();s.apply('delete-ingredient','delete',{entity:'ingredients',targetId:'fish'});s.apply('delete-supplier','delete',{entity:'suppliers',targetId:'supplier-1'});
  assert.equal(s.state.ingredients.length,0);assert.equal(s.state.suppliers.length,0);
  s.apply('restore-ingredient','restore',{trashId:'delete-ingredient'});s.apply('restore-supplier','restore',{trashId:'delete-supplier'});
  assert.equal(s.state.ingredients[0].id,'fish');assert.equal(s.state.suppliers[0].id,'supplier-1');
});
test('Recipes can change their product, portions and ingredients, and can be deleted and restored', () => {
  const s=received();s.state.sales.prods={one:{n:'Plato 1'},two:{n:'Plato 2'}};
  s.apply('recipe','recipe',{productKey:'one',portions:1,lines:[{ingredientId:'fish',quantity:200,unit:'g',yield:100}]});
  s.apply('edit','recipe',{id:'recipe',productKey:'two',portions:2,lines:[{ingredientId:'fish',quantity:300,unit:'g',yield:100}]});
  assert.equal(s.state.recipes[0].productKey,'two');assert.equal(O.recipeCost(s.state,s.state.recipes[0]),3);
  s.apply('delete','delete',{entity:'recipes',targetId:'recipe'});assert.equal(s.state.recipes.length,0);
  s.apply('restore','restore',{trashId:'delete'});assert.equal(s.state.recipes[0].productKey,'two');
});
test('Restoring a deleted input preserves its position before later consumption and receipt costs', () => {
  const s=setup();s.apply('opening','count',{ingredientId:'fish',quantity:10,unitCost:10,date:'2026-10-14',note:'Inicial'});
  s.apply('order','order',{supplierId:'supplier-1',date:'2026-10-14',lines:[{ingredientId:'fish',quantity:20,unit:'kg',unitCost:20}]});
  s.apply('a','receive',{orderId:'order',date:'2026-10-14',lines:[{lineId:'order/0',quantity:10,unitCost:20}]});
  s.apply('usage','usage',{ingredientId:'fish',quantity:5,unit:'kg',date:'2026-10-14',note:'Consumo'});
  s.apply('b','receive',{orderId:'order',date:'2026-10-14',lines:[{lineId:'order/0',quantity:10,unitCost:30}]});
  s.apply('delete','delete',{entity:'receptions',targetId:'a'});
  assert.equal(s.state.ingredients[0].cost,23.333333);
  s.apply('restore','restore',{trashId:'delete'});
  assert.equal(s.state.ingredients[0].cost,21);assert.equal(s.state.movements.find(m=>m.kind==='Consumo').unitCost,15);
});
test('Restoring parents or duplicate names is validated without losing the trash entry', () => {
  const s=received();s.apply('delete-order','delete',{entity:'orders',targetId:'order-1'});s.apply('delete-supplier','delete',{entity:'suppliers',targetId:'supplier-1'});
  const previous=structuredClone(s.state);
  assert.throws(()=>s.apply('restore-order','restore',{trashId:'delete-order'}),/Proveedor de la compra/);assert.deepEqual(s.state,previous);
  s.apply('new-supplier','supplier',{name:'Proveedor de prueba',taxId:'',contact:'',phone:''});
  assert.throws(()=>s.apply('restore-supplier','restore',{trashId:'delete-supplier'}),/mismo|ese nombre/);
});
test('Adding lines to an old reception leaves room for restoring a later deleted consumption', () => {
  const s=setup();s.apply('lemon','ingredient',{name:'Limón de prueba',unit:'kg',minimum:0});
  s.apply('opening','count',{ingredientId:'lemon',quantity:10,unitCost:10,date:'2026-10-14',note:'Inicial'});
  s.apply('order','order',{supplierId:'supplier-1',date:'2026-10-14',lines:[{ingredientId:'fish',quantity:10,unit:'kg',unitCost:20},{ingredientId:'lemon',quantity:20,unit:'kg',unitCost:20}]});
  s.apply('a','receive',{orderId:'order',date:'2026-10-14',lines:[{lineId:'order/0',quantity:5,unitCost:20}]});
  s.apply('usage','usage',{ingredientId:'lemon',quantity:5,unit:'kg',date:'2026-10-14',note:'Consumo'});
  const movementId=s.state.movements.at(-1).id;
  s.apply('c','receive',{orderId:'order',date:'2026-10-14',lines:[{lineId:'order/1',quantity:5,unitCost:30}]});
  s.apply('delete','delete',{entity:'movements',targetId:movementId});
  s.apply('edit-a','editReception',{id:'a',date:'2026-10-14',lines:[{lineId:'order/0',quantity:5,unitCost:20},{lineId:'order/1',quantity:5,unitCost:20}]});
  s.apply('restore','restore',{trashId:'delete'});
  assert.equal(s.state.movements.find(m=>m.id===movementId).unitCost,13.333333);
  assert.equal(s.state.ingredients.find(i=>i.id==='lemon').cost,18.888889);
  assert.equal(O.stock(s.state,'lemon'),15);
});
