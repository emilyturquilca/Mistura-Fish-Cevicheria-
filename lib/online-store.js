import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
import { authorized,load,save } from '../api/operations.js';
import { prepare,fail } from './online-core.js';
export const hash=value=>createHash('sha256').update(String(value)).digest('hex');
let storage={load,save};
// Explicit dependency injection for isolated tests/local preview; never selected by a request.
export function testStorage(adapter){if(process.env.NODE_ENV!=='test')throw Error('Test adapter unavailable');storage=adapter}
export const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function originAllowed(r){const origin=r.headers.get('origin');return !origin||origin===new URL(r.url).origin}
export async function body(r){if(!originAllowed(r))fail('Origen no permitido.',403);if(!r.headers.get('content-type')?.includes('application/json'))fail('Formato no permitido.',415);const text=await r.text();if(text.length>24000)fail('Pedido demasiado grande.',413);try{return JSON.parse(text)}catch{fail('Solicitud inválida.')}}
export function replyError(e){if(e.status)return json({error:e.message},e.status);console.error('Online order request failed:',e.name);return json({error:'No se pudo confirmar la operación. Actualiza el estado antes de repetirla.'},503)}
export async function change(fn){for(let i=0;i<5;i++){const current=await storage.load();prepare(current.state);const result=await fn(current.state);const version=await storage.save(current.state,current.version);if(version!=null)return result}fail('Hay cambios simultáneos. Actualiza y vuelve a intentarlo.',409)}
export async function state(){const data=await storage.load();prepare(data.state);return data.state}
export function admin(r){if(!authorized(r))fail('No autorizado',401)}
export function kitchen(r,s){if(authorized(r))return;const key=r.headers.get('x-cocina')||'';if(key.length<32||![s.webShop.kitchenKeyHash,s.webShop.operatorKeyHash].some(h=>h&&equal(hash(key),h)))fail('Código de cocina inválido.',401)}
export function operator(r,s){if(authorized(r))return;const key=r.headers.get('x-operativo')||'';if(key.length<32||!s.webShop.operatorKeyHash||!equal(hash(key),s.webShop.operatorKeyHash))fail('Código operativo inválido.',401)}
export function trackingOrder(r,s){const token=r.headers.get('x-order-token')||'';if(!/^[a-f0-9]{64}$/.test(token))fail('Enlace de seguimiento inválido.',404);const order=s.onlineOrders.find(o=>equal(o.accessHash,hash(token)));if(!order)fail('Pedido no encontrado.',404);return order}
export function originHash(r){const ip=r.headers.get('x-vercel-forwarded-for')||r.headers.get('x-forwarded-for')||'unknown';return createHmac('sha256',process.env.APP_PASSWORD||'local-preview-only').update(ip.split(',')[0].trim()).digest('hex')}
export function paymentsReady(){return Boolean(process.env.MP_ACCESS_TOKEN&&process.env.MP_PUBLIC_KEY&&process.env.MP_WEBHOOK_SECRET&&process.env.PUBLIC_APP_URL)}
export async function mp(path,options={}){
  if(!process.env.MP_ACCESS_TOKEN)fail('La pasarela todavía no está conectada.',503);
  const r=await fetch('https://api.mercadopago.com'+path,{...options,headers:{Authorization:'Bearer '+process.env.MP_ACCESS_TOKEN,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(20000)});
  const data=await r.json().catch(()=>({}));if(!r.ok)fail('La pasarela no confirmó la operación. Revisa el estado del pedido antes de repetir.',502);return data;
}
