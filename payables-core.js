// Supplier accounts are bookkeeping records; no payment is sent to a bank or provider.
(() => {
  const C=()=>globalThis.MisturaCore,O=()=>globalThis.MisturaOperations;
  const money=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
  const categories=Object.freeze(['Pescado','Verduras','Pulpo','Servicios','Abarrotes','Conchas negras','Sin categoría']);
  function supplierCategory(supplier){
    if(supplier.category!=null)return supplier.category;
    const name=String(supplier.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
    const rules=[['Pescado',/\bpescados?\b/],['Verduras',/\bverduras?\b/],['Pulpo',/\bpulpos?\b/],['Servicios',/\b(?:gas|agua|llamagas)\b/],['Abarrotes',/\babarrotes\b/],['Conchas negras',/\bconchas?\s+negras?\b/]];
    const matches=rules.filter(([,pattern])=>pattern.test(name));
    return matches.length===1?matches[0][0]:'Sin categoría';
  }
  function prepareCategories(s){for(const supplier of s.suppliers)if(supplier.category==null)supplier.category=supplierCategory(supplier)}
  function calendar(value,label,fail){
    const day=String(value||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T12:00:00Z'))||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)fail(label+': indica una fecha válida.');
    return day;
  }
  function amount(value,h){
    const n=h.num(value,'Importe');
    if(Math.abs(Number(value)-money(Number(value)))>1e-7)h.fail('El importe admite como máximo dos decimales.');
    return money(n);
  }
  function supplierTerms(p,previous,h){
    const paymentMode=p.paymentMode??previous?.paymentMode??'Contado';
    if(!['Contado','Crédito'].includes(paymentMode))h.fail('Condición de pago inválida.');
    const creditDays=paymentMode==='Crédito'?h.num(p.creditDays??previous?.creditDays??7,'Días de crédito'):0;
    if(!Number.isInteger(creditDays)||creditDays>365)h.fail('El crédito debe tener entre 1 y 365 días.');
    return {paymentMode,creditDays,paymentNotes:h.text(p.paymentNotes??previous?.paymentNotes,'Condiciones adicionales',true)};
  }
  function receptionTerms(s,r,p,h){
    const order=h.find(s.orders,r.orderId,'Compra'),supplier=h.find(s.suppliers,order.supplierId,'Proveedor');
    const paymentMode=p.paymentMode||r.paymentMode||supplier.paymentMode||'Contado';
    if(!['Contado','Crédito'].includes(paymentMode))h.fail('Condición de pago inválida.');
    const dueDate=paymentMode==='Contado'?r.date:calendar(p.dueDate||r.dueDate||C().shiftDay(r.date,supplier.creditDays||7),'Vencimiento',h.fail);
    if(dueDate<r.date)h.fail('El vencimiento no puede ser anterior a la recepción.');
    return {paymentMode,dueDate};
  }
  function accounts(s,today=C().dateKey()){
    const records=s.receptions.map(r=>{
      const order=s.orders.find(o=>o.id===r.orderId);
      return {id:'reception/'+r.id,entity:'receptions',recordId:r.id,supplierId:order?.supplierId,orderId:order?.id,orderNumber:order?.number,date:r.date,reference:r.reference||'',amount:money(r.lines.reduce((n,l)=>n+l.quantity*l.unitCost,0)),paymentMode:r.paymentMode||'',dueDate:r.dueDate||'',confirmed:Boolean(r.paymentMode&&r.dueDate),kind:'Mercadería recibida'};
    }).concat((s.supplierDebts||[]).map(d=>({id:'debt/'+d.id,entity:'supplierDebts',recordId:d.id,supplierId:d.supplierId,date:d.date,reference:d.reference,amount:d.amount,dueDate:d.dueDate,paymentMode:'Saldo anterior',confirmed:true,kind:'Deuda anterior'})));
    return records.map(a=>{
      const paid=money((s.supplierPayments||[]).filter(p=>p.accountId===a.id).reduce((n,p)=>n+p.amount,0)),balance=money(a.amount-paid);
      return {...a,paid,balance,status:!a.confirmed?'Por confirmar':balance<=0?'Pagada':a.dueDate<today?'Vencida':a.dueDate===today?'Vence hoy':'Pendiente'};
    });
  }
  function summary(s,supplierId,today){
    const list=accounts(s,today).filter(a=>!supplierId||a.supplierId===supplierId),confirmed=list.filter(a=>a.confirmed);
    return {accounts:list,pending:money(confirmed.reduce((n,a)=>n+Math.max(0,a.balance),0)),overdue:money(confirmed.filter(a=>a.status==='Vencida').reduce((n,a)=>n+a.balance,0)),paid:money(confirmed.reduce((n,a)=>n+a.paid,0)),unconfirmed:list.filter(a=>!a.confirmed).length,received:money(list.filter(a=>a.entity==='receptions').reduce((n,a)=>n+a.amount,0))};
  }
  function validate(s,h){
    prepareCategories(s);
    if(s.suppliers.some(p=>!categories.includes(p.category)))h.fail('Categoría de proveedor inválida.');
    const list=accounts(s),seen=new Set();
    for(const debt of s.supplierDebts||[]){
      h.find(s.suppliers,debt.supplierId,'Proveedor de la deuda');
      const key=debt.supplierId+'/'+debt.reference.toLocaleLowerCase();
      if(seen.has(key)||list.some(a=>a.entity==='receptions'&&a.supplierId===debt.supplierId&&a.reference&&a.reference.toLocaleLowerCase()===debt.reference.toLocaleLowerCase()))h.fail('Ese comprobante ya está registrado. No dupliques una compra como deuda anterior.');
      seen.add(key);
    }
    for(const reception of s.receptions)if(reception.paymentMode){
      if(!['Contado','Crédito'].includes(reception.paymentMode)||!reception.dueDate||reception.dueDate<reception.date)h.fail('Revisa las condiciones y el vencimiento de la recepción.');
    }
    for(const payment of s.supplierPayments||[]){
      const account=h.find(list,payment.accountId,'Cuenta del abono');
      if(!account.confirmed)h.fail('Confirma la cuenta antes de registrar abonos.');
      if(payment.supplierId!==account.supplierId)h.fail('La compra tiene abonos de otro proveedor. Corrige esos abonos antes de reasignarla.');
      if(payment.date<account.date)h.fail('El abono no puede ser anterior a la deuda.');
    }
    if(list.some(a=>a.balance<0))h.fail('Los abonos superarían el importe de la deuda. Corrige primero sus abonos.');
  }
  function apply(s,command,now,h){
    const p=command.payload||{};
    if(command.type==='supplierPayment'){
      const account=h.find(accounts(s),p.accountId,'Cuenta por pagar');
      if(!account.confirmed)h.fail('Confirma las condiciones de esta cuenta antes de registrar un abono.');
      const date=h.date(p.date,now);if(date<account.date)h.fail('El abono no puede ser anterior a la deuda.');
      const method=h.text(p.method,'Medio de pago');if(!['Efectivo','Transferencia','Yape','Plin','Otro'].includes(method))h.fail('Medio de pago inválido.');
      const record={accountId:account.id,supplierId:account.supplierId,amount:amount(p.amount,h),date,method,reference:h.text(p.reference,'Referencia del abono',true),note:h.text(p.note,'Nota',true),updatedAt:now};
      if(p.id)Object.assign(h.find(s.supplierPayments,p.id,'Abono'),record);else s.supplierPayments.push({id:command.id,createdAt:now,...record});
      return true;
    }
    if(command.type==='supplierDebt'){
      h.find(s.suppliers,p.supplierId,'Proveedor');const date=h.date(p.date,now),dueDate=calendar(p.dueDate,'Vencimiento',h.fail);
      if(dueDate<date)h.fail('El vencimiento no puede ser anterior a la deuda.');
      const record={supplierId:p.supplierId,date,dueDate,amount:amount(p.amount,h),reference:h.text(p.reference,'Comprobante o referencia'),note:h.text(p.note,'Nota',true),updatedAt:now};
      if(p.id)Object.assign(h.find(s.supplierDebts,p.id,'Deuda anterior'),record);else s.supplierDebts.push({id:command.id,createdAt:now,...record});
      return true;
    }
    if(command.type==='payableTerms'){
      const reception=h.find(s.receptions,p.id,'Recepción');Object.assign(reception,receptionTerms(s,reception,p,h),{paymentUpdatedAt:now});return true;
    }
    return false;
  }
  function after(s,previous,command,now,h){
    const p=command.payload||{};
    if(command.type==='supplier'){
      const old=previous.suppliers.find(x=>x.id===p.id),category=p.category??(old?supplierCategory(old):'Sin categoría');
      if(!categories.includes(category))h.fail('Categoría de proveedor inválida.');
      Object.assign(h.find(s.suppliers,p.id||command.id,'Proveedor'),supplierTerms(p,old,h),{category});
    }
    if(command.type==='receive'){
      const r=h.find(s.receptions,command.id,'Recepción');Object.assign(r,receptionTerms(s,r,p,h),{paymentUpdatedAt:now});
    }
    if(command.type==='editReception'){
      const r=h.find(s.receptions,p.id,'Recepción');if(r.paymentMode==='Contado')r.dueDate=r.date;
    }
  }
  function supplies(s,supplierId){
    const records={};
    for(const i of s.ingredients)if(i.supplierId===supplierId)records[i.id]={ingredientId:i.id,quantity:0,lastCost:null,lastDate:''};
    for(const r of s.receptions.filter(r=>s.orders.find(o=>o.id===r.orderId)?.supplierId===supplierId).sort((a,b)=>a.date.localeCompare(b.date)||String(a.createdAt).localeCompare(String(b.createdAt))))for(const l of r.lines){
      const record=records[l.ingredientId]||={ingredientId:l.ingredientId,quantity:0,lastCost:null,lastDate:''};record.quantity=O().round(record.quantity+l.quantity);record.lastCost=l.unitCost;record.lastDate=r.date;
    }
    return Object.values(records);
  }
  globalThis.MisturaPayables={accounts,summary,apply,after,validate,supplies,categories,supplierCategory};
})();
