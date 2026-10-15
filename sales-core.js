// Business dates and receipt amounts shared by the UI and regression tests.
(() => {
  const TIME_ZONE = 'America/Lima';
  const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const number = n => Number.isFinite(Number(n)) ? Number(n) : 0;
  function dateKey(value = new Date()) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k).value).join('-');
  }
  function dayStart(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return new Date(NaN);
    return new Date(key + 'T00:00:00-05:00');
  }
  function shiftDay(key, offset) {
    const date = dayStart(key);
    date.setUTCDate(date.getUTCDate() + offset);
    return dateKey(date);
  }
  function dateRange(period, now = new Date()) {
    const today = dateKey(now);
    let from = today, to = today;
    if (period.k === 'dia') from = to = period.day;
    else if (period.k === 'semana') from = shiftDay(today, -((dayStart(today).getUTCDay() + 6) % 7));
    else if (period.k === 'mes') from = today.slice(0, 7) + '-01';
    else if (period.k === 'anterior') {
      to = shiftDay(today.slice(0, 7) + '-01', -1);
      from = to.slice(0, 7) + '-01';
    } else if (period.k === 'custom') { from = period.from; to = period.to; }
    // Half-open intervals include every millisecond of the last selected day.
    return [dayStart(from), dayStart(shiftDay(to, 1))];
  }
  const inRange = (receipt, range) => new Date(receipt.f) >= range[0] && new Date(receipt.f) < range[1];
  function parseDate(value) {
    let text = String(value ?? '').trim();
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
    if (match) text = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}${match[4]}`;
    text = text.replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += 'T00:00:00';
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += '-05:00';
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  function normalizeReceipt(receipt, customers, products) {
    const sign = receipt.receipt_type === 'REFUND' ? -1 : 1;
    const signed = value => round(sign * Math.abs(number(value)));
    const addedTax = (receipt.total_taxes || []).filter(t => t.type === 'ADDED').reduce((s, t) => s + number(t.money_amount), 0);
    const net = round(number(receipt.total_money) - addedTax - number(receipt.tip) - number(receipt.surcharge));
    const lines = receipt.line_items || [];
    return {
      id: receipt.receipt_number, f: receipt.receipt_date || receipt.created_at,
      source: 'api', type: receipt.receipt_type, updatedAt: receipt.updated_at,
      store: receipt.store_id || '', refundFor: receipt.refund_for || '',
      cli: customers[receipt.customer_id] || 'Consumidor final',
      pay: (receipt.payments || []).map(p => p.name).join(' + ') || 'Sin dato',
      total: signed(receipt.total_money), net: signed(net),
      gross: signed(net + number(receipt.total_discount)),
      discount: signed(receipt.total_discount), addedTax: signed(addedTax),
      tip: signed(receipt.tip), surcharge: signed(receipt.surcharge),
      cost: lines.length && lines.every(l => l.cost_total != null && Number.isFinite(Number(l.cost_total)))
        ? signed(lines.reduce((s, l) => s + number(l.cost_total), 0)) : null,
      items: lines.map(line => {
        const key = line.item_id || line.item_name;
        if (!products[key]) products[key] = { n: line.item_name, c: 'Sin categoría', p: number(line.price), k: null };
        const taxes = (line.line_taxes || []).filter(t => t.type === 'ADDED').reduce((s, t) => s + number(t.money_amount), 0);
        return { k: key, q: sign * Math.abs(number(line.quantity)), t: signed(number(line.total_money) - taxes) };
      })
    };
  }
  function mergeReceipts(db, receipts, customers = {}) {
    let added = 0, updated = 0, cancelled = 0;
    for (const receipt of receipts) {
      const id = receipt.receipt_number;
      if (!id) continue;
      if (receipt.cancelled_at) {
        if (Object.hasOwn(db.v, id)) { delete db.v[id]; cancelled++; }
        continue;
      }
      if (!['SALE', 'REFUND'].includes(receipt.receipt_type)) continue;
      const next = normalizeReceipt(receipt, customers, db.prods);
      if (!parseDate(next.f)) throw new Error('Loyverse devolvió un recibo sin fecha válida.');
      if (!Object.hasOwn(db.v, id)) added++;
      else if (JSON.stringify(db.v[id]) !== JSON.stringify(next)) updated++;
      db.v[id] = next;
    }
    return { added, updated, cancelled };
  }
  function totals(receipts) {
    const result = { gross: 0, refunds: 0, discounts: 0, net: 0, paid: 0, addedTax: 0, tip: 0, surcharge: 0, cost: 0, profit: null, sales: 0, returns: 0, legacy: 0 };
    let costsKnown = receipts.length > 0;
    for (const r of receipts) {
      const refund = r.type === 'REFUND';
      const net = number(r.net ?? r.total);
      const gross = number(r.gross ?? net);
      result[refund ? 'returns' : 'sales']++;
      result[refund ? 'refunds' : 'gross'] += refund ? Math.abs(gross) : gross;
      result.net += net;
      result.paid += number(r.paid ?? r.total);
      result.discounts += number(r.discount);
      for (const key of ['addedTax', 'tip', 'surcharge']) result[key] += number(r[key]);
      if (r.net == null) result.legacy++;
      if (r.cost == null) costsKnown = false;
      else result.cost += number(r.cost);
    }
    for (const key of ['gross', 'refunds', 'discounts', 'net', 'paid', 'addedTax', 'tip', 'surcharge', 'cost']) result[key] = round(result[key]);
    if (costsKnown && !result.legacy) result.profit = round(result.net - result.cost);
    return result;
  }
  function reportRows(receipts) {
    const rows = [['N° recibo', 'Fecha y hora', 'Tipo', 'Cliente', 'Método', 'Ventas brutas', 'Descuentos', 'Ventas netas', 'Impuestos añadidos', 'Propinas', 'Recargos', 'Total cobrado', 'Costo de productos', 'Beneficio bruto']];
    for (const r of receipts) {
      const net = r.net ?? null, cost = r.cost ?? null;
      rows.push([String(r.id), new Intl.DateTimeFormat('es-PE', { timeZone: TIME_ZONE, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(r.f)), r.type === 'REFUND' ? 'Devolución' : 'Venta', r.cli, r.pay,
        r.gross ?? null, r.discount ?? null, net, r.addedTax ?? null, r.tip ?? null, r.surcharge ?? null, r.paid ?? r.total, cost, net != null && cost != null ? round(net - cost) : null]);
    }
    const t = totals(receipts);
    rows.push(['TOTAL', '', '', '', '', round(t.gross - t.refunds), t.discounts, t.legacy ? null : t.net, t.addedTax, t.tip, t.surcharge, t.paid, t.profit == null ? null : t.cost, t.profit]);
    return rows;
  }
  function hourly(receipts) {
    const buckets=Array.from({length:24},(_,hour)=>({hour,label:String(hour).padStart(2,'0')+':00',gross:0,refunds:0,discounts:0,net:0,paid:0,sales:0,returns:0}));
    const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:TIME_ZONE,hour:'2-digit',hourCycle:'h23'});
    for(const receipt of receipts){
      const date=new Date(receipt.f);if(Number.isNaN(date.getTime()))continue;
      const bucket=buckets[Number(formatter.format(date))],t=totals([receipt]);
      for(const key of ['gross','refunds','discounts','net','paid','sales','returns'])bucket[key]+=t[key];
    }
    for(const bucket of buckets)for(const key of ['gross','refunds','discounts','net','paid'])bucket[key]=round(bucket[key]);
    return buckets;
  }
  function csv(rows) {
    return '\ufeff' + rows.map(row => row.map(value => {
      const text = typeof value === 'string' && /^\s*[=+@-]/.test(value) ? "'" + value : String(value ?? '');
      return '"' + text.replaceAll('"', '""') + '"';
    }).join(',')).join('\r\n');
  }
  globalThis.MisturaCore = { TIME_ZONE, round, dateKey, dayStart, shiftDay, dateRange, inRange, parseDate, normalizeReceipt, mergeReceipts, totals, reportRows, hourly, csv };
})();
