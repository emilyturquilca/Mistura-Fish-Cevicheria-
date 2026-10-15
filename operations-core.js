// Shared business rules. Quantities are stored in kg, l or units; costs in PEN.
(() => {
  const round = (n, decimals = 4) => Math.round((Number(n) + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;
  const fail = message => { throw new Error(message); };
  const text = (v, label, optional = false) => {
    const s = String(v ?? '').trim();
    if ((!s && !optional) || s.length > 300) fail(label + ': revisa el texto (máximo 300 caracteres).');
    return s;
  };
  const num = (v, label, zero = false) => {
    if (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) > 1e8 || Number(v) < 0 || (!zero && Number(v) === 0)) fail(label + ': ingresa un número ' + (zero ? 'mayor o igual a cero.' : 'mayor que cero.'));
    const n = round(Number(v)); if (!zero && n === 0) fail(label + ': cantidad demasiado pequeña.'); return n;
  };
  const initial = () => ({ schema: 1, suppliers: [], ingredients: [], orders: [], receptions: [], movements: [], recipes: [], commands: [], sales: { v: {}, prods: {}, sync: null } });
  const find = (items, id, label) => items.find(x => x.id === id) || fail(label + ' no encontrado.');
  const stock = (s, id) => round(s.movements.filter(m => m.ingredientId === id).reduce((n, m) => n + m.quantity, 0));
  function unitQuantity(ingredient, quantity, unit) {
    const units = { kg: ['mass', 1], g: ['mass', .001], l: ['volume', 1], ml: ['volume', .001], un: ['unit', 1] };
    if (!units[unit] || !units[ingredient.unit] || units[unit][0] !== units[ingredient.unit][0]) fail('La unidad no corresponde al insumo.');
    return num(num(quantity, 'Cantidad') * units[unit][1], 'Cantidad convertida');
  }
  const date = (value, now) => {
    const d = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) !== d || d > globalThis.MisturaCore.dateKey(now)) fail('Fecha inválida o futura.');
    return d;
  };
  function recipeCost(s, recipe) {
    let total = 0;
    for (const line of recipe.lines) {
      const ingredient = find(s.ingredients, line.ingredientId, 'Insumo');
      if (ingredient.cost == null) return null;
      total += line.quantity / line.yield * ingredient.cost;
    }
    return round(total / recipe.portions, 2);
  }
  function apply(current, command, now = new Date().toISOString()) {
    const s = structuredClone(current), p = command.payload || {}, id = text(command.id, 'Identificador');
    if (s.commands.some(c => c.id === id)) return { state: s, duplicate: true };
    globalThis.MisturaEdits.prepare(s);
    const key = suffix => id + suffix;
    const day = () => date(p.date, now);
    const movement = (ingredient, quantity, kind, extra = {}) => {
      s.movements.push({ id: key('/' + s.movements.length), ingredientId: ingredient.id, quantity: round(quantity), unitCost: ingredient.cost, kind, date: day(), postedAt: now, ...extra });
    };
    if (globalThis.MisturaEdits.apply(s, command, now, { fail, text, num, find, date, unitQuantity, round })) {
      // Edited and restored records are validated by the ledger replay below.
    } else if (command.type === 'supplier') {
      const name = text(p.name, 'Proveedor');
      if (s.suppliers.some(x => x.id !== p.id && x.name.toLocaleLowerCase() === name.toLocaleLowerCase())) fail('Ya existe ese proveedor.');
      const item = { id: p.id || id, name, taxId: text(p.taxId, 'RUC', true), contact: text(p.contact, 'Contacto', true), phone: text(p.phone, 'Teléfono', true) };
      if (item.taxId && !/^\d{11}$/.test(item.taxId)) fail('El RUC debe tener 11 dígitos.');
      if (p.id) Object.assign(find(s.suppliers, p.id, 'Proveedor'), item); else s.suppliers.push(item);
    } else if (command.type === 'ingredient') {
      const name = text(p.name, 'Insumo');
      if (!['kg', 'l', 'un'].includes(p.unit)) fail('Unidad base inválida.');
      if (s.ingredients.some(x => x.id !== p.id && x.name.toLocaleLowerCase() === name.toLocaleLowerCase())) fail('Ya existe ese insumo.');
      const item = { name, unit: p.unit, minimum: num(p.minimum, 'Stock mínimo', true) };
      if (p.id) {
        const old = find(s.ingredients, p.id, 'Insumo');
        if (old.unit !== p.unit && (s.movements.some(m => m.ingredientId === old.id) || s.orders.some(o => o.lines.some(l => l.ingredientId === old.id)) || s.recipes.some(r => r.lines.some(l => l.ingredientId === old.id)))) fail('La unidad base de un insumo utilizado no puede cambiar. Corrige primero sus compras, movimientos y recetas.');
        Object.assign(old, item, { updatedAt: now });
      } else s.ingredients.push({ id, ...item, cost: null });
    } else if (command.type === 'order') {
      find(s.suppliers, p.supplierId, 'Proveedor');
      if (!Array.isArray(p.lines) || !p.lines.length || p.lines.length > 100) fail('Agrega entre 1 y 100 insumos a la compra.');
      const seen = new Set();
      const lines = p.lines.map((line, index) => {
        const ingredient = find(s.ingredients, line.ingredientId, 'Insumo');
        if (seen.has(ingredient.id)) fail('No repitas el mismo insumo en una compra.'); seen.add(ingredient.id);
        return { id: key('/' + index), ingredientId: ingredient.id, quantity: unitQuantity(ingredient, line.quantity, line.unit), unitCost: num(line.unitCost, 'Costo por unidad base', true), received: 0 };
      });
      const previousNumbers = [...s.orders.map(o => o.number), ...(s.trash || []).flatMap(t => (t.bundle.orders || []).map(o => o.number))];
      const number = Math.max(s.nextOrderNumber || 1, Math.max(0,...previousNumbers) + 1); s.nextOrderNumber = number + 1;
      s.orders.push({ id, number, supplierId: p.supplierId, date: day(), reference: text(p.reference, 'Referencia', true), status: 'Pendiente', lines, createdAt: now });
    } else if (command.type === 'cancelOrder') {
      const order = find(s.orders, p.orderId, 'Compra');
      if (order.status !== 'Pendiente' || order.lines.some(l => l.received)) fail('Solo puedes anular una compra sin recepciones.');
      order.status = 'Anulada';
    } else if (command.type === 'receive') {
      const order = find(s.orders, p.orderId, 'Compra');
      if (order.status === 'Anulada' || order.status === 'Recibida') fail('La compra ya está cerrada.');
      if (day() < order.date) fail('La recepción no puede ser anterior a la compra.');
      if (!Array.isArray(p.lines) || !p.lines.length) fail('Indica las cantidades recibidas.');
      const seen = new Set(), received = [];
      for (const item of p.lines) {
        if (seen.has(item.lineId)) fail('Línea de recepción duplicada.'); seen.add(item.lineId);
        const line = find(order.lines, item.lineId, 'Línea de compra');
        const ingredient = find(s.ingredients, line.ingredientId, 'Insumo');
        const quantity = num(item.quantity, 'Cantidad recibida');
        if (quantity > round(line.quantity - line.received)) fail('La recepción supera la cantidad pendiente.');
        const unitCost = num(item.unitCost, 'Costo recibido por unidad base', true), oldStock = stock(s, ingredient.id);
        const lot = text(item.lot, 'Lote', true), expiry = text(item.expiry, 'Vencimiento', true);
        if (expiry && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || new Date(expiry + 'T12:00:00Z').toISOString().slice(0, 10) !== expiry || expiry < p.date)) fail('Vencimiento inválido o anterior a la recepción.');
        ingredient.cost = round(((oldStock * (ingredient.cost || 0)) + quantity * unitCost) / (oldStock + quantity), 6);
        line.received = round(line.received + quantity);
        movement(ingredient, quantity, 'Recepción', { orderId: order.id, receptionId: id, unitCost, lot, expiry, note: text(p.reference, 'Comprobante', true) });
        received.push({ lineId: line.id, ingredientId: ingredient.id, quantity, unitCost, lot, expiry });
      }
      order.status = order.lines.every(l => l.received >= l.quantity) ? 'Recibida' : 'Parcial';
      s.receptions.push({ id, orderId: order.id, date: day(), reference: text(p.reference, 'Comprobante', true), lines: received, createdAt: now });
    } else if (['waste', 'count', 'usage'].includes(command.type)) {
      const ingredient = find(s.ingredients, p.ingredientId, 'Insumo'), previous = stock(s, ingredient.id), note = text(p.note, 'Motivo');
      if (command.type === 'count') {
        const quantity = num(p.quantity, 'Existencia contada', true), difference = round(quantity - previous);
        if (!difference) fail('El conteo coincide con el stock. No hay ajuste que registrar.');
        if (difference > 0) {
          const cost = num(p.unitCost, 'Costo por unidad base', true);
          ingredient.cost = round((previous * (ingredient.cost || 0) + difference * cost) / quantity, 6);
          movement(ingredient, difference, 'Conteo', { note, unitCost: cost, countedQuantity: quantity, inputCost: cost });
        } else movement(ingredient, difference, 'Conteo', { note, countedQuantity: quantity, inputCost: p.unitCost == null || p.unitCost === '' ? null : num(p.unitCost, 'Costo por unidad base', true) });
      } else {
        const quantity = unitQuantity(ingredient, p.quantity, p.unit);
        if (quantity > previous) fail('No hay stock suficiente para registrar esta salida.');
        movement(ingredient, -quantity, command.type === 'waste' ? 'Merma' : 'Consumo', { note });
      }
    } else if (command.type === 'recipe') {
      const productKey = text(p.productKey, 'Producto de Loyverse');
      if (!s.sales.prods[productKey]) fail('Primero sincroniza el producto desde Loyverse.');
      if (!Array.isArray(p.lines) || !p.lines.length || p.lines.length > 100) fail('La receta necesita entre 1 y 100 insumos.');
      const seen = new Set();
      const lines = p.lines.map(line => {
        const ingredient = find(s.ingredients, line.ingredientId, 'Insumo');
        if (seen.has(ingredient.id)) fail('No repitas el mismo insumo en la receta.'); seen.add(ingredient.id);
        const yieldValue = num(line.yield, 'Rendimiento');
        if (yieldValue > 100) fail('El rendimiento no puede superar 100%.');
        return { ingredientId: ingredient.id, quantity: unitQuantity(ingredient, line.quantity, line.unit), yield: yieldValue / 100 };
      });
      const old = p.id ? find(s.recipes, p.id, 'Receta') : s.recipes.find(r => r.productKey === productKey);
      if(s.recipes.some(r => r.productKey === productKey && r.id !== old?.id)) fail('Este producto ya tiene una receta.');
      const recipe = { id: old?.id || id, productKey, portions: num(p.portions, 'Porciones'), lines, updatedAt: now, revision: (old?.revision || 0) + 1 };
      if (old) Object.assign(old, recipe); else s.recipes.push(recipe);
    } else fail('Operación no permitida.');
    globalThis.MisturaEdits.recalculate(s, { fail, find, round });
    s.commands.push({ id, type: command.type, targetId: p.id || p.targetId || null, at: now });
    return { state: s, duplicate: false };
  }
  function combineSales(shared, local, now = Date.now()) {
    const olderThan = new Date(now).getTime() - 30 * 864e5;
    const retained = Object.fromEntries(Object.entries(local?.v || {}).filter(([id, r]) =>
      !Object.hasOwn(shared.cancelledIds || {}, id) && (r.source === 'file' || new Date(r.f).getTime() < olderThan)));
    return { ...structuredClone(shared), prods: { ...(local?.prods || {}), ...shared.prods }, v: { ...retained, ...shared.v } };
  }
  globalThis.MisturaOperations = { initial, apply, stock, recipeCost, unitQuantity, round, combineSales };
})();
