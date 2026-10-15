// First-version operations UI. Every write is confirmed by the shared API.
const OpsCore = globalThis.MisturaOperations;
let OPS = { state: null, version: 0, error: '', configured: false, busy: false };
let opNotice = '', opOrder = '', opRecipe = '', opSupplier = '';
const opDrafts = {}, opLineCounts = { order: 1, recipe: 1 };
function opCapture() {
  document.querySelectorAll('form[data-op]').forEach(form => {
    opDrafts[form.dataset.op] = Object.fromEntries(new FormData(form));
  });
}
function opRestore() {
  document.querySelectorAll('form[data-op]').forEach(form => {
    const values = opDrafts[form.dataset.op];
    if (values) Object.entries(values).forEach(([key, value]) => { const input = form.elements.namedItem(key); if (input && input.type !== 'submit') input.value = value; });
  });
}
async function opRequest(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'x-clave': encodeURIComponent(clave()), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json().catch(() => ({ error: 'No se pudo leer la respuesta del servidor.' }));
  if (r.status === 401) { salir(); throw new Error('Sesión terminada.'); }
  if (!r.ok) {
    if (r.status === 409 && data.state) { OPS.state = data.state; OPS.version = data.version; }
    throw new Error(data.error || 'Error ' + r.status);
  }
  return data;
}
function opAdopt(data) {
  OPS = { ...OPS, state: data.state, version: data.version, configured: true, error: '' };
  if (data.state.sales.sync) { DB = OpsCore.combineSales(data.state.sales,DB); guardar(); hidratar(); }
}
async function opLoad(quiet = false) {
  if (OPS.busy) return;
  OPS.busy = true;
  try { opAdopt(await opRequest('/api/operations')); if (!quiet) opNotice = 'Datos actualizados desde la base compartida.'; }
  catch (e) { OPS.error = e.message; OPS.configured = false; }
  finally { OPS.busy = false; if (clave()) render(); }
}
async function opSync(from) {
  const data = await opRequest('/api/sync-sales', { from }); opAdopt(data);
  return data.counts;
}
async function opCommit(type, payload, formName, expectedVersion = OPS.version) {
  if (OPS.busy || !OPS.configured) return;
  opCapture(); OPS.busy = true; opNotice = ''; render();
  // Keep the command ID across transport errors so retrying cannot create a second receipt.
  const serialized = JSON.stringify({ type, payload });
  let pending = OPS.pending;
  if(!pending){try{pending=JSON.parse(sessionStorage.getItem('mf_operation_pending')||'null')}catch{}}
  if (!pending || pending.serialized !== serialized) pending = OPS.pending = { id: crypto.randomUUID(), serialized };
  sessionStorage.setItem('mf_operation_pending',JSON.stringify(pending));
  try {
    const data = await opRequest('/api/operations', { id: pending.id, type, payload, version: expectedVersion });
    opAdopt(data); OPS.pending = null; sessionStorage.removeItem('mf_operation_pending');
    delete opDrafts[formName]; if (formName) document.querySelector(`form[data-op="${formName}"]`)?.reset();
    opNotice = data.duplicate ? 'Esta operación ya estaba guardada. No se duplicó.' : 'Guardado en la base compartida.';
    if (type === 'receive') opOrder = '';
    if (type === 'recipe') { opRecipe = ''; opLineCounts.recipe = 1; }
    if (type === 'supplier') opSupplier = '';
    if (type === 'order') opLineCounts.order = 1;
    if(typeof opAfterCommit === 'function')opAfterCommit(type,payload);
  } catch (e) { opNotice = e.message; }
  finally { OPS.busy = false; if(clave())render(); }
}
function opForm(event, type) {
  event.preventDefault(); if (OPS.busy) return;
  const data = Object.fromEntries(new FormData(event.currentTarget)), name = event.currentTarget.dataset.op;
  if (type === 'order' || type === 'recipe') {
    data.lines = [];
    for (let i = 0; i < opLineCounts[type]; i++) {
      const line = {};
      for (const field of ['ingredientId', 'quantity', 'unit', type === 'order' ? 'unitCost' : 'yield']) { line[field] = data[`line_${i}_${field}`]; delete data[`line_${i}_${field}`]; }
      data.lines.push(line);
    }
    if (type === 'recipe') data.productKey = opRecipe;
  }
  if (type === 'supplier' && opSupplier) data.id = opSupplier;
  if (type === 'receive') {
    const order = OPS.state.orders.find(o => o.id === opOrder); data.orderId = opOrder; data.lines = [];
    order.lines.forEach((line, i) => {
      if (Number(data[`qty_${i}`]) > 0) data.lines.push({ lineId: line.id, quantity: data[`qty_${i}`], unitCost: data[`cost_${i}`], lot: data[`lot_${i}`], expiry: data[`expiry_${i}`] });
      for (const field of ['qty', 'cost', 'lot', 'expiry']) delete data[`${field}_${i}`];
    });
  }
  opCommit(type, data, name);
}
function opRows(type, delta) { opCapture(); opLineCounts[type] = Math.max(1, Math.min(100, opLineCounts[type] + delta)); render(); }
function opSelectOrder(id) { opCapture(); opOrder = id; render(); }
function opSelectRecipe(key) {
  opCapture(); document.querySelector('form[data-op="recipe"]')?.remove(); opRecipe = key; const recipe = OPS.state.recipes.find(r => r.productKey === key);
  opLineCounts.recipe = recipe?.lines.length || 1;
  opDrafts.recipe = { portions: recipe?.portions || 1 };
  recipe?.lines.forEach((line, i) => Object.assign(opDrafts.recipe, { [`line_${i}_ingredientId`]: line.ingredientId, [`line_${i}_quantity`]: line.quantity, [`line_${i}_unit`]: OPS.state.ingredients.find(x => x.id === line.ingredientId).unit, [`line_${i}_yield`]: line.yield * 100 }));
  render();
}
function opEditSupplier(id) {
  opCapture(); document.querySelector('form[data-op="supplier"]')?.remove(); opSupplier = id;
  opDrafts.supplier = id ? { ...OPS.state.suppliers.find(s => s.id === id) } : {};
  render();
}
const opInput = (label, name, type = 'text', value = '', required = true, extra = '') => `<label>${esc(label)}<input name="${name}" aria-label="${esc(label)}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${extra}></label>`;
const opNumber = (label, name, value = '', zero = false) => opInput(label, name, 'number', value, true, `min="${zero ? 0 : .0001}" max="100000000" step="any"`);
const opDate = () => opInput('Fecha', 'date', 'date', Core.dateKey(), true, `max="${Core.dateKey()}"`);
const opOptions = (items, key = 'id', label = 'name') => items.map(x => `<option value="${esc(x[key])}">${esc(x[label])}</option>`).join('');
const opIngredients = (name = 'ingredientId') => `<label>Insumo<select name="${name}" aria-label="Insumo" required><option value="">Elegir insumo</option>${opOptions(OPS.state.ingredients)}</select></label>`;
const opUnits = name => `<label>Unidad<select name="${name}" aria-label="Unidad"><option value="kg">kg</option><option value="g">g</option><option value="l">l</option><option value="ml">ml</option><option value="un">un</option></select></label>`;
const opSave = text => `<button class="btn" type="submit" ${OPS.busy ? 'disabled' : ''}>${OPS.busy ? 'Guardando…' : text || 'Guardar'}</button>`;
const opTable = (headers, rows, empty = 'Todavía no hay registros.') => rows.length ? `<div class="wrap"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="empty">${esc(empty)}</p>`;
const opQuantity = value => Number(value).toLocaleString('es-PE', { maximumFractionDigits: 4 });
function opShell(title, subtitle, draw) {
  const ready = OPS.configured && OPS.state;
  return `<h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p><div class="bar"><span class="tag">${ready ? 'Base compartida · conectada' : 'Base sin conexión'}</span><button class="pill" onclick="opLoad()" ${OPS.busy ? 'disabled' : ''}>Actualizar datos</button></div>${opNotice ? `<div class="notice" role="status">${esc(opNotice)}${typeof restaurantUndoMarkup==='function'?restaurantUndoMarkup():''}</div>` : ''}${!ready ? `<div class="notice" role="alert">${esc(OPS.error || 'Conectando con la base compartida…')} No se pueden guardar operaciones hasta conectar.</div>` : draw()}`;
}
function opLineForm(type) {
  return `<div class="op-lines">${Array.from({ length: opLineCounts[type] }, (_, i) => `<div class="op-line"><b>${i + 1}</b>${opIngredients(`line_${i}_ingredientId`)}${opNumber(type === 'recipe' ? 'Cantidad neta en receta' : 'Cantidad a comprar', `line_${i}_quantity`)}${opUnits(`line_${i}_unit`)}${opNumber(type === 'recipe' ? 'Rendimiento %' : 'Costo S/ por kg, l o un', `line_${i}_${type === 'recipe' ? 'yield' : 'unitCost'}`, type === 'recipe' ? 100 : '', type === 'order')}</div>`).join('')}</div><div class="bar"><button type="button" class="pill" onclick="opRows('${type}',1)">Agregar insumo</button><button type="button" class="pill" onclick="opRows('${type}',-1)" ${opLineCounts[type] === 1 ? 'disabled' : ''}>Quitar último</button>${type==='recipe'?'<button type="button" class="pill" onclick="restaurantQuickIngredient()">Crear insumo aquí</button>':''}</div>`;
}
const OperationsViews = {
  Compras() { return opShell('Compras', 'Registra lo solicitado y recibe la mercadería en el siguiente paso.', () => {
    const s = OPS.state;
    return `${!s.suppliers.length || !s.ingredients.length ? '<div class="notice">Para empezar, registra tus proveedores en Proveedores y tus insumos en Inventario. Después podrás crear una compra.</div>' : `<form data-op="order" class="card op-form" onsubmit="opForm(event,'order')"><h2>Nueva compra</h2><div class="op-fields"><label>Proveedor<select name="supplierId" aria-label="Proveedor" required><option value="">Elegir proveedor</option>${opOptions(s.suppliers)}</select></label>${opDate()}${opInput('Referencia / pedido', 'reference', 'text', '', false)}</div><p class="k">El costo se ingresa por la unidad base del insumo (kg, l o un), con impuestos y flete prorrateado. Crear una compra no modifica el stock.</p>${opLineForm('order')}${opSave('Crear compra')}</form>`}<div class="card"><h2>Compras registradas</h2>${opTable(['N.º', 'Fecha', 'Proveedor', 'Total solicitado', 'Estado', 'Acción'], [...s.orders].reverse().map(o => [o.number, esc(o.date), esc(s.suppliers.find(x => x.id === o.supplierId)?.name), S(sum(o.lines.map(l => l.quantity * l.unitCost))), `<span class="tag">${esc(o.status)}</span>`, (['Pendiente', 'Parcial'].includes(o.status) ? `<button class="pill" data-id="${esc(o.id)}" onclick="view='Recepción';opSelectOrder(this.dataset.id)">Recibir</button>${o.status === 'Pendiente' ? ` <button class="pill" data-id="${esc(o.id)}" onclick="opCommit('cancelOrder',{orderId:this.dataset.id})">Anular pedido</button>` : ''}` : '') + opRecordActions('orders',o.id)]))}</div>`;
  }); },
  Proveedores() { return opShell('Proveedores', 'Directorio compartido de quienes abastecen el negocio.', () => `<form data-op="supplier" class="card op-form" onsubmit="opForm(event,'supplier')"><h2>${opSupplier ? 'Editar proveedor' : 'Nuevo proveedor'}</h2><div class="op-fields">${opInput('Nombre / razón social', 'name')}${opInput('RUC (opcional)', 'taxId', 'text', '', false, 'inputmode="numeric" pattern="[0-9]{11}"')}${opInput('Contacto (opcional)', 'contact', 'text', '', false)}${opInput('Teléfono (opcional)', 'phone', 'tel', '', false)}</div>${opSave()}${opSupplier ? ' <button type="button" class="pill" onclick="opEditSupplier(\'\')">Cancelar edición</button>' : ''}</form><div class="card">${opTable(['Proveedor', 'RUC', 'Contacto', 'Teléfono', 'Acción'], OPS.state.suppliers.map(s => [esc(s.name), esc(s.taxId || '—'), esc(s.contact || '—'), esc(s.phone || '—'), opRecordActions('suppliers',s.id)]))}</div>`); },
  Recepción() { return opShell('Recibir compra', 'Confirma cantidades, costo real, lote y vencimiento. Se permiten entregas parciales.', () => {
    const s = OPS.state, pending = s.orders.filter(o => ['Pendiente', 'Parcial'].includes(o.status));
    const order = pending.find(o => o.id === opOrder);
    return `<div class="bar"><button class="pill" onclick="view='Compras';render()">Volver a Compras</button></div><div class="card"><label>Compra pendiente <select aria-label="Compra pendiente" onchange="opSelectOrder(this.value)"><option value="">Seleccionar compra</option>${pending.map(o => `<option value="${esc(o.id)}" ${o.id === opOrder ? 'selected' : ''}>Compra ${o.number} · ${esc(s.suppliers.find(x => x.id === o.supplierId)?.name)} · ${o.status}</option>`).join('')}</select></label>${!pending.length ? '<p class="empty">No hay compras pendientes de recepción.</p>' : ''}</div>${order ? `<form class="card op-form" data-op="receive-${esc(order.id)}" onsubmit="opForm(event,'receive')"><h2>Recibir compra ${order.number}</h2><div class="op-fields">${opDate()}${opInput('Comprobante / guía', 'reference', 'text', '', false)}</div><p class="k">Ingresa cantidades en la unidad base. Deja 0 en lo que aún no llegó. Cada recepción queda registrada una sola vez.</p>${order.lines.map((l, i) => { const ing = s.ingredients.find(x => x.id === l.ingredientId); return l.quantity > l.received ? `<fieldset><legend>${esc(ing.name)} · faltan ${opQuantity(l.quantity - l.received)} ${ing.unit}</legend><div class="op-fields">${opNumber('Cantidad recibida (' + ing.unit + ')', `qty_${i}`, 0, true)}${opNumber('Costo S/ por ' + ing.unit, `cost_${i}`, l.unitCost, true)}${opInput('Lote (opcional)', `lot_${i}`, 'text', '', false)}${opInput('Vencimiento (opcional)', `expiry_${i}`, 'date', '', false)}</div></fieldset>` : ''; }).join('')}${opSave('Confirmar recepción')}</form>` : ''}<div class="card"><h2>Recepciones registradas</h2>${opTable(['Fecha', 'Compra', 'Comprobante', 'Costo recibido', 'Acciones'], [...s.receptions].reverse().map(r => [esc(r.date), s.orders.find(o => o.id === r.orderId)?.number, esc(r.reference || '—'), S(sum(r.lines.map(l => l.quantity * l.unitCost))),opRecordActions('receptions',r.id)]))}</div>`;
  }); },
  Inventario() { return opShell('Inventario', 'Existencias, costos promedio y trazabilidad de cada entrada y salida.', () => {
    const s = OPS.state, known = s.ingredients.filter(i => i.cost != null), unknown = s.ingredients.length - known.length;
    return `<div class="grid"><div class="card"><div class="k">Valor de existencias con costo conocido</div><div class="v">${S(sum(known.map(i => OpsCore.stock(s, i.id) * i.cost)))}</div><div class="k">${unknown} insumos aún sin costo</div></div><div class="card"><div class="k">Insumos bajo mínimo</div><div class="v">${s.ingredients.filter(i => OpsCore.stock(s, i.id) < i.minimum).length}</div></div></div><div class="notice">Las recepciones aumentan el stock; los consumos y mermas lo reducen. Registra el consumo real desde esta pantalla: importar ventas de Loyverse todavía no descuenta insumos automáticamente.</div><div class="card">${opTable(['Insumo', 'Existencia', 'Mínimo', 'Costo promedio', 'Valor', 'Estado', 'Acciones'], s.ingredients.map(i => { const qty = OpsCore.stock(s, i.id); return [esc(i.name), opQuantity(qty) + ' ' + i.unit, opQuantity(i.minimum) + ' ' + i.unit, i.cost == null ? 'Sin costo' : S(i.cost) + ' / ' + i.unit, i.cost == null ? 'Sin costo' : S(qty * i.cost), qty < i.minimum ? '<strong class="dn">Bajo mínimo</strong>' : 'Disponible',opRecordActions('ingredients',i.id)]; }))}</div><div class="grid g2"><form data-op="ingredient" class="card op-form" onsubmit="opForm(event,'ingredient')"><h2>Nuevo insumo</h2><div class="op-fields">${opInput('Nombre del insumo', 'name')}<label>Unidad base<select name="unit" aria-label="Unidad base"><option value="kg">kg</option><option value="l">l</option><option value="un">un</option></select></label>${opNumber('Stock mínimo', 'minimum', 0, true)}</div>${opSave('Crear insumo')}</form>${s.ingredients.length ? `<form data-op="count" class="card op-form" onsubmit="opForm(event,'count')"><h2>Stock inicial / ajuste por conteo</h2><p class="k">Ingresa el total que contaste, no la diferencia. Si aumenta el stock, indica el costo por unidad base de ese ingreso.</p><div class="op-fields">${opIngredients()}${opNumber('Existencia contada (unidad base)', 'quantity', '', true)}${opNumber('Costo del ingreso por unidad base', 'unitCost', '', true)}${opDate()}${opInput('Motivo del ajuste', 'note')}</div>${opSave('Registrar conteo')}</form><form data-op="usage" class="card op-form" onsubmit="opForm(event,'usage')"><h2>Salida por consumo</h2><div class="op-fields">${opIngredients()}${opNumber('Cantidad consumida', 'quantity')}${opUnits('unit')}${opDate()}${opInput('Motivo / turno / referencia', 'note')}</div>${opSave('Registrar consumo')}</form>` : ''}</div><div class="card"><h2>Movimientos de inventario</h2>${opTable(['Fecha', 'Tipo', 'Insumo', 'Cantidad', 'Costo movimiento', 'Detalle', 'Acciones'], [...s.movements].reverse().map(m => { const ing = s.ingredients.find(i => i.id === m.ingredientId); return [esc(m.date), esc(m.kind), esc(ing?.name), opQuantity(m.quantity) + ' ' + ing?.unit, m.unitCost == null ? 'Sin costo' : S(m.quantity * m.unitCost), esc([m.note, m.lot && 'Lote ' + m.lot, m.expiry && 'Vence ' + m.expiry].filter(Boolean).join(' · ')),opRecordActions('movements',m.id)]; }))}</div>`;
  }); },
  Mermas() { return opShell('Mermas', 'Registra pérdidas con cantidad, fecha, motivo y costo al momento de la salida.', () => {
    const s = OPS.state, losses = s.movements.filter(m => m.kind === 'Merma');
    return `<div class="grid"><div class="card"><div class="k">Costo conocido de mermas de insumos · todo el historial</div><div class="v">${S(Math.abs(sum(losses.map(m => m.quantity * (m.unitCost || 0)))))}</div><div class="k">${losses.length} registros${losses.some(m=>m.unitCost==null)?' · Hay insumos sin costo':''}</div></div></div>${s.ingredients.length ? `<form data-op="waste" class="card op-form" onsubmit="opForm(event,'waste')"><h2>Nueva merma</h2><div class="op-fields">${opIngredients()}${opNumber('Cantidad perdida', 'quantity')}${opUnits('unit')}${opDate()}${opInput('Motivo de la merma', 'note')}</div>${opSave('Registrar merma')}</form>` : '<div class="notice">Primero crea insumos y registra sus existencias en Inventario.</div>'}<div class="card">${opTable(['Fecha', 'Insumo', 'Cantidad perdida', 'Costo', 'Motivo', 'Acciones'], [...losses].reverse().map(m => { const i = s.ingredients.find(x => x.id === m.ingredientId); return [esc(m.date), esc(i.name), opQuantity(-m.quantity) + ' ' + i.unit, m.unitCost == null ? 'Sin costo' : S(-m.quantity * m.unitCost), esc(m.note),opRecordActions('movements',m.id)]; }))}</div>`;
  }); },
  Escandallos() { return opShell('Escandallos', 'Recetas vinculadas al catálogo de Loyverse y costo por porción con rendimientos.', () => {
    const s = OPS.state, recipe = s.recipes.find(r => r.productKey === opRecipe);
    return `<div class="card"><label>Producto de Loyverse<select aria-label="Producto de Loyverse" onchange="opSelectRecipe(this.value)"><option value="">Elegir producto</option>${Object.entries(s.sales.prods).sort((a,b) => a[1].n.localeCompare(b[1].n)).map(([k,p]) => `<option value="${esc(k)}" ${k === opRecipe ? 'selected' : ''}>${esc(p.n)}</option>`).join('')}</select></label>${!Object.keys(s.sales.prods).length ? '<p class="k">Sincroniza Loyverse para cargar los productos.</p>' : ''}</div>${opRecipe ? `<form data-op="recipe" class="card op-form" onsubmit="opForm(event,'recipe')"><h2>${recipe ? 'Editar receta' : 'Nueva receta'} · ${esc(s.sales.prods[opRecipe]?.n)}</h2><div class="op-fields">${opNumber('Porciones que rinde la receta', 'portions', 1)}</div><p class="k">Cantidad neta = lo que lleva la preparación. Rendimiento: 100% sin pérdida técnica; 80% si de 1 kg comprado aprovechas 800 g. Costo por porción = suma(cantidad neta ÷ rendimiento × costo promedio) ÷ porciones. Las mermas registradas no vuelven a sumarse a esta fórmula.</p>${opLineForm('recipe')}${opSave('Guardar receta')}</form>` : opRecipe ? '<div class="notice">Crea primero los insumos en Inventario.</div>' : ''}<div class="card"><h2>Recetas guardadas</h2>${opTable(['Producto', 'Porciones', 'Insumos', 'Costo por porción', 'Rinde con tu stock', 'Acción'], s.recipes.map(r => [esc(s.sales.prods[r.productKey]?.n || r.productKey), opQuantity(r.portions), r.lines.length, OpsCore.recipeCost(s, r) == null ? 'Faltan costos de insumos' : S(OpsCore.recipeCost(s, r)), typeof Restaurant==='undefined'?'—':Restaurant.capacity(s,r)+' platos', opRecordActions('recipes',r.id)]))}</div>`;
  }); },
  Rentabilidad() { return opShell('Rentabilidad', 'Ventas reales de Loyverse y margen teórico con el costo actual de tus recetas.', () => {
    const s = OPS.state, vs = sel(P.k), L = lines(vs);
    const rows = PROD.map(p => {
      const recipe = s.recipes.find(r => r.productKey === p.key), cost = recipe ? OpsCore.recipeCost(s, recipe) : null;
      const sold = L.filter(l => l.p === p.id), qty = sum(sold.map(l => l.q)), net = sum(sold.map(l => l.t));
      return { ...p, cost, recipe, qty, net };
    });
    const covered = rows.filter(r => r.cost != null), missing = rows.filter(r => r.qty && r.cost == null);
    deferCharts(() => chart('recipeMargins', 'bar', covered.filter(r => r.p > 0).map(r => r.n), covered.filter(r => r.p > 0).map(r => Core.round((r.p-r.cost)/r.p*100)), 'Margen teórico %', { indexAxis: 'y' }));
    return `${period()}${resumen(vs)}<div class="notice">El beneficio bruto anterior usa los costos históricos de los recibos. El margen por escandallo usa el costo promedio actual de tus insumos: es una estimación, puede cambiar con las compras y no incluye personal, alquiler ni otros gastos.</div><div class="grid"><div class="card"><div class="k">Productos con receta y costos completos</div><div class="v">${covered.length} / ${rows.length}</div></div><div class="card"><div class="k">Margen teórico de ventas con receta · período</div><div class="v">${covered.length ? S(sum(covered.map(r => r.net - r.qty*r.cost))) : 'Sin recetas costeadas'}</div><div class="k">${missing.length} productos vendidos sin costo completo; excluidos del cálculo.</div></div></div><div class="card"><h2>Margen teórico por producto</h2><canvas id="recipeMargins"></canvas></div><div class="card">${opTable(['Producto', 'Precio catálogo', 'Costo receta / porción', 'Margen por porción', 'Margen %', 'Unidades netas · período', 'Ingreso neto · período', 'Acciones'], rows.map(r => [`<strong class="product-name">${esc(r.n)}</strong>`, S(r.p), r.cost == null ? r.recipe ? 'Faltan costos de insumos' : 'Sin receta' : S(r.cost), r.cost == null ? '—' : S(r.p-r.cost), r.cost == null || !r.p ? '—' : ((r.p-r.cost)/r.p*100).toFixed(1)+'%', opQuantity(r.qty), S(r.net),r.recipe?opRecordActions('recipes',r.recipe.id):`<button class="pill" data-key="${esc(r.key)}" onclick="view='Escandallos';opSelectRecipe(this.dataset.key)">Crear receta</button>`]))}</div>`;
  }); }
};
