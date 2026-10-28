import { randomUUID } from 'node:crypto';
import { state,change,json,body,replyError,trackingOrder,hash,originHash,paymentsReady } from '../lib/online-store.js';
import { publicMenu,newOrder,tracking,fail } from '../lib/online-core.js';
import { verifyPayment } from '../lib/online-payments.js';
export async function GET(r){try{
  let s=await state();
  if(new URL(r.url).searchParams.get('action')==='track'){
    let o=trackingOrder(r,s);
    if(o.payment.id&&o.payment.status==='processing'){try{await verifyPayment(o.payment.id,o.id);s=await state();o=trackingOrder(r,s)}catch{}}
    return json(tracking(s,o));
  }
  return json({...publicMenu(s,paymentsReady()),publicKey:paymentsReady()?process.env.MP_PUBLIC_KEY:'',testMode:process.env.MP_ACCESS_TOKEN?.startsWith('TEST-')||false});
}catch(e){return replyError(e)}}
export async function POST(r){try{
  const p=await body(r),token=r.headers.get('x-order-token')||'';if(!/^[a-f0-9]{64}$/.test(token))fail('Revisa el identificador del pedido.');
  const accessHash=hash(token),id=randomUUID(),now=new Date().toISOString(),origin=originHash(r);
  const result=await change(s=>{let o=s.onlineOrders.find(x=>x.accessHash===accessHash);if(!o)o=newOrder(s,p,{id,accessHash,originHash:origin,now,paymentsReady:paymentsReady()});return tracking(s,o)});
  return json(result,201);
}catch(e){return replyError(e)}}
