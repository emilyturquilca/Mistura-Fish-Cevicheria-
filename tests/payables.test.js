import test from 'node:test';
import assert from 'node:assert/strict';
import '../sales-core.js';import '../operations-core.js';import '../operations-edit-core.js';import '../restaurant-core.js';import '../payables-core.js';
const O=globalThis.MisturaOperations,P=globalThis.MisturaPayables;
const now='2026-10-15T17:00:00Z',day='2026-10-15';
function setup(){
  let state=O.initial();
  const apply=(id,type,payload)=>{state=O.apply(state,{id,type,payload},now).state;return state};
  apply('supplier','supplier',{name:'Proveedor ficticio',paymentMode:'Crédito',creditDays:7,paymentNotes:'Transferencia acordada'});
  apply('fish','ingredient',{name:'Insumo ficticio',unit:'kg',stock:0,unitCost:0,supplierId:'supplier',category:'Prueba'});
  const buy=(id='order',quantity=10,cost=20)=>apply(id,'order',{supplierId:'supplier',date:day,reference:'PEDIDO-'+id,lines:[{ingredientId:'fish',quantity,unit:'kg',unitCost:cost}]});
  const receive=(id='received',orderId='order',quantity=5,cost=20,extra={})=>apply(id,'receive',{orderId,date:day,reference:'GUIA-'+id,lines:[{lineId:orderId+'/0',quantity,unitCost:cost}],...extra});
  const pay=(id='payment',amount=40,extra={})=>apply(id,'supplierPayment',{accountId:'reception/received',amount,date:day,method:'Transferencia',reference:'OPERACION-'+id,...extra});
  return {apply,buy,receive,pay,get state(){return state}};
}

test('Delivery stars save with a receipt, stay idempotent, and exclude unscored legacy deliveries',()=>{
  const s=setup();s.buy();s.receive('rated','order',5,20,{punctuality:'4',quality:'5',evaluationNote:'Entrega revisada'});s.receive('unrated','order',5,22);
  const before=structuredClone(s.state);s.receive('rated','order',5,20,{punctuality:1,quality:1});assert.deepEqual(s.state,before);
  const data=P.performance(s.state,'supplier');assert.deepEqual(data.punctuality,{value:4,count:1});assert.deepEqual(data.quality,{value:5,count:1});assert.equal(O.stock(s.state,'fish'),10);assert.equal(P.summary(s.state,'supplier').pending,210);
  assert.equal(s.state.receptions[0].evaluationNote,'Entrega revisada');assert.equal(s.state.receptions[1].quality,null);
});

test('Evaluations can be changed and cleared independently without changing stock, costs, debts or abonos',()=>{
  const s=setup();s.buy();s.receive();s.pay();const ledger=structuredClone(s.state.movements),accounts=P.accounts(s.state),cost=s.state.ingredients[0].cost;
  s.apply('rate','supplierEvaluation',{id:'received',punctuality:3,quality:4,evaluationNote:'Faltó hielo'});
  s.apply('rerate','supplierEvaluation',{id:'received',punctuality:5,quality:2,evaluationNote:'Revisado'});
  assert.equal(P.performance(s.state,'supplier').punctuality.value,5);
  s.apply('clear','supplierEvaluation',{id:'received',punctuality:'',quality:'',evaluationNote:''});
  assert.deepEqual(P.performance(s.state,'supplier').quality,{value:null,count:0});assert.deepEqual(s.state.movements,ledger);assert.deepEqual(P.accounts(s.state),accounts);assert.equal(s.state.ingredients[0].cost,cost);
});

test('Invalid scores fail atomically, including when sent with a stock-increasing receipt',()=>{
  const s=setup();s.buy();const before=structuredClone(s.state);
  for(const score of [0,6,2.5,-1,'NaN',true,[],{}]){
    assert.throws(()=>s.receive('bad','order',5,20,{quality:score}),/estrellas/);assert.deepEqual(s.state,before);
  }
  s.receive();const ratedBefore=structuredClone(s.state);
  assert.throws(()=>s.apply('wrong','supplierEvaluation',{id:'received',punctuality:6}),/estrellas/);assert.deepEqual(s.state,ratedBefore);
  assert.throws(()=>s.apply('missing','supplierEvaluation',{id:'absent',quality:5}),/no encontrado/);
});

test('Received quantities compare each ordered input in its own unit and partial deliveries accumulate',()=>{
  const s=setup();s.buy();s.receive('a','order',3);s.receive('b','order',2);
  let q=P.performance(s.state,'supplier').quantities[0];assert.deepEqual([q.ordered,q.received,q.pending,q.percent],[10,5,5,50]);
  s.apply('liquid','ingredient',{name:'Líquido ficticio',unit:'l'});
  s.apply('order2','order',{supplierId:'supplier',date:day,lines:[{ingredientId:'liquid',quantity:2,unit:'l',unitCost:4}]});
  s.apply('liquid-receipt','receive',{orderId:'order2',date:day,lines:[{lineId:'order2/0',quantity:2,unitCost:4}]});
  const quantities=P.performance(s.state,'supplier').quantities;assert.equal(quantities.length,2);assert.equal(quantities.find(x=>x.ingredientId==='liquid').percent,100);assert.equal(quantities.find(x=>x.ingredientId==='fish').percent,50);
});

test('Price history compares actual same-supplier costs rather than weighted stock cost or other suppliers',()=>{
  const s=setup();s.buy();s.receive('first','order',5,20);s.receive('second','order',5,22);
  s.apply('supplier2','supplier',{name:'Otro proveedor ficticio'});
  s.apply('order2','order',{supplierId:'supplier2',date:day,lines:[{ingredientId:'fish',quantity:1,unit:'kg',unitCost:99}]});
  s.receive('third','order2',1,99);
  const all=P.priceHistory(s.state,{ingredientId:'fish'});assert.deepEqual(all.map(r=>r.previousCost),[null,20,null]);assert.deepEqual(all.map(r=>r.change),[null,2,null]);assert.equal(all[1].percent,10);
  assert.equal(P.priceHistory(s.state,{supplierId:'supplier2'}).length,1);assert.notEqual(s.state.ingredients[0].cost,22);
});

test('Price history handles zero prices, decreases and backdated receipts, then recalculates after editing',()=>{
  const s=setup();s.buy('order',30);s.receive('zero','order',5,0);s.receive('up','order',5,10);s.receive('down','order',5,8);
  let rows=P.priceHistory(s.state);assert.equal(rows[1].change,10);assert.equal(rows[1].percent,null);assert.equal(rows[2].change,-2);assert.equal(rows[2].percent,-20);
  s.apply('edit','editReception',{id:'up',date:day,reference:'Corrección ficticia',lines:[{lineId:'order/0',quantity:5,unitCost:12}]});
  rows=P.priceHistory(s.state);assert.equal(rows[2].previousCost,12);assert.equal(rows[2].change,-4);
  s.apply('earlier-order','editOrder',{id:'order',supplierId:'supplier',date:'2026-10-14',lines:[{id:'order/0',ingredientId:'fish',quantity:30,unit:'kg',unitCost:20}]});
  s.receive('backdated','order',5,5,{date:'2026-10-14'});
  rows=P.priceHistory(s.state);assert.equal(rows[0].receptionId,'backdated');assert.equal(rows[1].previousCost,5);
});

test('Deleting and restoring receipts removes and restores their stars and price comparisons together',()=>{
  const s=setup();s.buy();s.receive('first','order',5,20,{quality:4});s.receive('second','order',5,22,{quality:2});
  s.apply('remove','delete',{entity:'receptions',targetId:'first'});
  assert.equal(P.performance(s.state,'supplier').quality.value,2);assert.equal(P.priceHistory(s.state)[0].previousCost,null);
  s.apply('restore','restore',{trashId:'remove'});
  assert.equal(P.performance(s.state,'supplier').quality.value,3);assert.equal(P.priceHistory(s.state)[1].previousCost,20);
});

test('Moving a purchase to another supplier clears reviews of the old supplier and reassigns its price history',()=>{
  const s=setup();s.buy();s.receive('received','order',5,20,{quality:5,punctuality:4});
  s.apply('supplier2','supplier',{name:'Otro proveedor ficticio'});
  s.apply('reassign','editOrder',{id:'order',supplierId:'supplier2',date:day,lines:[{id:'order/0',ingredientId:'fish',quantity:10,unit:'kg',unitCost:20}]});
  assert.equal(P.performance(s.state,'supplier').receptions.length,0);assert.equal(P.performance(s.state,'supplier2').quality.value,null);assert.equal(P.priceHistory(s.state)[0].supplierId,'supplier2');
});
test('Only received goods generate a debt, with agreed credit dates and no assumed payment',()=>{
  const s=setup();s.buy();assert.equal(P.accounts(s.state).length,0);assert.equal(O.stock(s.state,'fish'),0);
  s.receive();const a=P.accounts(s.state,day)[0];assert.equal(a.amount,100);assert.equal(a.balance,100);assert.equal(a.paid,0);assert.equal(a.dueDate,'2026-10-22');assert.equal(a.status,'Pendiente');assert.equal(O.stock(s.state,'fish'),5);
});
test('Partial receipts create independent accounts at their real quantities and costs',()=>{
  const s=setup();s.buy();s.receive();s.receive('second','order',5,22);
  const data=P.summary(s.state,'supplier',day);assert.equal(data.received,210);assert.equal(data.pending,210);assert.equal(data.accounts.length,2);assert.equal(O.stock(s.state,'fish'),10);assert.equal(s.state.ingredients[0].cost,21);
});
test('Cash purchases are paid and cannot receive a duplicate manual payment',()=>{
  const s=setup();s.buy();s.receive('received','order',5,20,{paymentMode:'Contado'});
  const a=P.accounts(s.state,day)[0];assert.equal(a.status,'Pagada');assert.equal(a.balance,0);assert.equal(a.paid,100);assert.equal(a.cashPaid,100);assert.equal(a.manualPaid,0);
  assert.equal(P.summary(s.state,'supplier','2026-11-01').pending,0);assert.equal(P.summary(s.state,'supplier','2026-11-01').overdue,0);assert.equal(P.summary(s.state,'supplier',day,true).accounts.length,0);
  const before=structuredClone(s.state);assert.throws(()=>s.pay('duplicate',100),/ya está pagada/);assert.deepEqual(s.state,before);assert.equal(O.stock(s.state,'fish'),5);
  const history=P.paymentHistory(s.state,'supplier');assert.equal(history.length,1);assert.equal(history[0].source,'cash');assert.equal(history[0].amount,100);assert.equal(P.paymentHistory(s.state,'supplier',true).length,0);
});

test('Existing manual payments count once when corrected to cash and are retained when switched back to credit',()=>{
  const s=setup();s.buy();s.receive();s.pay('partial',40);
  s.apply('cash','payableTerms',{id:'received',paymentMode:'Contado'});
  const a=P.accounts(s.state)[0];assert.equal(a.manualPaid,40);assert.equal(a.cashPaid,60);assert.equal(a.paid,100);assert.equal(a.balance,0);assert.equal(P.paymentHistory(s.state).reduce((n,p)=>n+p.amount,0),100);
  s.apply('credit','payableTerms',{id:'received',paymentMode:'Crédito',dueDate:'2026-10-22'});
  assert.equal(P.accounts(s.state)[0].balance,60);assert.equal(P.accounts(s.state)[0].manualPaid,40);assert.equal(P.paymentHistory(s.state).length,1);
});

test('Legacy cash accounts with complete manual payments do not duplicate paid history',()=>{
  const s=setup();s.buy();s.receive();s.pay('paid',100);s.state.receptions[0].paymentMode='Contado';
  const before=structuredClone(s.state),a=P.accounts(s.state)[0];assert.equal(a.paid,100);assert.equal(a.cashPaid,0);assert.equal(P.paymentHistory(s.state).length,1);assert.deepEqual(s.state,before);
  s.apply('correct-payment','supplierPayment',{id:'paid',accountId:'reception/received',amount:90,date:day,method:'Transferencia'});
  assert.equal(P.accounts(s.state)[0].paid,100);assert.equal(P.accounts(s.state)[0].cashPaid,10);
});

test('Receipt corrections keep cash paid but cannot conceal an overpayment from manual legacy records',()=>{
  const s=setup();s.buy();s.receive('received','order',5,20,{paymentMode:'Contado'});
  s.apply('edit-cost','editReception',{id:'received',date:day,lines:[{lineId:'order/0',quantity:5,unitCost:22}]});
  assert.equal(P.accounts(s.state)[0].paid,110);assert.equal(P.accounts(s.state)[0].balance,0);assert.equal(P.paymentHistory(s.state)[0].amount,110);assert.equal(O.stock(s.state,'fish'),5);
  const legacy=setup();legacy.buy();legacy.receive();legacy.pay('paid',100);legacy.state.receptions[0].paymentMode='Contado';
  const before=structuredClone(legacy.state);assert.throws(()=>legacy.apply('too-low','editReception',{id:'received',date:day,lines:[{lineId:'order/0',quantity:5,unitCost:10}]}),/superarían/);assert.deepEqual(legacy.state,before);
});

test('Deleting and restoring cash receipts recovers stock and history without fake manual payment records',()=>{
  const s=setup();s.buy();s.receive('received','order',5,20,{paymentMode:'Contado'});
  s.apply('delete-cash','delete',{entity:'receptions',targetId:'received'});assert.equal(P.accounts(s.state).length,0);assert.equal(P.paymentHistory(s.state).length,0);assert.equal(O.stock(s.state,'fish'),0);
  s.apply('restore-cash','restore',{trashId:'delete-cash'});assert.equal(P.accounts(s.state)[0].balance,0);assert.equal(P.paymentHistory(s.state).length,1);assert.equal(s.state.supplierPayments.length,0);assert.equal(O.stock(s.state,'fish'),5);
});

test('Mixed cash and credit deliveries leave only credit debt pending and overdue',()=>{
  const s=setup();s.buy();s.receive('cash','order',5,20,{paymentMode:'Contado'});s.receive('credit','order',5,22,{paymentMode:'Crédito',dueDate:'2026-10-16'});
  const total=P.summary(s.state,'supplier','2026-10-17'),debts=P.summary(s.state,'supplier','2026-10-17',true);
  assert.equal(total.received,210);assert.equal(total.paid,100);assert.equal(total.pending,110);assert.equal(total.overdue,110);assert.equal(debts.accounts.length,1);assert.equal(debts.paid,0);
});
test('Abonos reduce debt once, preserve stock and use the same idempotency as purchases',()=>{
  const s=setup();s.buy();s.receive();s.pay();const state=structuredClone(s.state);s.pay();assert.deepEqual(s.state,state);
  assert.equal(P.summary(s.state,'supplier',day).pending,60);assert.equal(P.summary(s.state,'supplier',day).paid,40);assert.equal(O.stock(s.state,'fish'),5);
});
test('Overpayment, excess precision and future payment dates fail atomically',()=>{
  const s=setup();s.buy();s.receive();s.pay();const before=structuredClone(s.state);
  assert.throws(()=>s.pay('overpay',61),/superarían/);assert.deepEqual(s.state,before);
  assert.throws(()=>s.pay('precision',1.111),/dos decimales/);
  assert.throws(()=>s.pay('future',10,{date:'2026-10-16'}),/futura/);
  assert.throws(()=>s.pay('early',10,{date:'2026-10-14'}),/anterior/);
  assert.deepEqual(s.state,before);
});
test('Editing, deleting and restoring an abono recalculates balances without changing stock',()=>{
  const s=setup();s.buy();s.receive();s.pay();s.pay('edited',60,{id:'payment'});assert.equal(P.accounts(s.state)[0].balance,40);
  s.apply('deleted','delete',{entity:'supplierPayments',targetId:'payment'});assert.equal(P.accounts(s.state)[0].balance,100);
  s.apply('restored','restore',{trashId:'deleted'});assert.equal(P.accounts(s.state)[0].balance,40);assert.equal(O.stock(s.state,'fish'),5);
});
test('Restoring a payment cannot overpay after another replacement payment',()=>{
  const s=setup();s.buy();s.receive();s.pay();s.apply('deleted','delete',{entity:'supplierPayments',targetId:'payment'});s.pay('replacement',100);
  const before=structuredClone(s.state);assert.throws(()=>s.apply('restored','restore',{trashId:'deleted'}),/superarían/);assert.deepEqual(s.state,before);
});
test('Changing actual received costs updates debt and stock cost, but cannot reduce below abonos',()=>{
  const s=setup();s.buy();s.receive();s.pay();
  const edit=unitCost=>s.apply('edit-'+unitCost,'editReception',{id:'received',date:day,reference:'GUIA',lines:[{lineId:'order/0',quantity:5,unitCost}]});
  edit(24);assert.equal(P.accounts(s.state)[0].balance,80);assert.equal(s.state.ingredients[0].cost,24);assert.equal(O.stock(s.state,'fish'),5);
  const before=structuredClone(s.state);assert.throws(()=>edit(5),/superarían/);assert.deepEqual(s.state,before);
});
test('Paid receipt and purchase deletion is blocked until payments are corrected',()=>{
  const s=setup();s.buy();s.receive();s.pay();
  for(const [entity,targetId]of [['receptions','received'],['orders','order']])assert.throws(()=>s.apply('delete-'+entity,'delete',{entity,targetId}),/tiene pagos/);
  s.apply('delete-payment','delete',{entity:'supplierPayments',targetId:'payment'});s.apply('delete-order','delete',{entity:'orders',targetId:'order'});
  assert.equal(P.accounts(s.state).length,0);assert.equal(O.stock(s.state,'fish'),0);
  s.apply('restore-order','restore',{trashId:'delete-order'});s.apply('restore-payment','restore',{trashId:'delete-payment'});assert.equal(P.accounts(s.state)[0].balance,60);
});
test('A purchase with abonos cannot silently move to a different supplier',()=>{
  const s=setup();s.buy();s.receive();s.pay();s.apply('other','supplier',{name:'Otro proveedor ficticio'});
  assert.throws(()=>s.apply('reassign','editOrder',{id:'order',supplierId:'other',date:day,lines:[{id:'order/0',ingredientId:'fish',quantity:10,unit:'kg',unitCost:20}]}),/otro proveedor/);
});
test('Existing receipts remain unconfirmed instead of inventing an unpaid opening balance',()=>{
  const s=setup();s.buy();s.receive();delete s.state.receptions[0].paymentMode;delete s.state.receptions[0].dueDate;
  assert.equal(P.summary(s.state,'supplier',day).pending,0);assert.equal(P.summary(s.state,'supplier',day).unconfirmed,1);assert.throws(()=>s.pay(),/Confirma/);
  s.apply('confirm','payableTerms',{id:'received',paymentMode:'Crédito',dueDate:'2026-10-20'});assert.equal(P.summary(s.state,'supplier',day).pending,100);
  s.pay('settled',100);assert.equal(P.summary(s.state,'supplier',day).pending,0);
});
test('Supplier conditions apply to future receipts without moving already agreed due dates',()=>{
  const s=setup();s.buy();s.receive();s.apply('terms','supplier',{id:'supplier',name:'Proveedor ficticio',paymentMode:'Crédito',creditDays:15});
  assert.equal(P.accounts(s.state)[0].dueDate,'2026-10-22');s.receive('later','order',5);assert.equal(P.accounts(s.state).find(a=>a.recordId==='later').dueDate,'2026-10-30');
  assert.throws(()=>s.apply('bad-terms','supplier',{id:'supplier',name:'Proveedor ficticio',paymentMode:'Crédito',creditDays:1.5}),/entre 1 y 365/);
});
test('Explicit due dates support overdue reports and reject invalid or prior dates',()=>{
  const s=setup();s.buy();s.receive();s.apply('terms','payableTerms',{id:'received',paymentMode:'Crédito',dueDate:'2026-10-16'});
  assert.equal(P.summary(s.state,'supplier','2026-10-17').overdue,100);assert.equal(P.summary(s.state,'supplier','2026-10-16').overdue,0);
  for(const dueDate of ['2026-02-30','bad','2026-10-14'])assert.throws(()=>s.apply('bad-'+dueDate,'payableTerms',{id:'received',paymentMode:'Crédito',dueDate}));
});
test('Opening debts and their abonos affect supplier balances without adding inventory',()=>{
  const s=setup();const debt={supplierId:'supplier',date:'2026-10-10',dueDate:'2026-10-14',reference:'ANTERIOR-1',amount:75,note:'Saldo previo ficticio'};
  s.apply('old','supplierDebt',debt);assert.equal(P.summary(s.state,'supplier',day).overdue,75);assert.equal(O.stock(s.state,'fish'),0);
  s.pay('paid-old',25,{accountId:'debt/old'});assert.equal(P.summary(s.state,'supplier',day).pending,50);
  s.apply('edit-old','supplierDebt',{id:'old',...debt,amount:80});assert.equal(P.summary(s.state,'supplier',day).pending,55);
  assert.throws(()=>s.apply('delete-old','delete',{entity:'supplierDebts',targetId:'old'}),/tiene pagos/);
});
test('Opening debts cannot duplicate an existing receipt or another opening document',()=>{
  const s=setup();s.buy();s.receive();const debt={supplierId:'supplier',date:day,dueDate:day,reference:'GUIA-received',amount:100};
  assert.throws(()=>s.apply('duplicate','supplierDebt',debt),/No dupliques/);
  s.apply('old','supplierDebt',{...debt,reference:'ANTERIOR'});assert.throws(()=>s.apply('again','supplierDebt',{...debt,reference:'anterior'}),/No dupliques/);
});
test('Supplier product history uses actual reception quantities and latest prices',()=>{
  const s=setup();s.buy();s.receive();s.receive('second','order',5,24);
  const history=P.supplies(s.state,'supplier');assert.equal(history.length,1);assert.equal(history[0].quantity,10);assert.equal(history[0].lastCost,24);
  assert.equal(P.supplies(s.state,'nonexistent').length,0);
});

test('Legacy suppliers are categorized only by unambiguous supply descriptions',()=>{
  const cases=[['Distribuidor de pescado','Pescado'],['Distribuidor de verduras','Verduras'],['Distribuidor de pulpo','Pulpo'],['Servicio de agua','Servicios'],['LLAMAGAS','Servicios'],['Distribuidor de abarrotes','Abarrotes'],['Distribuidor de conchas negras','Conchas negras'],['Pescado y verduras','Sin categoría'],['Gaspar','Sin categoría']];
  const before=O.initial();before.suppliers=cases.map(([name],i)=>({id:'legacy-'+i,name,phone:'',contact:'',taxId:''}));
  const state=O.apply(before,{id:'new',type:'supplier',payload:{name:'Otro proveedor ficticio'}},now).state;
  for(let i=0;i<cases.length;i++)assert.equal(state.suppliers[i].category,cases[i][1]);
  assert.ok(before.suppliers.every(s=>s.category==null),'The previous state is not mutated');
});

test('An explicit supplier category survives name changes without changing balances',()=>{
  const s=setup();s.buy();s.receive();s.pay();const summary=P.summary(s.state,'supplier',day);
  s.apply('categorize','supplier',{id:'supplier',name:'Proveedor ficticio',category:'Pescado'});
  s.apply('rename','supplier',{id:'supplier',name:'Distribuidor con nombre nuevo'});
  assert.equal(s.state.suppliers[0].category,'Pescado');assert.deepEqual(P.summary(s.state,'supplier',day),summary);assert.equal(O.stock(s.state,'fish'),5);
  s.apply('change','supplier',{id:'supplier',name:'Distribuidor con nombre nuevo',category:'Verduras'});assert.equal(s.state.suppliers[0].category,'Verduras');
});

test('Unknown supplier categories fail atomically and a restored category is preserved',()=>{
  const s=setup(),before=structuredClone(s.state);
  assert.throws(()=>s.apply('invalid','supplier',{id:'supplier',name:'Proveedor ficticio',category:'No permitida'}),/Categoría/);assert.deepEqual(s.state,before);
  s.apply('free','supplier',{name:'Proveedor libre',category:'Conchas negras'});
  s.apply('deleted','delete',{entity:'suppliers',targetId:'free'});s.apply('restored','restore',{trashId:'deleted'});
  assert.equal(s.state.suppliers.find(p=>p.id==='free').category,'Conchas negras');
});

test('Custom supplier categories are shared records and renaming updates assigned suppliers without affecting balances',()=>{
  const s=setup();s.buy();s.receive();s.pay();const balance=P.summary(s.state,'supplier',day);
  s.apply('category','supplierCategory',{name:'Bebidas'});assert.ok(P.categoryNames(s.state).includes('Bebidas'));
  s.apply('assign','supplier',{id:'supplier',name:'Proveedor ficticio',category:'Bebidas'});
  s.apply('rename-category','supplierCategory',{id:'category',name:'Bebidas y refrescos'});
  assert.equal(s.state.suppliers[0].category,'Bebidas y refrescos');assert.ok(!P.categoryNames(s.state).includes('Bebidas'));
  assert.deepEqual(P.summary(s.state,'supplier',day),balance);assert.equal(O.stock(s.state,'fish'),5);
});

test('Inline category creation and supplier save form one atomic operation',()=>{
  const s=setup();s.apply('inline','supplier',{name:'Proveedor nuevo',category:'__new__',newCategoryName:'Congelados'});
  assert.equal(s.state.suppliers.find(p=>p.id==='inline').category,'Congelados');assert.equal(s.state.supplierCategories[0].name,'Congelados');
  const before=structuredClone(s.state);
  assert.throws(()=>s.apply('invalid-inline','supplier',{name:'No debe guardarse',category:'__new__',newCategoryName:''}),/Nombre de la categoría/);assert.deepEqual(s.state,before);
  assert.throws(()=>s.apply('invalid-supplier','supplier',{name:'Tampoco se guarda',taxId:'123',category:'__new__',newCategoryName:'Carnes'}),/RUC/);assert.deepEqual(s.state,before);
});

test('Category validation prevents built-in, case and accent duplicates and reserved names',()=>{
  const s=setup();s.apply('custom','supplierCategory',{name:'Lácteos'});const before=structuredClone(s.state);
  for(const name of ['pescado','Servicios (gas y agua)','LACTEOS','__new__','x'.repeat(61)])assert.throws(()=>s.apply('bad-'+name.slice(0,10),'supplierCategory',{name}));
  assert.deepEqual(s.state,before);
});

test('Unused custom categories support deletion and recovery while assigned categories explain dependencies',()=>{
  const s=setup();s.apply('custom','supplierCategory',{name:'Carnes'});s.apply('assign','supplier',{id:'supplier',name:'Proveedor ficticio',category:'Carnes'});
  assert.throws(()=>s.apply('blocked','delete',{entity:'supplierCategories',targetId:'custom'}),/asignada a proveedores/);
  s.apply('unassign','supplier',{id:'supplier',name:'Proveedor ficticio',category:'Sin categoría'});s.apply('deleted','delete',{entity:'supplierCategories',targetId:'custom'});
  assert.ok(!P.categoryNames(s.state).includes('Carnes'));
  s.apply('restore','restore',{trashId:'deleted'});assert.ok(P.categoryNames(s.state).includes('Carnes'));
  s.apply('deleted-again','delete',{entity:'supplierCategories',targetId:'custom'});s.apply('replacement','supplierCategory',{name:'CARNES'});
  const before=structuredClone(s.state);assert.throws(()=>s.apply('conflict','restore',{trashId:'deleted-again'}),/Ya existe una categoría/);assert.deepEqual(s.state,before);
});
