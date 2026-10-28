import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { publicMenu,newOrder,settings,prepare,kitchenChange,tracking,confirmPayment,receiptPayload } from '../lib/online-core.js';
import { hash,testStorage,state } from '../lib/online-store.js';
import { webhookValid } from '../lib/online-payments.js';
import { syncReceipt } from '../lib/online-loyverse.js';
import * as orders from '../api/web-orders.js';import * as kitchen from '../api/kitchen.js';import * as payments from '../api/web-payments.js';import * as admin from '../api/shop-admin.js';import * as webhook from '../api/mp-webhook.js';import * as operations from '../api/operations.js';
const O=globalThis.MisturaOperations,C=globalThis.MisturaCore;
const token='a'.repeat(64),kitchenKey='b'.repeat(48),now='2026-10-23T17:00:00Z';
const variant='11111111-1111-4111-8111-111111111111';
function fixture(){
  let s=O.initial();s=O.apply(s,{id:'fish',type:'ingredient',payload:{name:'Insumo de prueba',unit:'kg',stock:10,unitCost:20}},'2026-10-20T12:00:00Z').state;
  s.settings={stockMode:'recipes'};
  s.sales.prods.dish={n:'Plato de prueba',c:'Carta',p:20,k:5,variantId:variant,taxIds:[]};
  s=O.apply(s,{id:'recipe',type:'recipe',payload:{productKey:'dish',portions:1,lines:[{ingredientId:'fish',quantity:200,unit:'g',yield:80}]}},'2026-10-20T12:01:00Z').state;
  prepare(s);s.webShop={enabled:true,allowCash:true,allowDelivery:true,deliveryFee:3,deliveryZone:'Zona de prueba',kitchenKeyHash:hash(kitchenKey),items:[{id:'dish',productKey:'dish',variantId:variant,name:'Plato de prueba',category:'Carta',price:20,taxIds:[],published:true,available:true}],loyverse:{enabled:false,storeId:'store-test',paymentTypes:{Efectivo:'cash-test',Tarjeta:'card-test',Yape:'yape-test'}}};
  return s;
}
const payload=(extra={})=>({mode:'mesa',table:'4',name:'Cliente de prueba',phone:'999999999',email:'',birthday:'02-29',marketingConsent:false,privacyAccepted:true,note:'Sin picante',method:'Efectivo',total:20,lines:[{id:'dish',quantity:1,price:20}],...extra});
function create(s,extra={},extraContext={}){return newOrder(s,payload(extra),{id:'order-test',accessHash:hash(token),originHash:'origin-test',now,paymentsReady:true,...extraContext})}
function memory(s){let current=structuredClone(s),version=0;process.env.NODE_ENV='test';testStorage({load:async()=>({state:structuredClone(current),version}),save:async(next,expected)=>{if(expected!==version)return null;current=structuredClone(next);return ++version}});return ()=>structuredClone(current)}
function req(path,{body,headers={}}={}){return new Request('https://example.test'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',origin:'https://example.test'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})})}
function env(){process.env.APP_PASSWORD='owner-test-password';process.env.MP_ACCESS_TOKEN='TEST-fake-key';process.env.MP_PUBLIC_KEY='TEST-fake-public';process.env.MP_WEBHOOK_SECRET='fake-webhook-secret';process.env.PUBLIC_APP_URL='https://example.test';process.env.LOYVERSE_TOKEN='fake-loyverse-key'}
test('Public menu and kitchen are projections; no costs, contacts, credentials or stock leak',async()=>{
  env();const s=fixture(),o=create(s);memory(s);
  const menu=await (await orders.GET(req('/api/web-orders'))).json();assert.equal(menu.items[0].price,20);assert.ok(!JSON.stringify(menu).includes('kitchenKeyHash'));assert.ok(!JSON.stringify(menu).includes('unitCost'));
  const k=await kitchen.GET(req('/api/kitchen?date=2026-10-23',{headers:{'x-cocina':kitchenKey}}));assert.equal(k.status,200);const data=await k.json();assert.equal(data.tickets.length,1);assert.equal(data.tickets[0].payment,'pending');assert.ok(!JSON.stringify(data).includes(o.phone));assert.ok(!JSON.stringify(data).includes('unitPrice'));assert.ok(!JSON.stringify(data).includes('accessHash'));
  assert.equal((await operations.GET(req('/api/operations',{headers:{'x-clave':kitchenKey}}))).status,401);
  assert.equal((await admin.GET(req('/api/shop-admin',{headers:{'x-cocina':kitchenKey}}))).status,401);
});
test('Order creation validates server prices, stock remains unchanged and optional birthday/permission is explicit',()=>{
  const s=fixture();assert.throws(()=>create(s,{total:1}),/total cambió/);assert.equal(s.onlineOrders.length,0);
  assert.throws(()=>create(s,{lines:[{id:'dish',quantity:1,price:1}]}),/precio/);
  assert.throws(()=>create(s,{birthday:'02-30'}),/cumpleaños/);
  assert.throws(()=>create(s,{privacyAccepted:false}),/uso de tus datos/);
  assert.throws(()=>create(s,{mode:'delivery',total:23,address:''}),/dirección/);
  const order=create(s);assert.equal(order.total,20);assert.equal(order.marketingConsent,false);assert.equal(s.kitchenTickets[0].status,'Por aceptar');assert.equal(O.stock(s,'fish'),10);
  const before=JSON.stringify(s);const menu=publicMenu(s);assert.equal(JSON.stringify(s),before);assert.equal(menu.items.length,1);
});
test('Public retries produce one order and one ticket, and closed/unavailable menus reject new orders',async()=>{
  env();const get=memory(fixture()),r=()=>req('/api/web-orders',{body:payload(),headers:{'x-order-token':token}});
  assert.equal((await orders.POST(r())).status,201);assert.equal((await orders.POST(r())).status,201);
  assert.equal(get().onlineOrders.length,1);assert.equal(get().kitchenTickets.length,1);
  assert.equal((await orders.GET(req('/api/web-orders?action=track',{headers:{'x-order-token':'c'.repeat(64)}}))).status,404);
  const s=fixture();s.webShop.enabled=false;assert.throws(()=>create(s),/no está recibiendo/);s.webShop.enabled=true;s.webShop.items[0].available=false;assert.throws(()=>create(s),/no está disponible/);
});
test('Kitchen state checks protect paid orders, in-flight payments, stale screens and delivery preparation',()=>{
  const s=fixture(),o=create(s,{method:'Tarjeta'}),t=s.kitchenTickets[0];
  assert.throws(()=>kitchenChange(s,{id:t.id,version:t.updatedAt,status:'Pendiente'},now),/no está confirmado/);
  o.payment.status='submitting';assert.throws(()=>kitchenChange(s,{id:t.id,version:t.updatedAt,status:'Cancelada',reason:'Prueba'},now),/en revisión/);
  o.payment.status='paid';kitchenChange(s,{id:t.id,version:t.updatedAt,status:'Pendiente'},'2026-10-23T17:01:00Z');
  assert.throws(()=>kitchenChange(s,{id:t.id,version:now,status:'En preparación'},now),/otra pantalla/);
  kitchenChange(s,{id:t.id,version:t.updatedAt,status:'En preparación'},'2026-10-23T17:02:00Z');assert.equal(t.status,'En preparación');assert.equal(O.stock(s,'fish'),10);
  assert.equal(globalThis.MisturaService.demand(s,'2026-10-23').dish,1);
});
test('Payment validation uses authoritative reference, amount, currency and method; returns flag review',()=>{
  const s=fixture(),o=create(s,{method:'Yape'}),p={id:100,external_reference:o.id,currency_id:'PEN',transaction_amount:20,payment_method_id:'yape',payment_type_id:'debit_card',status:'approved'};
  assert.throws(()=>confirmPayment(s,o,{...p,transaction_amount:1},now),/no coincide/);assert.throws(()=>confirmPayment(s,o,{...p,currency_id:'USD'},now),/no coincide/);
  assert.throws(()=>confirmPayment(s,o,{...p,payment_method_id:'visa',payment_type_id:'credit_card'},now),/medio de pago/);
  confirmPayment(s,o,p,now);assert.equal(o.payment.status,'paid');confirmPayment(s,o,{...p,status:'refunded',transaction_amount_refunded:20},now);assert.equal(o.payment.status,'review');
});
test('Webhook signature is checked before any gateway access and ignores forged body amounts',async()=>{
  env();const url='/api/mp-webhook?data.id=100',ts='1704908010',rid='request-test',sig=createHmac('sha256',process.env.MP_WEBHOOK_SECRET).update(`id:100;request-id:${rid};ts:${ts};`).digest('hex');
  const good=req(url,{body:{data:{id:'999'}},headers:{'x-signature':`ts=${ts},v1=${sig}`,'x-request-id':rid}});
  assert.equal(webhookValid(good,process.env.MP_WEBHOOK_SECRET),true);assert.equal(webhookValid(good,'wrong-key'),false);
  assert.equal((await webhook.POST(req(url,{body:{status:'approved'}}))).status,401);
});
test('Gateway charges use stored totals; repeated clicks cannot issue a second charge',async()=>{
  env();const s=fixture();create(s,{method:'Tarjeta'});const get=memory(s),original=globalThis.fetch;let charges=0;
  globalThis.fetch=async(url,options={})=>{
    if(String(url).endsWith('/v1/payments')&&options.method==='POST'){charges++;const data=JSON.parse(options.body);assert.equal(data.transaction_amount,20);assert.equal(data.external_reference,'order-test');assert.ok(options.headers['X-Idempotency-Key']);return Response.json({id:100})}
    if(String(url).endsWith('/v1/payments/100'))return Response.json({id:100,external_reference:'order-test',currency_id:'PEN',transaction_amount:20,payment_method_id:'visa',payment_type_id:'credit_card',status:'approved',date_approved:new Date().toISOString()});throw Error('Unexpected external request');
  };
  try{const request=()=>req('/api/web-payments',{body:{token:'fake-card-token',paymentMethodId:'visa',email:'test@example.test',attemptId:'11111111-1111-4111-8111-111111111111',transaction_amount:1},headers:{'x-order-token':token}});
    const results=await Promise.all([payments.POST(request()),payments.POST(request())]);assert.equal(charges,1);assert.ok(results.some(r=>r.status===200));assert.equal(get().onlineOrders[0].payment.status,'paid');assert.equal(O.stock(get(),'fish'),10);
  }finally{globalThis.fetch=original}
});
test('An uncertain gateway response locks another charge until reconciliation',async()=>{
  env();const s=fixture();create(s,{method:'Yape'});const get=memory(s),original=globalThis.fetch;let charges=0;
  globalThis.fetch=async()=>{charges++;throw Error('Synthetic transport failure')};
  try{const request=()=>req('/api/web-payments',{body:{token:'fake-yape-token',paymentMethodId:'yape',email:'test@example.test',attemptId:'11111111-1111-4111-8111-111111111111'},headers:{'x-order-token':token}});assert.equal((await payments.POST(request())).status,503);assert.equal(get().onlineOrders[0].payment.status,'review');assert.equal((await payments.POST(request())).status,409);assert.equal(charges,1)}finally{globalThis.fetch=original}
});
test('Loyverse is written once, reconciles the same receipt and consumes ingredients only once',async()=>{
  env();const s=fixture(),o=create(s);o.payment={status:'paid',paidAt:new Date().toISOString()};s.webShop.loyverse.enabled=true;const get=memory(s),original=globalThis.fetch;let receipt=null,posts=0;
  globalThis.fetch=async(url,options={})=>{
    if(String(url).includes('/receipts?'))return Response.json({receipts:receipt?[receipt]:[]});
    if(String(url).endsWith('/receipts')&&options.method==='POST'){posts++;const data=JSON.parse(options.body);assert.equal(data.line_items[0].variant_id,variant);receipt={receipt_number:'SYNTHETIC-WEB-1',receipt_type:'SALE',receipt_date:new Date().toISOString(),order:data.order,total_money:20,line_items:[{item_id:'dish',item_name:'Plato de prueba',quantity:1,total_money:20,cost_total:5}],payments:[{name:'Efectivo'}]};return Response.json(receipt)}throw Error('Unexpected external request');
  };
  try{await syncReceipt(o.id);await syncReceipt(o.id);assert.equal(posts,1);assert.equal(get().onlineOrders[0].receiptSync.status,'synced');assert.equal(Object.keys(get().sales.v).length,1);assert.equal(O.stock(get(),'fish'),9.75)}finally{globalThis.fetch=original}
});
test('Ambiguous Loyverse writes never repeat automatically even if search finds no receipt yet',async()=>{
  env();const s=fixture(),o=create(s);o.payment={status:'paid',paidAt:new Date().toISOString()};s.webShop.loyverse.enabled=true;const get=memory(s),original=globalThis.fetch;let posts=0;
  globalThis.fetch=async(url,options={})=>{if(options.method==='POST'){posts++;throw Error('Synthetic transport failure')}return Response.json({receipts:[]})};
  try{await syncReceipt(o.id);assert.equal(get().onlineOrders[0].receiptSync.status,'review');await syncReceipt(o.id);assert.equal(posts,1);assert.equal(O.stock(get(),'fish'),10)}finally{globalThis.fetch=original}
});
test('Settings publish only validated menu variants; receipt payload freezes paid order prices',()=>{
  const s=fixture();s.sales.prods.dish.webVariants=[{id:variant,name:'Normal',price:20},{id:'variant-second',name:'Especial',price:30}];
  const next=settings(s,{enabled:true,allowCash:true,items:[{id:'dish',name:'Plato especial',variantId:'variant-second',published:true,available:true}]});assert.equal(next.items[0].price,30);assert.equal(next.items[0].variantId,'variant-second');
  const o=create(s);o.payment={status:'paid',paidAt:now};s.sales.prods.dish.p=99;assert.equal(receiptPayload(o,s.webShop.loyverse).line_items[0].price,20);
  assert.throws(()=>receiptPayload({...o,deliveryFee:3},s.webShop.loyverse),/delivery/);
  s.sales.prods.dish.hasAddedTax=true;assert.throws(()=>settings(s,{items:[{id:'dish',published:true,available:true}]}),/impuestos/);
});
test('Catalog refresh reads official tax_ids and variant_id fields without dropping included taxes',async()=>{
  env();const get=memory(fixture()),original=globalThis.fetch;
  globalThis.fetch=async url=>{if(String(url).includes('/items?'))return Response.json({items:[{id:'dish',tax_ids:['tax-test'],variants:[{variant_id:variant,option1_value:'Normal',default_price:20}]}]});if(String(url).endsWith('/taxes'))return Response.json({taxes:[{id:'tax-test',type:'INCLUDED'}]});throw Error('Unexpected external request')};
  try{const r=await admin.POST(req('/api/shop-admin',{headers:{'x-clave':process.env.APP_PASSWORD},body:{action:'refresh-catalog'}}));assert.equal(r.status,200);const p=get().sales.prods.dish;assert.equal(p.variantId,variant);assert.deepEqual(p.taxIds,['tax-test']);assert.equal(p.webVariants[0].name,'Normal');assert.equal(p.hasAddedTax,false)}finally{globalThis.fetch=original}
});
