import { createHmac } from 'node:crypto';
import { equal,mp,change } from './online-store.js';
import { confirmPayment,fail } from './online-core.js';
import { syncReceipt } from './online-loyverse.js';
export function webhookValid(r,secret){
  const url=new URL(r.url),id=url.searchParams.get('data.id'),requestId=r.headers.get('x-request-id'),parts=Object.fromEntries((r.headers.get('x-signature')||'').split(',').map(x=>x.trim().split('=')));
  if(!secret||!id||!requestId||!/^\d+$/.test(parts.ts||'')||!/^[a-f0-9]{64}$/i.test(parts.v1||''))return false;
  const manifest=`id:${id.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  return equal(createHmac('sha256',secret).update(manifest).digest('hex'),parts.v1.toLowerCase());
}
export async function verifyPayment(id,expectedOrderId=null){
  if(!/^\d+$/.test(String(id)))fail('Pago inválido.');
  const payment=await mp('/v1/payments/'+encodeURIComponent(id));
  if(expectedOrderId&&payment.external_reference!==expectedOrderId)fail('El pago no corresponde al pedido.',409);
  const orderId=await change(s=>{const o=s.onlineOrders.find(o=>o.id===payment.external_reference);if(!o)fail('Pedido no encontrado.',404);confirmPayment(s,o,payment,new Date().toISOString());return o.id});
  await syncReceipt(orderId);return orderId;
}
