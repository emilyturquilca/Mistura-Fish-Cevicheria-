import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import '../sales-core.js';

const C = globalThis.MisturaCore;
const receipt = (id, overrides = {}) => ({
  receipt_number: id, receipt_type: 'SALE', receipt_date: '2026-10-12T17:00:00Z',
  total_money: 100, total_discount: 0, total_taxes: [], payments: [{ name: 'Efectivo' }],
  line_items: [{ item_id: 'ceviche', item_name: 'Ceviche', quantity: 1, total_money: 100, cost_total: 40 }],
  ...overrides
});

test('custom day uses Lima midnight and includes the final millisecond', () => {
  const interval = C.dateRange({ k: 'custom', from: '2026-10-12', to: '2026-10-12' });
  assert.equal(interval[0].toISOString(), '2026-10-12T05:00:00.000Z');
  assert.equal(interval[1].toISOString(), '2026-10-13T05:00:00.000Z');
  assert.equal(C.inRange({ f: '2026-10-12T04:59:59.999Z' }, interval), false);
  assert.equal(C.inRange({ f: '2026-10-12T05:00:00Z' }, interval), true);
  assert.equal(C.inRange({ f: '2026-10-13T04:59:59.999Z' }, interval), true);
  assert.equal(C.inRange({ f: '2026-10-13T05:00:00Z' }, interval), false);
});

test('synthetic regression: previous UTC filter includes receipts from the prior evening', () => {
  // Illustration of the date bug, not the business's real receipts.
  const rows = [{ f: '2026-10-12T01:00:00Z', total: 70 }, { f: '2026-10-12T17:00:00Z', total: 600 }];
  const old = [new Date('2026-10-12'), new Date('2026-10-13')];
  const fixed = C.dateRange({ k: 'dia', day: '2026-10-12' });
  assert.equal(rows.filter(r => C.inRange(r, old)).reduce((s, r) => s + r.total, 0), 670);
  assert.equal(rows.filter(r => C.inRange(r, fixed)).reduce((s, r) => s + r.total, 0), 600);
});

test('today follows Peru time and rolls over while the panel stays open', () => {
  assert.equal(C.dateKey('2026-10-15T04:59:59Z'), '2026-10-14');
  assert.equal(C.dateKey('2026-10-15T05:00:00Z'), '2026-10-15');
  assert.equal(C.dateKey(C.dateRange({ k: 'hoy' }, new Date('2026-10-15T05:00:00Z'))[0]), '2026-10-15');
  assert.equal(C.shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(C.shiftDay('2024-03-01', -1), '2024-02-29');
  assert.equal(C.shiftDay('2026-01-01', -1), '2025-12-31');
});

test('week and previous month ranges agree with business dates', () => {
  const now = new Date('2026-10-14T15:00:00Z');
  assert.equal(C.dateKey(C.dateRange({ k: 'semana' }, now)[0]), '2026-10-12');
  const previous = C.dateRange({ k: 'anterior' }, now);
  assert.equal(C.dateKey(previous[0]), '2026-09-01');
  assert.equal(C.dateKey(previous[1]), '2026-10-01');
});

test('CSV dates without an offset use Lima, explicit offsets are preserved', () => {
  assert.equal(C.parseDate('12/10/2026 23:30:00'), '2026-10-13T04:30:00.000Z');
  assert.equal(C.parseDate('2026-10-12'), '2026-10-12T05:00:00.000Z');
  assert.equal(C.parseDate('2026-10-12T23:30:00Z'), '2026-10-12T23:30:00.000Z');
  assert.equal(C.parseDate('invalid'), null);
});

test('sync updates receipts, removes subsequent cancellations and never duplicates', () => {
  const db = { v: {}, prods: {} };
  assert.equal(C.mergeReceipts(db, [receipt('1')]).added, 1);
  assert.equal(C.mergeReceipts(db, [receipt('1')]).updated, 0);
  assert.equal(C.mergeReceipts(db, [receipt('1', { total_money: 80 })]).updated, 1);
  assert.equal(Object.keys(db.v).length, 1);
  assert.equal(db.v['1'].total, 80);
  assert.equal(C.mergeReceipts(db, [receipt('1', { cancelled_at: '2026-10-14T12:00:00Z' })]).cancelled, 1);
  assert.equal(Object.keys(db.v).length, 0);
});

test('sales summary separates net sales, included/added tax, discounts, tips and surcharges', () => {
  const db = { v: {}, prods: {} };
  C.mergeReceipts(db, [receipt('1', {
    total_money: 133, total_discount: 10, tip: 5, surcharge: 10,
    total_taxes: [{ type: 'ADDED', money_amount: 18 }, { type: 'INCLUDED', money_amount: 8 }]
  })]);
  const t = C.totals(Object.values(db.v));
  assert.equal(t.gross, 110);
  assert.equal(t.net, 100);
  assert.equal(t.paid, 133);
  assert.equal(t.profit, 60);
  assert.equal(t.gross - t.refunds - t.discounts, t.net);
  assert.equal(C.round(t.net + t.addedTax + t.tip + t.surcharge), t.paid);
});

test('partial refunds subtract sales and costs, with discounts reversed once', () => {
  const db = { v: {}, prods: {} };
  C.mergeReceipts(db, [receipt('1', { total_money: 90, total_discount: 10 }), receipt('2', {
    receipt_type: 'REFUND', refund_for: '1', total_money: 18, total_discount: 2,
    line_items: [{ item_id: 'ceviche', item_name: 'Ceviche', quantity: 0.2, total_money: 18, cost_total: 8 }]
  })]);
  const t = C.totals(Object.values(db.v));
  assert.equal(t.net, 72);
  assert.equal(t.paid, 72);
  assert.equal(t.refunds, 20);
  assert.equal(t.discounts, 8);
  assert.equal(t.profit, 40);
  assert.equal(t.gross - t.refunds - t.discounts, t.net);
  assert.equal(db.v['2'].items[0].q, -0.2);
});

test('missing historical costs stay unknown; explicit zero cost is valid', () => {
  const db = { v: {}, prods: {} };
  C.mergeReceipts(db, [receipt('1', { line_items: [{ item_name: 'Item', quantity: 1, total_money: 100 }] })]);
  assert.equal(C.totals(Object.values(db.v)).profit, null);
  C.mergeReceipts(db, [receipt('1', { line_items: [{ item_name: 'Item', quantity: 1, total_money: 100, cost_total: 0 }] })]);
  assert.equal(C.totals(Object.values(db.v)).profit, 100);
  assert.equal(C.totals([{ total: 20 }]).legacy, 1);
  assert.equal(C.totals([{ total: 20 }]).profit, null);
});

test('exports keep numbers numeric, include all receipts and quote CSV safely', () => {
  const db = { v: {}, prods: {} };
  C.mergeReceipts(db, Array.from({ length: 65 }, (_, i) => receipt(String(i), { total_money: 0.10 })));
  const rows = C.reportRows(Object.values(db.v));
  assert.equal(rows.length, 67);
  assert.equal(rows.at(-1)[11], 6.50);
  assert.equal(typeof rows[1][7], 'number');
  const csv = C.csv([['Peña, "Ana"', '=SUM(A1)', 'line\nbreak', -12.5]]);
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes('"Peña, ""Ana"""'));
  assert.ok(csv.includes('"\'=SUM(A1)"'));
  assert.ok(csv.includes('"-12.5"'));
});

function app() {
  const elements = new Map();
  const element = () => ({ innerHTML: '', dataset:{}, querySelectorAll: () => [], appendChild() {}, remove() {}, click() {}, setAttribute() {} });
  const storage = new Map();
  const context = vm.createContext({
    console, Date, Intl, URL, Blob, structuredClone, setTimeout() {},clearTimeout() {},setInterval() {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    sessionStorage: { getItem: () => '', removeItem() {} },
    document: { querySelectorAll: () => [], querySelector: () => null, getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element, body: element() },
    window: {}, location: { origin: 'http://localhost' }
  });
  vm.runInContext(readFileSync(new URL('../sales-core.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../operations-core.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../operations-edit-core.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../restaurant-core.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../payables-core.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../service-core.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../home-core.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../operations-ui.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../operations-edit-ui.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../restaurant-ui.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../payables-ui.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../supplier-performance-ui.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../home-ui.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../service-ui.js', import.meta.url), 'utf8'), context);
  if (existsSync(new URL('../assets/xlsx.full.min.js', import.meta.url))) {
    vm.runInContext(readFileSync(new URL('../assets/xlsx.full.min.js', import.meta.url), 'utf8'), context);
  }
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  vm.runInContext(source, context);
  vm.runInContext('OPS.state=OpsCore.initial();OPS.configured=true;', context);
  return context;
}

test('all UI views render, daily navigation updates the chosen total, and labels are explicit', () => {
  const context = app();
  vm.runInContext(`DB={v:{},prods:{}};Core.mergeReceipts(DB,[${JSON.stringify(receipt('1'))}]);hidratar();P.k='dia';P.day='2026-10-12';`, context);
  assert.equal(vm.runInContext("sel(P.k).length", context), 1);
  assert.match(vm.runInContext('V.Dashboard()', context), /Ventas netas \(período\)/);
  assert.match(vm.runInContext('V.Ventas()', context), /12\/10\/2026/);
  assert.match(vm.runInContext('V.Reportes()', context), /Exportar Excel \(.xlsx\)/);
  for (const view of ['Compras', 'Proveedores', 'Cuentas por pagar', 'Recepción', 'Inventario', 'Reservaciones', 'Ventas por hora', 'Mermas', 'Escandallos', 'Productos', 'Rentabilidad', 'Sincronizar Loyverse', 'Papelera', 'Configuración','Producción','Cocina / comandas','Personal','Clientes / fidelización','Pronóstico']) {
    assert.equal(typeof vm.runInContext(`V[${JSON.stringify(view)}]()`, context), 'string');
  }
  vm.runInContext('moverDia(-1)', context);
  assert.equal(vm.runInContext('P.day', context), '2026-10-11');
  assert.equal(vm.runInContext('sel(P.k).length', context), 0);
  vm.runInContext('moverDia(1)', context);
  assert.equal(vm.runInContext('sel(P.k).length', context), 1);
  vm.runInContext("elegirPeriodo('hoy')", context);
  assert.match(vm.runInContext('period()', context), /Hoy ·/);
});

test('Home voice fallback navigates without writes and does not autoplay or start a microphone',()=>{
  const context=app();
  assert.match(vm.runInContext('V.Inicio()',context),/Temporada de pesca · Ilo/);
  const homeMarkup=vm.runInContext('V.Inicio()',context);
  assert.ok(homeMarkup.indexOf('id="home-command"')<homeMarkup.indexOf('<details'));
  assert.match(homeMarkup,/Windows \+ H/);
  assert.equal(vm.runInContext('homeListening',context),false);
  vm.runInContext('homeStartVoice()',context);
  assert.match(vm.runInContext('homeVoiceMessage',context),/no ofrece reconocimiento/);
  assert.equal(vm.runInContext("homeRunCommand('pagar deudas')",context),false);
  vm.runInContext("homeRunCommand('abrir inventario')",context);
  assert.equal(vm.runInContext('view',context),'Inventario');
  assert.equal(vm.runInContext('OPS.state.movements.length',context),0);
});

test('Voice recognition stops on navigation and late browser events cannot navigate again',()=>{
  const context=app();
  vm.runInContext(`window.SpeechRecognition=class{constructor(){globalThis.recognition=this}start(){this.onstart()}abort(){this.aborted=true;this.onend?.()}};homeStartVoice()`,context);
  assert.equal(vm.runInContext('homeListening',context),true);
  vm.runInContext("recognition.onresult({results:[[{transcript:'ver proveedores'}]]})",context);
  assert.equal(vm.runInContext('view',context),'Proveedores');
  assert.equal(vm.runInContext('homeListening',context),false);
  assert.equal(vm.runInContext('recognition.aborted',context),true);
  vm.runInContext("recognition.onresult({results:[[{transcript:'ver deudas'}]]})",context);
  assert.equal(vm.runInContext('view',context),'Proveedores');
});

test('Home has no spoken greeting and never invokes speech synthesis',()=>{
  const context=app();
  vm.runInContext(`window.SpeechSynthesisUtterance=class{constructor(){throw Error('Audio removed')}};window.speechSynthesis={speak(){throw Error('Audio removed')},cancel(){throw Error('Audio removed')}};homeRunCommand('leer resumen')`,context);
  assert.equal(vm.runInContext('view',context),'Inicio');
  const markup=vm.runInContext('V.Inicio()',context);assert.ok(!markup.includes('Escuchar saludo'));assert.ok(!markup.includes('Detener lectura'));
});

test('Voice click immediately shows starting state and allows cancellation before Chrome responds',()=>{
  const context=app();
  vm.runInContext(`window.SpeechRecognition=class{constructor(){globalThis.recognition=this}start(){}abort(){this.aborted=true;this.onend?.()}};homeStartVoice()`,context);
  assert.equal(vm.runInContext('homeListening',context),true);assert.equal(vm.runInContext('homeVoiceStarting',context),true);assert.match(vm.runInContext('homeVoiceMessage',context),/Iniciando micrófono/);
  vm.runInContext('homeStartVoice()',context);
  assert.equal(vm.runInContext('homeListening',context),false);assert.equal(vm.runInContext('recognition.aborted',context),true);
});

test('Voice errors clean up immediately even if Chrome never emits an end event',()=>{
  const context=app();
  vm.runInContext(`window.SpeechRecognition=class{constructor(){globalThis.recognition=this}start(){this.onstart()}abort(){this.aborted=true}};homeStartVoice();recognition.onerror({error:'not-allowed'})`,context);
  assert.equal(vm.runInContext('homeListening',context),false);assert.equal(vm.runInContext('homeVoiceStarting',context),false);assert.match(vm.runInContext('homeVoiceMessage',context),/El navegador no permite/);
  vm.runInContext(`homeStartVoice();recognition.onerror({error:'network'})`,context);
  assert.equal(vm.runInContext('homeListening',context),false);assert.match(vm.runInContext('homeVoiceMessage',context),/no pudo conectarse/);
  assert.match(vm.runInContext('homeVoiceMessage',context),/En Brave este servicio puede no estar disponible/);
  assert.match(vm.runInContext('homeVoiceMessage',context),/Windows \+ H/);
});

test('An unavailable constructor and a start exception never escape the button handler',()=>{
  const context=app();
  vm.runInContext(`window.SpeechRecognition=class{constructor(){throw Object.assign(new Error(),{name:'NotAllowedError'})}};homeStartVoice()`,context);
  assert.equal(vm.runInContext('homeListening',context),false);assert.match(vm.runInContext('homeVoiceMessage',context),/El navegador no permite/);
  vm.runInContext(`window.SpeechRecognition=class{start(){throw Error('unavailable')}abort(){}};homeStartVoice()`,context);
  assert.equal(vm.runInContext('homeListening',context),false);assert.match(vm.runInContext('homeVoiceMessage',context),/No se pudo iniciar/);
});

test('Voice startup times out instead of leaving the user waiting, and late events are ignored',()=>{
  const context=app();
  vm.runInContext(`globalThis.voiceTimers=new Map();let tid=0;setTimeout=(fn)=>{voiceTimers.set(++tid,fn);return tid};clearTimeout=id=>voiceTimers.delete(id);window.SpeechRecognition=class{constructor(){globalThis.recognition=this}start(){}abort(){this.aborted=true}};homeStartVoice();[...voiceTimers.values()][0]()`,context);
  assert.equal(vm.runInContext('homeListening',context),false);assert.equal(vm.runInContext('voiceTimers.size',context),0);assert.match(vm.runInContext('homeVoiceMessage',context),/El navegador no inició/);
  vm.runInContext("recognition.onstart();recognition.onresult({results:[[{transcript:'abrir compras'}]]})",context);
  assert.equal(vm.runInContext('view',context),'Inicio');assert.equal(vm.runInContext('homeListening',context),false);
});

test('Hourly Excel preserves the selected day and numeric amounts in all 24 hours', () => {
  const context = app();
  vm.runInContext(`DB={v:{},prods:{}};Core.mergeReceipts(DB,[${JSON.stringify(receipt('hourly'))}]);hidratar();P.k='dia';P.day='2026-10-12';XLSX.writeFile=(wb,name)=>{globalThis.exported={bytes:XLSX.write(wb,{type:'array',bookType:'xlsx'}),name}};hourlyExport();globalThis.reopened=XLSX.read(exported.bytes,{type:'array'});globalThis.rows=XLSX.utils.sheet_to_json(reopened.Sheets['Por hora'],{header:1});`, context);
  assert.equal(context.rows.length,25);
  assert.match(context.exported.name,/ventas-por-hora-.*2026-10-12-a-2026-10-12\.xlsx$/);
  assert.equal(context.rows.slice(1).reduce((n,r)=>n+r[6],0),100);
  assert.ok(context.rows.slice(1).every(r=>typeof r[6]==='number'));
});

test('Supplier profiles render linked purchases, goods and accounts with escaped notes',()=>{
  const context=app();
  vm.runInContext(`
    const command=(id,type,payload)=>{OPS.state=OpsCore.apply(OPS.state,{id,type,payload}).state};
    command('supplier','supplier',{name:'Proveedor ficticio',paymentMode:'Crédito',creditDays:7,paymentNotes:'<script>dato</script>'});
    command('ingredient','ingredient',{name:'Insumo ficticio',unit:'kg',supplierId:'supplier',stock:0,unitCost:0});
    command('order','order',{supplierId:'supplier',date:Core.dateKey(),lines:[{ingredientId:'ingredient',quantity:2,unit:'kg',unitCost:10}]});
    command('receipt','receive',{orderId:'order',date:Core.dateKey(),reference:'GUIA FICTICIA',punctuality:4,quality:3,evaluationNote:'<img src=x onerror=alert(1)>',lines:[{lineId:'order/0',quantity:1,unitCost:10}]});
    supplierProfile='supplier';
  `,context);
  const profile=vm.runInContext('V.Proveedores()',context);
  for(const label of ['Historial de compras','Insumos que suministra','Deudas y vencimientos','GUIA FICTICIA','Registrar pago'])assert.ok(profile.includes(label));
  assert.ok(profile.includes('&lt;script&gt;dato&lt;/script&gt;'));assert.ok(!profile.includes('<script>dato'));
  for(const label of ['Evaluaciones de entregas','Cumplimiento de cantidades','Historial de precios','4 de 5 estrellas','50%'])assert.ok(profile.includes(label));
  assert.ok(profile.includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(!profile.includes('<img src=x'));
  assert.match(vm.runInContext('V.Inventario()',context),/Recibir productos/);
  assert.match(vm.runInContext('V.Inventario()',context),/Ver precios/);
  vm.runInContext("ingredientHistory='ingredient'",context);
  assert.match(vm.runInContext("V['Precios de insumos']()",context),/GUIA FICTICIA/);
  assert.ok(!vm.runInContext('V.Inicio()',context).includes('Mercadería recibida hoy'));
  assert.match(vm.runInContext("V['Cuentas por pagar']()",context),/Deuda pendiente/);
});

test('Cash receipts are absent from every debt filter while retained in supplier payment history',()=>{
  const context=app();
  vm.runInContext(`
    const command=(id,type,payload)=>{OPS.state=OpsCore.apply(OPS.state,{id,type,payload}).state};
    command('s','supplier',{name:'Proveedor de prueba',paymentMode:'Crédito',creditDays:7});
    command('i','ingredient',{name:'Insumo de prueba',unit:'kg'});
    for(const id of ['cash','credit']){
      command('o-'+id,'order',{supplierId:'s',date:Core.dateKey(),lines:[{ingredientId:'i',quantity:2,unit:'kg',unitCost:10}]});
      command('r-'+id,'receive',{orderId:'o-'+id,date:Core.dateKey(),reference:id==='cash'?'DOCUMENTO-CONTADO-PRUEBA':'DOCUMENTO-CREDITO-PRUEBA',paymentMode:id==='cash'?'Contado':'Crédito',dueDate:Core.shiftDay(Core.dateKey(),7),lines:[{lineId:'o-'+id+'/0',quantity:2,unitCost:10}]});
    }
  `,context);
  for(const filter of ['Pendientes','Todas','Vencidas','Pagadas']){
    vm.runInContext('payableFilter='+JSON.stringify(filter),context);
    assert.ok(!vm.runInContext("V['Cuentas por pagar']()",context).includes('DOCUMENTO-CONTADO-PRUEBA'));
  }
  assert.match(vm.runInContext("payablePaymentsTable('s')",context),/DOCUMENTO-CONTADO-PRUEBA/);
  assert.match(vm.runInContext("payablePaymentsTable('s')",context),/Corregir forma de pago/);
  assert.match(vm.runInContext('opReceiptReference()',context),/Si no tienes uno, déjalo vacío/);
  assert.match(vm.runInContext("opLotInput('lot_0')",context),/Si no lo indica, déjalo vacío/);
  assert.ok(!vm.runInContext('opReceiptReference()',context).includes('required'));
});

test('Excel export creates a readable workbook with numeric totals and matching filters', () => {
  const context = app();
  assert.ok(context.XLSX, 'SheetJS must be available locally for a real export round trip');
  vm.runInContext(`DB={v:{},prods:{}};Core.mergeReceipts(DB,[${JSON.stringify(receipt('1'))},${JSON.stringify(receipt('2', { payments: [{ name: 'Tarjeta' }] }))}]);hidratar();P.k='dia';P.day='2026-10-12';fp='Efectivo';XLSX.writeFile=(wb,name)=>{globalThis.exported={bytes:XLSX.write(wb,{type:'array',bookType:'xlsx'}),name}};exportExcel(true);`, context);
  assert.ok(context.exported, vm.runInContext('MSG', context));
  assert.match(context.exported.name, /2026-10-12-a-2026-10-12\.xlsx$/);
  vm.runInContext("globalThis.reopened=XLSX.read(exported.bytes,{type:'array'});globalThis.result=XLSX.utils.sheet_to_json(reopened.Sheets.Recibos,{header:1});", context);
  assert.deepEqual(Array.from(context.reopened.SheetNames), ['Resumen', 'Por día', 'Recibos']);
  assert.equal(context.result.length, 3);
  assert.equal(context.result[1][0], '1');
  assert.equal(context.result[1][7], 100);
  assert.equal(context.result[2][11], 100);
  assert.equal(context.result[2][13], 60);
});

test('full sync refreshes receipts with a bounded creation window and applies cancellations', async () => {
  const context = app();
  vm.runInContext(`DB={v:{old:{id:'old',f:'2025-10-12T05:00:00Z',total:120,items:[]},cancel:{id:'cancel',f:'2026-10-12T05:00:00Z',total:70,items:[]}},prods:{},sync:'2026-10-14T00:00:00Z'};globalThis.requests=[];pages=async(path,key,p)=>{requests.push({path,p});return path=='/receipts'?[${JSON.stringify(receipt('old', { total_money: 100 }))},${JSON.stringify(receipt('cancel', { cancelled_at: '2026-10-14T12:00:00Z' }))}]:[]};`, context);
  await vm.runInContext('sincronizar(true)', context);
  assert.equal(vm.runInContext('DB.v.old.total', context), 100);
  assert.equal(vm.runInContext("Object.hasOwn(DB.v,'cancel')", context), false);
  assert.equal(vm.runInContext('DB.apiVersion', context), 3);
  const query = context.requests.find(r => r.path === '/receipts').p;
  assert.equal(query.updated_at_min, query.created_at_min);
  assert.ok(new Date(query.created_at_min).getTime() >= Date.now() - 30 * 864e5 - 5000);
});

test('failed sync leaves receipt data and incremental cursor intact', async () => {
  const context = app();
  vm.runInContext("DB={v:{},prods:{},apiVersion:3,apiSync:'2026-10-12T00:00:00Z'};pages=async(path)=>{if(path=='/receipts')throw new Error('Network failure');return []};", context);
  await vm.runInContext('sincronizar(true)', context);
  assert.equal(vm.runInContext('DB.apiSync', context), '2026-10-12T00:00:00Z');
  assert.equal(vm.runInContext('Object.keys(DB.v).length', context), 0);
  assert.equal(vm.runInContext('syncing', context), false);
  assert.match(vm.runInContext('MSG', context), /Network failure/);
});

test('history loads and file imports never advance the API sync cursor', async () => {
  const context = app();
  vm.runInContext("DB={v:{},prods:{},apiVersion:3,apiSync:'2026-10-12T00:00:00Z'};pages=async()=>[];", context);
  await vm.runInContext("sincronizar(true,'2026-10-13T05:00:00Z')", context);
  assert.equal(vm.runInContext('DB.apiSync', context), '2026-10-12T00:00:00Z');
  vm.runInContext("importar('Receipt number,Date,Total,Receipt type\\nF1,12/10/2026 14:00,20,REFUND')", context);
  assert.equal(vm.runInContext('DB.apiSync', context), '2026-10-12T00:00:00Z');
  assert.equal(vm.runInContext('DB.v.F1.total', context), -20);
  assert.equal(vm.runInContext('DB.v.F1.type', context), 'REFUND');
});

test('sync module shows server configuration without asking each device to save the token', () => {
  const context = app();
  vm.runInContext('serverConfigured=true', context);
  const html = vm.runInContext("V['Sincronizar Loyverse']()", context);
  assert.match(html, /Loyverse configurado para todos tus dispositivos/);
  assert.ok(!html.includes('id="tk"'));
  assert.ok(!html.includes('Guardar y sincronizar'));
});

test('old stored archives do not cause a recent sync to request history outside the available plan', async () => {
  const context = app();
  vm.runInContext("DB={v:{archive:{id:'archive',f:'2025-01-01T12:00:00Z',total:50,items:[]}},prods:{},apiVersion:2,apiSync:new Date().toISOString()};pages=async(path,key,p)=>{if(path=='/receipts'&&(!p.created_at_min||new Date(p.created_at_min).getTime()<Date.now()-31*864e5))throw new Error('PAYMENT_REQUIRED');return []};", context);
  await vm.runInContext('sincronizar(false)', context);
  assert.equal(vm.runInContext('DB.apiVersion', context), 3);
  assert.equal(vm.runInContext('DB.v.archive.total', context), 50);
  assert.ok(!vm.runInContext('MSG', context).includes('PAYMENT_REQUIRED'));
});

test('rapid renders and view changes discard stale chart callbacks before they reuse a canvas', () => {
  const context = app();
  vm.runInContext(`
    globalThis.pendingDraws=[];globalThis.chartInstances=[];
    setTimeout=draw=>pendingDraws.push(draw);
    globalThis.getComputedStyle=()=>({getPropertyValue:key=>key=='--ink'?'#0d2b3e':'#dbe8ee'});
    globalThis.Chart=class {
      constructor(canvas,config){
        if(chartInstances.some(chart=>chart.canvas===canvas&&!chart.destroyed))throw new Error('Canvas already in use');
        this.canvas=canvas;this.config=config;chartInstances.push(this);
      }
      destroy(){this.destroyed=true}
    };
    DB={v:{},prods:{}};Core.mergeReceipts(DB,[${JSON.stringify(receipt('chart-sale', { receipt_date: new Date().toISOString() }))}]);hidratar();
    view='Dashboard';render();render();view='Rentabilidad';render();
    pendingDraws.forEach(draw=>draw());
  `, context);
  assert.equal(context.chartInstances.length, 1);
  assert.equal(context.chartInstances[0].config.type, 'bar');
  assert.equal(context.chartInstances[0].config.options.indexAxis, 'y');
});
