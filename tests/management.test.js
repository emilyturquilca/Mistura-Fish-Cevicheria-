import test from 'node:test';import assert from 'node:assert/strict';
import '../sales-core.js';import '../operations-core.js';import '../operations-edit-core.js';import '../restaurant-core.js';import '../payables-core.js';import '../service-core.js';import '../management-core.js';
import { testStorage,hash } from '../lib/online-store.js';import * as operational from '../api/operational.js';import * as operations from '../api/operations.js';
const O=globalThis.MisturaOperations,R=globalThis.MisturaRestaurant,P=globalThis.MisturaPayables,now='2026-10-27T17:00:00Z';
function setup(){let s=O.initial(),n=0;const apply=(type,payload,id='command-'+(++n))=>{s=O.apply(s,{id,type,payload},now).state;return s};apply('supplier',{name:'Proveedor de prueba'},'supplier');apply('ingredient',{name:'Pescado de prueba',unit:'kg'},'fish');s.sales.prods.dish={n:'Plato de prueba',p:40,k:13};return {apply,get s(){return s},set s(v){s=v}}}
test('One received purchase updates supplier history, physical stock and cash/credit accounts atomically',()=>{
  const a=setup(),payload={supplierId:'supplier',date:'2026-10-27',paymentMode:'Contado',lines:[{ingredientId:'fish',quantity:20,unit:'kg',unitCost:12}]};
  a.apply('purchaseReceived',payload,'purchase');assert.equal(a.s.orders.length,1);assert.equal(a.s.receptions.length,1);assert.equal(a.s.orders[0].status,'Recibida');assert.equal(O.stock(a.s,'fish'),20);assert.equal(P.supplies(a.s,'supplier')[0].quantity,20);assert.equal(P.summary(a.s,'supplier').pending,0);
  a.apply('purchaseReceived',payload,'purchase');assert.equal(O.stock(a.s,'fish'),20);assert.equal(a.s.receptions.length,1);
  a.apply('stockPhysical',{ingredientId:'fish',quantity:5,note:'Conteo de prueba'});assert.equal(O.stock(a.s,'fish'),5);assert.equal(P.supplies(a.s,'supplier')[0].quantity,20);
  a.apply('purchaseReceived',{...payload,paymentMode:'Crédito',dueDate:'2026-10-30',lines:[{ingredientId:'fish',quantity:2,unit:'kg',unitCost:15}]},'credit');assert.equal(P.summary(a.s,'supplier').pending,30);assert.equal(O.stock(a.s,'fish'),7);
  const before=structuredClone(a.s);assert.throws(()=>a.apply('purchaseReceived',{...payload,paymentMode:'Crédito',dueDate:'2026-10-20'}),/vencimiento|Vencimiento/);assert.deepEqual(a.s,before);
});
test('Global stock does not consume recipes; enabling recipes starts from its explicit activation time',()=>{
  const a=setup();a.apply('stockPhysical',{ingredientId:'fish',quantity:20});a.apply('recipe',{productKey:'dish',portions:1,lines:[{ingredientId:'fish',quantity:200,unit:'g',yield:100}]});
  a.s.sales.v.old={id:'old',type:'SALE',source:'api',f:'2026-10-27T16:00:00Z',items:[{k:'dish',q:2}]};R.reconcile(a.s,'2026-10-27T17:00:00Z');assert.equal(O.stock(a.s,'fish'),20);
  assert.throws(()=>a.apply('businessSettings',{advancedEnabled:true,stockMode:'recipes'}),/fichas/);
  a.apply('businessSettings',{advancedEnabled:true,stockMode:'recipes',recipesReady:true});R.reconcile(a.s,'2026-10-27T17:01:00Z');assert.equal(O.stock(a.s,'fish'),20);
  a.s.sales.v.fresh={id:'fresh',type:'SALE',source:'api',f:'2026-10-27T17:02:00Z',items:[{k:'dish',q:2}]};R.reconcile(a.s,'2026-10-27T17:03:00Z');assert.equal(O.stock(a.s,'fish'),19.6);
  a.apply('businessSettings',{advancedEnabled:false,stockMode:'global'});a.s.sales.v.other={id:'other',type:'SALE',source:'api',f:'2026-10-27T17:05:00Z',items:[{k:'dish',q:2}]};R.reconcile(a.s,'2026-10-27T17:06:00Z');assert.equal(O.stock(a.s,'fish'),19.6);
});
test('Simple production accepts dishes without recipes and leaves stock unchanged',()=>{
  const a=setup();a.apply('productionPlan',{date:'2026-10-27',status:'En preparación',lines:[{productKey:'dish',quantity:5}]});assert.equal(a.s.productionPlans[0].status,'En preparación');assert.equal(O.stock(a.s,'fish'),0);
});
test('Operational code sees only the operational projection and cannot call administrator endpoints or commands',async()=>{
  const a=setup();a.s.webShop={operatorKeyHash:hash('operator-test-code-12345678901234567890')};a.s.sales.v.secret={id:'secret',type:'SALE',total:987654,net:987654,f:now,items:[]};
  process.env.NODE_ENV='test';process.env.APP_PASSWORD='owner-test-password';let current=structuredClone(a.s),version=0;testStorage({load:async()=>({state:structuredClone(current),version}),save:async(next,v)=>{if(v!==version)return null;current=structuredClone(next);return ++version}});
  const headers={'x-operativo':'operator-test-code-12345678901234567890','Content-Type':'application/json',origin:'https://example.test'};
  const get=()=>new Request('https://example.test/api/operational',{headers});const result=await operational.GET(get());assert.equal(result.status,200);const data=await result.json();assert.equal(data.role,'operativo');assert.ok(!JSON.stringify(data).includes('987654'));for(const key of ['suppliers','orders','receptions','movements','sales','recipes','webShop'])assert.equal(data[key],undefined);
  assert.equal((await operations.GET(new Request('https://example.test/api/operations',{headers:{'x-clave':headers['x-operativo']}}))).status,401);
  const denied=await operational.POST(new Request('https://example.test/api/operational',{method:'POST',headers,body:JSON.stringify({type:'businessSettings',commandId:'11111111-1111-4111-8111-111111111111',payload:{advancedEnabled:true,stockMode:'recipes'}})}));assert.equal(denied.status,403);
  const create=()=>new Request('https://example.test/api/operational',{method:'POST',headers,body:JSON.stringify({type:'reservation',commandId:'22222222-2222-4222-8222-222222222222',payload:{name:'Mesa de prueba',guests:2,plannedAt:'2026-10-28T13:00',status:'Pendiente',lines:[{productKey:'dish',quantity:2}]}})});
  assert.equal((await operational.POST(create())).status,200);assert.equal((await operational.POST(create())).status,200);assert.equal(current.reservations.length,1);
  const manual=await operational.POST(new Request('https://example.test/api/operational',{method:'POST',headers,body:JSON.stringify({type:'kitchenTicket',commandId:'33333333-3333-4333-8333-333333333333',payload:{date:'2026-10-27',table:'Mesa de prueba',status:'Pendiente',lines:[{productKey:'dish',quantity:2}],total:999999}})}));assert.equal(manual.status,200);assert.equal(current.kitchenTickets.length,1);assert.equal(current.kitchenTickets[0].total,undefined);
});
