import test from 'node:test';
import assert from 'node:assert/strict';
import '../sales-core.js';
import '../operations-core.js';
import '../operations-edit-core.js';
import '../restaurant-core.js';
import '../payables-core.js';
import '../home-core.js';
const H=globalThis.MisturaHome,O=globalThis.MisturaOperations;

test('Home uses the Lima business day for reservations and the recorded goods receipt date',()=>{
  const s=O.initial();s.suppliers=[{id:'p',name:'Proveedor de prueba'}];s.orders=[{id:'o',supplierId:'p'}];
  s.receptions=[{id:'r',orderId:'o',date:'2026-10-16',lines:[{quantity:4}]},{id:'tomorrow',orderId:'o',date:'2026-10-17',lines:[]}];
  s.reservations=[{id:'a',plannedAt:'2026-10-17T01:00:00Z',status:'Pendiente',guests:4,lines:[{productKey:'missing-recipe',quantity:2}]},{id:'b',plannedAt:'2026-10-17T05:00:00Z',status:'Pendiente',guests:2,lines:[]},{id:'cancel',plannedAt:'2026-10-17T01:00:00Z',status:'Cancelada',guests:9,lines:[]},{id:'served',plannedAt:'2026-10-16T18:00:00Z',status:'Atendida',guests:6,lines:[]}];
  const before=JSON.stringify(s),d=H.daily(s,new Date('2026-10-17T04:59:59Z'));
  assert.equal(d.day,'2026-10-16');assert.equal(d.greeting,'Buenas noches');assert.equal(d.reservations.length,2);assert.equal(d.pending.length,1);assert.equal(d.guests,4);assert.equal(d.dishes,2);assert.deepEqual(d.plan.missing,['missing-recipe']);
  assert.equal(d.receptions.length,1);assert.equal(d.receptions[0].supplier,'Proveedor de prueba');assert.equal(JSON.stringify(s),before);
  const next=H.daily(s,new Date('2026-10-17T05:00:00Z'));assert.equal(next.day,'2026-10-17');assert.equal(next.pending[0].id,'b');assert.equal(next.receptions[0].id,'tomorrow');
});
test('Voice only accepts explicit navigation and reading, with accent and punctuation normalization',()=>{
  assert.deepEqual(H.command('Por favor, abrir el inventario.'),{action:'navigate',view:'Inventario'});
  assert.deepEqual(H.command('Ver reservaciones de hoy'),{action:'navigate',view:'Reservaciones'});
  assert.deepEqual(H.command('ver recepciones de hoy'),{action:'navigate',view:'Reservaciones'});
  assert.deepEqual(H.command('ver recepciones de productos'),{action:'navigate',view:'Recepción'});
  assert.deepEqual(H.command('ir a las recetas'),{action:'navigate',view:'Escandallos'});
  assert.deepEqual(H.command('Lee el resumen de hoy'),{action:'read'});
  for(const text of ['borrar inventario','pagar deudas','registrar merma','comprar pescado','abrir inventario y borrar todo',''])assert.equal(H.command(text),null);
});
test('Fishery snapshot expires and never treats an expired seasonal calendar as a current authorization',()=>{
  assert.deepEqual(H.fishingStatus('2026-10-17'),{stale:false,perico:true,chanque:true});
  assert.equal(H.fishingStatus('2026-10-24').stale,false);
  for(const day of ['2026-10-25','2027-10-17','2026-09-17'])assert.deepEqual(H.fishingStatus(day),{stale:true,perico:false,chanque:false});
});
