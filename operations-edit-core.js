// Editing/deletion rules shared by the server and the deletion preview.
(() => {
  const collections = ['suppliers', 'ingredients', 'orders', 'receptions', 'movements', 'recipes','reservations','preparedWastes','supplierDebts','supplierPayments','supplierCategories'];
  function prepare(s) {
    s.reservations ||= [];s.preparedWastes ||= [];s.supplierDebts ||= [];s.supplierPayments ||= [];s.supplierCategories ||= [];
    const balances = {};
    for (const m of s.movements) {
      const before = balances[m.ingredientId] || 0;
      if (m.kind === 'Conteo' && m.countedQuantity == null) {
        m.countedQuantity = Math.round((before + m.quantity + Number.EPSILON) * 1e4) / 1e4;
        m.inputCost = m.quantity > 0 ? m.unitCost : null;
      }
      balances[m.ingredientId] = Math.round((before + m.quantity + Number.EPSILON) * 1e4) / 1e4;
    }
    // Stable posting positions make restoring an older receipt independent of later deletions.
    let last = 0;
    for (const m of s.movements) { if (m.sequence == null) m.sequence = Math.max(s.nextMovementSequence || 1,last + 1); last = Math.max(last, m.sequence); }
    s.nextMovementSequence = Math.max(s.nextMovementSequence || 1, last + 1);
  }
  function recalculate(s, { fail, find, round }) {
    const balances = {}, costs = {},automaticDelta={};
    for (const c of ['suppliers','ingredients']) {
      const names = s[c].map(r => r.name.toLocaleLowerCase());
      if(new Set(names).size !== names.length) fail('Ya existe otro registro con ese nombre. Edítalo antes de restaurar.');
    }
    if(new Set(s.recipes.map(r => r.productKey)).size !== s.recipes.length) fail('Ese producto ya tiene una receta. Corrige la receta actual antes de restaurar la anterior.');
    for (const m of s.movements) if(m.sequence == null) m.sequence = s.nextMovementSequence++;
    s.movements.sort((a,b) => a.sequence - b.sequence);
    for (const order of s.orders) {
      find(s.suppliers, order.supplierId, 'Proveedor de la compra');
      for (const line of order.lines) {
        find(s.ingredients, line.ingredientId, 'Insumo de la compra');
        line.received = round(s.receptions.filter(r => r.orderId === order.id).reduce((total, r) => total + r.lines.filter(l => l.lineId === line.id).reduce((n, l) => n + l.quantity, 0), 0));
        if (line.received > line.quantity) fail('La compra no puede quedar con menos cantidad que la ya recibida. Edita sus recepciones primero.');
      }
      if (order.status === 'Anulada' && order.lines.some(l => l.received)) fail('Una compra anulada no puede tener recepciones.');
      if (order.status !== 'Anulada') order.status = order.lines.every(l => l.received >= l.quantity) ? 'Recibida' : order.lines.some(l => l.received > 0) ? 'Parcial' : 'Pendiente';
    }
    for (const r of s.receptions) {
      const order = find(s.orders, r.orderId, 'Compra de la recepción');
      if (r.date < order.date) fail('La fecha de compra no puede quedar después de una recepción.');
      for (const line of r.lines) {
        const ordered = find(order.lines, line.lineId, 'Línea de compra recibida');
        if (ordered.ingredientId !== line.ingredientId) fail('No puedes cambiar un insumo ya recibido. Edita o elimina primero esa recepción.');
      }
    }
    for (const m of s.movements) {
      const ingredient = find(s.ingredients, m.ingredientId, 'Insumo del movimiento'), before = balances[ingredient.id] || 0;
      let cost = costs[ingredient.id] ?? null;
      if (m.kind === 'Recepción') {
        const receipt = find(s.receptions, m.receptionId, 'Recepción del movimiento');
        const line = receipt.lines.find(l => l.ingredientId === m.ingredientId) || fail('Movimiento sin línea de recepción.');
        Object.assign(m, { quantity: line.quantity, unitCost: line.unitCost, date: receipt.date, note: receipt.reference, lot: line.lot, expiry: line.expiry, orderId: receipt.orderId });
        cost = round((Math.max(0,before) * (cost || 0) + m.quantity * m.unitCost) / (Math.max(0,before) + m.quantity), 6);
      } else if(m.kind==='Stock'){
        m.quantity=round(m.countedQuantity-before);m.unitCost=m.inputCost;cost=m.inputCost;automaticDelta[ingredient.id]=0;
      } else if (m.kind === 'Conteo') {
        m.quantity = round(m.countedQuantity - before);
        if (m.quantity > 0) {
          if (m.inputCost == null) fail('Un conteo posterior ahora aumenta el stock. Edita ese conteo e indica el costo del ingreso antes de cambiar la recepción.');
          m.unitCost = m.inputCost;
          cost = round((Math.max(0,before) * (cost || 0) + m.quantity * m.unitCost) / (Math.max(0,before)+m.quantity), 6);
        } else m.unitCost = cost;
        automaticDelta[ingredient.id]=0;
      } else if (['Merma', 'Consumo','Venta'].includes(m.kind)){m.unitCost = cost;if(m.kind==='Venta')automaticDelta[ingredient.id]=(automaticDelta[ingredient.id]||0)+m.quantity}
      else fail('Tipo de movimiento inválido.');
      const after = round(before + m.quantity);
      if (after < 0 && m.kind!=='Venta' && m.kind!=='Stock' && round(after-(automaticDelta[ingredient.id]||0))<0) fail(`El cambio dejaría ${ingredient.name} con stock negativo en ${m.kind.toLowerCase()} del ${m.date}. Corrige o elimina primero esa salida.`);
      balances[ingredient.id] = after; costs[ingredient.id] = cost;
    }
    for (const ingredient of s.ingredients) ingredient.cost = costs[ingredient.id] ?? null;
    for (const recipe of s.recipes) for (const line of recipe.lines) find(s.ingredients, line.ingredientId, 'Insumo de la receta');
    globalThis.MisturaPayables?.validate(s,{fail,find});
  }
  function deletion(s, entity, targetId, { fail, find }) {
    if (!collections.includes(entity)) fail('Registro no eliminable.');
    const target = find(s[entity], targetId, 'Registro'), bundle = Object.fromEntries(collections.map(c => [c, []]));
    if(entity==='supplierCategories'&&s.suppliers.some(p=>p.category===target.name))fail('Esta categoría está asignada a proveedores. Cámbialos a otra categoría antes de eliminarla.');
    if (entity === 'suppliers' && s.orders.some(o => o.supplierId === targetId)) fail('Este proveedor tiene compras. Reasigna o elimina esas compras antes de eliminar el proveedor.');
    if (entity === 'suppliers' && s.ingredients.some(i => i.supplierId === targetId)) fail('Este proveedor está asignado a insumos. Cambia su proveedor desde Inventario antes de eliminarlo.');
    if(entity==='suppliers'&&s.supplierDebts.some(d=>d.supplierId===targetId))fail('Este proveedor tiene deudas anteriores registradas. Corrígelas o elimínalas primero.');
    const accountIds=entity==='supplierDebts'?['debt/'+targetId]:entity==='receptions'?['reception/'+targetId]:entity==='orders'?s.receptions.filter(r=>r.orderId===targetId).map(r=>'reception/'+r.id):[];
    if(s.supplierPayments.some(p=>accountIds.includes(p.accountId)))fail('Esta cuenta tiene pagos. Corrige o elimina sus pagos antes de eliminar la deuda o la compra.');
    if (entity === 'ingredients' && (s.orders.some(o => o.lines.some(l => l.ingredientId === targetId)) || s.movements.some(m => m.ingredientId === targetId&&m.kind==='Venta') || s.recipes.some(r => r.lines.some(l => l.ingredientId === targetId)))) fail('Este insumo tiene compras, ventas o recetas. Corrige o elimina los registros relacionados antes de eliminar el insumo.');
    if(entity==='movements'&&target.kind==='Venta')fail('El consumo viene de Loyverse. Corrige el stock físico desde Inventario.');
    if (entity === 'movements' && target.kind === 'Recepción') return deletion(s, 'receptions', target.receptionId, { fail, find });
    bundle[entity] = [structuredClone(target)];
    if(entity==='ingredients')bundle.movements=s.movements.filter(m=>m.ingredientId===targetId).map(m=>structuredClone(m));
    if (entity === 'orders') bundle.receptions = s.receptions.filter(r => r.orderId === targetId).map(r => structuredClone(r));
    const receiptIds = new Set(bundle.receptions.map(r => r.id));
    if (receiptIds.size) bundle.movements = s.movements.filter(m => receiptIds.has(m.receptionId)).map(m => structuredClone(m));
    const positions = {};
    for (const c of collections) {
      positions[c] = bundle[c].map(record => ({ id: record.id, index: s[c].findIndex(r => r.id === record.id) }));
      const ids = new Set(bundle[c].map(r => r.id)); s[c] = s[c].filter(r => !ids.has(r.id));
    }
    return { bundle, positions, entity, targetId, label: target.name || (entity === 'orders' ? 'Compra ' + target.number : target.reference || target.note || (entity === 'recipes' ? s.sales.prods[target.productKey]?.n : target.date)) || 'Registro' };
  }
  function apply(s, command, now, helpers) {
    const { fail, find, text, num, date, unitQuantity } = helpers, p = command.payload || {}, id = command.id;
    if (command.type === 'delete') {
      const removal = deletion(s, p.entity, p.targetId, helpers);
      (s.trash ||= []).push({ id, at: now, ...removal });
    } else if (command.type === 'restore') {
      const entry = find(s.trash || [], p.trashId, 'Registro en papelera');
      for (const c of collections) for (const record of entry.bundle[c] || []) {
        if (s[c].some(r => r.id === record.id)) fail('Ya existe un registro con el mismo identificador.');
        const index = entry.positions[c]?.find(x => x.id === record.id)?.index ?? s[c].length;
        s[c].splice(Math.min(index, s[c].length), 0, structuredClone(record));
      }
      s.trash = s.trash.filter(t => t.id !== entry.id);
    } else if (command.type === 'editOrder') {
      const order = find(s.orders, p.id, 'Compra');
      find(s.suppliers, p.supplierId, 'Proveedor');
      if (!Array.isArray(p.lines) || !p.lines.length || p.lines.length > 100) fail('La compra necesita entre 1 y 100 insumos.');
      const seen = new Set();
      const lines = p.lines.map((line, index) => {
        const ingredient = find(s.ingredients, line.ingredientId, 'Insumo');
        if (seen.has(ingredient.id)) fail('No repitas el mismo insumo en una compra.'); seen.add(ingredient.id);
        const old = order.lines.find(l => l.id === line.id) || order.lines.find(l => l.ingredientId === ingredient.id);
        return { id: old?.id || id + '/' + index, ingredientId: ingredient.id, quantity: unitQuantity(ingredient, line.quantity, line.unit), unitCost: num(line.unitCost, 'Costo por unidad base', true), received: 0 };
      });
      Object.assign(order, { supplierId: p.supplierId, date: date(p.date, now), reference: text(p.reference, 'Referencia', true), lines, updatedAt: now });
      if (order.status === 'Anulada') order.status = 'Pendiente';
    } else if (command.type === 'editReception') {
      const r = find(s.receptions, p.id, 'Recepción'), order = find(s.orders, p.orderId || r.orderId, 'Compra');
      if (order.status === 'Anulada') fail('Edita primero la compra anulada.');
      if (!Array.isArray(p.lines) || !p.lines.length || p.lines.length > 100) fail('Indica al menos un insumo recibido. Para quitar toda la recepción usa Eliminar.');
      const seen = new Set(), day = date(p.date, now);
      const lines = p.lines.map(line => {
        if (seen.has(line.lineId)) fail('Línea de recepción duplicada.'); seen.add(line.lineId);
        const ordered = find(order.lines, line.lineId, 'Línea de compra');
        const expiry = text(line.expiry, 'Vencimiento', true);
        if (expiry && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || new Date(expiry + 'T12:00:00Z').toISOString().slice(0,10) !== expiry || expiry < day)) fail('Vencimiento inválido o anterior a la recepción.');
        return { lineId: ordered.id, ingredientId: ordered.ingredientId, quantity: num(line.quantity, 'Cantidad recibida'), unitCost: num(line.unitCost, 'Costo por unidad base', true), lot: text(line.lot, 'Lote', true), expiry };
      });
      const before = s.movements.filter(m => m.receptionId === r.id), position = s.movements.findIndex(m => m.receptionId === r.id);
      const firstSequence = before[0]?.sequence ?? s.nextMovementSequence++;
      // Reserve the interval of this reception so adding a line keeps its original posting time.
      const later = [...s.movements, ...(s.trash || []).flatMap(t => t.bundle.movements || [])].filter(m => m.receptionId !== r.id && m.sequence > firstSequence).map(m => m.sequence);
      const nextSequence = later.length ? Math.min(...later) : Math.max(firstSequence + 1, s.nextMovementSequence);
      Object.assign(r, { orderId: order.id, date: day, reference: text(p.reference, 'Comprobante', true), lines, updatedAt: now });
      const replacement = lines.map((line, index) => ({ id: before.find(m => m.ingredientId === line.ingredientId)?.id || id + '/receipt/' + index, postedAt: r.createdAt, sequence: firstSequence + (nextSequence - firstSequence) * index / lines.length, ingredientId: line.ingredientId, kind: 'Recepción', receptionId: r.id, quantity: line.quantity, unitCost: line.unitCost }));
      s.movements = s.movements.filter(m => m.receptionId !== r.id);
      s.movements.splice(position < 0 ? s.movements.length : position, 0, ...replacement);
    } else if (command.type === 'editMovement') {
      const m = find(s.movements, p.id, 'Movimiento');
      if (m.kind === 'Recepción') fail('Edita la recepción vinculada a este movimiento.');
      const ingredient = find(s.ingredients, p.ingredientId, 'Insumo');
      if (m.kind === 'Conteo') {
        m.countedQuantity = num(p.quantity, 'Existencia contada', true);
        m.inputCost = num(p.unitCost, 'Costo del ingreso', true);
      } else {
        if (!['Merma', 'Consumo'].includes(p.kind)) fail('Tipo de salida inválido.');
        m.kind = p.kind; m.quantity = -unitQuantity(ingredient, p.quantity, p.unit);
      }
      Object.assign(m, { ingredientId: ingredient.id, date: date(p.date, now), note: text(p.note, 'Motivo'), updatedAt: now });
    } else return false;
    return true;
  }
  globalThis.MisturaEdits = { prepare, recalculate, apply };
})();
