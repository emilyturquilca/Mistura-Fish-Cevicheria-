import { json,replyError } from '../lib/online-store.js';
import { webhookValid,verifyPayment } from '../lib/online-payments.js';
export async function POST(r){
  if(!webhookValid(r,process.env.MP_WEBHOOK_SECRET))return json({error:'Firma inválida'},401);
  try{const id=new URL(r.url).searchParams.get('data.id');await verifyPayment(id);return json({ok:true})}catch(e){return replyError(e)}
}
