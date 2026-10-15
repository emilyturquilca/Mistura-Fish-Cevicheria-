import test from 'node:test';
import assert from 'node:assert/strict';
import '../sales-core.js';import '../operations-core.js';import '../operations-edit-core.js';import '../restaurant-core.js';
const O=globalThis.MisturaOperations,R=globalThis.MisturaRestaurant,C=globalThis.MisturaCore;
const at=minute=>'2026-10-15T15:'+String(minute).padStart(2,'0')+':00Z';
function setup(stock=10){
  let state=O.initial();
  const apply=(id,type,payload,minute=0)=>{state=O.apply(state,{id,type,payload},at(minute)).state;return state};
  apply('fish','ingredient',{name:'Pescado de prueba',unit:'kg',category:'Pescados',newSupplierName:'Proveedor de prueba',stock,unitCost:20});
  state.sales.prods.dish={n:'Plato de prueba',p:40};
  apply('recipe','recipe',{productKey:'dish',portions:1,lines:[{ingredientId:'fish',quantity:200,unit:'g',yield:80}]},1);
  const sale=(id,minute,quantity=2)=>({id,f:at(minute),source:'api',type:'SALE',total:40*quantity,net:40*quantity,items:[{k:'dish',q:quantity,t:40*quantity}]});
  const sync=(minute)=>R.reconcile(state,at(minute));
  return {apply,sale,sync,get state(){return state}};
}
test('An ingredient records category, supplier, stock and unit cost atomically',()=>{
  const s=setup();assert.equal(O.stock(s.state,'fish'),10);assert.equal(s.state.ingredients[0].cost,20);
  assert.equal(s.state.ingredients[0].category,'Pescados');assert.equal(s.state.suppliers[0].name,'Proveedor de prueba');
  assert.equal(s.state.ingredients[0].supplierId,s.state.suppliers[0].id);
  assert.equal(s.state.movements[0].kind,'Stock');assert.equal(R.capacity(s.state,s.state.recipes[0]),40);
  const before=structuredClone(s.state);
  assert.throws(()=>s.apply('bad','ingredient',{name:'Otro',unit:'kg',category:'Pescados',newSupplierName:'No debe guardarse',stock:-1,unitCost:10}),/Stock/);
  assert.deepEqual(s.state,before);
});
test('Editing the stock field sets the physical total and entered unit cost',()=>{
  const s=setup();s.apply('edit','ingredient',{id:'fish',name:'Pescado de prueba',unit:'kg',category:'Pescados',stock:4,unitCost:25},5);
  assert.equal(O.stock(s.state,'fish'),4);assert.equal(s.state.ingredients[0].cost,25);assert.equal(O.recipeCost(s.state,s.state.recipes[0]),6.25);
});

test('A supplier assigned to an ingredient must be reassigned before deletion',()=>{
  const s=setup(),supplierId=s.state.suppliers[0].id;
  assert.throws(()=>s.apply('delete-supplier','delete',{entity:'suppliers',targetId:supplierId}),/asignado a insumos/);
  s.apply('unassign','ingredient',{id:'fish',name:'Pescado de prueba',unit:'kg',category:'Pescados',supplierId:''},2);
  s.apply('delete-supplier','delete',{entity:'suppliers',targetId:supplierId},3);
  assert.equal(s.state.suppliers.length,0);assert.equal(s.state.ingredients[0].supplierId,'');
});
test('New ingredient categories require a real name instead of saving the UI sentinel',()=>{
  const s=setup();assert.throws(()=>s.apply('invalid','ingredient',{name:'Otro',unit:'kg',category:'__new__',stock:0,unitCost:0}),/Nueva categoría/);
  s.apply('valid','ingredient',{name:'Otro',unit:'kg',category:'__new__',newCategoryName:'Mi categoría',stock:0,unitCost:0});
  assert.equal(s.state.ingredients[1].category,'Mi categoría');
});
test('Loyverse sales deduct recipe gross ingredient needs once across repeated syncs',()=>{
  const s=setup();s.state.sales.v.a=s.sale('a',5,2);s.sync(6);
  assert.equal(O.stock(s.state,'fish'),9.5);assert.equal(s.state.movements.filter(m=>m.kind==='Venta').length,1);
  const id=s.state.movements.find(m=>m.kind==='Venta').id;s.sync(7);assert.equal(O.stock(s.state,'fish'),9.5);
  assert.equal(s.state.movements.find(m=>m.kind==='Venta').id,id);
  s.state.sales.v.a.items[0].q=3;s.sync(8);assert.equal(O.stock(s.state,'fish'),9.25);
});
test('Old receipts imported after activation do not reduce the new stock',()=>{
  const s=setup();s.state.sales.v.old={...s.sale('old',5,100),f:'2026-10-14T12:00:00-05:00'};s.sync(6);
  assert.equal(O.stock(s.state,'fish'),10);assert.equal(s.state.movements.filter(m=>m.kind==='Venta').length,0);
});
test('Recipe revisions apply to later sales and never reprice ingredient quantities in previous sales',()=>{
  const s=setup();s.state.sales.v.a=s.sale('a',5,4);s.sync(6);
  s.apply('recipe-edit','recipe',{id:'recipe',productKey:'dish',portions:1,lines:[{ingredientId:'fish',quantity:100,unit:'g',yield:100}]},10);
  assert.equal(O.stock(s.state,'fish'),9);
  s.state.sales.v.b=s.sale('b',11,2);s.sync(12);assert.equal(O.stock(s.state,'fish'),8.8);
});
test('Financial refunds retain consumption; a discarded plate is logged without deducting twice',()=>{
  const s=setup();s.state.sales.v.a=s.sale('a',5,2);s.sync(6);
  s.state.sales.v.refund={id:'refund',f:at(7),source:'api',type:'REFUND',refundFor:'a',total:-40,net:-40,items:[{k:'dish',q:-1,t:-40}]};s.sync(8);
  assert.equal(O.stock(s.state,'fish'),9.5);
  s.apply('waste-plate','preparedWaste',{refundId:'refund',productKey:'dish',quantity:1,date:'2026-10-15',note:'Plato descartado'},9);
  assert.equal(O.stock(s.state,'fish'),9.5);assert.equal(s.state.preparedWastes[0].unitCost,5);
  assert.throws(()=>s.apply('duplicate-waste','preparedWaste',{refundId:'refund',productKey:'dish',quantity:1,date:'2026-10-15',note:'Repetido'},10),/ya se registró/);
  s.apply('delete-waste','delete',{entity:'preparedWastes',targetId:'waste-plate'},11);assert.equal(O.stock(s.state,'fish'),9.5);
});
test('Cancellation of a previously imported prepared sale does not claim that ingredients were recovered',()=>{
  const s=setup();s.state.sales.v.a=s.sale('a',5);s.sync(6);delete s.state.sales.v.a;s.state.sales.cancelledIds={a:at(7)};s.sync(8);
  assert.equal(O.stock(s.state,'fish'),9.5);assert.equal(s.state.saleUsage.a.status,'cancelled');
});
test('Late POS synchronization is placed before a later physical stock correction',()=>{
  const s=setup();s.apply('physical','ingredient',{id:'fish',name:'Pescado de prueba',unit:'kg',category:'Pescados',stock:8,unitCost:20},10);
  s.state.sales.v.offline=s.sale('offline',5,2);s.sync(15);
  assert.equal(O.stock(s.state,'fish'),8);
  const autoIndex=s.state.movements.findIndex(m=>m.kind==='Venta'),countIndex=s.state.movements.findIndex(m=>m.id==='physical/stock');
  assert.ok(autoIndex<countIndex);
});
test('Actual sold quantities remain visible as negative stock, and incoming goods recover a valid cost',()=>{
  const s=setup(1);s.state.sales.v.a=s.sale('a',5,8);s.sync(6);assert.equal(O.stock(s.state,'fish'),-1);
  s.apply('buy','order',{supplierId:s.state.suppliers[0].id,date:'2026-10-15',lines:[{ingredientId:'fish',quantity:2,unit:'kg',unitCost:30}]},8);
  s.apply('arrived','receive',{orderId:'buy',date:'2026-10-15',lines:[{lineId:'buy/0',quantity:2,unitCost:30}]},9);
  assert.equal(O.stock(s.state,'fish'),1);assert.equal(s.state.ingredients[0].cost,30);
});
test('A pending recipe prevents a guessed deduction and does not backfill previous sales when completed',()=>{
  const s=setup();s.state.sales.prods.other={n:'Otro plato'};s.state.sales.v.a={...s.sale('a',5),items:[{k:'other',q:2,t:40}]};s.sync(6);
  assert.equal(O.stock(s.state,'fish'),10);assert.equal(s.state.autoStock.pending.length,1);
  s.apply('new-recipe','recipe',{productKey:'other',portions:1,lines:[{ingredientId:'fish',quantity:100,unit:'g',yield:100}]},10);
  assert.equal(O.stock(s.state,'fish'),10);
  s.state.sales.v.b={...s.sale('b',11),items:[{k:'other',q:2,t:40}]};s.sync(12);assert.equal(O.stock(s.state,'fish'),9.8);
});
test('Deleting a recipe stops future consumption while preserving earlier prepared meals',()=>{
  const s=setup();s.state.sales.v.a=s.sale('a',5);s.sync(6);s.apply('delete-recipe','delete',{entity:'recipes',targetId:'recipe'},7);
  s.state.sales.v.b=s.sale('b',8);s.sync(9);assert.equal(O.stock(s.state,'fish'),9.5);assert.equal(s.state.autoStock.pending.length,1);
});
test('An unused ingredient with its own entered stock can be removed and restored without an extra stock panel',()=>{
  const s=setup();s.apply('other','ingredient',{name:'Insumo libre',unit:'un',category:'Otros',stock:3,unitCost:2},2);
  s.apply('delete','delete',{entity:'ingredients',targetId:'other'},3);assert.ok(!s.state.ingredients.some(i=>i.id==='other'));
  s.apply('restore','restore',{trashId:'delete'},4);assert.equal(O.stock(s.state,'other'),3);assert.equal(s.state.ingredients.find(i=>i.id==='other').cost,2);
});
test('Reservations aggregate recipe requirements and shortages without consuming physical stock',()=>{
  const s=setup(1);const payload={name:'Reserva de prueba',phone:'',guests:8,plannedAt:'2026-10-16T13:00',status:'Pendiente',note:'',lines:[{productKey:'dish',quantity:6}]};
  s.apply('r1','reservation',payload,5);s.apply('r2','reservation',{...payload,name:'Otra reserva',lines:[{productKey:'dish',quantity:2}]},6);
  const plan=R.plan(s.state,'2026-10-16');assert.equal(plan.dishes.dish,8);assert.equal(plan.ingredients[0].quantity,2);assert.equal(plan.ingredients[0].buy,1);assert.equal(O.stock(s.state,'fish'),1);
  s.apply('served','reservation',{...payload,id:'r1',status:'Atendida'},7);assert.equal(R.plan(s.state,'2026-10-16').dishes.dish,2);
  s.apply('delete','delete',{entity:'reservations',targetId:'r2'},8);assert.equal(R.plan(s.state,'2026-10-16').reservations.length,0);
  s.apply('restore','restore',{trashId:'delete'},9);assert.equal(R.plan(s.state,'2026-10-16').dishes.dish,2);
});
test('Reservation planning marks unknown recipes as incomplete rather than reporting zero ingredients needed',()=>{
  const s=setup();s.state.sales.prods.missing={n:'Plato sin receta'};
  s.apply('reservation','reservation',{name:'Reserva',guests:1,phone:'',plannedAt:'2026-10-16T12:00',lines:[{productKey:'missing',quantity:1}]},5);
  assert.deepEqual(R.plan(s.state,'2026-10-16').missing,['missing']);
});
test('Hourly totals use local receipt time, separate refunds, and reconcile to the selected sales totals',()=>{
  const receipts=[{id:'prev',f:'2026-10-15T01:00:00Z',type:'SALE',total:20,net:18,gross:20,discount:2},{id:'sale',f:'2026-10-15T16:00:00Z',type:'SALE',total:100,net:100,gross:100},{id:'refund',f:'2026-10-15T17:00:00Z',type:'REFUND',total:-10,net:-10,gross:-10}];
  const hours=C.hourly(receipts);assert.equal(hours[20].net,18);assert.equal(hours[11].sales,1);assert.equal(hours[12].returns,1);assert.equal(hours[12].refunds,10);
  assert.equal(hours.reduce((n,h)=>n+h.net,0),C.totals(receipts).net);assert.equal(hours.reduce((n,h)=>n+h.paid,0),110);
  const selected=receipts.filter(r=>C.inRange(r,C.dateRange({k:'dia',day:'2026-10-15'})));assert.equal(C.hourly(selected).reduce((n,h)=>n+h.net,0),90);
});
