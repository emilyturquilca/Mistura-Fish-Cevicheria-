import { state,change,json,body,replyError,trackingOrder,mp,paymentsReady } from '../lib/online-store.js';
import { fail,tracking,orderTicket } from '../lib/online-core.js';
import { verifyPayment } from '../lib/online-payments.js';
export async function POST(r){try{
  const p=await body(r);if(!paymentsReady())fail('La pasarela todavía no está conectada.',503);
  const s=await state(),o=trackingOrder(r,s);
  if(p.action==='refresh'){
    const candidates=o.payment.id?[{id:o.payment.id}]:(await mp('/v1/payments/search?external_reference='+encodeURIComponent(o.id))).results||[];
    if(candidates.length>1)fail('Hay más de una operación de pago. Administración debe revisarlas.',409);
    if(candidates[0])await verifyPayment(candidates[0].id,o.id);
    const fresh=await state();return json(tracking(fresh,fresh.onlineOrders.find(x=>x.id===o.id)));
  }
  if(o.method==='Efectivo')fail('Este pedido se cobra en efectivo.');
  if(!p.token||String(p.token).length>200||!/^\S+@\S+\.\S+$/.test(p.email||''))fail('Completa los datos del pago.');
  if(!/^[a-f0-9-]{20,80}$/i.test(p.attemptId||''))fail('Identificador de pago inválido.');
  const method=String(p.paymentMethodId||'');if(o.method==='Yape'?method!=='yape':!/^\w{1,40}$/.test(method)||method==='yape')fail('Medio de pago inválido.');
  const claim=await change(s=>{
    const order=trackingOrder(r,s),ticket=orderTicket(s,order);
    if(['Cancelada','Entregada'].includes(ticket?.status))fail('Este pedido ya no admite pagos.',409);
    if(order.payment.status==='paid')return {paid:true};
    if(['submitting','processing','review'].includes(order.payment.status))fail('Hay un pago en proceso. Pulsa Actualizar pago antes de volver a intentar.',409);
    order.payment={status:'submitting',attemptId:p.attemptId,startedAt:new Date().toISOString()};return {id:order.id,total:order.total};
  });
  if(claim.paid)return json(tracking(s,o));
  try{
    const payer={email:p.email};if(p.identification?.type&&p.identification?.number)payer.identification={type:String(p.identification.type).slice(0,10),number:String(p.identification.number).slice(0,30)};
    const payment=await mp('/v1/payments',{method:'POST',headers:{'X-Idempotency-Key':o.id+'-'+p.attemptId},body:JSON.stringify({transaction_amount:claim.total,currency_id:'PEN',token:p.token,payment_method_id:method,...(p.issuerId?{issuer_id:String(p.issuerId).slice(0,30)}:{}),installments:1,payer,external_reference:o.id,description:'Mistura Fish · Pedido '+o.number,notification_url:process.env.PUBLIC_APP_URL.replace(/\/$/,'')+'/api/mp-webhook'})});
    if(!/^\d+$/.test(String(payment.id)))fail('La pasarela no devolvió una confirmación válida. Revisa el pago antes de repetir.',502);
    await change(s=>{const order=s.onlineOrders.find(x=>x.id===o.id);order.payment={...order.payment,status:'processing',id:String(payment.id)};return true});
    await verifyPayment(payment.id,o.id);
  }catch(e){await change(s=>{const order=s.onlineOrders.find(x=>x.id===o.id);if(order.payment.status==='submitting')order.payment.status='review';return true});throw e}
  const fresh=await state();return json(tracking(fresh,fresh.onlineOrders.find(x=>x.id===o.id)));
}catch(e){return replyError(e)}}
