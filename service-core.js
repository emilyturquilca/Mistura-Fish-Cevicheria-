// Service planning, kitchen, team and customer rules. Shared by browser and API.
(() => {
  const C=()=>globalThis.MisturaCore,O=()=>globalThis.MisturaOperations;
  const collections=['productionPlans','kitchenTickets','staff','shifts','customers','customerVisits','loyaltyRewards'];
  function prepare(s){for(const key of collections)s[key] ||= [];s.reservations ||= []}
  const fail=message=>{throw Error(message)};
  function day(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value))||!Number.isFinite(+C().dayStart(value))||C().dateKey(C().dayStart(value))!==value)fail('Indica una fecha válida.');
    return value;
  }
  function integer(value,label,h,zero=false){const n=h.num(value,label,zero);if(!Number.isInteger(n))h.fail(label+': usa un número entero.');return n}
  function lines(s,input,h){
    if(!Array.isArray(input)||!input.length||input.length>100)h.fail('Agrega entre 1 y 100 platos.');
    const seen=new Set();return input.map(l=>{
      if(!s.sales.prods[l.productKey])h.fail('Plato no encontrado; sincroniza Loyverse.');
      if(seen.has(l.productKey))h.fail('No repitas el plato; suma sus cantidades.');seen.add(l.productKey);
      return {productKey:l.productKey,quantity:integer(l.quantity,'Cantidad de platos',h)};
    });
  }
  function save(s,entity,p,record,command,now,h){
    if(p.id)Object.assign(h.find(s[entity],p.id,'Registro'),record,{updatedAt:now});
    else s[entity].push({id:command.id,createdAt:now,updatedAt:now,...record});
  }
  function demand(s,date){
    const tickets=(s.kitchenTickets||[]).filter(t=>t.date===date&&!['Cancelada','Por aceptar'].includes(t.status));
    const linked=new Set(tickets.map(t=>t.reservationId).filter(Boolean));
    const reservations=(s.reservations||[]).filter(r=>r.status==='Pendiente'&&C().dateKey(r.plannedAt)===date&&!linked.has(r.id));
    const dishes={};for(const row of [...tickets,...reservations])for(const l of row.lines)dishes[l.productKey]=(dishes[l.productKey]||0)+l.quantity;
    return dishes;
  }
  function requirements(s,dishes){
    const needs={},missing=[];
    for(const [key,q]of Object.entries(dishes)){
      const recipe=s.recipes.find(r=>r.productKey===key);
      if(!recipe||recipe.lines.some(l=>!s.ingredients.some(i=>i.id===l.ingredientId))){missing.push(key);continue}
      for(const l of recipe.lines)needs[l.ingredientId]=(needs[l.ingredientId]||0)+q*l.quantity/l.yield/recipe.portions;
    }
    return {missing,ingredients:Object.entries(needs).map(([id,q])=>({id,quantity:O().round(q),stock:O().stock(s,id),buy:O().round(Math.max(0,q-O().stock(s,id)))}))};
  }
  function loyalty(s,customer){
    const returns={};for(const r of Object.values(s.sales.v))if(r.type==='REFUND'&&r.refundFor)returns[r.refundFor]=(returns[r.refundFor]||0)+(r.net??r.total??0);
    const history=customer.loyverseId?Object.values(s.sales.v).filter(r=>r.type==='SALE'&&r.customerId===customer.loyverseId):[];
    const purchases=history.filter(r=>(r.net??r.total??0)+(returns[r.id]||0)>0);
    const visits=customer.loyverseId?[]:(s.customerVisits||[]).filter(v=>v.customerId===customer.id);
    const rewards=(s.loyaltyRewards||[]).filter(v=>v.customerId===customer.id);
    const earned=purchases.length+visits.length,used=rewards.reduce((n,r)=>n+r.visitsUsed,0),remaining=Math.max(0,earned-used);
    return {purchases,history,returns,visits,rewards,earned,used,remaining,deficit:Math.max(0,used-earned),spend:C().round(history.reduce((n,r)=>n+(r.net??r.total??0)+(returns[r.id]||0),0)),available:s.loyaltyProgram?Math.floor(remaining/s.loyaltyProgram.target):0};
  }
  function forecast(s,date,today=C().dateKey()){
    day(date);const weekday=C().dayStart(date).getUTCDay(),end=date<today?date:today,start=C().shiftDay(end,-56),days=new Map();
    for(const r of Object.values(s.sales.v)){
      const d=C().dateKey(r.f);if(r.type!=='SALE'||d<start||d>=end||C().dayStart(d).getUTCDay()!==weekday)continue;
      if(!days.has(d))days.set(d,{});const row=days.get(d);
      for(const l of r.items||[])if(l.q>0)row[l.k]=(row[l.k]||0)+l.q;
    }
    const confirmed=demand(s,date),keys=new Set([...Object.keys(confirmed),...Array.from(days.values()).flatMap(d=>Object.keys(d))]);
    const rows=[...keys].map(key=>{
      const observed=[...days.values()].map(d=>d[key]||0),average=observed.length?observed.reduce((a,b)=>a+b,0)/observed.length:null;
      const estimate=days.size>=3?Math.ceil(average):null,reserved=confirmed[key]||0;
      return {key,average,estimate,confirmed:reserved,suggested:Math.max(reserved,estimate||0)};
    }).sort((a,b)=>b.suggested-a.suggested);
    return {days:[...days.keys()].sort(),rows,...requirements(s,Object.fromEntries(rows.filter(r=>r.suggested>0).map(r=>[r.key,r.suggested])))};
  }
  function apply(s,command,now,h){
    const p=command.payload||{};prepare(s);
    if(command.type==='productionPlan'){
      const date=day(p.date),status=h.text(p.status||'Planificada','Estado');
      if(!['Planificada','En preparación','Lista','Cancelada'].includes(status))h.fail('Estado de producción inválido.');
      if(s.productionPlans.some(r=>r.id!==p.id&&r.date===date&&r.status!=='Cancelada')&&status!=='Cancelada')h.fail('Ya existe un plan activo para ese día. Edítalo para agregar platos.');
      if(p.staffId)h.find(s.staff,p.staffId,'Responsable');
      const selected=lines(s,p.lines,h);
      if(s.settings?.stockMode==='recipes'&&status!=='Planificada'&&status!=='Cancelada'&&requirements(s,Object.fromEntries(selected.map(l=>[l.productKey,l.quantity]))).missing.length)h.fail('Completa las recetas antes de iniciar la preparación.');
      save(s,'productionPlans',p,{date,status,staffId:p.staffId||'',note:h.text(p.note,'Notas',true),lines:selected},command,now,h);return true;
    }
    if(command.type==='kitchenTicket'){
      if(p.id&&s.kitchenTickets.find(t=>t.id===p.id)?.onlineOrderId)h.fail('Este pedido viene de la web. Corrige su contacto u observaciones desde Pedidos web; conserva los platos y el importe del pedido.');
      const reservation=p.reservationId?h.find(s.reservations,p.reservationId,'Reservación'):null;
      if(reservation?.status==='Cancelada')h.fail('La reservación está cancelada.');
      if(reservation&&s.kitchenTickets.some(t=>t.id!==p.id&&t.reservationId===reservation.id&&t.status!=='Cancelada'))h.fail('Esa reservación ya tiene una comanda.');
      const date=day(p.date||C().dateKey(reservation?.plannedAt)),status=p.status||'Pendiente';
      if(!['Pendiente','En preparación','Lista','Entregada','Cancelada'].includes(status))h.fail('Estado de comanda inválido.');
      if(reservation&&date!==C().dateKey(reservation.plannedAt))h.fail('La fecha debe coincidir con la reservación.');
      if(p.staffId)h.find(s.staff,p.staffId,'Responsable');if(p.customerId)h.find(s.customers,p.customerId,'Cliente');
      const selected=lines(s,p.lines||reservation?.lines,h);
      const previous=p.id?h.find(s.kitchenTickets,p.id,'Comanda'):null;
      save(s,'kitchenTickets',p,{number:previous?.number||Math.max(0,...s.kitchenTickets.map(t=>t.number||0),...(s.trash||[]).flatMap(t=>(t.bundle.kitchenTickets||[]).map(r=>r.number||0)))+1,date,status,reservationId:reservation?.id||'',customerId:p.customerId||'',staffId:p.staffId||'',table:h.text(p.table||reservation?.name,'Mesa / pedido'),note:h.text(p.note??reservation?.note,'Notas',true),lines:selected,statusAt:previous?.status===status?previous.statusAt:now},command,now,h);return true;
    }
    if(command.type==='kitchenStatus'){
      const ticket=h.find(s.kitchenTickets,p.id,'Comanda'),next={'Por aceptar':'Pendiente',Pendiente:'En preparación','En preparación':'Lista',Lista:'Entregada'}[ticket.status];
      const online=s.onlineOrders?.find(o=>o.id===ticket.onlineOrderId);
      if(online&&(online.archived||(online.method!=='Efectivo'&&online.payment.status!=='paid')))h.fail('El pedido web requiere confirmar el pago o revisar su archivo antes de continuar.');
      if(p.status!==next)h.fail('Actualiza la comanda y revisa su estado.');
      Object.assign(ticket,{status:next,statusAt:now,updatedAt:now});return true;
    }
    if(command.type==='staff'){
      save(s,'staff',p,{name:h.text(p.name,'Nombre'),role:h.text(p.role,'Puesto'),phone:h.text(p.phone,'Teléfono',true),active:p.active!=='No',note:h.text(p.note,'Notas',true)},command,now,h);return true;
    }
    if(command.type==='shift'){
      h.find(s.staff,p.staffId,'Persona');
      const start=C().parseDate(p.start),end=C().parseDate(p.end);
      if(!start||!end||new Date(end)<=new Date(start)||new Date(end)-new Date(start)>24*3600e3)h.fail('Revisa el horario: el fin debe ser posterior y el turno no puede superar 24 horas.');
      for(const value of [p.start,p.end])if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value))||C().dateKey(C().parseDate(value))!==value.slice(0,10))h.fail('Indica una fecha y hora válidas para el turno.');
      const status=p.status||'Programado';if(!['Programado','Asistió','Faltó','Cancelado'].includes(status))h.fail('Estado del turno inválido.');
      if(['Asistió','Faltó'].includes(status)&&C().dateKey(start)>C().dateKey(now))h.fail('No registres asistencia de un turno futuro.');
      if(status!=='Cancelado'&&s.shifts.some(r=>r.id!==p.id&&r.staffId===p.staffId&&r.status!=='Cancelado'&&new Date(r.start)<new Date(end)&&new Date(r.end)>new Date(start)))h.fail('Esta persona ya tiene un turno en ese horario.');
      save(s,'shifts',p,{staffId:p.staffId,start,end,status,note:h.text(p.note,'Notas',true)},command,now,h);return true;
    }
    if(command.type==='customer'){
      const previous=p.id?h.find(s.customers,p.id,'Cliente'):null,loyverseId=h.text(p.loyverseId,'Cliente Loyverse',true);
      if(loyverseId&&s.customers.some(c=>c.id!==p.id&&c.loyverseId===loyverseId))h.fail('Ese cliente de Loyverse ya está vinculado a otra ficha.');
      if(previous&&previous.loyverseId!==loyverseId&&(s.customerVisits.some(v=>v.customerId===p.id)||s.loyaltyRewards.some(v=>v.customerId===p.id)))h.fail('Corrige primero las visitas y beneficios antes de cambiar el vínculo con Loyverse.');
      save(s,'customers',p,{name:h.text(p.name,'Nombre'),phone:h.text(p.phone,'Teléfono',true),loyverseId,note:h.text(p.note,'Preferencias',true)},command,now,h);return true;
    }
    if(command.type==='customerVisit'){
      const customer=h.find(s.customers,p.customerId,'Cliente'),date=h.date(p.date,now);
      if(customer.loyverseId)h.fail('Las compras de este cliente se cuentan desde Loyverse; no registres visitas duplicadas.');
      if(s.customerVisits.some(v=>v.id!==p.id&&v.customerId===customer.id&&v.date===date))h.fail('Ya registraste una visita de este cliente en esa fecha.');
      save(s,'customerVisits',p,{customerId:customer.id,date,note:h.text(p.note,'Notas',true)},command,now,h);return true;
    }
    if(command.type==='loyaltyProgram'){
      if(p.clear===true){delete s.loyaltyProgram;return true}
      s.loyaltyProgram={target:integer(p.target,'Compras o visitas para un beneficio',h),reward:h.text(p.reward,'Beneficio'),updatedAt:now};return true;
    }
    if(command.type==='loyaltyReward'){
      const customer=h.find(s.customers,p.customerId,'Cliente');
      if(p.id){const old=h.find(s.loyaltyRewards,p.id,'Beneficio');if(old.customerId!==customer.id)h.fail('No cambies el cliente del beneficio.');Object.assign(old,{date:h.date(p.date,now),note:h.text(p.note,'Notas',true),updatedAt:now});return true}
      if(!s.loyaltyProgram||!loyalty(s,customer).available)h.fail('El cliente todavía no reúne compras o visitas para un beneficio.');
      save(s,'loyaltyRewards',p,{customerId:customer.id,date:h.date(p.date,now),visitsUsed:s.loyaltyProgram.target,reward:s.loyaltyProgram.reward,note:h.text(p.note,'Notas',true)},command,now,h);return true;
    }
    return false;
  }
  function after(s,previous,command,h){
    if(!['restore','customer','customerVisit','delete'].includes(command.type))return;
    for(const customer of s.customers||[]){
      const old=previous.customers?.find(c=>c.id===customer.id),before=old?loyalty(previous,old).deficit:0;
      if(loyalty(s,customer).deficit>before)h.fail('El cambio dejaría beneficios sin compras o visitas que los respalden. Corrige primero los beneficios entregados.');
    }
  }
  function validate(s,h){
    prepare(s);
    for(const r of [...s.productionPlans,...s.kitchenTickets]){if(r.staffId)h.find(s.staff,r.staffId,'Responsable');if(r.customerId)h.find(s.customers,r.customerId,'Cliente')}
    for(const r of s.shifts)h.find(s.staff,r.staffId,'Persona del turno');
    for(const r of [...s.customerVisits,...s.loyaltyRewards])h.find(s.customers,r.customerId,'Cliente del historial');
    const activePlans=s.productionPlans.filter(p=>p.status!=='Cancelada').map(p=>p.date);
    if(new Set(activePlans).size!==activePlans.length)h.fail('Ya existe un plan activo para ese día.');
    const linked=s.kitchenTickets.filter(t=>t.status!=='Cancelada'&&t.reservationId).map(t=>t.reservationId);
    if(new Set(linked).size!==linked.length)h.fail('La reservación ya tiene una comanda activa.');
    const linkedCustomers=s.customers.filter(c=>c.loyverseId).map(c=>c.loyverseId);
    if(new Set(linkedCustomers).size!==linkedCustomers.length)h.fail('Ese cliente de Loyverse ya está vinculado.');
    const visits=s.customerVisits.map(v=>v.customerId+'/'+v.date);
    if(new Set(visits).size!==visits.length)h.fail('Ya existe una visita del cliente en esa fecha.');
    for(const a of s.shifts)if(a.status!=='Cancelado'&&s.shifts.some(b=>b.id!==a.id&&b.staffId===a.staffId&&b.status!=='Cancelado'&&new Date(a.start)<new Date(b.end)&&new Date(a.end)>new Date(b.start)))h.fail('Hay turnos superpuestos. Corrige el turno actual antes de restaurar.');
  }
  globalThis.MisturaService={collections,prepare,apply,after,validate,demand,requirements,loyalty,forecast};
})();
