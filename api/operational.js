import { state,change,json,body,replyError,operator } from '../lib/online-store.js';
import { kitchenView,kitchenChange,fail,orderTicket } from '../lib/online-core.js';
import { syncReceipt } from '../lib/online-loyverse.js';
const C=globalThis.MisturaCore,S=globalThis.MisturaService,O=globalThis.MisturaOperations;
const stamp=r=>r.updatedAt||r.createdAt||r.id;
function view(s){
  S.prepare(s);const date=C.dateKey();
  return {role:'operativo',date,products:Object.entries(s.sales.prods).map(([id,p])=>({id,name:p.n})),
    reservations:s.reservations.map(r=>({id:r.id,version:stamp(r),name:r.name,phone:r.phone,guests:r.guests,plannedAt:r.plannedAt,status:r.status,note:r.note,lines:r.lines})),
    plans:s.productionPlans.map(p=>({id:p.id,version:stamp(p),date:p.date,status:p.status,note:p.note,lines:p.lines})),
    customers:s.customers.map(c=>{const b=S.loyalty(s,c);return {id:c.id,version:stamp(c),name:c.name,phone:c.phone,note:c.note,linked:!!c.loyverseId,earned:b.earned,remaining:b.remaining,available:b.available,visits:b.visits.map(v=>({id:v.id,version:stamp(v),customerId:c.id,date:v.date,note:v.note})),rewards:b.rewards.map(v=>({id:v.id,version:stamp(v),customerId:c.id,date:v.date,reward:v.reward,note:v.note}))}}),
    program:s.loyaltyProgram?{target:s.loyaltyProgram.target,reward:s.loyaltyProgram.reward}:null,
    tickets:kitchenView(s,date).map(t=>{const raw=s.kitchenTickets.find(k=>k.id===t.id),o=s.onlineOrders.find(o=>o.id===raw?.onlineOrderId);return {...t,reservationId:raw?.reservationId||'',lines:raw.lines.map(l=>({productKey:l.productKey,name:l.name||s.sales.prods[l.productKey]?.n||'Plato',quantity:l.quantity})),...(o?{orderId:o.id,total:o.total}:{})}}),
    demand:S.demand(s,date)};
}
export async function GET(r){try{const s=await state();operator(r,s);return json(view(s))}catch(e){return replyError(e)}}
export async function POST(r){try{
  const data=await body(r),now=new Date().toISOString();
  if(data.action==='kitchen'){
    await change(s=>{operator(r,s);kitchenChange(s,data,now);return true});
  }else if(data.action==='cash-paid'){
    await change(s=>{operator(r,s);const o=s.onlineOrders.find(o=>o.id===data.id);if(!o||o.method!=='Efectivo'||orderTicket(s,o)?.status==='Cancelada'||data.received!==true)fail('Confirma el efectivo recibido para este pedido.');if(o.payment.status!=='paid')o.payment={status:'paid',paidAt:now,confirmedBy:'operativo'};return true});await syncReceipt(data.id);
  }else{
    const allowed={reservation:'reservations',productionPlan:'productionPlans',kitchenTicket:'kitchenTickets',customer:'customers',customerVisit:'customerVisits',loyaltyReward:'loyaltyRewards'};
    if(!allowed[data.type]&&data.type!=='delete')fail('Este perfil no tiene permiso para esa operación.',403);
    if(typeof data.commandId!=='string'||!/^[a-f0-9-]{36}$/i.test(data.commandId))fail('Identificador inválido.');
    await change(s=>{
      operator(r,s);if(s.commands.some(c=>c.id===data.commandId))return true;
      const p=data.payload||{};
      const entity=data.type==='delete'?p.entity:allowed[data.type];
      if(data.type==='delete'&&!['reservations','productionPlans','kitchenTickets','customers','customerVisits','loyaltyRewards'].includes(entity))fail('No puedes eliminar ese tipo de registro.',403);
      const id=data.type==='delete'?p.targetId:p.id,old=id?s[entity]?.find(x=>x.id===id):null;
      if(id&&(!old||stamp(old)!==data.version))fail('El registro cambió. Actualiza y vuelve a revisar.',409);
      let payload;
      if(data.type==='reservation')payload={id:p.id,name:p.name,phone:p.phone,guests:p.guests,plannedAt:p.plannedAt,status:p.status,note:p.note,lines:p.lines};
      if(data.type==='productionPlan')payload={id:p.id,date:p.date,status:p.status,note:p.note,lines:p.lines,staffId:old?.staffId||''};
      if(data.type==='kitchenTicket')payload={id:p.id,date:p.date,status:p.status,table:p.table,note:p.note,lines:p.lines,reservationId:p.reservationId||old?.reservationId||'',staffId:old?.staffId||'',customerId:old?.customerId||''};
      if(data.type==='customer')payload={id:p.id,name:p.name,phone:p.phone,note:p.note,loyverseId:old?.loyverseId||''};
      if(['customerVisit','loyaltyReward'].includes(data.type))payload={id:p.id,customerId:p.customerId,date:p.date,note:p.note};
      if(data.type==='delete')payload={entity,targetId:id};
      Object.assign(s,O.apply(s,{id:data.commandId,type:data.type,payload},now).state);return true;
    });
  }
  const s=await state();operator(r,s);return json(view(s));
}catch(e){return replyError(e)}}
