import { randomBytes } from 'node:crypto';
import { admin,state,change,json,body,replyError,hash,paymentsReady,mp } from '../lib/online-store.js';
import { settings,fail,orderTicket } from '../lib/online-core.js';
import { loyverse,syncReceipt } from '../lib/online-loyverse.js';
import { verifyPayment } from '../lib/online-payments.js';
const safeShop=s=>{const {kitchenKeyHash,operatorKeyHash,...shop}=s.webShop;return {...shop,kitchenConfigured:!!kitchenKeyHash,operatorConfigured:!!operatorKeyHash}};
async function pages(path,key){const rows=[];let cursor;for(let i=0;i<30;i++){const data=await loyverse(path+(path==='/items'?'?limit=250'+(cursor?'&cursor='+encodeURIComponent(cursor):''):''));if(!Array.isArray(data[key]))fail('Respuesta inesperada de Loyverse.',502);rows.push(...data[key]);cursor=data.cursor;if(!cursor)return rows}fail('Demasiados productos para actualizar en una sola operación.',502)}
export async function GET(r){try{
  admin(r);const action=new URL(r.url).searchParams.get('action');
  if(action==='loyverse-options'){const [stores,paymentTypes]=await Promise.all([pages('/stores','stores'),pages('/payment_types','payment_types')]);return json({stores:stores.map(s=>({id:s.id,name:s.name})),paymentTypes:paymentTypes.map(p=>({id:p.id,name:p.name}))})}
  const s=await state();return json({shop:safeShop(s),paymentsReady:paymentsReady(),products:Object.entries(s.sales.prods).map(([id,p])=>({id,name:p.n,category:p.c,price:p.p,variantId:p.variantId||'',hasAddedTax:!!p.hasAddedTax,variants:p.webVariants||[]})),orders:[...s.onlineOrders].reverse().map(({accessHash,originHash,...o})=>({...o,status:orderTicket(s,o)?.status||'En revisión'}))});
}catch(e){return replyError(e)}}
export async function POST(r){try{
  admin(r);const p=await body(r);
  if(p.action==='settings'){await change(s=>{s.webShop=settings(s,p);return true});return json({ok:true})}
  if(p.action==='kitchen-key'){
    const key=randomBytes(24).toString('hex');await change(s=>{s.webShop.kitchenKeyHash=hash(key);return true});return json({key});
  }
  if(p.action==='operator-key'){
    const key=randomBytes(24).toString('hex');await change(s=>{s.webShop.operatorKeyHash=hash(key);return true});return json({key});
  }
  if(p.action==='refresh-catalog'){
    const [items,taxes]=await Promise.all([pages('/items','items'),pages('/taxes','taxes')]);
    await change(s=>{for(const item of items){const previous=s.sales.prods[item.id];if(!previous)continue;const variant=item.variants?.[0],taxIds=(item.tax_ids||item.taxes||[]).map(t=>typeof t==='string'?t:t.id);Object.assign(previous,{p:variant?.default_price??previous.p,variantId:item.variants?.length===1?(variant.variant_id||variant.id):'',taxIds,webVariants:(item.variants||[]).map(v=>({id:v.variant_id||v.id,name:[v.option1_value,v.option2_value,v.option3_value].filter(Boolean).join(' / ')||v.variant_name||'Presentación',price:v.stores?.find(x=>x.store_id===s.webShop.loyverse?.storeId)?.price??v.default_price??0})),hasAddedTax:taxIds.some(id=>taxes.find(t=>t.id===id)?.type==='ADDED')})}return true});return json({ok:true});
  }
  if(p.action==='loyverse-config'){
    const [stores,types]=await Promise.all([pages('/stores','stores'),pages('/payment_types','payment_types')]);
    if(!stores.some(s=>s.id===p.storeId))fail('Elige una tienda válida.');
    const paymentTypes={};for(const method of ['Efectivo','Tarjeta','Yape']){const id=p.paymentTypes?.[method];if(!types.some(t=>t.id===id))fail('Elige el medio de pago de '+method+'.');paymentTypes[method]=id;}
    if(p.deliveryVariantId&&!/^[a-f0-9-]{36}$/i.test(p.deliveryVariantId))fail('Revisa el artículo de delivery.');
    await change(s=>{const delivery=p.deliveryVariantId?Object.values(s.sales.prods).find(x=>x.variantId===p.deliveryVariantId||x.webVariants?.some(v=>v.id===p.deliveryVariantId)):null;if(p.deliveryVariantId&&(!delivery||delivery.hasAddedTax))fail('Revisa el artículo y los impuestos del cargo de delivery.');s.webShop.loyverse={enabled:p.enabled===true,storeId:p.storeId,paymentTypes,deliveryVariantId:p.deliveryVariantId||'',deliveryTaxIds:delivery?.taxIds||[]};return true});return json({ok:true});
  }
  if(p.action==='sync-receipt'){await syncReceipt(p.id);return json({ok:true})}
  if(p.action==='refresh-payment'){
    const s=await state(),o=s.onlineOrders.find(x=>x.id===p.id);if(!o)fail('Pedido no encontrado.',404);
    const results=o.payment.id?[{id:o.payment.id}]:(await mp('/v1/payments/search?external_reference='+encodeURIComponent(o.id))).results||[];
    if(results.length>1)fail('Hay varias operaciones. Revisa el pedido directamente en Mercado Pago.',409);
    if(results[0])await verifyPayment(results[0].id,o.id);return json({ok:true});
  }
  if(p.action==='cash-paid'){
    await change(s=>{const o=s.onlineOrders.find(x=>x.id===p.id);if(!o||o.method!=='Efectivo')fail('Elige un pedido en efectivo.');if(orderTicket(s,o)?.status==='Cancelada')fail('El pedido está cancelado.');if(o.payment.status==='paid')return true;o.payment={status:'paid',paidAt:new Date().toISOString(),confirmedBy:'admin'};return true});await syncReceipt(p.id);return json({ok:true});
  }
  if(p.action==='edit-contact'){
    await change(s=>{const o=s.onlineOrders.find(x=>x.id===p.id);if(!o)fail('Pedido no encontrado.');for(const field of ['name','phone','address','note']){if(typeof p[field]!=='string'||p[field].length>500)fail('Revisa los datos del contacto.');o[field]=p[field].trim()}const t=orderTicket(s,o);if(t)t.note=o.note;return true});return json({ok:true});
  }
  if(p.action==='archive'){
    await change(s=>{const o=s.onlineOrders.find(x=>x.id===p.id);if(!o)fail('Pedido no encontrado.');const t=orderTicket(s,o);if(p.archived!==false&&o.payment.status==='paid'&&!['Entregada','Cancelada'].includes(t?.status))fail('Entrega o revisa el pedido pagado antes de archivarlo.');if(p.archived!==false&&o.payment.status!=='paid'&&['submitting','processing','review'].includes(o.payment.status))fail('Revisa primero el pago en curso.');o.archived=p.archived!==false;if(o.archived&&o.payment.status!=='paid'&&t){t.status='Cancelada';o.cancelReason='Archivado por administración';t.updatedAt=new Date().toISOString()}return true});return json({ok:true});
  }
  fail('Acción no permitida.');
}catch(e){return replyError(e)}}
