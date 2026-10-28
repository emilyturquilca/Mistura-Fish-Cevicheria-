import { state,change,json,body,replyError,kitchen } from '../lib/online-store.js';
import { kitchenView,kitchenChange,fail } from '../lib/online-core.js';
export async function GET(r){try{const s=await state();kitchen(r,s);const date=new URL(r.url).searchParams.get('date')||globalThis.MisturaCore.dateKey();if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('Fecha inválida.');return json({tickets:kitchenView(s,date),date})}catch(e){return replyError(e)}}
export async function POST(r){try{const p=await body(r);await change(s=>{kitchen(r,s);kitchenChange(s,p,new Date().toISOString());return true});return json({ok:true})}catch(e){return replyError(e)}}
