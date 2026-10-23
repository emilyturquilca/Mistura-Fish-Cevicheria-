import test from 'node:test';
import assert from 'node:assert/strict';
import '../sales-core.js';import '../operations-core.js';import '../operations-edit-core.js';import '../restaurant-core.js';import '../payables-core.js';import '../service-core.js';
const O=globalThis.MisturaOperations,S=globalThis.MisturaService,C=globalThis.MisturaCore;
const now='2026-10-23T17:00:00Z';
function setup(){
  let s=O.initial(),n=0;
  const apply=(type,payload,id='command-'+(++n))=>{s=O.apply(s,{id,type,payload},now).state;return s};
  apply('ingredient',{name:'Insumo de prueba',unit:'kg',stock:3,unitCost:20},'ingredient');
  s.sales.prods.dish={n:'Plato de prueba',p:30};s.sales.prods.other={n:'Otro plato de prueba',p:30};
  apply('recipe',{productKey:'dish',portions:2,lines:[{ingredientId:'ingredient',quantity:400,unit:'g',yield:80}]},'recipe');
  return {apply,get s(){return s},set s(value){s=value}};
}
const dishes=q=>[{productKey:'dish',quantity:q}];
test('Legacy states upgrade lazily and every service command is retry-safe without changing stock',()=>{
  const a=setup(),before=O.stock(a.s,'ingredient');
  const payload={date:'2026-10-24',lines:dishes(4),status:'Planificada'};
  a.apply('productionPlan',payload,'plan');a.apply('productionPlan',payload,'plan');
  assert.equal(a.s.productionPlans.length,1);assert.equal(O.stock(a.s,'ingredient'),before);
  a.apply('productionPlan',{...payload,id:'plan',status:'Lista'});
  assert.equal(O.stock(a.s,'ingredient'),before);
  assert.throws(()=>a.apply('productionPlan',{...payload,date:'2026-02-30'}),/fecha válida/);
  assert.throws(()=>a.apply('productionPlan',payload),/plan activo/);
  assert.throws(()=>a.apply('productionPlan',{...payload,id:'plan',lines:dishes(1.5)}),/entero/);
  assert.throws(()=>a.apply('productionPlan',{...payload,id:'plan',lines:[...dishes(2),...dishes(3)]}),/repitas/);
});
test('Demand counts a reservation once after making its kitchen ticket and aggregates shared ingredients',()=>{
  const a=setup();a.apply('reservation',{name:'Mesa de prueba',guests:4,plannedAt:'2026-10-24T13:00',lines:dishes(4)},'reservation');
  assert.equal(S.demand(a.s,'2026-10-24').dish,4);
  a.apply('kitchenTicket',{reservationId:'reservation',date:'2026-10-24',table:'Mesa',lines:dishes(6)},'ticket');
  assert.equal(S.demand(a.s,'2026-10-24').dish,6);
  assert.throws(()=>a.apply('delete',{entity:'reservations',targetId:'reservation'}),/tiene una comanda/);
  assert.throws(()=>a.apply('kitchenTicket',{reservationId:'reservation',date:'2026-10-24',table:'Mesa',lines:dishes(4)}),/ya tiene/);
  a.apply('kitchenTicket',{date:'2026-10-24',table:'Mostrador',lines:dishes(10)},'ticket2');
  const needs=S.requirements(a.s,S.demand(a.s,'2026-10-24'));
  assert.equal(needs.ingredients[0].quantity,4);assert.equal(needs.ingredients[0].buy,1);
  assert.equal(O.stock(a.s,'ingredient'),3);
  a.apply('kitchenStatus',{id:'ticket',status:'En preparación'});a.apply('kitchenStatus',{id:'ticket',status:'Lista'});a.apply('kitchenStatus',{id:'ticket',status:'Entregada'});
  assert.throws(()=>a.apply('kitchenStatus',{id:'ticket',status:'Lista'}),/estado/);
  assert.equal(O.stock(a.s,'ingredient'),3);
});
test('Production with missing recipes stays a draft and its deletion can be undone',()=>{
  const a=setup(),payload={date:'2026-10-24',lines:[{productKey:'other',quantity:2}]};
  a.apply('productionPlan',payload,'plan');assert.deepEqual(S.requirements(a.s,{other:2}).missing,['other']);
  assert.throws(()=>a.apply('productionPlan',{...payload,id:'plan',status:'En preparación'}),/recetas/);
  a.apply('delete',{entity:'productionPlans',targetId:'plan'},'delete-plan');assert.equal(a.s.productionPlans.length,0);
  a.apply('restore',{trashId:'delete-plan'});assert.equal(a.s.productionPlans[0].id,'plan');
});
test('Staff shifts support overnight work, disallow overlaps and preserve references when deleting',()=>{
  const a=setup();a.apply('staff',{name:'Persona de prueba',role:'Cocina'},'person');
  const payload={staffId:'person',start:'2026-10-23T22:00',end:'2026-10-24T06:00',status:'Programado'};
  a.apply('shift',payload,'shift');assert.equal(a.s.shifts[0].start,'2026-10-24T03:00:00.000Z');
  assert.throws(()=>a.apply('shift',{...payload,start:'2026-10-24T05:00',end:'2026-10-24T07:00'}),/ya tiene un turno/);
  assert.throws(()=>a.apply('shift',{...payload,end:'2026-10-25T06:00'}),/24 horas/);
  assert.throws(()=>a.apply('shift',{...payload,start:'2026-10-25T08:00',end:'2026-10-25T12:00',status:'Asistió'}),/futuro/);
  assert.throws(()=>a.apply('delete',{entity:'staff',targetId:'person'}),/turnos o tareas/);
  a.apply('shift',{staffId:'person',start:'2026-10-24T06:00',end:'2026-10-24T07:00'},'adjacent');
  a.apply('delete',{entity:'shifts',targetId:'shift'},'delete-shift');
  a.apply('shift',{staffId:'person',start:'2026-10-24T05:00',end:'2026-10-24T06:00'},'replacement');
  assert.throws(()=>a.apply('restore',{trashId:'delete-shift'}),/superpuestos/);
});
test('Manual loyalty visits, benefits and corrections preserve the amount of visits used at redemption',()=>{
  const a=setup();a.apply('customer',{name:'Cliente de prueba'},'client');a.apply('loyaltyProgram',{target:2,reward:'Beneficio de prueba'});
  a.apply('customerVisit',{customerId:'client',date:'2026-10-21'},'v1');a.apply('customerVisit',{customerId:'client',date:'2026-10-22'},'v2');
  assert.throws(()=>a.apply('customerVisit',{customerId:'client',date:'2026-10-22'}),/Ya registraste/);
  assert.equal(S.loyalty(a.s,a.s.customers[0]).available,1);
  a.apply('loyaltyReward',{customerId:'client',date:'2026-10-23'},'reward');assert.equal(S.loyalty(a.s,a.s.customers[0]).remaining,0);
  a.apply('loyaltyProgram',{target:4,reward:'Otro beneficio'});assert.equal(a.s.loyaltyRewards[0].visitsUsed,2);
  assert.throws(()=>a.apply('loyaltyReward',{customerId:'client',date:'2026-10-23'}),/todavía/);
  assert.throws(()=>a.apply('delete',{entity:'customerVisits',targetId:'v1'}),/respalda/);
  a.apply('delete',{entity:'loyaltyRewards',targetId:'reward'},'delete-reward');
  a.apply('delete',{entity:'customerVisits',targetId:'v1'},'delete-visit');assert.equal(S.loyalty(a.s,a.s.customers[0]).remaining,1);
  a.apply('restore',{trashId:'delete-visit'});a.apply('restore',{trashId:'delete-reward'});assert.equal(S.loyalty(a.s,a.s.customers[0]).remaining,0);
  a.apply('loyaltyProgram',{clear:true});assert.equal(a.s.loyaltyProgram,undefined);assert.equal(a.s.loyaltyRewards.length,1);
});
test('Restoring a benefit cannot spend the same visits a second time',()=>{
  const a=setup();a.apply('customer',{name:'Cliente de prueba'},'client');a.apply('loyaltyProgram',{target:1,reward:'Beneficio'});
  a.apply('customerVisit',{customerId:'client',date:'2026-10-22'},'visit');
  a.apply('loyaltyReward',{customerId:'client',date:'2026-10-23'},'reward');a.apply('delete',{entity:'loyaltyRewards',targetId:'reward'},'remove');
  a.apply('loyaltyReward',{customerId:'client',date:'2026-10-23'},'replacement');
  assert.throws(()=>a.apply('restore',{trashId:'remove'}),/sin compras o visitas/);
  assert.equal(a.s.loyaltyRewards.length,1);
});
test('Customer matching uses Loyverse IDs, excludes fully refunded sales and never merges equal names',()=>{
  const a=setup();a.s.sales.v={sale:{id:'sale',type:'SALE',customerId:'pos-client',cli:'Mismo nombre',net:60,items:[],f:now},other:{id:'other',type:'SALE',customerId:'another-id',cli:'Mismo nombre',net:80,items:[],f:now}};
  a.apply('customer',{name:'Mismo nombre',loyverseId:'pos-client'},'client');const c=a.s.customers[0];
  assert.equal(S.loyalty(a.s,c).earned,1);assert.equal(S.loyalty(a.s,c).spend,60);
  assert.throws(()=>a.apply('customer',{name:'Otra ficha',loyverseId:'pos-client'}),/ya está vinculado/);
  assert.throws(()=>a.apply('customerVisit',{customerId:'client',date:'2026-10-23'}),/duplicadas/);
  a.s.sales.v.refund={id:'refund',type:'REFUND',refundFor:'sale',net:-20};assert.equal(S.loyalty(a.s,c).earned,1);assert.equal(S.loyalty(a.s,c).spend,40);
  a.s.sales.v.refund.net=-60;assert.equal(S.loyalty(a.s,c).earned,0);
  const normalized=C.normalizeReceipt({receipt_number:'r',receipt_type:'SALE',customer_id:'pos-client',receipt_date:now,total_money:10},{'pos-client':'Mismo nombre'},{});assert.equal(normalized.customerId,'pos-client');
});
test('Forecast averages observed matching weekdays, excludes future data and does not add reservations twice',()=>{
  const a=setup(),date='2026-10-23';
  const sale=(id,day,q)=>({id,type:'SALE',f:day+'T17:00:00Z',items:[{k:'dish',q}],net:30*q});
  a.s.sales.v={a:sale('a','2026-10-02',4),b:sale('b','2026-10-09',8),c:sale('c','2026-10-16',6),future:sale('future','2026-10-30',100),today:sale('today',date,100),wrong:sale('wrong','2026-10-15',99)};
  a.apply('reservation',{name:'Mesa',guests:2,plannedAt:date+'T13:00',lines:dishes(10)},'reservation');
  const f=S.forecast(a.s,date,date);assert.equal(f.days.length,3);assert.equal(f.rows[0].estimate,6);assert.equal(f.rows[0].suggested,10);assert.equal(f.ingredients[0].quantity,2.5);
  delete a.s.sales.v.c;const low=S.forecast(a.s,date,date);assert.equal(low.rows[0].estimate,null);assert.equal(low.rows[0].suggested,10);
});
