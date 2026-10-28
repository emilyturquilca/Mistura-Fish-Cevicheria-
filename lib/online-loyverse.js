import { change,state } from './online-store.js';
import { fail,receiptPayload,money } from './online-core.js';
export async function loyverse(path,options={}){
  if(!process.env.LOYVERSE_TOKEN)fail('Falta conectar Loyverse.',503);
  const r=await fetch('https://api.loyverse.com/v1.0'+path,{...options,headers:{Authorization:'Bearer '+process.env.LOYVERSE_TOKEN,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(20000)});
  const data=await r.json().catch(()=>({}));if(!r.ok)fail('Loyverse no confirmó la operación ('+r.status+').',502);return data;
}
export async function syncReceipt(orderId){
  const initial=await state(),order=initial.onlineOrders.find(o=>o.id===orderId),config=initial.webShop.loyverse;
  if(!order||order.payment.status!=='paid'||!config?.enabled||order.receiptSync?.status==='synced')return;
  const marker='MISTURA-WEB-'+order.id;
  // A receipt POST has no documented idempotency key. Never repeat an ambiguous write.
  const claim=await change(s=>{const o=s.onlineOrders.find(x=>x.id===orderId);if(o.receiptSync.status==='synced')return null;if(o.receiptSync.status==='sending'&&new Date(o.receiptSync.at)>Date.now()-90000)return null;const allowCreate=o.receiptSync.status==='pending';const payload=receiptPayload(o,s.webShop.loyverse);o.receiptSync={...o.receiptSync,status:'sending',at:new Date().toISOString()};return {allowCreate,payload}});
  if(!claim)return;
  let posted=false;
  try{
    const existing=await loyverse('/receipts?order='+encodeURIComponent(marker));
    const receipts=(existing.receipts||[]).filter(r=>r.order===marker&&!r.cancelled_at&&r.receipt_type==='SALE');
    if(existing.cursor||receipts.length>1)fail('Hay recibos duplicados o sin conciliar. Revisa Loyverse.',409);
    let receipt=receipts[0];
    if(!receipt){
      if(!claim.allowCreate)fail('No se encontró un recibo confirmado. Revisa Loyverse antes de autorizar otro envío.',409);
      const taxIds=[...new Set(claim.payload.line_items.flatMap(l=>(l.line_taxes||[]).map(t=>t.id)))];
      if(taxIds.length){const data=await loyverse('/taxes');for(const id of taxIds){const tax=data.taxes?.find(t=>t.id===id);if(!tax||tax.type!=='INCLUDED'||tax.deleted_at||(tax.stores?.length&&!tax.stores.includes(claim.payload.store_id)))fail('Revisa los impuestos del pedido antes de enviar la venta a Loyverse.',409)}}
      posted=true;receipt=await loyverse('/receipts',{method:'POST',body:JSON.stringify(claim.payload)});
    }
    if(!receipt.receipt_number||money(receipt.total_money)!==order.total)fail('El importe del recibo no coincide. Revisa impuestos y delivery en Loyverse.',409);
    await change(s=>{
      const o=s.onlineOrders.find(x=>x.id===orderId);o.receiptSync={status:'synced',receiptNumber:receipt.receipt_number,at:new Date().toISOString()};
      globalThis.MisturaCore.mergeReceipts(s.sales,[receipt]);globalThis.MisturaRestaurant.reconcile(s);
      return true;
    });
  }catch(e){await change(s=>{const o=s.onlineOrders.find(x=>x.id===orderId);if(o.receiptSync.status!=='synced')o.receiptSync={...o.receiptSync,status:'review',message:e.status?e.message:'Se perdió la confirmación. Conciliar antes de repetir.',ambiguous:posted};return false});}
}
