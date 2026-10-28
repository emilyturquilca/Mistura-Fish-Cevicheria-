import '../sales-core.js';
const C=globalThis.MisturaCore;
export const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const text=(v,label,max=300)=>{const t=String(v??'').trim();if(t.length>max)fail(label+': texto demasiado largo.');return t};
export const money=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
export function prepare(s){s.onlineOrders ||= [];s.kitchenTickets ||= [];s.webShop ||= {enabled:false,items:[],deliveryFee:0,allowDelivery:false,allowCash:true};return s}
export function publicMenu(s,paymentsReady=false){
  const shop=prepare(s).webShop;
  return {enabled:shop.enabled===true,allowDelivery:shop.allowDelivery===true,allowCash:shop.allowCash!==false,deliveryFee:money(shop.deliveryFee||0),deliveryZone:shop.deliveryZone||'',notice:shop.notice||'',paymentsReady,
    items:(shop.items||[]).filter(i=>i.published&&i.available).map(i=>({id:i.id,name:i.name,category:i.category,description:i.description||'',price:i.price}))};
}
export function settings(s,p){
  if(!Array.isArray(p.items)||p.items.length>300)fail('Revisa los platos de la carta.');
  const old=prepare(s).webShop,seen=new Set();
  const items=p.items.map(i=>{
    const source=s.sales.prods[i.id];if(!source)fail('Sincroniza los productos antes de publicar la carta.');
    if(seen.has(i.id))fail('Producto repetido.');seen.add(i.id);
    const variants=source.webVariants||[],variant=variants.find(v=>v.id===i.variantId)||(variants.length===1?variants[0]:null);
    const name=text(i.name||source.n,'Nombre',100),price=money(variant?.price??source.p),variantId=variant?.id||source.variantId||'';
    if(!name||(i.published===true&&(!Number.isFinite(price)||price<=0||price>5000)))fail('El plato debe tener un precio válido en Loyverse.');
    if(i.published===true&&source.hasAddedTax)fail('Este plato tiene impuestos añadidos. Revisa su precio e impuestos en Loyverse antes de publicarlo.');
    if(i.published===true&&!variantId)fail('Actualiza las referencias de Loyverse y elige la presentación del plato antes de publicarlo.');
    return {id:i.id,productKey:i.id,name,category:text(source.c||'Carta','Categoría',100),description:text(i.description,'Descripción'),price,variantId,taxIds:source.taxIds||[],published:i.published===true,available:i.available===true};
  });
  const fee=money(p.deliveryFee||0);if(!Number.isFinite(fee)||fee<0||fee>100)fail('Revisa el costo de delivery.');
  if(p.enabled===true&&!items.some(i=>i.published&&i.available))fail('Publica por lo menos un plato disponible.');
  return {...old,enabled:p.enabled===true,allowDelivery:p.allowDelivery===true,allowCash:p.allowCash!==false,deliveryFee:fee,deliveryZone:text(p.deliveryZone,'Zona de reparto'),notice:text(p.notice,'Aviso de la carta'),items};
}
export function newOrder(s,p,{id,accessHash,originHash,now,paymentsReady}){
  prepare(s);const shop=s.webShop;
  if(!shop.enabled)fail('La carta todavía no está recibiendo pedidos.',409);
  if(!['mesa','recojo','delivery'].includes(p.mode))fail('Elige mesa, recojo o delivery.');
  if(p.mode==='delivery'&&!shop.allowDelivery)fail('El delivery no está disponible en este momento.',409);
  if(!['Efectivo','Tarjeta','Yape'].includes(p.method))fail('Elige un medio de pago.');
  if(p.method==='Efectivo'&&shop.allowCash===false)fail('El pago en efectivo no está disponible.');
  if(p.method!=='Efectivo'&&!paymentsReady)fail('Los pagos en línea todavía no están activados. Puedes consultar al restaurante.',409);
  const name=text(p.name,'Nombre',100),phone=text(p.phone,'Celular',20),email=text(p.email,'Correo',160),address=text(p.address,'Dirección'),table=text(p.table,'Mesa',40),note=text(p.note,'Observaciones',500);
  if(!name||!/^\+?[0-9 ()-]{7,20}$/.test(phone))fail('Indica tu nombre y un celular válido.');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Revisa el correo.');
  if(p.mode==='delivery'&&!address)fail('Indica la dirección de entrega.');if(p.mode==='mesa'&&!table)fail('Indica tu mesa.');
  const birthday=text(p.birthday,'Cumpleaños',5);
  if(birthday&&(!/^\d{2}-\d{2}$/.test(birthday)||C.dateKey('2000-'+birthday+'T12:00:00-05:00').slice(5)!==birthday))fail('Revisa el día y mes de cumpleaños.');
  if(p.privacyAccepted!==true)fail('Acepta el uso de tus datos para gestionar este pedido.');
  if(!Array.isArray(p.lines)||!p.lines.length||p.lines.length>30)fail('Elige entre 1 y 30 platos.');
  const seen=new Set(),lines=p.lines.map(l=>{
    const item=shop.items.find(i=>i.id===l.id&&i.published&&i.available);if(!item)fail('Un plato ya no está disponible. Revisa tu carrito.',409);
    const q=Number(l.quantity);if(!Number.isInteger(q)||q<1||q>30||seen.has(item.id))fail('Revisa las cantidades del pedido.');seen.add(item.id);
    if(l.price==null||money(l.price)!==item.price)fail('El precio de un plato cambió. Actualiza la carta antes de confirmar.',409);
    return {productKey:item.productKey,variantId:item.variantId,taxIds:[...(item.taxIds||[])],name:item.name,quantity:q,unitPrice:item.price};
  });
  const deliveryFee=p.mode==='delivery'?money(shop.deliveryFee||0):0,total=money(lines.reduce((n,l)=>n+l.unitPrice*l.quantity,0)+deliveryFee);
  if(total<=0||total>5000)fail('El pedido supera el importe permitido para compra en línea. Contacta al restaurante.');
  if(money(p.total)!==total)fail('El total cambió. Revisa el carrito antes de confirmar.',409);
  if(originHash&&s.onlineOrders.filter(o=>o.originHash===originHash&&new Date(o.createdAt)>new Date(now)-15*60e3).length>=6)fail('Has enviado varios pedidos. Espera unos minutos o consulta al restaurante.',429);
  const number=Math.max(s.nextWebOrderNumber||1,Math.max(0,...s.onlineOrders.map(o=>o.number))+1);s.nextWebOrderNumber=number+1;
  const order={id,number,accessHash,originHash,createdAt:now,updatedAt:now,mode:p.mode,table: p.mode==='mesa'?table:'',address:p.mode==='delivery'?address:'',name,phone,email,birthday,marketingConsent:p.marketingConsent===true,consentAt:now,privacyVersion:'2026-10-23',note,lines,deliveryFee,total,method:p.method,payment:{status:'pending'},receiptSync:{status:'pending'}};
  s.onlineOrders.push(order);
  const ticketNumber=Math.max(0,...s.kitchenTickets.map(t=>t.number||0),...(s.trash||[]).flatMap(t=>(t.bundle.kitchenTickets||[]).map(r=>r.number||0)))+1;
  s.kitchenTickets.push({id:'web/'+id,onlineOrderId:id,number:ticketNumber,date:C.dateKey(now),status:'Por aceptar',statusAt:now,createdAt:now,updatedAt:now,table:p.mode==='mesa'?'Mesa '+table:p.mode==='delivery'?'Delivery · '+name:'Recojo · '+name,note,lines:lines.map(l=>({productKey:l.productKey,quantity:l.quantity,name:l.name})),staffId:'',customerId:'',reservationId:''});
  return order;
}
export function orderTicket(s,o){return (s.kitchenTickets||[]).find(t=>t.onlineOrderId===o.id)}
export function tracking(s,o){return {number:o.number,createdAt:o.createdAt,mode:o.mode,lines:o.lines.map(l=>({name:l.name,quantity:l.quantity,unitPrice:l.unitPrice})),total:o.total,deliveryFee:o.deliveryFee,method:o.method,payment:o.payment.status,status:orderTicket(s,o)?.status||'En revisión',cancelReason:o.cancelReason||'',receiptNumber:o.receiptSync?.receiptNumber||'',archived:!!o.archived}}
export function kitchenView(s,date){
  return (s.kitchenTickets||[]).filter(t=>t.date===date).filter(t=>!s.onlineOrders?.find(o=>o.id===t.onlineOrderId)?.archived).map(t=>{
    const o=s.onlineOrders?.find(o=>o.id===t.onlineOrderId);
    return {id:t.id,number:t.number,webNumber:o?.number||null,version:t.updatedAt||t.createdAt,status:t.status,createdAt:t.createdAt,date:t.date,table:t.table,note:t.note,mode:o?.mode||'local',payment:o?.payment.status||'',method:o?.method||'',lines:t.lines.map(l=>({name:l.name||s.sales.prods[l.productKey]?.n||'Plato',quantity:l.quantity}))};
  });
}
export function kitchenChange(s,p,now){
  const t=s.kitchenTickets?.find(t=>t.id===p.id);if(!t)fail('El pedido ya no está disponible.',404);
  if((t.updatedAt||t.createdAt)!==p.version)fail('El pedido cambió en otra pantalla. Actualiza el tablero.',409);
  const o=s.onlineOrders?.find(o=>o.id===t.onlineOrderId),next={'Por aceptar':'Pendiente',Pendiente:'En preparación','En preparación':'Lista',Lista:'Entregada'}[t.status];
  if(o?.archived)fail('Este pedido está archivado.',409);
  if(p.status==='Cancelada'){
    if(!['Por aceptar','Pendiente'].includes(t.status))fail('Administración debe revisar la cancelación de este pedido.',409);
    if(['paid','submitting','processing','review'].includes(o?.payment.status))fail('El pedido tiene un pago confirmado o en revisión. Administración debe revisarlo antes de cancelarlo.',409);
    const reason=text(p.reason,'Motivo',200);if(!reason)fail('Indica el motivo del rechazo.');if(o)o.cancelReason=reason;
  }else if(p.status!==next)fail('Revisa el estado del pedido.',409);
  if(p.status!=='Cancelada'&&o&&o.method!=='Efectivo'&&o.payment.status!=='paid')fail('El pago en línea todavía no está confirmado.',409);
  Object.assign(t,{status:p.status,statusAt:now,updatedAt:now});if(o)o.updatedAt=now;
  return t;
}
export function confirmPayment(s,o,payment,now){
  if(String(payment.external_reference)!==o.id||payment.currency_id!=='PEN'||money(payment.transaction_amount)!==o.total)fail('El pago no coincide con el pedido.',409);
  const method=payment.payment_method_id==='yape'?'Yape':['credit_card','debit_card','prepaid_card'].includes(payment.payment_type_id)?'Tarjeta':null;
  if(method!==o.method)fail('El medio de pago no coincide con el pedido.',409);
  if(o.payment.id&&String(o.payment.id)!==String(payment.id)&&o.payment.status==='paid')fail('Este pedido ya tiene otro pago confirmado. Requiere revisión.',409);
  if(payment.status==='approved'&&Number(payment.transaction_amount_refunded||0)===0){o.payment={status:'paid',id:String(payment.id),paidAt:payment.date_approved||now};}
  else if(['refunded','charged_back'].includes(payment.status)||Number(payment.transaction_amount_refunded||0)>0){o.payment={...o.payment,status:'review',id:String(payment.id),reviewReason:'Devolución o contracargo en la pasarela. Revisar también Loyverse.'};}
  else if(o.payment.status!=='paid')o.payment={...o.payment,status:['rejected','cancelled'].includes(payment.status)?'failed':'processing',id:String(payment.id)};
  o.updatedAt=now;return o;
}
export function receiptPayload(o,config){
  if(o.payment.status!=='paid')fail('Confirma el pago antes de registrar la venta.');
  if(!config.storeId||!config.paymentTypes?.[o.method])fail('Configura la tienda y los medios de pago de Loyverse.');
  if(o.lines.some(l=>!l.variantId))fail('Actualiza la carta desde Loyverse antes de enviar ventas.');
  if(o.deliveryFee>0&&!config.deliveryVariantId)fail('Asocia el cargo de delivery a un artículo de Loyverse.');
  const line_items=o.lines.map(l=>({variant_id:l.variantId,quantity:l.quantity,price:l.unitPrice,line_taxes:(l.taxIds||[]).map(id=>({id}))}));
  if(o.deliveryFee>0)line_items.push({variant_id:config.deliveryVariantId,quantity:1,price:o.deliveryFee,line_taxes:(config.deliveryTaxIds||[]).map(id=>({id}))});
  return {store_id:config.storeId,order:'MISTURA-WEB-'+o.id,source:'Mistura pedidos web',receipt_date:o.payment.paidAt,note:'Pedido web #'+o.number,line_items,payments:[{payment_type_id:config.paymentTypes[o.method],paid_at:o.payment.paidAt}]};
}
